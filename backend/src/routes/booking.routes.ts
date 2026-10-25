import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler, ApiError } from "../utils/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";
import { writeAuditLog } from "../services/audit.service";
import { emitGlobal, emitToUser } from "../lib/socket";
import { markWebsiteCompleted } from "../services/inspiredWoo.service";
import { withScanLog, scanLogForDay } from "../services/scanLog.service";
import { readOrderPhoto, readOrderMessage, storeSlipPhoto, attachSlipPhoto, getBookingPhoto, photoReaderConfigured } from "../services/photoReader.service";
import { bookingInputSchema, createBooking, acceptBooking, assertRefFree, assignByScan, scanBillVendors } from "../services/booking.service";

// Office side of vendor bookings: the "Awaiting Pickup" queue.
const router = Router();
router.use(authenticate);

const INCLUDE = {
  vendor: { select: { id: true, name: true, deliveryCharge: true } },
  order: { select: { id: true, status: true, date: true, resolvedAt: true, employee: { select: { id: true, name: true } } } },
} as const;

type BookingStatus = "AWAITING_PICKUP" | "ACCEPTED" | "REJECTED";

/** Start/end (UTC) of a Dubai calendar day "YYYY-MM-DD". */
function dubaiDay(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d) - 4 * 60 * 60 * 1000);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

router.get(
  "/",
  requireRole("SUPER_ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const ids = typeof req.query.ids === "string" && req.query.ids ? req.query.ids.split(",") : undefined;
    const status = req.query.status as BookingStatus | undefined;
    const vendorId = req.query.vendorId as string | undefined;
    const day = typeof req.query.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.day) ? req.query.day : undefined;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const qNum = Number(q);
    const range = day ? dubaiDay(day) : undefined;
    const bookings = await prisma.booking.findMany({
      where: {
        ...(ids ? { id: { in: ids } } : {}),
        ...(status ? { status } : {}),
        ...(vendorId ? { vendorId } : {}),
        ...(range && !q ? { createdAt: { gte: range.start, lt: range.end } } : {}),
        ...(q
          ? {
              OR: [
                ...(Number.isSafeInteger(qNum) && qNum > 0 ? [{ cnNo: qNum }] : []),
                { vendorRef: { contains: q, mode: "insensitive" as const } },
                { customerName: { contains: q, mode: "insensitive" as const } },
                { customerPhone: { contains: q } },
                { vendor: { name: { contains: q, mode: "insensitive" as const } } },
              ],
            }
          : {}),
      },
      include: INCLUDE,
      orderBy: { createdAt: status === "AWAITING_PICKUP" ? "asc" : "desc" },
      take: ids ? undefined : range && !q ? 3000 : 500,
    });
    const awaitingCount = await prisma.booking.count({ where: { status: "AWAITING_PICKUP" } });
    // Still-waiting orders per Dubai day, so older unpicked ones are never forgotten.
    const awaitingDays = await prisma.$queryRaw<{ day: string; count: bigint }[]>`
      SELECT to_char("createdAt" + interval '4 hours', 'YYYY-MM-DD') AS day, count(*) AS count
      FROM bookings WHERE status = 'AWAITING_PICKUP' GROUP BY 1 ORDER BY 1`.catch((err) => {
      console.error("[bookings] awaitingDays query failed:", err);
      return [] as { day: string; count: bigint }[];
    });
    res.json({ bookings, awaitingCount, awaitingDays: awaitingDays.map((r) => ({ day: r.day, count: Number(r.count) })) });
  })
);

// Look up a booking by CN — used when a label is scanned or typed.
router.get(
  "/by-cn/:cn",
  requireRole("SUPER_ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const code = req.params.cn.trim();
    const cnNo = Number(code);
    const booking =
      (Number.isSafeInteger(cnNo) ? await prisma.booking.findUnique({ where: { cnNo }, include: INCLUDE }) : null) ??
      (await prisma.booking.findFirst({ where: { vendorRef: code }, include: INCLUDE, orderBy: { createdAt: "desc" } }));
    if (!booking) throw new ApiError(404, "No booking with that CN or order No.");
    res.json(booking);
  })
);

const photoReadSchema = z.object({
  vendorId: z.string().min(1, "Choose a vendor"),
  image: z.string().min(100), // data URL sent to the reader
  thumb: z.string().optional(), // smaller copy kept with the order
});

router.post(
  "/message-read",
  requireRole("SUPER_ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const d = z.object({ text: z.string().trim().min(5).max(4000), products: z.array(z.string().max(80)).max(60).optional() }).parse(req.body);
    res.json({ order: await readOrderMessage(d.text, d.products) });
  })
);

router.get(
  "/photo-reader/status",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (_req, res) => {
    res.json({ configured: photoReaderConfigured() });
  })
);

// Read one handwritten slip photo → suggested fields (nothing is saved as an order yet).
router.post(
  "/photo-read",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const data = photoReadSchema.parse(req.body);
    const m = data.image.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
    if (!m) throw new ApiError(400, "Unsupported image");
    const orders = await readOrderPhoto(m[2], m[1]);
    const photoId = await storeSlipPhoto(data.vendorId, data.thumb);
    res.json({ orders, photoId });
  })
);

router.get(
  "/:id/photo",
  requireRole("SUPER_ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const photo = await getBookingPhoto(req.params.id);
    res.setHeader("Content-Type", photo.mime);
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.send(Buffer.from(photo.data));
  })
);

// Office enters a consignment on a vendor's behalf.
router.post(
  "/",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const { vendorId, ...rest } = req.body ?? {};
    if (typeof vendorId !== "string" || !vendorId) throw new ApiError(400, "Choose a vendor");
    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor || !vendor.active) throw new ApiError(404, "Vendor not found or inactive");
    const input = bookingInputSchema.parse(rest);
    const booking = await createBooking(vendorId, input, "ADMIN");
    await attachSlipPhoto(req.body?.photoId, booking.id, vendorId);
    await writeAuditLog({ userId: req.user!.sub, action: "BOOKING_CREATE", entity: "Booking", entityId: booking.id, meta: { vendor: vendor.name, cnNo: booking.cnNo, by: "ADMIN" } });
    emitGlobal("booking:changed", { type: "created", id: booking.id });
    res.status(201).json(booking);
  })
);

router.put(
  "/:id",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.booking.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new ApiError(404, "Booking not found");
    if (existing.status === "ACCEPTED") throw new ApiError(400, "Already in Daily Entry — edit the consignment there");
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
      include: INCLUDE,
    });
    await writeAuditLog({ userId: req.user!.sub, action: "BOOKING_UPDATE", entity: "Booking", entityId: booking.id, meta: input });
    emitGlobal("booking:changed", { type: "updated", id: booking.id });
    res.json(booking);
  })
);

const acceptSchema = z.object({
  ids: z.array(z.string()).min(1),
  employeeId: z.string().min(1, "Choose a driver"),
  emirate: z.string().max(30).optional(),
  date: z.string().optional(),
});

// Accept one or more bookings into Daily Entry under one driver.
router.post(
  "/accept",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const data = acceptSchema.parse(req.body);
    const accepted: { id: string; cnNo: number }[] = [];
    const failed: { id: string; error: string }[] = [];

    for (const id of data.ids) {
      try {
        const order = await acceptBooking(id, { employeeId: data.employeeId, emirate: data.emirate || undefined, date: data.date });
        accepted.push({ id, cnNo: order.cnNo });
        emitGlobal("order:changed", { type: "created", order });
        emitToUser(order.employeeId, "order:assigned", { order });
      } catch (err) {
        failed.push({ id, error: err instanceof Error ? err.message : "Failed" });
      }
    }

    if (accepted.length) {
      await writeAuditLog({
        userId: req.user!.sub,
        action: "BOOKING_ACCEPT",
        entity: "Booking",
        entityId: accepted.map((a) => a.id).join(","),
        meta: { cnNos: accepted.map((a) => a.cnNo), employeeId: data.employeeId, emirate: data.emirate, date: data.date },
      });
      emitGlobal("booking:changed", { type: "accepted", ids: accepted.map((a) => a.id) });
    }
    res.json({ accepted, failed });
  })
);

router.get(
  "/scan-vendors",
  requireRole("SUPER_ADMIN", "MANAGER"),
  asyncHandler(async (_req, res) => res.json(await scanBillVendors()))
);

// Every scan of a Dubai day (office Scan & Assign and drivers taking parcels).
router.get(
  "/scan-log",
  requireRole("SUPER_ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const day = typeof req.query.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.day) ? req.query.day : new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10);
    res.json({ day, scans: await scanLogForDay(day) });
  })
);

// Scan & Assign: one scanned CN → the chosen driver. Office may move open orders between drivers.
router.post(
  "/scan-assign",
  requireRole("SUPER_ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const { code, employeeId, confirm, vendorId } = z
      .object({ code: z.string().min(1).max(100), employeeId: z.string().min(1), confirm: z.boolean().optional(), vendorId: z.string().optional() })
      .parse(req.body);
    const r = await withScanLog({ byUserId: req.user!.sub, byRole: "OFFICE", driverId: employeeId, code }, () =>
      assignByScan(code, employeeId, { allowReassign: true, confirmed: confirm, vendorId: vendorId || undefined })
    );
    if (r.result !== "ALREADY") {
      await writeAuditLog({
        userId: req.user!.sub,
        action: r.result === "ACCEPTED" ? "SCAN_ACCEPT" : "SCAN_REASSIGN",
        entity: "Order",
        entityId: r.order.id,
        meta: { cnNo: r.order.cnNo, to: employeeId, from: r.previousEmployeeId },
      });
      emitGlobal("order:changed", { type: r.result === "ACCEPTED" ? "created" : "updated", order: r.order });
      emitGlobal("booking:changed", { type: "accepted" });
      emitToUser(employeeId, "order:assigned", { order: r.order });
      if (r.previousEmployeeId) emitToUser(r.previousEmployeeId, "order:removed", { orderId: r.order.id });
    }
    res.json(r);
  })
);

router.post(
  "/:id/reject",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const { reason } = z.object({ reason: z.string().trim().min(1, "Give a reason").max(300) }).parse(req.body);
    const existing = await prisma.booking.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new ApiError(404, "Booking not found");
    if (existing.status !== "AWAITING_PICKUP") throw new ApiError(400, `Booking is already ${existing.status.toLowerCase()}`);
    const booking = await prisma.booking.update({ where: { id: existing.id }, data: { status: "REJECTED", rejectReason: reason }, include: INCLUDE });
    await writeAuditLog({ userId: req.user!.sub, action: "BOOKING_REJECT", entity: "Booking", entityId: booking.id, meta: { cnNo: booking.cnNo, reason } });
    emitGlobal("booking:changed", { type: "rejected", id: booking.id });
    res.json(booking);
  })
);

// Undo a rejection — back into the queue.
router.post(
  "/:id/reopen",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.booking.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new ApiError(404, "Booking not found");
    if (existing.status !== "REJECTED") throw new ApiError(400, "Only rejected bookings can be reopened");
    const booking = await prisma.booking.update({ where: { id: existing.id }, data: { status: "AWAITING_PICKUP", rejectReason: null }, include: INCLUDE });
    emitGlobal("booking:changed", { type: "reopened", id: booking.id });
    res.json(booking);
  })
);

router.delete(
  "/:id",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.booking.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new ApiError(404, "Booking not found");
    if (existing.status === "ACCEPTED") throw new ApiError(400, "Already in Daily Entry — delete the consignment there instead");
    await prisma.booking.delete({ where: { id: existing.id } });
    await writeAuditLog({ userId: req.user!.sub, action: "BOOKING_DELETE", entity: "Booking", entityId: existing.id, meta: { cnNo: existing.cnNo } });
    emitGlobal("booking:changed", { type: "deleted", id: existing.id });
    res.json({ deleted: true });
  })
);

router.post(
  "/mark-printed",
  requireRole("SUPER_ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const { ids } = z.object({ ids: z.array(z.string()).min(1) }).parse(req.body);
    await prisma.booking.updateMany({ where: { id: { in: ids } }, data: { labelPrintedAt: new Date() } });
    const website = await markWebsiteCompleted(ids).catch((err) => ({ marked: 0, failed: ids.length, error: String(err) }));
    if (website.marked) emitGlobal("booking:changed", { type: "web-completed" });
    res.json({ ok: true, website });
  })
);

export default router;
