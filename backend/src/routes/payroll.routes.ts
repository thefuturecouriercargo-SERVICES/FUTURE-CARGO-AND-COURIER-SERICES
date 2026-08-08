import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler, ApiError } from "../utils/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";
import { writeAuditLog } from "../services/audit.service";
import { emitGlobal } from "../lib/socket";

const router = Router();
router.use(authenticate);

// GET /payroll?month=2026-08  -> working days per employee for that month
{ href: "/payroll", label: "Payroll", short: "Payroll", roles: ["SUPER_ADMIN", "MANAGER"] },
  asyncHandler(async (req, res) => {
    const month = req.query.month as string;
    if (!month) throw new ApiError(400, "month is required");
    const rows = await prisma.payroll.findMany({ where: { month } });
    res.json(rows);
  })
);

const workingDaysSchema = z.object({
  month: z.string(),
  employeeId: z.string(),
  workingDays: z.number().int().min(0).max(31),
});

// POST /payroll  -> upsert working days for an employee/month
router.post(
  "/",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const data = workingDaysSchema.parse(req.body);
    const row = await prisma.payroll.upsert({
      where: { month_employeeId: { month: data.month, employeeId: data.employeeId } },
      update: { workingDays: data.workingDays },
      create: { month: data.month, employeeId: data.employeeId, workingDays: data.workingDays },
    });
    emitGlobal("payroll:changed", { row });
    res.json(row);
  })
);

// GET /payroll/entries?month=2026-08
router.get(
  "/entries",
  requireRole("SUPER_ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const month = req.query.month as string;
    if (!month) throw new ApiError(400, "month is required");
    const entries = await prisma.payrollEntry.findMany({
      where: { month },
      include: { employee: { select: { id: true, name: true } } },
      orderBy: { date: "desc" },
    });
    res.json(entries);
  })
);

const createEntrySchema = z.object({
  month: z.string(),
  date: z.string(),
  employeeId: z.string(),
type: z.enum(["PAID", "SHORT", "BONUS"]),
  amount: z.number().int().min(0),
  note: z.string().max(500).optional(),
});

// POST /payroll/entries
router.post(
  "/entries",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const data = createEntrySchema.parse(req.body);
    const entry = await prisma.payrollEntry.create({
      data: {
        month: data.month,
        date: new Date(data.date),
        employeeId: data.employeeId,
        type: data.type,
        amount: data.amount,
        note: data.note,
      },
    });
    await writeAuditLog({
      userId: req.user!.sub,
      action: "PAYROLL_ENTRY_CREATE",
      entity: "PayrollEntry",
      entityId: entry.id,
    });
    emitGlobal("payroll:changed", { entry });
    res.status(201).json(entry);
  })
);

// DELETE /payroll/entries/:id
router.delete(
  "/entries/:id",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.payrollEntry.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new ApiError(404, "Payroll entry not found");
    await prisma.payrollEntry.delete({ where: { id: req.params.id } });
    await writeAuditLog({
      userId: req.user!.sub,
      action: "PAYROLL_ENTRY_DELETE",
      entity: "PayrollEntry",
      entityId: req.params.id,
    });
    emitGlobal("payroll:changed", { deleted: req.params.id });
    res.json({ deleted: true });
  })
);

export default router;
