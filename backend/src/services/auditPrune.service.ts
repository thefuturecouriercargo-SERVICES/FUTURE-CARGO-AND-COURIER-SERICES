import { prisma } from "../lib/prisma";

/**
 * Keeps the database small: the action history (audit_logs) is the biggest and
 * fastest-growing table, so entries older than 3 months are deleted once a day.
 *
 * Never deleted (the app still needs them):
 *  - one-time markers (entity "Init", or an action stamped with a date like
 *    KM_FRESH_START_2026_11_17) — deleting them would re-run one-time jobs
 *  - vendor report exports (Report Builder's last range / suggested next range)
 *  - backup records (last backup email / nightly failure shown in Settings)
 * CNs, cash, payroll, expenses and every other table are not touched.
 */
const KEEP_DAYS = 90;

export async function pruneAuditLogs(): Promise<number> {
  const cutoff = new Date(Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000);
  const n = await prisma.$executeRaw`
    DELETE FROM audit_logs
    WHERE "createdAt" < ${cutoff}
      AND entity <> 'Init'
      AND action NOT IN ('REPORT_EXPORT', 'BACKUP_EMAIL')
      AND action NOT LIKE 'BACKUP%'
      AND action !~ '_20[0-9]{2}_[0-9]{2}_[0-9]{2}$'`;
  return Number(n);
}

export function startAuditPruneScheduler() {
  const run = () =>
    pruneAuditLogs()
      .then((n) => n && console.log(`[audit] removed ${n} history entr${n === 1 ? "y" : "ies"} older than ${KEEP_DAYS} days`))
      .catch((err) => console.error("[audit] prune failed:", err));
  setTimeout(run, 5 * 60 * 1000);
  setInterval(run, 24 * 60 * 60 * 1000);
}
