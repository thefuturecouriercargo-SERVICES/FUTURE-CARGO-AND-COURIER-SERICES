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

const createSchema = z.object({
  date: z.string(),
  employeeId: z.string(),
  amount: z.number().int().min(0),
  note: z.string().max(500).optional(),
});

// Admin creates a purchase entry against a driver.
router.post(
  "/",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body);
    const { start } = dayRange(data.date);
    const entry = await prisma.purchase.create({
      data: {
        date: start,
        employeeId: data.employeeId,
        amount: data.amount,
        note: data.note,
      },
    });

    await writeAuditLog({
      userId: req.user!.sub,
      action: "PURCHASE_CREATE",
      entity: "Purchase",
      entityId: entry.id,
    });
    emitGlobal("purchase:changed", { entry });
    res.status(201).json(entry);
  })
);

// List purchases with optional filters.
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

    if (req.query.employeeId) where.employeeId = req.query.employeeId as string;

    const entries = await prisma.purchase.findMany({
      where,
      include: { employee: { select: { id: true, name: true } } },
      orderBy: { date: "desc" },
    });
    res.json(entries);
  })
);

// Delete a purchase entry.
router.delete(
  "/:id",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.purchase.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new ApiError(404, "Purchase entry not found");

    await prisma.purchase.delete({ where: { id: req.params.id } });
    await writeAuditLog({
      userId: req.user!.sub,
      action: "PURCHASE_DELETE",
      entity: "Purchase",
      entityId: req.params.id,
    });
    emitGlobal("purchase:changed", { deleted: req.params.id });
    res.json({ deleted: true });
  })
);

export default router;
