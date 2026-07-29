import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler, ApiError } from "../utils/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";
import { writeAuditLog } from "../services/audit.service";
import { emitGlobal } from "../lib/socket";

const router = Router();
router.use(authenticate);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const includeInactive = req.query.includeInactive === "true";
    const vendors = await prisma.vendor.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: { name: "asc" },
    });
    res.json(vendors);
  })
);

const vendorSchema = z.object({
  name: z.string().min(1).max(60).transform((s) => s.trim().toUpperCase()),
  deliveryCharge: z.number().int().min(0).max(100000),
  active: z.boolean().optional(),
});

router.post(
  "/",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const data = vendorSchema.parse(req.body);
    const vendor = await prisma.vendor.create({ data });
    await writeAuditLog({ userId: req.user!.sub, action: "CREATE", entity: "Vendor", entityId: vendor.id, meta: data });
    emitGlobal("vendor:changed", { type: "created", vendor });
    res.status(201).json(vendor);
  })
);

router.put(
  "/:id",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const data = vendorSchema.partial().parse(req.body);
    const vendor = await prisma.vendor.update({ where: { id: req.params.id }, data });
    await writeAuditLog({ userId: req.user!.sub, action: "UPDATE", entity: "Vendor", entityId: vendor.id, meta: data });
    emitGlobal("vendor:changed", { type: "updated", vendor });
    res.json(vendor);
  })
);

router.delete(
  "/:id",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const usedCount = await prisma.order.count({ where: { vendorId: req.params.id } });
    if (usedCount > 0) {
      // Preserve referential integrity / historical orders: soft-delete instead of hard delete.
      const vendor = await prisma.vendor.update({ where: { id: req.params.id }, data: { active: false } });
      await writeAuditLog({ userId: req.user!.sub, action: "DEACTIVATE", entity: "Vendor", entityId: vendor.id });
      emitGlobal("vendor:changed", { type: "updated", vendor });
      return res.json({ softDeleted: true, vendor });
    }
    await prisma.vendor.delete({ where: { id: req.params.id } });
    await writeAuditLog({ userId: req.user!.sub, action: "DELETE", entity: "Vendor", entityId: req.params.id });
    emitGlobal("vendor:changed", { type: "deleted", id: req.params.id });
    res.json({ deleted: true });
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const vendor = await prisma.vendor.findUnique({ where: { id: req.params.id } });
    if (!vendor) throw new ApiError(404, "Vendor not found");
    res.json(vendor);
  })
);

export default router;
