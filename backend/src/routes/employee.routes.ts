import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler, ApiError } from "../utils/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";
import { hashPassword } from "../utils/password";
import { writeAuditLog } from "../services/audit.service";
import { emitGlobal } from "../lib/socket";
import { monthRange } from "../utils/dates";

const router = Router();
router.use(authenticate);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const includeInactive = req.query.includeInactive === "true";
    const roleParam = req.query.role as string | undefined;
    const roleFilter =
      roleParam === "ALL"
        ? { role: { in: ["DRIVER", "MANAGER"] as Array<"DRIVER" | "MANAGER"> }, username: { not: "manager" } }
        : { role: (roleParam as "DRIVER" | "MANAGER") ?? "DRIVER" };
    const employees = await prisma.user.findMany({
      where: { ...roleFilter, ...(includeInactive ? {} : { active: true }) },
      orderBy: { name: "asc" },
     select: { id: true, name: true, username: true, email: true, phone: true, active: true, baseSalary: true, role: true, isAgent: true, createdAt: true },
    });
    res.json(employees);
  })
);

const createSchema = z.object({
  name: z.string().min(1).max(80),
  username: z.string().min(3).max(40),
  email: z.string().email().optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  phone: z.string().max(30).optional(),
  password: z.string().min(6).max(100),
  baseSalary: z.number().int().min(0).optional(),
  role: z.enum(["DRIVER", "MANAGER"]).optional(),
  isAgent: z.boolean().optional(),
});
router.post(
  "/",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body);
    const passwordHash = await hashPassword(data.password);
    const employee = await prisma.user.create({
      data: {
        name: data.name,
        username: data.username.trim(),
        email: data.email,
       phone: data.phone,
        role: data.role ?? "DRIVER",
        passwordHash,
        baseSalary: data.baseSalary ?? 0,
        isAgent: data.isAgent ?? false,
      },
      select: { id: true, name: true, username: true, email: true, phone: true, active: true, baseSalary: true, role: true, isAgent: true },
    });
    await writeAuditLog({ userId: req.user!.sub, action: "CREATE", entity: "Employee", entityId: employee.id });
    emitGlobal("employee:changed", { type: "created", employee });
    res.status(201).json(employee);
  })
);

const updateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  email: z.string().email().optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  phone: z.string().max(30).optional(),
  active: z.boolean().optional(),
  password: z.string().min(6).max(100).optional(),
  baseSalary: z.number().int().min(0).optional(),
  isAgent: z.boolean().optional(),
});

router.put(
  "/:id",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const data = updateSchema.parse(req.body);
    const { password, ...rest } = data;
    const employee = await prisma.user.update({
      where: { id: req.params.id },
      data: { ...rest, ...(password ? { passwordHash: await hashPassword(password) } : {}) },
     select: { id: true, name: true, username: true, email: true, phone: true, active: true, baseSalary: true, isAgent: true },
    });
    await writeAuditLog({ userId: req.user!.sub, action: "UPDATE", entity: "Employee", entityId: employee.id });
    emitGlobal("employee:changed", { type: "updated", employee });
    res.json(employee);
  })
);

router.delete(
  "/:id",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    // Drivers with historical orders are deactivated, never hard-deleted.
    const employee = await prisma.user.update({
      where: { id: req.params.id },
      data: { active: false },
      select: { id: true, name: true, active: true },
    });
    await writeAuditLog({ userId: req.user!.sub, action: "DEACTIVATE", entity: "Employee", entityId: employee.id });
    emitGlobal("employee:changed", { type: "updated", employee });
    res.json({ deactivated: true, employee });
  })
);

router.get(
  "/:id/performance",
  asyncHandler(async (req, res) => {
    const month = (req.query.month as string) ?? undefined;
    const { start, end } = monthRange(month);

    const employee = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!employee) throw new ApiError(404, "Employee not found");

    const orders = await prisma.order.findMany({
      where: { employeeId: req.params.id, date: { gte: start, lte: end } },
    });

    const delivered = orders.filter((o) => o.status === "DELIVERED");
    res.json({
      employee: { id: employee.id, name: employee.name },
      totalOrders: orders.length,
      delivered: delivered.length,
      pending: orders.filter((o) => o.status === "PENDING").length,
      cancelled: orders.filter((o) => o.status === "CANCELLED").length,
      transferred: orders.filter((o) => o.status === "TRANSFER").length,
      totalSales: delivered.reduce((s, o) => s + o.total, 0),
      totalDeliveryCharge: delivered.reduce((s, o) => s + o.deliveryCharge, 0),
    });
  })
);

export default router;
