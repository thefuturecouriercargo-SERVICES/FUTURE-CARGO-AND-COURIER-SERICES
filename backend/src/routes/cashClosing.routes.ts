import { Router } from "express";
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
    const balanceCash = cashPayments - totalExpenses;

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

    const expenses = await prisma.expenseEntry.findMany({
      where: { date: start, employeeId: req.user!.sub, source: "ADMIN" },
      orderBy: { createdAt: "asc" },
    });
    const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);

    res.json({
      date: start.toISOString().slice(0, 10),
      totalDelivered: orders.length,
      totalDeliveryCharge: orders.reduce((s, o) => s + o.deliveryCharge, 0),
      cashPayments,
      onlinePayments,
      expenses,
      totalExpenses,
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
