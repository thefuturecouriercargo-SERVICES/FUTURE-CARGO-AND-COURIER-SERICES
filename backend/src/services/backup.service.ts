import { gzipSync } from "zlib";
import { prisma } from "../lib/prisma";
import { writeAuditLog } from "./audit.service";

/**
 * Full JSON backup of every table. Restorable row-for-row (ids, dates and
 * password hashes are kept as-is), and readable in any text editor.
 */
export async function buildBackup() {
  const [
    users,
    vendors,
    vendorAdjustments,
    vendorPayments,
    agentPayments,
    purchases,
    orders,
    orderTransfers,
    cashClosings,
    expenseEntries,
    payrolls,
    payrollEntries,
    companySettings,
    notifications,
    auditLogs,
  ] = await Promise.all([
    prisma.user.findMany(),
    prisma.vendor.findMany(),
    prisma.vendorAdjustment.findMany(),
    prisma.vendorPayment.findMany(),
    prisma.agentPayment.findMany(),
    prisma.purchase.findMany(),
    prisma.order.findMany(),
    prisma.orderTransfer.findMany(),
    prisma.cashClosing.findMany(),
    prisma.expenseEntry.findMany(),
    prisma.payroll.findMany(),
    prisma.payrollEntry.findMany(),
    prisma.companySettings.findMany(),
    prisma.notification.findMany(),
    prisma.auditLog.findMany(),
  ]);

  const tables = {
    users,
    vendors,
    vendorAdjustments,
    vendorPayments,
    agentPayments,
    purchases,
    orders,
    orderTransfers,
    cashClosings,
    expenseEntries,
    payrolls,
    payrollEntries,
    companySettings,
    notifications,
    auditLogs,
  };

  const counts = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]));

  return {
    app: "Future Courier Operations",
    version: 1,
    createdAt: new Date().toISOString(),
    counts,
    tables,
  };
}

export function backupFilename(ext: string) {
  const dubai = new Date(Date.now() + 4 * 60 * 60 * 1000);
  return `future-courier-backup-${dubai.toISOString().slice(0, 10)}.${ext}`;
}

// ---------------------------------------------------------------------------
// Weekly email via Resend
// ---------------------------------------------------------------------------

const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export function backupEmailConfig() {
  const apiKey = process.env.RESEND_API_KEY || "";
  const to = (process.env.BACKUP_EMAIL_TO || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const from = process.env.BACKUP_EMAIL_FROM || "Future Courier Backup <onboarding@resend.dev>";
  const dayIdx = Math.max(0, DAYS.indexOf((process.env.BACKUP_EMAIL_DAY || "SUN").toUpperCase().slice(0, 3)));
  const hour = Math.min(23, Math.max(0, parseInt(process.env.BACKUP_EMAIL_HOUR || "9", 10) || 9));
  return { apiKey, to, from, dayIdx, day: DAYS[dayIdx], hour, configured: Boolean(apiKey && to.length) };
}

export async function lastBackupEmail() {
  return prisma.auditLog.findFirst({
    where: { action: "BACKUP_EMAIL", entity: "Backup" },
    orderBy: { createdAt: "desc" },
  });
}

/** Builds a backup and emails it as a gzipped JSON attachment. */
export async function sendBackupEmail(triggeredBy: string | null = null) {
  const cfg = backupEmailConfig();
  if (!cfg.configured) {
    throw new Error("Backup email not configured — set RESEND_API_KEY and BACKUP_EMAIL_TO in Railway.");
  }

  const backup = await buildBackup();
  const gz = gzipSync(Buffer.from(JSON.stringify(backup)));
  const filename = backupFilename("json.gz");
  const sizeKb = Math.round(gz.length / 1024);

  const rows = Object.entries(backup.counts)
    .map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0">${k}</td><td style="text-align:right">${v}</td></tr>`)
    .join("");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: cfg.from,
      to: cfg.to,
      subject: `Future Courier backup — ${filename.slice(22, 32)}`,
      html:
        `<p>Weekly database backup attached (<b>${filename}</b>, ${sizeKb} KB).</p>` +
        `<p>Keep this email. To open the file, unzip it (it's a .gz) — inside is a plain JSON file.</p>` +
        `<table style="font-family:monospace;font-size:13px">${rows}</table>`,
      attachments: [{ filename, content: gz.toString("base64") }],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    await writeAuditLog({
      userId: triggeredBy,
      action: "BACKUP_EMAIL_FAILED",
      entity: "Backup",
      meta: { status: res.status, error: text.slice(0, 500) },
    });
    throw new Error(`Resend rejected the email (${res.status}): ${text.slice(0, 300)}`);
  }

  await writeAuditLog({
    userId: triggeredBy,
    action: "BACKUP_EMAIL",
    entity: "Backup",
    meta: { to: cfg.to, filename, sizeKb, counts: backup.counts, manual: Boolean(triggeredBy) },
  });

  return { to: cfg.to, filename, sizeKb };
}

/**
 * Checks once an hour. Sends when it's the configured day/hour (Dubai time)
 * and nothing was sent in the last 6 days — or if more than 8 days have passed
 * (e.g. the server was down on backup day). The last-sent time lives in the
 * audit log, so restarts and redeploys never double-send or skip a week.
 */
export function startWeeklyBackupScheduler() {
  const DAY_MS = 24 * 60 * 60 * 1000;
  let lastFailAt = 0; // after a failure, wait 6h before retrying (avoids hourly error spam)

  const tick = async () => {
    try {
      const cfg = backupEmailConfig();
      if (!cfg.configured) return;
      if (Date.now() - lastFailAt < 6 * 60 * 60 * 1000) return;

      const last = await lastBackupEmail();
      const since = last ? Date.now() - last.createdAt.getTime() : Infinity;
      const dubai = new Date(Date.now() + 4 * 60 * 60 * 1000);
      const isWindow = dubai.getUTCDay() === cfg.dayIdx && dubai.getUTCHours() >= cfg.hour;

      if ((isWindow && since > 6 * DAY_MS) || since > 8 * DAY_MS) {
        const r = await sendBackupEmail(null);
        // eslint-disable-next-line no-console
        console.log(`[backup] weekly email sent to ${r.to.join(", ")} (${r.sizeKb} KB)`);
      }
    } catch (err) {
      lastFailAt = Date.now();
      // eslint-disable-next-line no-console
      console.error("[backup] weekly email failed", err);
    }
  };

  setTimeout(tick, 60 * 1000); // first check a minute after boot
  setInterval(tick, 60 * 60 * 1000);
}
