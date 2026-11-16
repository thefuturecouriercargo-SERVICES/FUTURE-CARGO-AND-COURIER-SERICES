import { Router } from "express";
import { kmEnabled, readBill, storePhoto } from "../services/km.service";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler, ApiError } from "../utils/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";
import { dayRange } from "../utils/dates";
import { writeAuditLog } from "../services/audit.service";
import { emitGlobal } from "../lib/socket";

const router = Router();
router.use(authenticate);

const submitSchema = z.object({
  date: z.string().optional(),
});

// Driver submits (or re-submits) their day-end cash closing.
// Delivered/cash/online totals are always computed server-side from real order data — never trusted from the client.
router.post(
  "/",
  requireRole("DRIVER"),
  asyncHandler(async (req, res) => {
    const data = submitSchema.parse(req.body);
    const { start } = dayRange(data.date);

    // KM-tracked drivers close the day with "End delivery" (End KM) first.
    if (await kmEnabled(req.user!.sub)) {
      const log = await prisma.kmLog.findUnique({ where: { employeeId_date: { employeeId: req.user!.sub, date: start } } });
      if (log && log.endKm == null) throw new ApiError(400, "Enter your End KM — tap END DELIVERY");
    }

    const orders = await prisma.order.findMany({
      where: { employeeId: req.user!.sub, date: start, status: "DELIVERED" },
    });

 const totalDeliveryCharge = orders.reduce((s, o) => s + o.deliveryCharge, 0);
const cashPayments = orders.filter((o) => o.payment === "CASH").reduce((s, o) => s + o.total, 0);
const onlinePayments = orders.filter((o) => o.payment === "BANK").reduce((s, o) => s + o.total, 0);
const adminExpenses = await prisma.expenseEntry.findMany({
      where: { date: start, employeeId: req.user!.sub, source: "ADMIN" },
    });
    const totalExpenses = adminExpenses.reduce((s, e) => s + e.amount, 0);
    const purchases = await prisma.purchase.findMany({
      where: { date: start, employeeId: req.user!.sub },
    });
    const totalPurchases = purchases.reduce((s, p) => s + p.amount, 0);
    const balanceCash = cashPayments - totalExpenses - totalPurchases;

    const closing = await prisma.cashClosing.upsert({
      where: { employeeId_date: { employeeId: req.user!.sub, date: start } },
      create: {
        employeeId: req.user!.sub,
        date: start,
        totalDelivered: orders.length,
        totalDeliveryCharge,
        cashPayments,
        onlinePayments,
       expenses: totalExpenses,
        balanceCash,
      },
      update: {
        totalDelivered: orders.length,
        totalDeliveryCharge,
        cashPayments,
        onlinePayments,
       expenses: totalExpenses,
        balanceCash,
        submittedAt: new Date(),
      },
      include: { employee: { select: { id: true, name: true } } },
    });

    await writeAuditLog({
      userId: req.user!.sub,
      action: "CASH_CLOSING_SUBMIT",
      entity: "CashClosing",
      entityId: closing.id,
    });
  
    emitGlobal("cashClosing:submitted", { closing });

    res.status(201).json(closing);
  })
);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const where: Record<string, unknown> = {};
    if (req.query.date) where.date = dayRange(req.query.date as string).start;
    if (req.query.employeeId) where.employeeId = req.query.employeeId as string;

    // Drivers can only see their own closings.
    if (req.user!.role === "DRIVER") where.employeeId = req.user!.sub;

    const closings = await prisma.cashClosing.findMany({
      where,
      include: { employee: { select: { id: true, name: true } } },
      orderBy: [{ date: "desc" }, { submittedAt: "desc" }],
    });
    res.json(closings);
  })
);

// ---------- Driver expenses (added from Cash closing; counted exactly like admin-entered ones) ----------

const DRIVER_EXPENSE_TYPES = ["FUEL", "PARKING", "SALIK", "CAR_WASH", "DARB", "WORKSHOP", "STATIONARY", "INTERNET", "OTHER"] as const;

/** Driver may add/remove expenses for today, or yesterday before 10 AM (same as the Cash closing page). */
function driverExpenseDayOk(date: Date) {
  const dubai = new Date(Date.now() + 4 * 60 * 60 * 1000);
  const today = Date.UTC(dubai.getUTCFullYear(), dubai.getUTCMonth(), dubai.getUTCDate());
  if (date.getTime() === today) return true;
  return date.getTime() === today - 24 * 60 * 60 * 1000 && dubai.getUTCHours() < 10;
}

async function assertClosingOpen(employeeId: string, date: Date) {
  const c = await prisma.cashClosing.findUnique({ where: { employeeId_date: { employeeId, date } } });
  if (c?.status === "REVIEWED") throw new ApiError(409, "This cash closing is already reviewed by admin");
}

// Read the amount from a bill photo. Rounded to whole AED (99.15 → 99, 99.50 → 100).
router.post(
  "/expenses/read",
  requireRole("DRIVER"),
  asyncHandler(async (req, res) => {
    const { photo } = z.object({ photo: z.string().min(20) }).parse(req.body);
    const p = await storePhoto(req.user!.sub, "EXPENSE", photo);
    const r = await readBill(p.base64, p.mime);
    res.json({ photoId: p.id, raw: r?.amount ?? null, amount: r?.amount != null ? Math.round(r.amount) : null, litres: r?.litres ?? null, station: r?.station ?? null });
  })
);

router.post(
  "/expenses",
  requireRole("DRIVER"),
  asyncHandler(async (req, res) => {
    const d = z
      .object({
        date: z.string(),
        category: z.enum(DRIVER_EXPENSE_TYPES),
        amount: z.coerce.number().int().positive().max(5000),
        photoId: z.string({ required_error: "Take a photo of the bill" }).min(1, "Take a photo of the bill"),
        litres: z.coerce.number().positive().max(300).nullable().optional(),
        station: z.string().max(60).nullable().optional(),
        note: z.string().max(200).nullable().optional(),
      })
      .parse(req.body);
    const userId = req.user!.sub;
    const { start } = dayRange(d.date);
    if (!driverExpenseDayOk(start)) throw new ApiError(400, "Expenses can only be added for today");
    await assertClosingOpen(userId, start);
    // No bill, no expense: the photo must be one this driver just uploaded.
    const photo = await prisma.kmPhoto.findFirst({ where: { id: d.photoId, employeeId: userId }, select: { id: true } });
    if (!photo) throw new ApiError(400, "Take a photo of the bill");
    const entry = await prisma.expenseEntry.create({
      data: {
        date: start,
        category: d.category,
        amount: d.amount,
        remarks: [d.station, d.note].filter(Boolean).join(" · ") || null,
        source: "ADMIN", // counted in cash closing, dashboard and P&L like any admin entry
        enteredBy: "DRIVER",
        employeeId: userId,
        photoId: d.photoId ?? null,
      },
    });
    // Fuel paid from collected cash also counts in the KM & fuel report.
    if (d.category === "FUEL" && (await kmEnabled(userId))) {
      await prisma.fuelLog.create({ data: { employeeId: userId, date: start, amount: d.amount, litres: d.litres ?? null, station: d.station ?? null, photoId: d.photoId ?? null } });
      emitGlobal("km:changed", { employeeId: userId });
    }
    await writeAuditLog({ userId, action: "EXPENSE_CREATE", entity: "ExpenseEntry", entityId: entry.id, meta: { by: "DRIVER", category: d.category, amount: d.amount } });
    emitGlobal("expense:changed", { entry });
    res.status(201).json(entry);
  })
);

router.delete(
  "/expenses/:id",
  requireRole("DRIVER"),
  asyncHandler(async (req, res) => {
    const userId = req.user!.sub;
    const e = await prisma.expenseEntry.findUnique({ where: { id: req.params.id } });
    if (!e || e.employeeId !== userId || e.enteredBy !== "DRIVER") throw new ApiError(404, "Expense not found");
    if (!driverExpenseDayOk(e.date)) throw new ApiError(400, "Only today's expenses can be removed");
    await assertClosingOpen(userId, e.date);
    await prisma.expenseEntry.delete({ where: { id: e.id } });
    if (e.category === "FUEL" && e.photoId) await prisma.fuelLog.deleteMany({ where: { employeeId: userId, photoId: e.photoId, amount: e.amount } });
    else if (e.category === "FUEL") {
      const f = await prisma.fuelLog.findFirst({ where: { employeeId: userId, date: e.date, amount: e.amount, photoId: null }, orderBy: { createdAt: "desc" } });
      if (f) await prisma.fuelLog.delete({ where: { id: f.id } });
    }
    await writeAuditLog({ userId, action: "EXPENSE_DELETE", entity: "ExpenseEntry", entityId: e.id, meta: { by: "DRIVER" } });
    emitGlobal("expense:changed", { deleted: e.id });
    emitGlobal("km:changed", { employeeId: userId });
    res.json({ deleted: true });
  })
);

router.get(
  "/preview",
  requireRole("DRIVER"),
  asyncHandler(async (req, res) => {
    const { start } = dayRange(req.query.date as string | undefined);
    const orders = await prisma.order.findMany({
      where: { employeeId: req.user!.sub, date: start, status: "DELIVERED" },
    });
   const cashPayments = orders.filter((o) => o.payment === "CASH").reduce((s, o) => s + o.total, 0);
    const onlinePayments = orders.filter((o) => o.payment === "BANK").reduce((s, o) => s + o.total, 0);
    const cashCount = orders.filter((o) => o.payment === "CASH").length;
    const bankCount = orders.filter((o) => o.payment === "BANK").length;

    const expenses = await prisma.expenseEntry.findMany({
      where: { date: start, employeeId: req.user!.sub, source: "ADMIN" },
      orderBy: { createdAt: "asc" },
    });
    const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);

    const purchases = await prisma.purchase.findMany({
      where: { date: start, employeeId: req.user!.sub },
      include: { vendor: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });
    const totalPurchases = purchases.reduce((s, p) => s + p.amount, 0);

    res.json({
      date: start.toISOString().slice(0, 10),
      totalDelivered: orders.length,
      totalDeliveryCharge: orders.reduce((s, o) => s + o.deliveryCharge, 0),
      cashPayments,
      onlinePayments,
      cashCount,
      bankCount,
      expenses,
      totalExpenses,
      purchases,
      totalPurchases,
    });
  })
);

router.patch(
  "/:id/review",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const closing = await prisma.cashClosing.update({
      where: { id: req.params.id },
      data: { status: "REVIEWED" },
      include: { employee: { select: { id: true, name: true } } },
    });
    await writeAuditLog({ userId: req.user!.sub, action: "CASH_CLOSING_REVIEW", entity: "CashClosing", entityId: closing.id });
    emitGlobal("cashClosing:reviewed", { closing });
    res.json(closing);
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const closing = await prisma.cashClosing.findUnique({
      where: { id: req.params.id },
      include: { employee: { select: { id: true, name: true } } },
    });
    if (!closing) throw new ApiError(404, "Cash closing record not found");
    if (req.user!.role === "DRIVER" && closing.employeeId !== req.user!.sub) {
      throw new ApiError(403, "Not allowed");
    }
    res.json(closing);
  })
);

export default router;
