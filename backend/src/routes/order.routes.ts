import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { asyncHandler, ApiError } from "../utils/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";
import { dayRange, monthRange, parseDateParam, displayDate } from "../utils/dates";
import { writeAuditLog } from "../services/audit.service";
import { emitGlobal, emitToUser } from "../lib/socket";
import { lockOrderCreation } from "../services/booking.service";
import { chargeFor, correctEmirate } from "../lib/deliveryCharge";
import { updateOrderContact, withContact } from "../lib/orderContact";

const router = Router();
router.use(authenticate);

const STATUSES = ["PENDING", "DELIVERED", "TRANSFER", "CANCELLED"] as const;
const PAYMENTS = ["CASH", "BANK"] as const;
type Status = (typeof STATUSES)[number];

/** A CN booked through the Vendor Portal must be accepted from Awaiting Pickup, not re-typed. */
async function assertCnNotBooked(cnNo: number) {
  const booking = await prisma.booking.findUnique({ where: { cnNo }, include: { vendor: { select: { name: true } } } });
  if (booking && booking.status !== "ACCEPTED") {
    throw new ApiError(
      409,
      `CN No. ${cnNo} is a ${booking.vendor.name} booking (${booking.customerName}) — accept it from Awaiting Pickup instead`
    );
  }
}

/**
 * Fields that must change alongside a status change:
 *  - resolvedAt: stamped when an order becomes Delivered/Cancelled, cleared when
 *    it goes back to Pending/Transfer, untouched if the status didn't change.
 *  - remarks: set to the cancel reason on Cancel; cleared (null) when an order
 *    that WAS cancelled moves to any other status, so an old cancel reason never
 *    lingers on a delivered order. Untouched otherwise.
 */
function statusSideEffects(
  prevStatus: Status | null,
  nextStatus: Status,
  reason?: string
): { resolvedAt?: Date | null; remarks?: string | null } {
  const out: { resolvedAt?: Date | null; remarks?: string | null } = {};
  const resolved = nextStatus === "DELIVERED" || nextStatus === "CANCELLED";
  if (prevStatus !== nextStatus) out.resolvedAt = resolved ? new Date() : null;
  if (nextStatus === "CANCELLED") {
    if (reason !== undefined) out.remarks = reason;
  } else if (prevStatus === "CANCELLED") {
    out.remarks = null;
  }
  return out;
}

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
  if (query.bankPaymentConfirmed !== undefined) where.bankPaymentConfirmed = query.bankPaymentConfirmed === "true";
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

// Lists any CN No. that currently has more than one Order row — a sign of a
// duplicate entered before this uniqueness check existed. Admin reviews and
// removes the wrong one via the normal Delete action.
router.get(
  "/duplicates",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (_req, res) => {
    const grouped = await prisma.order.groupBy({
      by: ["cnNo"],
      _count: { cnNo: true },
      having: { cnNo: { _count: { gt: 1 } } },
    });
    if (grouped.length === 0) return res.json({ groups: [] });

    const orders = await prisma.order.findMany({
      where: { cnNo: { in: grouped.map((g) => g.cnNo) } },
      include: { vendor: true, employee: { select: { id: true, name: true } } },
      orderBy: [{ cnNo: "asc" }, { createdAt: "asc" }],
    });

    const groups = grouped
      .map((g) => ({ cnNo: g.cnNo, orders: orders.filter((o) => o.cnNo === g.cnNo) }))
      .sort((a, b) => a.cnNo - b.cnNo);

    res.json({ groups });
  })
);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const where = buildWhere(req.query as Record<string, unknown>);
    const take = req.query.limit ? Math.min(Number(req.query.limit), 500) : 1000;
    const skip = req.query.offset ? Number(req.query.offset) : 0;

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: { vendor: true, employee: { select: { id: true, name: true } }, booking: { select: { customerName: true, customerPhone: true, address: true, emirate: true, items: true, notes: true, vendorRef: true, codAmount: true, lat: true, lng: true } } },
        orderBy: [{ date: "desc" }, { slNo: "asc" }],
        take,
        skip,
      }),
      prisma.order.count({ where }),
    ]);

    res.json({ orders: orders.map(withContact), total });
  })
);

// Admin/manager fixes a CN's customer phone / address (⋯ → Edit address & phone).
router.patch(
  "/:id/contact",
  requireRole("SUPER_ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const r = await updateOrderContact(req.params.id, req.body ?? {});
    await writeAuditLog({ userId: req.user!.sub, action: "EDIT_CONTACT", entity: "Order", entityId: r.order.id, meta: { cnNo: r.cnNo, before: r.before, phone: req.body?.phone, address: req.body?.address } });
    emitGlobal("order:changed", { type: "updated", order: r.order });
    if (r.order.employeeId) emitToUser(r.order.employeeId, "order:changed", { order: r.order });
    res.json(r.order);
  })
);

const createSchema = z.object({
  date: z.string(),
  cnNo: z.number().int().positive(),
  vendorId: z.string(),
  payment: z.enum(PAYMENTS),
  emirate: z.string().min(1).max(30),
  employeeId: z.string(),
total: z.number().int(),
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

// CN No. must be globally unique — never reused, regardless of status or date.
const existingCn = await prisma.order.findFirst({ where: { cnNo: data.cnNo } });
if (existingCn) {
  throw new ApiError(409, `CN No. ${data.cnNo} already exists (dated ${displayDate(existingCn.date)}, ${existingCn.status})`);
}
await assertCnNotBooked(data.cnNo);

const order = await prisma.$transaction(async (tx) => {
      // Same lock as vendor-booking accepts: re-check the CN inside it so two
      // simultaneous entries of one CN can't both get through.
      await lockOrderCreation(tx);
      const dupCn = await tx.order.findFirst({ where: { cnNo: data.cnNo }, select: { id: true } });
      if (dupCn) throw new ApiError(409, `CN No. ${data.cnNo} already exists`);
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
          deliveryCharge: chargeFor(vendor, data.emirate, data.remarks),
          total: data.total,
          payment: data.payment,
          emirate: correctEmirate(data.emirate, data.remarks),
          employeeId: data.employeeId,
          status: data.status ?? "PENDING",
          remarks: data.remarks,
          resolvedAt: data.status === "DELIVERED" || data.status === "CANCELLED" ? new Date() : null,
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
  bankPaymentConfirmed: z.boolean().optional(),
  emirate: z.string().min(1).max(30).optional(),
  employeeId: z.string().optional(),
  total: z.number().int().optional(),
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
     vendorFields = { vendorId: vendor.id, brandName: vendor.name };
}
// Charge follows the vendor and the area (outside areas have their own rate).
if (data.vendorId || (data.emirate && data.emirate.toUpperCase() !== existing.emirate)) {
  const v = data.vendorId ? await prisma.vendor.findUnique({ where: { id: data.vendorId } }) : await prisma.vendor.findUnique({ where: { id: existing.vendorId } });
  const bk = await prisma.booking.findFirst({ where: { orderId: existing.id }, select: { address: true } });
  if (v) vendorFields.deliveryCharge = chargeFor(v, data.emirate ?? existing.emirate, bk?.address ?? existing.custAddress ?? existing.remarks);
}

if (data.cnNo !== undefined && data.cnNo !== existing.cnNo) {
  const existingCn = await prisma.order.findFirst({
    where: { cnNo: data.cnNo, id: { not: existing.id } },
  });
  if (existingCn) {
    throw new ApiError(409, `CN No. ${data.cnNo} already exists (dated ${displayDate(existingCn.date)}, ${existingCn.status})`);
  }
  await assertCnNotBooked(data.cnNo);
}

// Status side effects first; an explicit remarks value in the edit form still wins.
const sideEffects = data.status ? statusSideEffects(existing.status, data.status, data.remarks) : {};

const order = await prisma.order.update({
      where: { id: req.params.id },
      data: {
        ...sideEffects,
        ...(data.cnNo !== undefined ? { cnNo: data.cnNo } : {}),
        ...vendorFields,
        ...(data.payment ? { payment: data.payment } : {}),
        ...(data.bankPaymentConfirmed !== undefined ? { bankPaymentConfirmed: data.bankPaymentConfirmed } : {}),
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

const bulkUpdateSchema = z
  .object({
    ids: z.array(z.string()).min(1, "Select at least one consignment"),
    emirate: z.string().min(1).max(30).optional(),
    employeeId: z.string().optional(),
    status: z.enum(STATUSES).optional(),
    reason: z.string().max(300).optional(),
  })
  .refine((data) => data.emirate || data.employeeId || data.status, {
    message: "Provide an emirate, employee, and/or status to apply",
  })
  .refine((data) => data.status !== "CANCELLED" || (data.reason && data.reason.trim().length > 0), {
    message: "A reason is required to cancel consignments",
    path: ["reason"],
  });

router.patch(
  "/bulk",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const data = bulkUpdateSchema.parse(req.body);

    if (data.employeeId) {
      const employee = await prisma.user.findUnique({ where: { id: data.employeeId } });
      if (!employee || employee.role !== "DRIVER") throw new ApiError(404, "Employee not found");
    }

    if (data.status) {
      // Status changes need per-row logic (carryover date-bump, cancel reason), so
      // each selected order is updated individually inside one transaction rather
      // than a single blanket updateMany.
      const existingOrders = await prisma.order.findMany({ where: { id: { in: data.ids } } });
      const { start: todayStart } = dayRange();
      const lastSl = await prisma.order.aggregate({ where: { date: todayStart }, _max: { slNo: true } });
      let nextSl = (lastSl._max.slNo ?? 0) + 1;

      const updates = existingOrders.map((existing) => {
        const isCarryover = data.status !== "PENDING" && existing.date.getTime() < todayStart.getTime();
        const carryFields = isCarryover ? { date: todayStart, slNo: nextSl++ } : {};
        return prisma.order.update({
          where: { id: existing.id },
          data: {
            status: data.status,
            ...(data.emirate ? { emirate: data.emirate.toUpperCase() } : {}),
            ...(data.employeeId ? { employeeId: data.employeeId } : {}),
            ...statusSideEffects(existing.status, data.status!, data.reason),
            ...carryFields,
          },
        });
      });
      await prisma.$transaction(updates);
    } else {
      const updateData: Prisma.OrderUncheckedUpdateManyInput = {};
      if (data.emirate) updateData.emirate = data.emirate.toUpperCase();
      if (data.employeeId) updateData.employeeId = data.employeeId;

      await prisma.order.updateMany({
        where: { id: { in: data.ids } },
        data: updateData,
      });
    }

    // A new emirate can move parcels in/out of outside areas → refresh their charge.
    if (data.emirate) {
      const rows = await prisma.order.findMany({ where: { id: { in: data.ids } }, include: { vendor: true } });
      const bks = await prisma.booking.findMany({ where: { orderId: { in: data.ids } }, select: { orderId: true, address: true } });
      const addr = new Map(bks.map((b) => [b.orderId, b.address]));
      for (const o of rows) {
        const c = chargeFor(o.vendor, o.emirate, addr.get(o.id) ?? o.custAddress ?? o.remarks);
        if (c !== o.deliveryCharge) await prisma.order.update({ where: { id: o.id }, data: { deliveryCharge: c } });
      }
    }

    await writeAuditLog({
      userId: req.user!.sub,
      action: "BULK_UPDATE",
      entity: "Order",
      entityId: data.ids.join(","),
      meta: { ids: data.ids, emirate: data.emirate, employeeId: data.employeeId, status: data.status, count: data.ids.length },
    });

    emitGlobal("order:changed", { type: "bulk-updated", ids: data.ids });

    res.json({ updated: data.ids.length });
  })
);

router.delete(
  "/:id",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    // ?withBooking=1 removes the vendor's booking too, so the CN disappears from
    // the vendor's pages as well. Otherwise the booking goes back to Awaiting
    // Pickup rather than staying marked accepted with no order.
    if (req.query.withBooking === "1") {
      const linked = await prisma.booking.findMany({ where: { orderId: req.params.id }, select: { id: true, cnNo: true } });
      await prisma.booking.deleteMany({ where: { orderId: req.params.id } });
      for (const b of linked) {
        await writeAuditLog({ userId: req.user!.sub, action: "BOOKING_DELETE", entity: "Booking", entityId: b.id, meta: { cnNo: b.cnNo, withOrder: req.params.id } });
      }
      if (linked.length) emitGlobal("booking:changed", { type: "deleted" });
    } else {
      await prisma.booking.updateMany({ where: { orderId: req.params.id }, data: { status: "AWAITING_PICKUP", orderId: null } });
    }
    await prisma.order.delete({ where: { id: req.params.id } });
    // A deleted consignment disappears from the Scan & Assign history too.
    await prisma.scanLog.deleteMany({ where: { orderId: req.params.id } });
    await writeAuditLog({ userId: req.user!.sub, action: "DELETE", entity: "Order", entityId: req.params.id });
    emitGlobal("order:changed", { type: "deleted", id: req.params.id });
    res.json({ deleted: true });
  })
);

const statusSchema = z
  .object({ status: z.enum(STATUSES), reason: z.string().max(300).optional() })
  .refine((data) => data.status !== "CANCELLED" || (data.reason && data.reason.trim().length > 0), {
    message: "A reason is required to cancel a consignment",
    path: ["reason"],
  });

router.patch(
  "/:id/status",
  asyncHandler(async (req, res) => {
    const { status, reason } = statusSchema.parse(req.body);
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
          data: {
            status,
            ...carryFields,
            ...statusSideEffects(existing.status, status, reason),
          },
          include: { vendor: true, employee: { select: { id: true, name: true } } },
        });
      });

      await writeAuditLog({
        userId: req.user!.sub,
        action: "STATUS_UPDATE",
        entity: "Order",
        entityId: order.id,
        meta: { from: existing.status, to: status, reason, carriedOverToToday: isCarryover },
      });
    emitGlobal("order:changed", { type: "updated", order });
    res.json(order);
  })
);
const paymentSchema = z.object({ payment: z.enum(PAYMENTS), bankPaymentConfirmed: z.boolean().optional() });

router.patch(
  "/:id/payment",
  asyncHandler(async (req, res) => {
    const { payment, bankPaymentConfirmed } = paymentSchema.parse(req.body);
    const existing = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new ApiError(404, "Order not found");

    if (req.user!.role === "DRIVER" && existing.employeeId !== req.user!.sub) {
      throw new ApiError(403, "You can only update your own deliveries");
    }

    const order = await prisma.order.update({
      where: { id: req.params.id },
      data: {
        payment,
        // Only ever touched when the payment is actually BANK — switching to CASH
        // leaves this alone (irrelevant for cash) rather than resetting history.
        ...(payment === "BANK" ? { bankPaymentConfirmed: bankPaymentConfirmed ?? false } : {}),
      },
      include: { vendor: true, employee: { select: { id: true, name: true } } },
    });

    await writeAuditLog({
      userId: req.user!.sub,
      action: "PAYMENT_UPDATE",
      entity: "Order",
      entityId: order.id,
      meta: { from: existing.payment, to: payment, bankPaymentConfirmed },
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
        data: { employeeId: toEmployeeId, status: "TRANSFER", ...statusSideEffects(existing.status, "TRANSFER") },
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
    const { start } = dayRange(req.query.date as string | undefined);

    // Look at ALL past orders (any status), not just Pending/Transfer ones, so we can
    // tell whether a consignment number was later re-resolved under a newer entry.
    const pastOrders = await prisma.order.findMany({
      where: { date: { lt: start } },
      include: { vendor: true, employee: { select: { id: true, name: true } }, booking: { select: { customerName: true, customerPhone: true, address: true, emirate: true, items: true, notes: true, vendorRef: true, codAmount: true, lat: true, lng: true } } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    });

    // Dedupe by (vendor, CN No): keep only the most recent entry for each consignment.
    // If that most recent entry is already Delivered/Cancelled, the consignment is
    // resolved and must not show up as a stale carryover duplicate.
    const seenKeys = new Set<string>();
    const orders = pastOrders.filter((o) => {
      const key = `${o.vendorId}::${o.cnNo}`;
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return o.status === "PENDING" || o.status === "TRANSFER";
    });

    orders.sort((a, b) => a.date.getTime() - b.date.getTime());

    res.json({ orders: orders.map(withContact) });
  })
);

// Unconfirmed bank-payment carryover — mirrors pending-carryover above, but tracks
// a DIFFERENT thing: not order status, but whether a BANK payment's receipt has
// been confirmed. An order can be Delivered and still show up here if its bank
// payment was never ticked as received — persists indefinitely across days until
// someone confirms it. Drivers only ever see their own; admin/manager see everyone's.
router.get(
  "/unconfirmed-bank-carryover",
  asyncHandler(async (req, res) => {
    const { start } = dayRange(req.query.date as string | undefined);

    const where: Prisma.OrderWhereInput = {
      date: { lt: start },
      payment: "BANK",
      bankPaymentConfirmed: false,
    };
    if (req.user!.role === "DRIVER") {
      where.employeeId = req.user!.sub;
    } else if (req.query.employeeId) {
      where.employeeId = req.query.employeeId as string;
    }

    const pastOrders = await prisma.order.findMany({
      where,
      include: { vendor: true, employee: { select: { id: true, name: true } } },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    });

    // Dedupe by CN — only the most recent entry per consignment.
    const seenCn = new Set<number>();
    const orders = pastOrders.filter((o) => {
      if (seenCn.has(o.cnNo)) return false;
      seenCn.add(o.cnNo);
      return true;
    });

    res.json({ orders });
  })
);

const bulkConfirmSchema = z.object({ beforeDate: z.string() });

// One-time cleanup action — marks every BANK order dated before the given date as
// confirmed, so a backlog of historically-unconfirmed payments doesn't flood the
// new carryover view the moment this feature goes live.
router.patch(
  "/bulk-confirm-bank",
  requireRole("SUPER_ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const { beforeDate } = bulkConfirmSchema.parse(req.body);
    const { start } = dayRange(beforeDate);

    const result = await prisma.order.updateMany({
      where: { date: { lt: start }, payment: "BANK", bankPaymentConfirmed: false },
      data: { bankPaymentConfirmed: true },
    });

    await writeAuditLog({
      userId: req.user!.sub,
      action: "BULK_CONFIRM_BANK",
      entity: "Order",
      entityId: "bulk",
      meta: { beforeDate, count: result.count },
    });

    emitGlobal("order:changed", { type: "bulk-confirmed-bank" });
    res.json({ updated: result.count });
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
        booking: { select: { customerName: true, customerPhone: true, address: true, emirate: true, items: true, notes: true, vendorRef: true, codAmount: true, lat: true, lng: true } },
      },
    });
    if (!order) throw new ApiError(404, "Order not found");
    res.json(withContact(order));
  })
);

// One order by id — used by the header search's "Open in Daily Entry" jump so it
// lands on the order's real day and CN even if the booking's details differ.
router.get(
  "/one/:id",
  requireRole("SUPER_ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: { vendor: true, employee: { select: { id: true, name: true } }, booking: { select: { customerName: true, customerPhone: true, address: true, emirate: true, items: true, notes: true, vendorRef: true, codAmount: true, lat: true, lng: true } } },
    });
    if (!order) return res.status(404).json({ message: "Order not found — it may have been deleted" });
    res.json(withContact(order));
  })
);

// Full dated history of one consignment for the order panel's timeline:
// vendor booking, entry, scans, edits, status changes, transfers, notes.
router.get(
  "/:id/history",
  requireRole("SUPER_ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        vendor: { select: { name: true } },
        employee: { select: { name: true } },
        booking: { select: { createdAt: true, labelPrintedAt: true } },
        transfers: {
          orderBy: { transferredAt: "asc" },
          include: { fromEmployee: { select: { name: true } }, toEmployee: { select: { name: true } } },
        },
      },
    });
    if (!order) return res.status(404).json({ message: "Order not found" });

    const logs = await prisma.auditLog.findMany({
      where: { entity: "Order", entityId: id },
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    });
    // Bulk updates list their orders inside meta.ids.
    const bulk = await prisma.$queryRaw<{ userId: string | null; meta: unknown; createdAt: Date }[]>`
      SELECT "userId", meta, "createdAt" FROM audit_logs
      WHERE action = 'BULK_UPDATE' AND entity = 'Order' AND jsonb_exists(meta::jsonb -> 'ids', ${id})`;

    // Names for any user ids mentioned inside log details.
    type M = Record<string, unknown>;
    const ids = new Set<string>();
    const pick = (m: M, k: string) => (typeof m[k] === "string" ? (m[k] as string) : null);
    for (const l of logs) {
      const m = (l.meta ?? {}) as M;
      ["to", "from", "employeeId"].forEach((k) => { const v = pick(m, k); if (v) ids.add(v); });
    }
    for (const b of bulk) {
      const m = (b.meta ?? {}) as M;
      const v = pick(m, "employeeId"); if (v) ids.add(v);
      if (b.userId) ids.add(b.userId);
    }
    const users = ids.size ? await prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } }) : [];
    const nameOf = (uid: string | null | undefined) => (uid ? users.find((u) => u.id === uid)?.name ?? null : null);

    type Ev = { at: string; what: string; by?: string | null; detail?: string | null; kind: string };
    const ev: Ev[] = [];
    const push = (at: Date | null | undefined, e: Omit<Ev, "at">) => { if (at) ev.push({ at: at.toISOString(), ...e }); };
    const NICE: Record<string, string> = { PENDING: "Pending", DELIVERED: "Delivered", CANCELLED: "Cancelled", TRANSFER: "Transfer" };

    if (order.booking) {
      push(order.booking.createdAt, { kind: "booking", what: `Booked by vendor ${order.vendor.name}` });
      push(order.booking.labelPrintedAt, { kind: "info", what: "Label printed" });
    }

    let entered = false;
    for (const l of logs) {
      const m = (l.meta ?? {}) as M;
      const by = l.user?.name ?? null;
      switch (l.action) {
        case "CREATE":
          entered = true;
          push(l.createdAt, { kind: "entry", what: "Entered in Daily Entry", by, detail: nameOf(pick(m, "employeeId")) ? `With ${nameOf(pick(m, "employeeId"))}` : null });
          break;
        case "SCAN_ACCEPT":
          entered = true;
          push(l.createdAt, { kind: "entry", what: `Scanned & assigned to ${nameOf(pick(m, "to")) ?? "driver"}`, by });
          break;
        case "SCAN_REASSIGN":
          push(l.createdAt, { kind: "transfer", what: `Re-scanned: ${nameOf(pick(m, "from")) ?? "?"} → ${nameOf(pick(m, "to")) ?? "?"}`, by });
          break;
        case "DRIVER_SCAN_CLAIM":
          entered = true;
          push(l.createdAt, { kind: "entry", what: `Scanned by driver ${by ?? ""}`.trim() });
          break;
        case "STATUS_UPDATE": {
          const from = NICE[pick(m, "from") ?? ""] ?? pick(m, "from");
          const to = NICE[pick(m, "to") ?? ""] ?? pick(m, "to");
          const viaAgent = pick(m, "source") === "AGENT_REPORT";
          push(l.createdAt, {
            kind: (pick(m, "to") ?? "").toLowerCase(),
            what: `${from ?? "?"} → ${to ?? "?"}${viaAgent ? " (agent report)" : ""}`,
            by,
            detail: pick(m, "reason"),
          });
          break;
        }
        case "PAYMENT_UPDATE":
          push(l.createdAt, { kind: "info", what: `Payment ${pick(m, "from") ?? "?"} → ${pick(m, "to") ?? "?"}`, by });
          break;
        case "UPDATE": {
          const bits: string[] = [];
          if (pick(m, "employeeId")) bits.push(`driver ${nameOf(pick(m, "employeeId")) ?? "?"}`);
          if (pick(m, "status")) bits.push(`status ${NICE[pick(m, "status")!] ?? pick(m, "status")}`);
          if (typeof m.total === "number") bits.push(`total AED ${m.total}`);
          if (pick(m, "emirate")) bits.push(pick(m, "emirate")!);
          push(l.createdAt, { kind: "edit", what: "Edited", by, detail: bits.length ? bits.join(" · ") : null });
          break;
        }
        case "EDIT_CONTACT":
        case "DRIVER_EDIT_CONTACT":
          push(l.createdAt, { kind: "edit", what: "Address / phone changed", by });
          break;
        case "TRANSFER":
          break; // shown from the transfer records below (they carry from/to + note)
        default:
          push(l.createdAt, { kind: "info", what: l.action.replace(/_/g, " ").toLowerCase(), by });
      }
    }
    for (const b of bulk) {
      const m = (b.meta ?? {}) as M;
      const bits: string[] = [];
      if (pick(m, "employeeId")) bits.push(`driver ${nameOf(pick(m, "employeeId")) ?? "?"}`);
      if (pick(m, "status")) bits.push(`status ${NICE[pick(m, "status")!] ?? pick(m, "status")}`);
      if (pick(m, "emirate")) bits.push(pick(m, "emirate")!);
      push(new Date(b.createdAt), { kind: "edit", what: "Bulk update", by: nameOf(b.userId), detail: bits.join(" · ") || null });
    }
    for (const t of order.transfers) {
      push(t.transferredAt, { kind: "transfer", what: `Transferred ${t.fromEmployee.name} → ${t.toEmployee.name}`, detail: t.note });
    }
    if (!entered) push(order.createdAt, { kind: "entry", what: "Entered in Daily Entry" });
    if (order.driverNote) push(order.driverNoteAt, { kind: "note", what: `Driver note: ${order.driverNote}` });
    // Closed before status changes were logged — still show when.
    if ((order.status === "DELIVERED" || order.status === "CANCELLED") && !ev.some((e) => e.kind === order.status.toLowerCase())) {
      push(order.resolvedAt, { kind: order.status.toLowerCase(), what: NICE[order.status], detail: order.status === "CANCELLED" ? order.remarks : null });
    }

    ev.sort((a, b) => a.at.localeCompare(b.at));
    res.json({ events: ev });
  })
);

export default router;
