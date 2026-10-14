import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler, ApiError } from "../utils/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";
import { writeAuditLog } from "../services/audit.service";
import { buildBackup, backupFilename, backupEmailConfig, lastBackupEmail, sendBackupEmail } from "../services/backup.service";

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

// ---- Backup ----------------------------------------------------------------

// Full JSON download of every table. Super Admin only.
router.get(
  "/backup",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const backup = await buildBackup();
    await writeAuditLog({ userId: req.user!.sub, action: "BACKUP_DOWNLOAD", entity: "Backup", meta: { counts: backup.counts } });
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${backupFilename("json")}"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(JSON.stringify(backup));
  })
);

router.get(
  "/backup/status",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (_req, res) => {
    const cfg = backupEmailConfig();
    const last = await lastBackupEmail();
    res.json({
      configured: cfg.configured,
      hasApiKey: Boolean(cfg.apiKey),
      to: cfg.to,
      schedule: `Every ${cfg.day} after ${String(cfg.hour).padStart(2, "0")}:00 (Dubai)`,
      lastSentAt: last?.createdAt ?? null,
    });
  })
);

// Send the backup email right now (also a good way to test the Resend setup).
router.post(
  "/backup/email",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    try {
      const result = await sendBackupEmail(req.user!.sub);
      res.json({ sent: true, ...result });
    } catch (err) {
      throw new ApiError(400, err instanceof Error ? err.message : "Backup email failed");
    }
  })
);

export default router;
