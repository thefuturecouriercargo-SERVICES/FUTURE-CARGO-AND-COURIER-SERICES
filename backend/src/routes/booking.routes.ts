import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler, ApiError } from "../utils/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";
import { writeAuditLog } from "../services/audit.service";
import { emitGlobal, emitToUser } from "../lib/socket";
import { bookingInputSchema, createBooking, acceptBooking, assertRefFree, assignByScan } from "../services/booking.service";

// Office side of vendor bookings: the "Awaiting Pickup" queue.
const router = Router();
router.use(authenticate);

const INCLUDE = {
  vendor: { select: { id: true, name: true, deliveryCharge: true } },
  order: { select: { id: true, status: true, date: true, resolvedAt: true, employee: { select: { id: true, name: true } } } },
} as const;

type BookingStatus = "AWAITING_PICKUP" | "ACCEPTED" | "REJECTED";

router.get(
  "/",
  requireRole("SUPER_ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const ids = typeof req.query.ids === "string" && req.query.ids ? req.query.ids.split(",") : undefined;
    const status = req.query.status as BookingStatus | undefined;
    const vendorId = req.query.vendorId as string | undefined;
    const bookings = await prisma.booking.findMany({
      where: {
        ...(ids ? { id: { in: ids } } : {}),
        ...(status ? { status } : {}),
        ...(vendorId ? { vendorId } : {}),
      },
      include: INCLUDE,
      orderBy: { createdAt: status === "AWAITING_PICKUP" ? "asc" : "desc" },
      take: ids ? undefined : 500,
    });
    const awaitingCount = await prisma.booking.count({ where: { status: "AWAITING_PICKUP" } });
    res.json({ bookings, awaitingCount });
  })
);

// Look up a booking by CN — used when a label is scanned or typed.
router.get(
  "/by-cn/:cn",
  requireRole("SUPER_ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const code = req.params.cn.trim();
    const cnNo = Number(code);
    const booking =
      (Number.isSafeInteger(cnNo) ? await prisma.booking.findUnique({ where: { cnNo }, include: INCLUDE }) : null) ??
      (await prisma.booking.findFirst({ where: { vendorRef: code }, include: INCLUDE, orderBy: { createdAt: "desc" } }));
    if (!booking) throw new ApiError(404, "No booking with that CN or order No.");
    res.json(booking);
  })
);

// Office enters a consignment on a vendor's behalf.
router.post(
  "/",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const { vendorId, ...rest } = req.body ?? {};
    if (typeof vendorId !== "string" || !vendorId) throw new ApiError(400, "Choose a vendor");
    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor || !vendor.active) throw new ApiError(404, "Vendor not found or inactive");
    const input = bookingInputSchema.parse(rest);
    const booking = await createBooking(vendorId, input, "ADMIN");
    await writeAuditLog({ userId: req.user!.sub, action: "BOOKING_CREATE", entity: "Booking", entityId: booking.id, meta: { vendor: vendor.name, cnNo: booking.cnNo, by: "ADMIN" } });
    emitGlobal("booking:changed", { type: "created", id: booking.id });
    res.status(201).json(booking);
  })
);

router.put(
  "/:id",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.booking.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new ApiError(404, "Booking not found");
    if (existing.status === "ACCEPTED") throw new ApiError(400, "Already in Daily Entry — edit the consignment there");
    const input = bookingInputSchema.parse(req.body);
    await assertRefFree(existing.vendorId, input.vendorRef || undefined, existing.id);
    const booking = await prisma.booking.update({
      where: { id: existing.id },
      data: {
        vendorRef: input.vendorRef || null,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        address: input.address,
        emirate: input.emirate.toUpperCase(),
        items: input.items || null,
        codAmount: input.codAmount,
        notes: input.notes || null,
      },
      include: INCLUDE,
    });
    await writeAuditLog({ userId: req.user!.sub, action: "BOOKING_UPDATE", entity: "Booking", entityId: booking.id, meta: input });
    emitGlobal("booking:changed", { type: "updated", id: booking.id });
    res.json(booking);
  })
);

const acceptSchema = z.object({
  ids: z.array(z.string()).min(1),
  employeeId: z.string().min(1, "Choose a driver"),
  emirate: z.string().max(30).optional(),
  date: z.string().optional(),
});

// Accept one or more bookings into Daily Entry under one driver.
router.post(
  "/accept",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const data = acceptSchema.parse(req.body);
    const accepted: { id: string; cnNo: number }[] = [];
    const failed: { id: string; error: string }[] = [];

    for (const id of data.ids) {
      try {
        const order = await acceptBooking(id, { employeeId: data.employeeId, emirate: data.emirate || undefined, date: data.date });
        accepted.push({ id, cnNo: order.cnNo });
        emitGlobal("order:changed", { type: "created", order });
        emitToUser(order.employeeId, "order:assigned", { order });
      } catch (err) {
        failed.push({ id, error: err instanceof Error ? err.message : "Failed" });
      }
    }

    if (accepted.length) {
      await writeAuditLog({
        userId: req.user!.sub,
        action: "BOOKING_ACCEPT",
        entity: "Booking",
        entityId: accepted.map((a) => a.id).join(","),
        meta: { cnNos: accepted.map((a) => a.cnNo), employeeId: data.employeeId, emirate: data.emirate, date: data.date },
      });
      emitGlobal("booking:changed", { type: "accepted", ids: accepted.map((a) => a.id) });
    }
    res.json({ accepted, failed });
  })
);

// Scan & Assign: one scanned CN → the chosen driver. Office may move open orders between drivers.
router.post(
  "/scan-assign",
  requireRole("SUPER_ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const { code, employeeId } = z.object({ code: z.string().min(1).max(100), employeeId: z.string().min(1) }).parse(req.body);
    const r = await assignByScan(code, employeeId, { allowReassign: true });
    if (r.result !== "ALREADY") {
      await writeAuditLog({
        userId: req.user!.sub,
        action: r.result === "ACCEPTED" ? "SCAN_ACCEPT" : "SCAN_REASSIGN",
        entity: "Order",
        entityId: r.order.id,
        meta: { cnNo: r.order.cnNo, to: employeeId, from: r.previousEmployeeId },
      });
      emitGlobal("order:changed", { type: r.result === "ACCEPTED" ? "created" : "updated", order: r.order });
      emitGlobal("booking:changed", { type: "accepted" });
      emitToUser(employeeId, "order:assigned", { order: r.order });
      if (r.previousEmployeeId) emitToUser(r.previousEmployeeId, "order:removed", { orderId: r.order.id });
    }
    res.json(r);
  })
);

router.post(
  "/:id/reject",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const { reason } = z.object({ reason: z.string().trim().min(1, "Give a reason").max(300) }).parse(req.body);
    const existing = await prisma.booking.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new ApiError(404, "Booking not found");
    if (existing.status !== "AWAITING_PICKUP") throw new ApiError(400, `Booking is already ${existing.status.toLowerCase()}`);
    const booking = await prisma.booking.update({ where: { id: existing.id }, data: { status: "REJECTED", rejectReason: reason }, include: INCLUDE });
    await writeAuditLog({ userId: req.user!.sub, action: "BOOKING_REJECT", entity: "Booking", entityId: booking.id, meta: { cnNo: booking.cnNo, reason } });
    emitGlobal("booking:changed", { type: "rejected", id: booking.id });
    res.json(booking);
  })
);

// Undo a rejection — back into the queue.
router.post(
  "/:id/reopen",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.booking.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new ApiError(404, "Booking not found");
    if (existing.status !== "REJECTED") throw new ApiError(400, "Only rejected bookings can be reopened");
    const booking = await prisma.booking.update({ where: { id: existing.id }, data: { status: "AWAITING_PICKUP", rejectReason: null }, include: INCLUDE });
    emitGlobal("booking:changed", { type: "reopened", id: booking.id });
    res.json(booking);
  })
);

router.delete(
  "/:id",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.booking.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new ApiError(404, "Booking not found");
    if (existing.status === "ACCEPTED") throw new ApiError(400, "Already in Daily Entry — delete the consignment there instead");
    await prisma.booking.delete({ where: { id: existing.id } });
    await writeAuditLog({ userId: req.user!.sub, action: "BOOKING_DELETE", entity: "Booking", entityId: existing.id, meta: { cnNo: existing.cnNo } });
    emitGlobal("booking:changed", { type: "deleted", id: existing.id });
    res.json({ deleted: true });
  })
);

router.post(
  "/mark-printed",
  requireRole("SUPER_ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const { ids } = z.object({ ids: z.array(z.string()).min(1) }).parse(req.body);
    await prisma.booking.updateMany({ where: { id: { in: ids } }, data: { labelPrintedAt: new Date() } });
    res.json({ ok: true });
  })
);

export default router;
