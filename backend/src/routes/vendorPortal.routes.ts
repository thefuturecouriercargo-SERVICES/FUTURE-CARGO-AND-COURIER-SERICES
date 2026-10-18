import { Router } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticateVendor } from "../middleware/auth";
import { parseDateParam, monthRange, formatDate, dayRange } from "../utils/dates";
import { z } from "zod";
import { ApiError } from "../utils/asyncHandler";
import { bookingInputSchema, createBooking, assertRefFree } from "../services/booking.service";
import { writeAuditLog } from "../services/audit.service";
import { readOrderPhoto, storeSlipPhoto, attachSlipPhoto, getBookingPhoto, photoReaderConfigured } from "../services/photoReader.service";
import { emitGlobal } from "../lib/socket";

const router = Router();
router.use(authenticateVendor);

// Converts a timestamp to its Dubai calendar date (midnight UTC of that day).
function toDubaiDateOnly(d: Date): number {
  const dubaiOffsetMs = 4 * 60 * 60 * 1000;
  const shifted = new Date(d.getTime() + dubaiOffsetMs);
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
}

router.get(
  "/orders",
  asyncHandler(async (req, res) => {
    const vendorId = req.vendor!.sub;
    const where: Record<string, unknown> = { vendorId };

    if (req.query.from || req.query.to) {
      where.date = {
        ...(req.query.from ? { gte: parseDateParam(req.query.from as string) } : {}),
        ...(req.query.to ? { lte: parseDateParam(req.query.to as string) } : {}),
      };
    }
    if (req.query.status) where.status = req.query.status as string;
    if (req.query.cn) {
      const cnNum = Number(req.query.cn);
      if (!Number.isNaN(cnNum)) where.cnNo = cnNum;
    }

    const orders = await prisma.order.findMany({
      where,
      include: { booking: { select: { customerName: true, customerPhone: true, address: true, emirate: true, items: true, notes: true, vendorRef: true, codAmount: true } } },
      orderBy: [{ date: "desc" }, { slNo: "asc" }],
      take: 1000,
    });

    res.json({ orders });
  })
);

// Monthly summary + day-by-day breakdown, scoped to just this vendor.
router.get(
  "/monthly",
  asyncHandler(async (req, res) => {
    const vendorId = req.vendor!.sub;
    const { start, end, year, month } = monthRange(req.query.month as string | undefined);

    const orders = await prisma.order.findMany({
      where: { vendorId, date: { gte: start, lte: end } },
      orderBy: { date: "asc" },
    });

    function summarize(list: typeof orders) {
      const delivered = list.filter((o) => o.status === "DELIVERED");
      return {
        totalOrders: list.length,
        delivered: delivered.length,
        pending: list.filter((o) => o.status === "PENDING").length,
        transferred: list.filter((o) => o.status === "TRANSFER").length,
        cancelled: list.filter((o) => o.status === "CANCELLED").length,
        totalSales: delivered.reduce((s, o) => s + o.total, 0),
        totalDeliveryCharge: delivered.reduce((s, o) => s + o.deliveryCharge, 0),
      };
    }

    const dateMap = new Map<string, typeof orders>();
    for (const o of orders) {
      const key = formatDate(o.date);
      const list = dateMap.get(key) ?? [];
      list.push(o);
      dateMap.set(key, list);
    }
    const dailyBreakdown = Array.from(dateMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, list]) => ({ date, ...summarize(list) }));

    res.json({
      month: `${year}-${String(month).padStart(2, "0")}`,
      summary: summarize(orders),
      dailyBreakdown,
    });
  })
);

// Same date-wise ledger the admin Vendor Credit page uses, scoped to just this vendor.
//   Opening Amount    = running Total Amount from everything BEFORE the selected date
//   Opening Cancelled = running Cancelled Total from before the selected date
//   Today Amount / Today Cancelled = just the selected date's own activity
//   Total Amount (running through selected date) = Opening Amount + Today Amount
router.get(
  "/credit",
  asyncHandler(async (req, res) => {
    const vendorId = req.vendor!.sub;
    const { start: selectedDate } = dayRange(req.query.date as string | undefined);

    const allOrders = await prisma.order.findMany({
      where: { vendorId, date: { lte: selectedDate } },
      select: { cnNo: true, status: true, total: true, deliveryCharge: true, date: true, createdAt: true },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    });

    const seenCn = new Set<number>();
    const deduped = allOrders.filter((o) => {
      if (seenCn.has(o.cnNo)) return false;
      seenCn.add(o.cnNo);
      return true;
    });

    let openingAmount = 0;
    let openingCancelled = 0;
    let openingCharge = 0;
    let todayAmount = 0;
    let todayCancelled = 0;
    let todayCharge = 0;
    // Delivered-only figures, tracked separately — Balance for just what's actually
    // Delivered (Total − Delivery Charge), not the overall running Balance above.
    let openingDeliveredAmount = 0;
    let openingDeliveredCharge = 0;
    let todayDeliveredAmount = 0;
    let todayDeliveredCharge = 0;

    for (const o of deduped) {
      // Same rule as the admin Vendor Credit page: "today" means genuinely entered
      // today, not just resolved today (which would bump `date` forward).
      const isToday = toDubaiDateOnly(o.createdAt) === selectedDate.getTime();
      if (isToday) {
        todayAmount += o.total;
        if (o.status === "CANCELLED") todayCancelled += o.total;
        // Delivery charge deducted for anything not Cancelled (Pending/Transfer
        // included), matching the same rule used on the admin Vendor Credit page.
        else todayCharge += o.deliveryCharge;
      } else {
        openingAmount += o.total;
        if (o.status === "CANCELLED") openingCancelled += o.total;
        else openingCharge += o.deliveryCharge;
      }
      if (o.status === "DELIVERED") {
        if (isToday) {
          todayDeliveredAmount += o.total;
          todayDeliveredCharge += o.deliveryCharge;
        } else {
          openingDeliveredAmount += o.total;
          openingDeliveredCharge += o.deliveryCharge;
        }
      }
    }

    const [openingPayments, todayPayments, openingAdjustments, todayAdjustments] = await Promise.all([
      prisma.vendorPayment.aggregate({ where: { vendorId, date: { lt: selectedDate } }, _sum: { amount: true } }),
      prisma.vendorPayment.aggregate({ where: { vendorId, date: selectedDate }, _sum: { amount: true } }),
      prisma.vendorAdjustment.aggregate({ where: { vendorId, date: { lt: selectedDate } }, _sum: { amount: true } }),
      prisma.vendorAdjustment.aggregate({ where: { vendorId, date: selectedDate }, _sum: { amount: true } }),
    ]);

    const openingAdj = openingAdjustments._sum.amount ?? 0;
    const todayAdj = todayAdjustments._sum.amount ?? 0;
    openingAmount += openingAdj;
    todayAmount += todayAdj;

    const openingPaid = openingPayments._sum.amount ?? 0;
    const todayPaid = todayPayments._sum.amount ?? 0;

    const totalAmount = openingAmount + todayAmount;
    const cancelledTotal = openingCancelled + todayCancelled;
    const totalDeliveryCharge = openingCharge + todayCharge;
    const totalPaid = openingPaid + todayPaid;
    const balance = totalAmount - cancelledTotal - totalDeliveryCharge - totalPaid;

    // Delivered-only balance: what's actually been Delivered, minus its own delivery
    // charge, minus what's already been paid — decreases as payments come in, just
    // like the overall Balance above.
    const deliveredTotal = openingDeliveredAmount + todayDeliveredAmount;
    const deliveredCharge = openingDeliveredCharge + todayDeliveredCharge;
    const deliveredBalance = deliveredTotal - deliveredCharge - totalPaid;

    res.json({
      openingAmount,
      openingCancelled,
      todayAmount,
      todayCancelled,
      totalAmount,
      cancelledTotal,
      totalDeliveryCharge,
      totalPaid,
      balance,
      deliveredTotal,
      deliveredCharge,
      deliveredBalance,
    });
  })
);

router.get(
  "/credit/payments",
  asyncHandler(async (req, res) => {
    const vendorId = req.vendor!.sub;
    const payments = await prisma.vendorPayment.findMany({
      where: { vendorId },
      orderBy: { date: "desc" },
    });
    res.json(payments);
  })
);

// ---- Daily view & global search -------------------------------------------

const PORTAL_BOOKING_SELECT = {
  customerName: true,
  customerPhone: true,
  address: true,
  emirate: true,
  items: true,
  notes: true,
  vendorRef: true,
  codAmount: true,
} as const;

function dubaiDayBounds(day: Date) {
  // `day` is midnight UTC of the Dubai calendar date; Dubai is UTC+4.
  const start = new Date(day.getTime() - 4 * 60 * 60 * 1000);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

// One day: consignments in Daily Entry for that date, plus bookings entered that
// day that are still waiting for pickup (or were rejected), with totals.
router.get(
  "/daily",
  asyncHandler(async (req, res) => {
    const vendorId = req.vendor!.sub;
    const { start: day } = dayRange(req.query.date as string | undefined);
    const { start, end } = dubaiDayBounds(day);

    const [orders, waiting] = await Promise.all([
      prisma.order.findMany({
        where: { vendorId, date: day },
        include: { booking: { select: PORTAL_BOOKING_SELECT } },
        orderBy: [{ slNo: "asc" }],
      }),
      prisma.booking.findMany({
        where: { vendorId, status: { in: ["AWAITING_PICKUP", "REJECTED"] }, createdAt: { gte: start, lt: end } },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    const delivered = orders.filter((o) => o.status === "DELIVERED");
    const notCancelled = orders.filter((o) => o.status !== "CANCELLED");
    res.json({
      date: formatDate(day),
      orders,
      waiting,
      summary: {
        total: orders.length,
        delivered: delivered.length,
        pending: orders.filter((o) => o.status === "PENDING" || o.status === "TRANSFER").length,
        cancelled: orders.filter((o) => o.status === "CANCELLED").length,
        awaitingPickup: waiting.filter((b) => b.status === "AWAITING_PICKUP").length,
        codTotal: notCancelled.reduce((s, o) => s + o.total, 0),
        deliveredAmount: delivered.reduce((s, o) => s + o.total, 0),
        deliveryCharge: notCancelled.reduce((s, o) => s + o.deliveryCharge, 0),
      },
    });
  })
);

// Search every consignment this vendor ever had: CN, customer name or phone.
router.get(
  "/search",
  asyncHandler(async (req, res) => {
    const vendorId = req.vendor!.sub;
    const q = String(req.query.q ?? "").trim();
    if (q.length < 2) return res.json({ orders: [], bookings: [] });
    const digits = q.replace(/\D/g, "");
    const cn = /^\d+$/.test(q) ? Number(q) : NaN;
    const text = { contains: q, mode: "insensitive" as const };
    // Phones are stored as typed ("050 123 4567"), so match on digits only.
    let phoneIds: string[] = [];
    if (digits.length >= 6) {
      const tail = digits.slice(-7);
      const all = await prisma.booking.findMany({ where: { vendorId }, select: { id: true, customerPhone: true } });
      phoneIds = all.filter((b) => b.customerPhone.replace(/\D/g, "").includes(tail)).map((b) => b.id);
    }
    // Only consignments already in Daily Entry (orders). Search by CN, customer
    // name, phone, or area (address / driver-set area / emirate).
    const orders = await prisma.order.findMany({
      where: {
        vendorId,
        OR: [
          ...(Number.isSafeInteger(cn) ? [{ cnNo: cn }] : []),
          { booking: { customerName: text } },
          ...(phoneIds.length ? [{ booking: { id: { in: phoneIds } } }] : []),
          { booking: { address: text } },
          { area: text },
          { emirate: text },
        ],
      },
      include: { booking: { select: PORTAL_BOOKING_SELECT } },
      orderBy: [{ date: "desc" }],
      take: 100,
    });
    res.json({ orders, bookings: [] });
  })
);

// ---- Bookings: consignments the vendor enters here, with a printable label ----

const BOOKING_INCLUDE = {
  vendor: { select: { id: true, name: true } },
  order: { select: { id: true, status: true, date: true, resolvedAt: true, employee: { select: { name: true } } } },
} as const;

router.get(
  "/bookings",
  asyncHandler(async (req, res) => {
    const vendorId = req.vendor!.sub;
    const ids = typeof req.query.ids === "string" && req.query.ids ? req.query.ids.split(",") : undefined;
    const status = req.query.status as string | undefined;
    const bookings = await prisma.booking.findMany({
      where: {
        vendorId,
        ...(ids ? { id: { in: ids } } : {}),
        ...(status ? { status: status as "AWAITING_PICKUP" | "ACCEPTED" | "REJECTED" } : {}),
      },
      include: BOOKING_INCLUDE,
      orderBy: { createdAt: "desc" },
      take: ids ? undefined : 300,
    });
    res.json({ bookings });
  })
);

router.post(
  "/bookings",
  asyncHandler(async (req, res) => {
    const input = bookingInputSchema.parse(req.body);
    const booking = await createBooking(req.vendor!.sub, input, "VENDOR");
    await attachSlipPhoto(req.body?.photoId, booking.id, req.vendor!.sub);
    await writeAuditLog({ action: "BOOKING_CREATE", entity: "Booking", entityId: booking.id, meta: { vendor: booking.vendor.name, cnNo: booking.cnNo, by: "VENDOR" } });
    emitGlobal("booking:changed", { type: "created", id: booking.id });
    res.status(201).json(booking);
  })
);

router.get(
  "/photo-reader/status",
  asyncHandler(async (_req, res) => {
    res.json({ configured: photoReaderConfigured() });
  })
);

router.post(
  "/photo-read",
  asyncHandler(async (req, res) => {
    const data = z.object({ image: z.string().min(100), thumb: z.string().optional() }).parse(req.body);
    const m = data.image.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
    if (!m) throw new ApiError(400, "Unsupported image");
    const orders = await readOrderPhoto(m[2], m[1]);
    const photoId = await storeSlipPhoto(req.vendor!.sub, data.thumb);
    res.json({ orders, photoId });
  })
);

router.get(
  "/bookings/:id/photo",
  asyncHandler(async (req, res) => {
    const photo = await getBookingPhoto(req.params.id, req.vendor!.sub);
    res.setHeader("Content-Type", photo.mime);
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.send(Buffer.from(photo.data));
  })
);

async function ownAwaitingBooking(vendorId: string, id: string) {
  const booking = await prisma.booking.findFirst({ where: { id, vendorId } });
  if (!booking) throw new ApiError(404, "Booking not found");
  if (booking.status !== "AWAITING_PICKUP") {
    throw new ApiError(400, "This consignment has already been picked up by Future Courier — contact the office to change it");
  }
  return booking;
}

router.put(
  "/bookings/:id",
  asyncHandler(async (req, res) => {
    const existing = await ownAwaitingBooking(req.vendor!.sub, req.params.id);
    const input = bookingInputSchema.parse(req.body);
    await assertRefFree(existing.vendorId, input.vendorRef || undefined, existing.id);
    const booking = await prisma.booking.update({
      where: { id: existing.id },
      data: {
        vendorRef: input.vendorRef || null,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        address: input.address,
        emirate: input.emirate.toUpperCase(),
        items: input.items || null,
        codAmount: input.codAmount,
        notes: input.notes || null,
      },
      include: BOOKING_INCLUDE,
    });
    emitGlobal("booking:changed", { type: "updated", id: booking.id });
    res.json(booking);
  })
);

router.delete(
  "/bookings/:id",
  asyncHandler(async (req, res) => {
    const existing = await ownAwaitingBooking(req.vendor!.sub, req.params.id);
    await prisma.booking.delete({ where: { id: existing.id } });
    await writeAuditLog({ action: "BOOKING_DELETE", entity: "Booking", entityId: existing.id, meta: { cnNo: existing.cnNo, by: "VENDOR" } });
    emitGlobal("booking:changed", { type: "deleted", id: existing.id });
    res.json({ deleted: true });
  })
);

router.post(
  "/bookings/mark-printed",
  asyncHandler(async (req, res) => {
    const { ids } = z.object({ ids: z.array(z.string()).min(1) }).parse(req.body);
    await prisma.booking.updateMany({ where: { id: { in: ids }, vendorId: req.vendor!.sub }, data: { labelPrintedAt: new Date() } });
    res.json({ ok: true });
  })
);

export default router;
