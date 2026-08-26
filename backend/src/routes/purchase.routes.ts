import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler, ApiError } from "../utils/asyncHandler";
import { authenticate } from "../middleware/auth";
import { dayRange, monthRange, parseDateParam } from "../utils/dates";
import { writeAuditLog } from "../services/audit.service";
import { emitGlobal } from "../lib/socket";

const router = Router();
router.use(authenticate);

const createSchema = z.object({
  date: z.string(),
  employeeId: z.string().optional(), // ignored for DRIVER callers; required for SUPER_ADMIN
  vendorId: z.string().optional(), // when set, this deduction is a payment to that vendor
  amount: z.number().int().min(0),
  note: z.string().max(500).optional(),
});

// Admin creates a purchase/deduction entry against a driver, OR a driver logs their
// own deduction (e.g. cash they personally paid out to a vendor).
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body);
    const { start } = dayRange(data.date);

    let employeeId: string;
    if (req.user!.role === "SUPER_ADMIN") {
      if (!data.employeeId) throw new ApiError(400, "employeeId is required");
      employeeId = data.employeeId;
    } else if (req.user!.role === "DRIVER") {
      employeeId = req.user!.sub; // drivers can only log entries against themselves
    } else {
      throw new ApiError(403, "You do not have permission to perform this action");
    }

    if (data.vendorId) {
      const vendor = await prisma.vendor.findUnique({ where: { id: data.vendorId } });
      if (!vendor) throw new ApiError(404, "Vendor not found");
    }

    const entry = await prisma.purchase.create({
      data: {
        date: start,
        employeeId,
        vendorId: data.vendorId,
        amount: data.amount,
        note: data.note,
      },
      include: { vendor: { select: { id: true, name: true } } },
    });

    await writeAuditLog({
      userId: req.user!.sub,
      action: "PURCHASE_CREATE",
      entity: "Purchase",
      entityId: entry.id,
      meta: { employeeId, vendorId: data.vendorId, amount: data.amount },
    });
    emitGlobal("purchase:changed", { entry });
    if (data.vendorId) emitGlobal("vendorPayment:changed", { type: "created" });
    res.status(201).json(entry);
  })
);

// List purchases with optional filters. Drivers only ever see their own entries.
router.get(
  "/",
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

    if (req.user!.role === "DRIVER") {
      where.employeeId = req.user!.sub;
    } else if (req.query.employeeId) {
      where.employeeId = req.query.employeeId as string;
    }

    const entries = await prisma.purchase.findMany({
      where,
      include: {
        employee: { select: { id: true, name: true } },
        vendor: { select: { id: true, name: true } },
      },
      orderBy: { date: "desc" },
    });
    res.json(entries);
  })
);

// Delete a purchase entry. Admins can delete any entry; drivers only their own.
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const existing = await prisma.purchase.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new ApiError(404, "Purchase entry not found");

    if (req.user!.role !== "SUPER_ADMIN" && existing.employeeId !== req.user!.sub) {
      throw new ApiError(403, "You do not have permission to perform this action");
    }

    await prisma.purchase.delete({ where: { id: req.params.id } });
    await writeAuditLog({
      userId: req.user!.sub,
      action: "PURCHASE_DELETE",
      entity: "Purchase",
      entityId: req.params.id,
    });
    emitGlobal("purchase:changed", { deleted: req.params.id });
    if (existing.vendorId) emitGlobal("vendorPayment:changed", { type: "deleted" });
    res.json({ deleted: true });
  })
);

export default router;
