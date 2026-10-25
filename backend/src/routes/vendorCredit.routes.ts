import { Router } from "express";
import { z } from "zod";
import ExcelJS from "exceljs";
import { prisma } from "../lib/prisma";
import { scanInfoFor } from "../services/entryScan.service";
import { asyncHandler, ApiError } from "../utils/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";
import { dayRange } from "../utils/dates";
import { writeAuditLog } from "../services/audit.service";
import { emitGlobal } from "../lib/socket";

const router = Router();
router.use(authenticate, requireRole("SUPER_ADMIN", "MANAGER"));

interface OrderRow {
  vendorId: string;
  status: string;
  total: number;
  deliveryCharge: number;
  date: Date;
}

/** Computes the full Vendor Credit ledger as of a given date — shared by the
 * on-screen table and the Excel export, so both are always identical.
 * Delivery charge is deducted for every non-Cancelled order (Pending/Transfer
 * included), not just once Delivered — same rule as Agent Credit. */
async function computeVendorCreditRows(asOf: Date) {
  const end = new Date(asOf.getTime() + 24 * 60 * 60 * 1000);

  const vendors = await prisma.vendor.findMany({ orderBy: { name: "asc" } });
  const vendorIds = vendors.map((v) => v.id);

  const [ordersThroughDate, pendingOrders, adjustments, vendorPayments, driverPayments] = await Promise.all([
    prisma.order.findMany({
      where: { vendorId: { in: vendorIds }, date: { lt: end } },
      select: { vendorId: true, status: true, total: true, deliveryCharge: true, date: true },
    }),
    prisma.order.findMany({
      where: { vendorId: { in: vendorIds }, status: { in: ["PENDING", "TRANSFER"] } },
      select: { vendorId: true, total: true, deliveryCharge: true },
    }),
    prisma.vendorAdjustment.findMany({
      where: { vendorId: { in: vendorIds }, date: { lt: end } },
      select: { vendorId: true, amount: true },
    }),
    prisma.vendorPayment.findMany({
      where: { vendorId: { in: vendorIds }, date: { lt: end } },
      select: { vendorId: true, amount: true },
    }),
    prisma.purchase.findMany({
      where: { vendorId: { in: vendorIds }, date: { lt: end } },
      select: { vendorId: true, amount: true },
    }),
  ]);

  const byVendor = (orders: OrderRow[]) => {
    const map = new Map<string, OrderRow[]>();
    for (const o of orders) {
      const list = map.get(o.vendorId) ?? [];
      list.push(o);
      map.set(o.vendorId, list);
    }
    return map;
  };
  const ordersMap = byVendor(ordersThroughDate);
  const pendingMap = byVendor(pendingOrders as OrderRow[]);

  const sumBy = (rows: { vendorId: string; amount: number }[]) => {
    const map = new Map<string, number>();
    for (const r of rows) map.set(r.vendorId, (map.get(r.vendorId) ?? 0) + r.amount);
    return map;
  };
  const adjustmentMap = sumBy(adjustments);
  const paymentMap = sumBy(vendorPayments);
  const driverPaymentMap = sumBy(driverPayments.filter((p): p is { vendorId: string; amount: number } => p.vendorId !== null));

  return vendors.map((v) => {
    const orders = ordersMap.get(v.id) ?? [];
    const pending = pendingMap.get(v.id) ?? [];

    let openingAmount = 0,
      openingCancelled = 0,
      todayAmount = 0,
      todayCancelled = 0,
      totalDeliveryCharge = 0,
      deliveredOpening = 0,
      deliveredToday = 0,
      deliveredCharge = 0;

    for (const o of orders) {
      const isToday = o.date >= asOf;
      if (o.status === "CANCELLED") {
        if (isToday) todayCancelled += o.total;
        else openingCancelled += o.total;
      } else {
        if (isToday) todayAmount += o.total;
        else openingAmount += o.total;
        totalDeliveryCharge += o.deliveryCharge;
        if (o.status === "DELIVERED") {
          if (isToday) deliveredToday += o.total;
          else deliveredOpening += o.total;
          deliveredCharge += o.deliveryCharge;
        }
      }
    }

    const totalAmount = openingAmount + todayAmount;
    const cancelledTotal = openingCancelled + todayCancelled;
    const adjustmentTotal = adjustmentMap.get(v.id) ?? 0;
    const totalPaid = (paymentMap.get(v.id) ?? 0) + (driverPaymentMap.get(v.id) ?? 0);
    const balance = totalAmount - cancelledTotal - totalDeliveryCharge - totalPaid + adjustmentTotal;

    const pendingTotal = pending.reduce((s, o) => s + o.total, 0);
    const pendingDeliveryCharge = pending.reduce((s, o) => s + o.deliveryCharge, 0);
    const pendingPayable = pendingTotal - pendingDeliveryCharge;

    const deliveredTotal = deliveredOpening + deliveredToday;
    const deliveredPayable = deliveredTotal - deliveredCharge;

    return {
      vendor: { id: v.id, name: v.name, active: v.active },
      openingAmount,
      openingCancelled,
      todayAmount,
      todayCancelled,
      totalAmount,
      adjustmentTotal,
      cancelledTotal,
      totalDeliveryCharge,
      totalPaid,
      balance,
      pendingTotal,
      pendingDeliveryCharge,
      pendingPayable,
      deliveredOpening,
      deliveredToday,
      deliveredTotal,
      deliveredCharge,
      deliveredPayable,
    };
  });
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { start } = dayRange(req.query.date as string | undefined);
    const rows = await computeVendorCreditRows(start);
    res.json(rows);
  })
);

// Delivered Consignments Summary — per vendor, for one specific day (grouped by
// the day each order was actually delivered, not entered). View-only, separate
// from the running Balance above.
router.get(
  "/delivered-daily",
  asyncHandler(async (req, res) => {
    const { start } = dayRange(req.query.date as string | undefined);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    const orders = await prisma.order.findMany({
      where: { status: "DELIVERED", date: { gte: start, lt: end } },
      select: { vendorId: true, total: true, deliveryCharge: true, vendor: { select: { name: true } } },
    });

    const grouped = new Map<string, { vendorId: string; vendorName: string; count: number; totalAmount: number; deliveryCharge: number }>();
    for (const o of orders) {
      const existing = grouped.get(o.vendorId) ?? { vendorId: o.vendorId, vendorName: o.vendor.name, count: 0, totalAmount: 0, deliveryCharge: 0 };
      existing.count += 1;
      existing.totalAmount += o.total;
      existing.deliveryCharge += o.deliveryCharge;
      grouped.set(o.vendorId, existing);
    }

    const rows = Array.from(grouped.values())
      .map((r) => ({ ...r, payable: r.totalAmount - r.deliveryCharge }))
      .sort((a, b) => a.vendorName.localeCompare(b.vendorName));

    res.json({ rows });
  })
);

// New-entries report: for a given day, how many genuinely new consignments each
// vendor got. "New" means created that day — not orders merely carried over or
// resolved that day. Includes delivery charge and balance (total minus delivery
// charge) for these new entries specifically, not the vendor's overall ledger.
router.get(
  "/new-entries",
  asyncHandler(async (req, res) => {
    const { start } = dayRange(req.query.date as string | undefined);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    // Everything each vendor gave us that day:
    //  - vendor-portal / website / photo bookings entered that day (picked up or still waiting), and
    //  - consignments typed straight into Daily Entry that day (no booking).
    const bookings = await prisma.booking.findMany({
      where: { createdAt: { gte: start, lt: end }, status: { not: "REJECTED" } },
      select: {
        cnNo: true,
        vendorId: true,
        customerName: true,
        customerPhone: true,
        address: true,
        emirate: true,
        items: true,
        codAmount: true,
        createdAt: true,
        vendor: { select: { name: true, deliveryCharge: true } },
        order: { select: { id: true, cnNo: true, total: true, deliveryCharge: true, status: true, employee: { select: { name: true } } } },
      },
    });
    const typed = await prisma.order.findMany({
      where: { createdAt: { gte: start, lt: end }, booking: { is: null } },
      select: { id: true, vendorId: true, total: true, deliveryCharge: true, cnNo: true, emirate: true, status: true, createdAt: true, vendor: { select: { name: true } }, employee: { select: { name: true } } },
    });
    const scanInfo = await scanInfoFor(bookings.map((b) => b.order?.id).filter(Boolean) as string[]);

    type Row = { vendorId: string; vendorName: string; count: number; totalAmount: number; deliveryCharge: number; scanned: number; manual: number; awaiting: number };
    const grouped = new Map<string, Row>();
    const entries: unknown[] = [];
    const seenCn = new Set<number>();
    const add = (vendorId: string, vendorName: string, type: "SCANNED" | "MANUAL" | "AWAITING", total: number, dl: number, entry: Record<string, unknown>) => {
      const g = grouped.get(vendorId) ?? { vendorId, vendorName, count: 0, totalAmount: 0, deliveryCharge: 0, scanned: 0, manual: 0, awaiting: 0 };
      g.count += 1;
      g.totalAmount += total;
      g.deliveryCharge += dl;
      if (type === "SCANNED") g.scanned += 1;
      else if (type === "MANUAL") g.manual += 1;
      else g.awaiting += 1;
      grouped.set(vendorId, g);
      entries.push({ groupId: vendorId, groupName: vendorName, type, total, deliveryCharge: dl, vendor: vendorName, ...entry });
    };

    for (const b of bookings) {
      const cn = b.order?.cnNo ?? b.cnNo;
      if (seenCn.has(cn)) continue;
      seenCn.add(cn);
      const sc = b.order ? scanInfo.get(b.order.id) : undefined;
      const type = !b.order ? "AWAITING" : sc ? "SCANNED" : "MANUAL";
      add(b.vendorId, b.vendor.name, type, b.order?.total ?? b.codAmount, b.order?.deliveryCharge ?? b.vendor.deliveryCharge, {
        at: sc?.at ?? b.createdAt,
        scan: sc,
        cnNo: cn,
        driver: b.order?.employee?.name ?? "",
        customerName: b.customerName,
        customerPhone: b.customerPhone,
        address: b.address,
        emirate: b.emirate,
        items: b.items ?? "",
        status: b.order?.status ?? "AWAITING PICKUP",
      });
    }
    for (const o of typed) {
      if (seenCn.has(o.cnNo)) continue;
      seenCn.add(o.cnNo);
      add(o.vendorId, o.vendor.name, "MANUAL", o.total, o.deliveryCharge, {
        at: o.createdAt,
        cnNo: o.cnNo,
        driver: o.employee?.name ?? "",
        customerName: "",
        customerPhone: "",
        address: "",
        emirate: o.emirate,
        items: "",
        status: o.status,
      });
    }
    (entries as { groupName: string; cnNo: number }[]).sort((a, b) => a.groupName.localeCompare(b.groupName) || a.cnNo - b.cnNo);

    const rows = Array.from(grouped.values())
      .map((r) => ({ ...r, balance: r.totalAmount - r.deliveryCharge }))
      .sort((a, b) => a.vendorName.localeCompare(b.vendorName));
    res.json({ rows, entries });
  })
);

// Excel statement of the vendor credit ledger shown on screen.
router.get(
  "/export",
  asyncHandler(async (req, res) => {
    const { start } = dayRange(req.query.date as string | undefined);
    const rows = await computeVendorCreditRows(start);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Future Courier Operations";
    workbook.created = new Date();
    const sheet = workbook.addWorksheet("Vendor Credit Statement");
    sheet.columns = [
      { header: "Vendor", key: "vendor", width: 20 },
      { header: "Opening Amount", key: "openingAmount", width: 15 },
      { header: "Opening Cancelled", key: "openingCancelled", width: 16 },
      { header: "Today's Amount", key: "todayAmount", width: 15 },
      { header: "Today's Cancelled", key: "todayCancelled", width: 16 },
      { header: "Total Amount", key: "totalAmount", width: 14 },
      { header: "Adjustment", key: "adjustmentTotal", width: 12 },
      { header: "Cancelled (Total)", key: "cancelledTotal", width: 15 },
      { header: "Delivery Charge", key: "totalDeliveryCharge", width: 15 },
      { header: "Paid", key: "totalPaid", width: 12 },
      { header: "Balance", key: "balance", width: 14 },
    ];
    sheet.getRow(1).font = { bold: true };
    rows.forEach((r) =>
      sheet.addRow({
        vendor: r.vendor.name,
        openingAmount: r.openingAmount,
        openingCancelled: r.openingCancelled,
        todayAmount: r.todayAmount,
        todayCancelled: r.todayCancelled,
        totalAmount: r.totalAmount,
        adjustmentTotal: r.adjustmentTotal,
        cancelledTotal: r.cancelledTotal,
        totalDeliveryCharge: r.totalDeliveryCharge,
        totalPaid: r.totalPaid,
        balance: r.balance,
      })
    );

    const totals = rows.reduce(
      (acc, r) => ({
        openingAmount: acc.openingAmount + r.openingAmount,
        openingCancelled: acc.openingCancelled + r.openingCancelled,
        todayAmount: acc.todayAmount + r.todayAmount,
        todayCancelled: acc.todayCancelled + r.todayCancelled,
        totalAmount: acc.totalAmount + r.totalAmount,
        adjustmentTotal: acc.adjustmentTotal + r.adjustmentTotal,
        cancelledTotal: acc.cancelledTotal + r.cancelledTotal,
        totalDeliveryCharge: acc.totalDeliveryCharge + r.totalDeliveryCharge,
        totalPaid: acc.totalPaid + r.totalPaid,
        balance: acc.balance + r.balance,
      }),
      { openingAmount: 0, openingCancelled: 0, todayAmount: 0, todayCancelled: 0, totalAmount: 0, adjustmentTotal: 0, cancelledTotal: 0, totalDeliveryCharge: 0, totalPaid: 0, balance: 0 }
    );
    const totalRow = sheet.addRow({ vendor: "TOTAL", ...totals });
    totalRow.font = { bold: true };

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="vendor-credit-statement.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  })
);

router.get(
  "/:vendorId/payments",
  asyncHandler(async (req, res) => {
    const payments = await prisma.vendorPayment.findMany({
      where: { vendorId: req.params.vendorId },
      orderBy: { date: "desc" },
    });
    res.json(payments);
  })
);

const paymentSchema = z.object({
  date: z.string(),
  amount: z.number().int().positive(),
  note: z.string().max(300).optional(),
});

router.post(
  "/:vendorId/payments",
  asyncHandler(async (req, res) => {
    const vendor = await prisma.vendor.findUnique({ where: { id: req.params.vendorId } });
    if (!vendor) throw new ApiError(404, "Vendor not found");

    const data = paymentSchema.parse(req.body);
    const { start } = dayRange(data.date);
    const payment = await prisma.vendorPayment.create({
      data: { vendorId: req.params.vendorId, date: start, amount: data.amount, note: data.note },
    });

    await writeAuditLog({
      userId: req.user!.sub,
      action: "VENDOR_PAYMENT_CREATE",
      entity: "VendorPayment",
      entityId: payment.id,
      meta: { vendorId: req.params.vendorId, amount: data.amount },
    });
    emitGlobal("vendorPayment:changed", { type: "created", payment });
    res.status(201).json(payment);
  })
);

router.delete(
  "/payments/:id",
  asyncHandler(async (req, res) => {
    const existing = await prisma.vendorPayment.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new ApiError(404, "Payment entry not found");

    await prisma.vendorPayment.delete({ where: { id: req.params.id } });
    await writeAuditLog({
      userId: req.user!.sub,
      action: "VENDOR_PAYMENT_DELETE",
      entity: "VendorPayment",
      entityId: req.params.id,
    });
    emitGlobal("vendorPayment:changed", { type: "deleted", id: req.params.id });
    res.json({ deleted: true });
  })
);

const adjustmentSchema = z.object({
  date: z.string(),
  amount: z.number().int().refine((v) => v !== 0, "Amount can't be zero"),
  note: z.string().max(300).optional(),
});

router.post(
  "/:vendorId/adjustments",
  asyncHandler(async (req, res) => {
    const vendor = await prisma.vendor.findUnique({ where: { id: req.params.vendorId } });
    if (!vendor) throw new ApiError(404, "Vendor not found");

    const data = adjustmentSchema.parse(req.body);
    const { start } = dayRange(data.date);
    const adjustment = await prisma.vendorAdjustment.create({
      data: { vendorId: req.params.vendorId, date: start, amount: data.amount, note: data.note },
    });

    await writeAuditLog({
      userId: req.user!.sub,
      action: "VENDOR_ADJUSTMENT_CREATE",
      entity: "VendorAdjustment",
      entityId: adjustment.id,
      meta: { vendorId: req.params.vendorId, amount: data.amount },
    });
    emitGlobal("vendorPayment:changed", { type: "created" });
    res.status(201).json(adjustment);
  })
);

export default router;
