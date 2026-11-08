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

const CATEGORIES = [
  "FUEL", "INSURANCE", "SALARY", "WORKSHOP", "CAR_WASH", "ROOM_RENT",
  "CAR_RENT", "STATIONARY", "PARKING", "VISA", "MEDICAL", "COMMISSION",
  "OTHER", "DARB", "SALIK", "INTERNET", "LICENSE",
] as const;

const createSchema = z
  .object({
    date: z.string(),
    category: z.enum(CATEGORIES),
    amount: z.number().int().min(1),
    note: z.string().max(500).optional(),
    employeeId: z.string().optional(),
  })
  .refine((d) => d.category !== "SALARY" || !!d.employeeId, { message: "Pick the driver for a salary reminder", path: ["employeeId"] });

// Manager sends a reminder to the admin.
router.post(
  "/",
  requireRole("SUPER_ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body);
    const { start } = dayRange(data.date);
    const [me, emp] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.user!.sub }, select: { name: true } }),
      data.employeeId ? prisma.user.findUnique({ where: { id: data.employeeId }, select: { name: true } }) : null,
    ]);
    if (data.employeeId && !emp) throw new ApiError(404, "Driver not found");
    const row = await prisma.expenseReminder.create({
      data: {
        date: start,
        category: data.category,
        amount: data.amount,
        note: data.note || null,
        employeeId: data.employeeId || null,
        employeeName: emp?.name ?? null,
        createdById: req.user!.sub,
        createdByName: me?.name ?? "Manager",
      },
    });
    await writeAuditLog({ userId: req.user!.sub, action: "REMINDER_CREATE", entity: "ExpenseReminder", entityId: row.id });
    emitGlobal("reminder:changed", { type: "new", id: row.id });
    res.status(201).json(row);
  })
);

// Admin: reminders waiting for confirmation.
router.get(
  "/pending",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (_req, res) => {
    res.json(await prisma.expenseReminder.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" } }));
  })
);

// Manager: own recent reminders and their status.
router.get(
  "/mine",
  requireRole("SUPER_ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    res.json(await prisma.expenseReminder.findMany({ where: { createdById: req.user!.sub }, orderBy: { createdAt: "desc" }, take: 10 }));
  })
);

// Admin confirms. Normal expense → saved on the manager's date. Salary → only marked;
// the admin enters it on the Payroll page (opened by the app).
router.post(
  "/:id/confirm",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const r = await prisma.expenseReminder.findUnique({ where: { id: req.params.id } });
    if (!r) throw new ApiError(404, "Reminder not found");
    if (r.status !== "PENDING") throw new ApiError(409, `Already ${r.status.toLowerCase()}`);
    let expenseId: string | null = null;
    if (r.category !== "SALARY") {
      const e = await prisma.expenseEntry.create({
        data: {
          date: r.date,
          category: r.category,
          amount: r.amount,
          remarks: [r.note, `Reminder from ${r.createdByName}`].filter(Boolean).join(" · "),
          source: "ADMIN",
          employeeId: r.employeeId,
        },
      });
      expenseId = e.id;
      emitGlobal("expense:changed", { entry: e });
    }
    const row = await prisma.expenseReminder.update({
      where: { id: r.id },
      data: { status: "CONFIRMED", confirmedAt: new Date(), expenseId },
    });
    await writeAuditLog({ userId: req.user!.sub, action: "REMINDER_CONFIRM", entity: "ExpenseReminder", entityId: r.id });
    emitGlobal("reminder:changed", { type: "confirmed", id: r.id });
    res.json(row);
  })
);

router.post(
  "/:id/dismiss",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const r = await prisma.expenseReminder.findUnique({ where: { id: req.params.id } });
    if (!r) throw new ApiError(404, "Reminder not found");
    const row = await prisma.expenseReminder.update({ where: { id: r.id }, data: { status: "DISMISSED", confirmedAt: new Date() } });
    await writeAuditLog({ userId: req.user!.sub, action: "REMINDER_DISMISS", entity: "ExpenseReminder", entityId: r.id });
    emitGlobal("reminder:changed", { type: "dismissed", id: r.id });
    res.json(row);
  })
);

export default router;
