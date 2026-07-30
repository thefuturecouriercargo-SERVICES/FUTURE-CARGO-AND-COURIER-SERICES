import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler, ApiError } from "../utils/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";
import { dayRange, monthRange, parseDateParam } from "../utils/dates";
import { writeAuditLog } from "../services/audit.service";
import { emitGlobal } from "../lib/socket";

const router = Router();
router.use(authenticate);

const CATEGORIES = [
  "FUEL", "INSURANCE", "SALARY", "WORKSHOP", "CAR_WASH", "ROOM_RENT",
  "CAR_RENT", "STATIONARY", "PARKING", "VISA", "MEDICAL", "COMMISSION",
  "OTHER", "DARB", "SALIK", "INTERNET", "LICENSE",
] as const;

const createSchema = z.object({
  date: z.string(),
  category: z.enum(CATEGORIES),
  amount: z.number().int().min(0),
  remarks: z.string().max(500).optional(),
});

// Admin creates a manual expense entry.
router.post(
  "/",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body);
    const { start } = dayRange(data.date);

    const entry = await prisma.expenseEntry.create({
      data: {
        date: start,
        category: data.category,
        amount: data.amount,
        remarks: data.remarks,
        source: "ADMIN",
      },
    });

    await writeAuditLog({
      userId: req.user!.sub,
      action: "EXPENSE_CREATE",
      entity: "ExpenseEntry",
      entityId: entry.id,
    });
    emitGlobal("expense:changed", { entry });
    res.status(201).json(entry);
  })
);

// List expenses with optional filters.
router.get(
  "/",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const where: Record<string, unknown> = {};

    if (req.query.date) {
      where.date = dayRange(req.query.date as string).start;
    } else if (req.query.month) {
      const { start, end } = monthRange(req.query.month as string);
      where.date = { gte: start, lte: end };
    } else if (req.query.from || req.query.to) {
      where.date = {
        ...(req.query.from ? { gte: parseDateParam(req.query.from as string) } : {}),
        ...(req.query.to ? { lte: parseDateParam(req.query.to as string) } : {}),
      };
    }

    if (req.query.category) where.category = req.query.category as string;

    const entries = await prisma.expenseEntry.findMany({
      where,
      include: { employee: { select: { id: true, name: true } } },
      orderBy: { date: "desc" },
    });
    res.json(entries);
  })
);

// Delete an expense entry.
router.delete(
  "/:id",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.expenseEntry.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new ApiError(404, "Expense entry not found");

    await prisma.expenseEntry.delete({ where: { id: req.params.id } });
    await writeAuditLog({
      userId: req.user!.sub,
      action: "EXPENSE_DELETE",
      entity: "ExpenseEntry",
      entityId: req.params.id,
    });
    emitGlobal("expense:changed", { deleted: req.params.id });
    res.json({ deleted: true });
  })
);

export default router;
