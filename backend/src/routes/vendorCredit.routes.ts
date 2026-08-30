import { Router } from "express";
import { z } from "zod";
import ExcelJS from "exceljs";
import { prisma } from "../lib/prisma";
import { asyncHandler, ApiError } from "../utils/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";
import { dayRange } from "../utils/dates";
import { writeAuditLog } from "../services/audit.service";
import { emitGlobal } from "../lib/socket";

const router = Router();
router.use(authenticate, requireRole("SUPER_ADMIN", "MANAGER"));

// Vendor credit = what's left to pay each vendor, shown date-wise like a ledger:
//   Opening Amount   = running Total Amount from everything BEFORE the selected date
//   Opening Cancelled = running Cancelled Total from before the selected date
//   Today Amount / Today Cancelled = just the selected date's own activity
//   Total Amount (running through selected date) = Opening Amount + Today Amount
//   Balance = Total Amount - Cancelled Total - Delivery Charge Total - Paid Amount
// Pending/Transfer orders stay counted in Total Amount as-is (expected to convert to
// Delivered soon); once they do, their delivery charge gets deducted automatically.
//
// Safeguard: the same consignment (CN No) must never be counted twice for a vendor,
// even if it was accidentally entered more than once. Before totalling anything, orders
// are deduplicated by (vendorId, cnNo) — keeping only the most recent entry (up to the
// selected date) for each consignment number.
// Converts a timestamp to its Dubai calendar date (midnight UTC of that day), so we
// can compare "was this order genuinely created today" regardless of time-of-day.
function toDubaiDateOnly(d: Date): number {
  const dubaiOffsetMs = 4 * 60 * 60 * 1000;
  const shifted = new Date(d.getTime() + dubaiOffsetMs);
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
}

async function computeVendorCreditRows(selectedDate: Date) {
  const vendors = await prisma.vendor.findMany({ orderBy: { name: "asc" } });

  const allOrders = await prisma.order.findMany({
    where: { date: { lte: selectedDate } },
    select: { vendorId: true, cnNo: true, status: true, total: true, deliveryCharge: true, date: true, createdAt: true },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });

  const seenKeys = new Set<string>();
  const dedupedOrders = allOrders.filter((o) => {
    const key = `${o.vendorId}::${o.cnNo}`;
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });

  const openingAmountMap = new Map<string, number>();
  const openingCancelledMap = new Map<string, number>();
  const openingChargeMap = new Map<string, number>();
  const todayAmountMap = new Map<string, number>();
  const todayCancelledMap = new Map<string, number>();
  const todayChargeMap = new Map<string, number>();

  for (const o of dedupedOrders) {
    // "Today" means genuinely entered today — NOT just resolved today. An order
    // created days ago that only just got Delivered/Cancelled today has its `date`
    // field bumped forward to today for reporting purposes, but that's backlog being
    // cleared, not new business — so it belongs in Opening, not Today.
    const isToday = toDubaiDateOnly(o.createdAt) === selectedDate.getTime();
    const amountMap = isToday ? todayAmountMap : openingAmountMap;
    const cancelledMap = isToday ? todayCancelledMap : openingCancelledMap;
    const chargeMap = isToday ? todayChargeMap : openingChargeMap;

    amountMap.set(o.vendorId, (amountMap.get(o.vendorId) ?? 0) + o.total);
    if (o.status === "CANCELLED") {
      cancelledMap.set(o.vendorId, (cancelledMap.get(o.vendorId) ?? 0) + o.total);
    }
    if (o.status === "DELIVERED") {
      chargeMap.set(o.vendorId, (chargeMap.get(o.vendorId) ?? 0) + o.deliveryCharge);
    }
  }

  function toMap(list: { vendorId: string | null; _sum: { amount: number | null } }[]) {
    const m = new Map<string, number>();
    for (const item of list) {
      if (!item.vendorId) continue;
      m.set(item.vendorId, (m.get(item.vendorId) ?? 0) + (item._sum.amount ?? 0));
    }
    return m;
  }

  const [
    openingPayments,
    todayPayments,
    openingDriverPayments,
    todayDriverPayments,
    openingAdjustments,
    todayAdjustments,
  ] = await Promise.all([
    prisma.vendorPayment.groupBy({ by: ["vendorId"], where: { date: { lt: selectedDate } }, _sum: { amount: true } }),
    prisma.vendorPayment.groupBy({ by: ["vendorId"], where: { date: selectedDate }, _sum: { amount: true } }),
    prisma.purchase.groupBy({
      by: ["vendorId"],
      where: { vendorId: { not: null }, date: { lt: selectedDate } },
      _sum: { amount: true },
    }),
    prisma.purchase.groupBy({
      by: ["vendorId"],
      where: { vendorId: { not: null }, date: selectedDate },
      _sum: { amount: true },
    }),
    prisma.vendorAdjustment.groupBy({ by: ["vendorId"], where: { date: { lt: selectedDate } }, _sum: { amount: true } }),
    prisma.vendorAdjustment.groupBy({ by: ["vendorId"], where: { date: selectedDate }, _sum: { amount: true } }),
  ]);

  const openingPaidMap = toMap(openingPayments);
  for (const p of openingDriverPayments) {
    if (p.vendorId) openingPaidMap.set(p.vendorId, (openingPaidMap.get(p.vendorId) ?? 0) + (p._sum.amount ?? 0));
  }
  const todayPaidMap = toMap(todayPayments);
  for (const p of todayDriverPayments) {
    if (p.vendorId) todayPaidMap.set(p.vendorId, (todayPaidMap.get(p.vendorId) ?? 0) + (p._sum.amount ?? 0));
  }
  const openingAdjMap = toMap(openingAdjustments);
  const todayAdjMap = toMap(todayAdjustments);

  return vendors.map((v) => {
    const openingAmount = (openingAmountMap.get(v.id) ?? 0) + (openingAdjMap.get(v.id) ?? 0);
    const openingCancelled = openingCancelledMap.get(v.id) ?? 0;
    const openingCharge = openingChargeMap.get(v.id) ?? 0;
    const openingPaid = openingPaidMap.get(v.id) ?? 0;

    const todayAmount = (todayAmountMap.get(v.id) ?? 0) + (todayAdjMap.get(v.id) ?? 0);
    const todayCancelled = todayCancelledMap.get(v.id) ?? 0;
    const todayCharge = todayChargeMap.get(v.id) ?? 0;
    const todayPaid = todayPaidMap.get(v.id) ?? 0;

    const totalAmount = openingAmount + todayAmount;
    const cancelledTotal = openingCancelled + todayCancelled;
    const totalDeliveryCharge = openingCharge + todayCharge;
    const totalPaid = openingPaid + todayPaid;
    const adjustmentTotal = (openingAdjMap.get(v.id) ?? 0) + (todayAdjMap.get(v.id) ?? 0);
    const balance = totalAmount - cancelledTotal - totalDeliveryCharge - totalPaid;

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
    };
  });
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { start: selectedDate } = dayRange(req.query.date as string | undefined);
    res.json(await computeVendorCreditRows(selectedDate));
  })
);

// Excel statement of the same ledger shown on screen, for a given date.
router.get(
  "/export",
  asyncHandler(async (req, res) => {
    const { start: selectedDate } = dayRange(req.query.date as string | undefined);
    const rows = await computeVendorCreditRows(selectedDate);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Future Courier Operations";
    workbook.created = new Date();
    const sheet = workbook.addWorksheet("Vendor Credit Statement");
    sheet.columns = [
      { header: "Vendor", key: "vendor", width: 20 },
      { header: "Opening Amount", key: "openingAmount", width: 15 },
      { header: "Opening Cancelled", key: "openingCancelled", width: 16 },
      { header: "Today's Amount", key: "todayAmount", width: 14 },
      { header: "Today's Cancelled", key: "todayCancelled", width: 15 },
      { header: "Total Amount", key: "totalAmount", width: 14 },
      { header: "Adjustment", key: "adjustmentTotal", width: 12 },
      { header: "Cancelled (Total)", key: "cancelledTotal", width: 15 },
      { header: "Delivery Charge", key: "totalDeliveryCharge", width: 15 },
      { header: "Paid", key: "totalPaid", width: 12 },
      { header: "Balance", key: "balance", width: 14 },
    ];
    sheet.getRow(1).font = { bold: true };
    rows.forEach((r) => sheet.addRow({ ...r, vendor: r.vendor.name }));

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
      {
        openingAmount: 0,
        openingCancelled: 0,
        todayAmount: 0,
        todayCancelled: 0,
        totalAmount: 0,
        adjustmentTotal: 0,
        cancelledTotal: 0,
        totalDeliveryCharge: 0,
        totalPaid: 0,
        balance: 0,
      }
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
    const [manual, driverPayments] = await Promise.all([
      prisma.vendorPayment.findMany({
        where: { vendorId: req.params.vendorId },
        orderBy: { date: "desc" },
      }),
      prisma.purchase.findMany({
        where: { vendorId: req.params.vendorId },
        include: { employee: { select: { name: true } } },
        orderBy: { date: "desc" },
      }),
    ]);

    const combined = [
      ...manual.map((p) => ({
        id: p.id,
        date: p.date,
        amount: p.amount,
        note: p.note,
        source: "MANUAL" as const,
        employeeName: null as string | null,
      })),
      ...driverPayments.map((p) => ({
        id: p.id,
        date: p.date,
        amount: p.amount,
        note: p.note,
        source: "DRIVER" as const,
        employeeName: p.employee.name,
      })),
    ].sort((a, b) => b.date.getTime() - a.date.getTime());

    res.json(combined);
  })
);

const paymentSchema = z.object({
  date: z.string(),
  amount: z.number().int().positive(),
  note: z.string().max(300).optional(),
});

const adjustmentSchema = z.object({
  date: z.string(),
  amount: z.number().int().refine((v) => v !== 0, "Amount can't be zero"),
  note: z.string().max(300).optional(),
});

// Adjustment amount can be positive (adds to Total Amount) or negative (subtracts).
router.post(
  "/:vendorId/adjustments",
  requireRole("SUPER_ADMIN", "MANAGER"),
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

router.get(
  "/:vendorId/adjustments",
  asyncHandler(async (req, res) => {
    const adjustments = await prisma.vendorAdjustment.findMany({
      where: { vendorId: req.params.vendorId },
      orderBy: { date: "desc" },
    });
    res.json(adjustments);
  })
);

router.delete(
  "/adjustments/:id",
  requireRole("SUPER_ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.vendorAdjustment.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new ApiError(404, "Adjustment entry not found");

    await prisma.vendorAdjustment.delete({ where: { id: req.params.id } });
    await writeAuditLog({
      userId: req.user!.sub,
      action: "VENDOR_ADJUSTMENT_DELETE",
      entity: "VendorAdjustment",
      entityId: req.params.id,
    });
    emitGlobal("vendorPayment:changed", { type: "deleted" });
    res.json({ deleted: true });
  })
);

router.post(
  "/:vendorId/payments",
  requireRole("SUPER_ADMIN", "MANAGER"),
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
  requireRole("SUPER_ADMIN", "MANAGER"),
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

export default router;
