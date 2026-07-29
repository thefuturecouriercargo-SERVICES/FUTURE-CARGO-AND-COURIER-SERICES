import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";
import { writeAuditLog } from "../services/audit.service";

const router = Router();
router.use(authenticate);

async function getOrCreateSettings() {
  const existing = await prisma.companySettings.findFirst();
  if (existing) return existing;
  return prisma.companySettings.create({ data: {} });
}

router.get(
  "/company",
  asyncHandler(async (_req, res) => {
    res.json(await getOrCreateSettings());
  })
);

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  address: z.string().max(300).optional(),
  phone: z.string().max(40).optional(),
  email: z.string().email().optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  logoUrl: z.string().max(500).optional(),
});

router.put(
  "/company",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const data = updateSchema.parse(req.body);
    const current = await getOrCreateSettings();
    const updated = await prisma.companySettings.update({ where: { id: current.id }, data });
    await writeAuditLog({ userId: req.user!.sub, action: "UPDATE", entity: "CompanySettings", entityId: updated.id });
    res.json(updated);
  })
);

export default router;
