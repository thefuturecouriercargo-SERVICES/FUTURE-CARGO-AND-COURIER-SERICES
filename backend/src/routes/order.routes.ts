import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { asyncHandler, ApiError } from "../utils/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";
import { dayRange, monthRange, parseDateParam } from "../utils/dates";
import { writeAuditLog } from "../services/audit.service";
import { emitGlobal, emitToUser } from "../lib/socket";

const router = Router();
router.use(authenticate);

const STATUSES = ["PENDING", "DELIVERED", "TRANSFER", "CANCELLED"] as const;
const PAYMENTS = ["CASH", "BANK"] as const;

function buildWhere(query: Record<string, unknown>): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = {};

  if (query.date) {
    const { start } = dayRange(query.date as string);
    where.date = start;
  } else if (query.month) {
    const { start, end } = monthRange(query.month as string);
    where.date = { gte: start, lte: end };
  } else if (query.from || query.to) {
    where.date = {
      ...(query.from ? { gte: parseDateParam(query.from as string) } : {}),
      ...(query.to ? { lte: parseDateParam(query.to as string) } : {}),
    };
  }

  if (query.employeeId) where.employeeId = query.employeeId as string;
  if (query.vendorId) where.vendorId = query.vendorId as string;
  if (query.status) where.status = query.status as (typeof STATUSES)[number];
  if (query.payment) where.payment = query.payment as (typeof PAYMENTS)[number];
  if (query.emirate) where.emirate = (query.emirate as string).toUpperCase();
  if (query.cn) {
    const cnNum = Number(query.cn);
    if (!Number.isNaN(cnNum)) where.cnNo = cnNum;
  }
  if (query.search) {
    const search = query.search as string;
    const cnNum = Number(search);
    where.OR = [
      ...(Number.isNaN(cnNum) ? [] : [{ cnNo: cnNum }]),
      { brandName: { contains: search, mode: "insensitive" as const } },
    ];
  }

  return where;
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const where = buildWhere(req.query as Record<string, unknown>);
    const take = req.query.limit ? Math.min(Number(req.query.limit), 500) : 1000;
    const skip = req.query.offset ? Number(req.query.offset) : 0;

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: { vendor: true, employee: { select: { id: true, name: true } } },
        orderBy: [{ date: "desc" }, { slNo: "asc" }],
        take,
        skip,
      }),
      prisma.order.count({ where }),
    ]);

    res.json({ orders, total });
  })
);

const createSchema = z.object({
  date: z.string(),
  cnNo: z.number().int().positive(),
  vendorId: z.string(),
  payment: z.enum(PAYMENTS),
  emirate: z.string().min(1).max(30),
  employeeId: z.string(),
  total: z.number().int().min(0),
  status: z.enum(STATUSES).optional(),
  remarks: z.string().max(500).optional(),
});

router.post(
  "/",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body);
    const { date } = dayRange(data.date);

    const vendor = await prisma.vendor.findUnique({ where: { id: data.vendorId } });
    if (!vendor) throw new ApiError(404, "Vendor not found");

   const employee = await prisma.user.findUnique({ where: { id: data.employeeId } });
if (!employee || employee.role !== "DRIVER") throw new ApiError(404, "Employee not found");

const existingCn = await prisma.order.findFirst({
  where: {
    cnNo: data.cnNo,
    OR: [
      { date },
      { status: "PENDING" },
    ],
  },
});
if (existingCn) throw new ApiError(409, `CN No. ${data.cnNo} already exists (active or same-day)`);

const order = await prisma.$transaction(async (tx) => {
      const lastSl = await tx.order.aggregate({
        where: { date },
        _max: { slNo: true },
      });
      const slNo = (lastSl._max.slNo ?? 0) + 1;

      return tx.order.create({
        data: {
          date,
          slNo,
          cnNo: data.cnNo,
          vendorId: vendor.id,
          brandName: vendor.name,
          deliveryCharge: vendor.deliveryCharge,
          total: data.total,
          payment: data.payment,
          emirate: data.emirate.toUpperCase(),
          employeeId: data.employeeId,
          status: data.status ?? "PENDING",
          remarks: data.remarks,
        },
        include: { vendor: true, employee: { select: { id: true, name: true } } },
      });
    });

    await writeAuditLog({ userId: req.user!.sub, action: "CREATE", entity: "Order", entityId: order.id, meta: data });
    emitGlobal("order:changed", { type: "created", order });
    emitToUser(order.employeeId, "order:assigned", { order });

    res.status(201).json(order);
  })
);

const updateSchema = z.object({
  cnNo: z.number().int().positive().optional(),
  vendorId: z.string().optional(),
  payment: z.enum(PAYMENTS).optional(),
  emirate: z.string().min(1).max(30).optional(),
  employeeId: z.string().optional(),
  total: z.number().int().min(0).optional(),
  status: z.enum(STATUSES).optional(),
  remarks: z.string().max(500).optional(),
});

router.put(
  "/:id",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const data = updateSchema.parse(req.body);
    const existing = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new ApiError(404, "Order not found");

    let vendorFields: { vendorId?: string; brandName?: string; deliveryCharge?: number } = {};
    if (data.vendorId) {
      const vendor = await prisma.vendor.findUnique({ where: { id: data.vendorId } });
      if (!vendor) throw new ApiError(404, "Vendor not found");
     vendorFields = { vendorId: vendor.id, brandName: vendor.name, deliveryCharge: vendor.deliveryCharge };
}

if (data.cnNo !== undefined && data.cnNo !== existing.cnNo) {
  const existingCn = await prisma.order.findFirst({
    where: {
      cnNo: data.cnNo,
      id: { not: existing.id },
      OR: [
        { date: existing.date },
        { status: "PENDING" },
      ],
    },
  });
  if (existingCn) throw new ApiError(409, `CN No. ${data.cnNo} already exists (active or same-day)`);
}

const order = await prisma.order.update({
      where: { id: req.params.id },
      data: {
        ...(data.cnNo !== undefined ? { cnNo: data.cnNo } : {}),
        ...vendorFields,
        ...(data.payment ? { payment: data.payment } : {}),
        ...(data.emirate ? { emirate: data.emirate.toUpperCase() } : {}),
        ...(data.employeeId ? { employeeId: data.employeeId } : {}),
        ...(data.total !== undefined ? { total: data.total } : {}),
        ...(data.status ? { status: data.status } : {}),
        ...(data.remarks !== undefined ? { remarks: data.remarks } : {}),
      },
      include: { vendor: true, employee: { select: { id: true, name: true } } },
    });

    await writeAuditLog({ userId: req.user!.sub, action: "UPDATE", entity: "Order", entityId: order.id, meta: data });
    emitGlobal("order:changed", { type: "updated", order });
    res.json(order);
  })
);

router.delete(
  "/:id",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    await prisma.order.delete({ where: { id: req.params.id } });
    await writeAuditLog({ userId: req.user!.sub, action: "DELETE", entity: "Order", entityId: req.params.id });
    emitGlobal("order:changed", { type: "deleted", id: req.params.id });
    res.json({ deleted: true });
  })
);

const statusSchema = z.object({ status: z.enum(STATUSES) });

router.patch(
  "/:id/status",
  asyncHandler(async (req, res) => {
    const { status } = statusSchema.parse(req.body);
    const existing = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new ApiError(404, "Order not found");

    // Drivers may only update the status of their own assigned orders.
    if (req.user!.role === "DRIVER" && existing.employeeId !== req.user!.sub) {
      throw new ApiError(403, "You can only update your own deliveries");
    }

  const { start: todayStart } = dayRange();
      const isCarryover = status !== "PENDING" && existing.date.getTime() < todayStart.getTime();

      const order = await prisma.$transaction(async (tx) => {
        let carryFields: { date?: Date; slNo?: number } = {};
        if (isCarryover) {
          const lastSl = await tx.order.aggregate({
            where: { date: todayStart },
            _max: { slNo: true },
          });
          carryFields = { date: todayStart, slNo: (lastSl._max.slNo ?? 0) + 1 };
        }
        return tx.order.update({
          where: { id: req.params.id },
          data: { status, ...carryFields },
          include: { vendor: true, employee: { select: { id: true, name: true } } },
        });
      });

      await writeAuditLog({
        userId: req.user!.sub,
        action: "STATUS_UPDATE",
        entity: "Order",
        entityId: order.id,
        meta: { from: existing.status, to: status, carriedOverToToday: isCarryover },
      });
    emitGlobal("order:changed", { type: "updated", order });
    res.json(order);
  })
);
const paymentSchema = z.object({ payment: z.enum(PAYMENTS) });

router.patch(
  "/:id/payment",
  asyncHandler(async (req, res) => {
    const { payment } = paymentSchema.parse(req.body);
    const existing = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new ApiError(404, "Order not found");

    if (req.user!.role === "DRIVER" && existing.employeeId !== req.user!.sub) {
      throw new ApiError(403, "You can only update your own deliveries");
    }

    const order = await prisma.order.update({
      where: { id: req.params.id },
      data: { payment },
      include: { vendor: true, employee: { select: { id: true, name: true } } },
    });

    await writeAuditLog({
      userId: req.user!.sub,
      action: "PAYMENT_UPDATE",
      entity: "Order",
      entityId: order.id,
      meta: { from: existing.payment, to: payment },
    });
    emitGlobal("order:changed", { type: "updated", order });
    res.json(order);
  })
);
const transferSchema = z.object({ toEmployeeId: z.string(), note: z.string().max(300).optional() });

router.post(
  "/:id/transfer",
  asyncHandler(async (req, res) => {
    const { toEmployeeId, note } = transferSchema.parse(req.body);
    const existing = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new ApiError(404, "Order not found");

    if (req.user!.role === "DRIVER" && existing.employeeId !== req.user!.sub) {
      throw new ApiError(403, "You can only transfer your own deliveries");
    }
    if (toEmployeeId === existing.employeeId) {
      throw new ApiError(400, "Cannot transfer an order to the same driver");
    }

    const toEmployee = await prisma.user.findUnique({ where: { id: toEmployeeId } });
    if (!toEmployee || toEmployee.role !== "DRIVER" || !toEmployee.active) {
      throw new ApiError(404, "Target driver not found or inactive");
    }

    const [order] = await prisma.$transaction([
      prisma.order.update({
        where: { id: req.params.id },
        data: { employeeId: toEmployeeId, status: "TRANSFER" },
        include: { vendor: true, employee: { select: { id: true, name: true } } },
      }),
      prisma.orderTransfer.create({
        data: {
          orderId: req.params.id,
          fromEmployeeId: existing.employeeId,
          toEmployeeId,
          note,
        },
      }),
    ]);

    await writeAuditLog({
      userId: req.user!.sub,
      action: "TRANSFER",
      entity: "Order",
      entityId: order.id,
      meta: { from: existing.employeeId, to: toEmployeeId, note },
    });

    emitGlobal("order:changed", { type: "transferred", order });
    emitToUser(existing.employeeId, "order:removed", { orderId: order.id });
    emitToUser(toEmployeeId, "order:assigned", { order });

    res.json(order);
  })
);

router.get(
  "/pending-carryover",
  asyncHandler(async (req, res) => {
    const { start } = dayRange();
    const orders = await prisma.order.findMany({
      where: { status: "PENDING", date: { lt: start } },
      include: { vendor: true, employee: { select: { id: true, name: true } } },
      orderBy: { date: "asc" },
    });
    res.json({ orders });
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: {
        vendor: true,
        employee: { select: { id: true, name: true } },
        transfers: { include: { fromEmployee: { select: { name: true } }, toEmployee: { select: { name: true } } } },
      },
    });
    if (!order) throw new ApiError(404, "Order not found");
    res.json(order);
  })
);

export default router;
