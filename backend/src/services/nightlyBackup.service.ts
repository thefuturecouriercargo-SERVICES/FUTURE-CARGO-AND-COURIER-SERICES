import { gzipSync } from "zlib";
import { Readable } from "stream";
import { S3Client, PutObjectCommand, ListObjectsV2Command, GetObjectCommand, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { buildBackup } from "./backup.service";
import { writeAuditLog } from "./audit.service";

/**
 * Nightly backup to the Railway storage bucket "nightly-backups" (kept apart from
 * the database, so a database problem can't take the backups with it).
 *
 * Every night after 3 AM Dubai time a full backup (same JSON as Settings →
 * Download Backup) is gzipped and saved as nightly/future-courier-backup-YYYY-MM-DD.json.gz.
 * The last KEEP_DAYS files are kept; older ones are removed.
 */
const PREFIX = "nightly/";
const KEEP_DAYS = 60;
const RUN_AFTER_HOUR = 3; // Dubai time
const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000;

function cfg() {
  const endpoint = process.env.BACKUP_S3_ENDPOINT || "";
  const bucket = process.env.BACKUP_S3_BUCKET || "";
  const accessKeyId = process.env.BACKUP_S3_ACCESS_KEY_ID || "";
  const secretAccessKey = process.env.BACKUP_S3_SECRET_ACCESS_KEY || "";
  const region = process.env.BACKUP_S3_REGION || "auto";
  return { endpoint, bucket, accessKeyId, secretAccessKey, region, configured: Boolean(endpoint && bucket && accessKeyId && secretAccessKey) };
}

let client: S3Client | null = null;
function s3() {
  const c = cfg();
  if (!c.configured) throw new Error("Nightly backup storage is not set up (BACKUP_S3_* variables missing).");
  if (!client) {
    client = new S3Client({
      endpoint: c.endpoint,
      region: c.region,
      credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
      forcePathStyle: false,
    });
  }
  return { client, bucket: c.bucket };
}

function dubaiToday() {
  return new Date(Date.now() + DUBAI_OFFSET_MS).toISOString().slice(0, 10);
}

export function nightlyConfigured() {
  return cfg().configured;
}

export async function listNightlyBackups() {
  const { client, bucket } = s3();
  const files: { key: string; date: string; sizeKb: number; savedAt: string }[] = [];
  let token: string | undefined;
  do {
    const r = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: PREFIX, ContinuationToken: token }));
    for (const o of r.Contents ?? []) {
      if (!o.Key) continue;
      const m = o.Key.match(/(\d{4}-\d{2}-\d{2})/);
      files.push({
        key: o.Key,
        date: m ? m[1] : "",
        sizeKb: Math.round((o.Size ?? 0) / 1024),
        savedAt: (o.LastModified ?? new Date(0)).toISOString(),
      });
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return files.sort((a, b) => b.key.localeCompare(a.key));
}

/** Builds a backup now and saves it under today's (Dubai) date, replacing today's file if any. */
export async function runNightlyBackup(triggeredBy: string | null = null) {
  const { client, bucket } = s3();
  const backup = await buildBackup();
  const gz = gzipSync(Buffer.from(JSON.stringify(backup)));
  const date = dubaiToday();
  const key = `${PREFIX}future-courier-backup-${date}.json.gz`;
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: gz, ContentType: "application/gzip" }));

  // Keep the newest KEEP_DAYS files.
  const files = await listNightlyBackups();
  const old = files.slice(KEEP_DAYS);
  if (old.length) {
    await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: old.map((f) => ({ Key: f.key })) } }));
  }

  const sizeKb = Math.round(gz.length / 1024);
  await writeAuditLog({
    userId: triggeredBy,
    action: "BACKUP_NIGHTLY",
    entity: "Backup",
    meta: { key, date, sizeKb, counts: backup.counts, manual: Boolean(triggeredBy), removedOld: old.length },
  });
  return { key, date, sizeKb };
}

/** Streams one saved backup file (only keys inside the nightly folder). */
export async function readNightlyBackup(key: string) {
  if (!key.startsWith(PREFIX) || key.includes("..")) throw new Error("Unknown backup file");
  const { client, bucket } = s3();
  const r = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return { body: r.Body as Readable, size: r.ContentLength };
}

/**
 * Checks every 30 minutes. After 3 AM Dubai time, if today's file isn't in the
 * bucket yet, makes it — so a restart or redeploy never skips or doubles a night.
 */
export function startNightlyBackupScheduler() {
  if (!nightlyConfigured()) {
    // eslint-disable-next-line no-console
    console.log("[backup] nightly backup storage not configured — skipping scheduler");
    return;
  }
  let lastFailAt = 0;
  let doneFor = "";

  const tick = async () => {
    try {
      const today = dubaiToday();
      if (doneFor === today) return;
      const hour = new Date(Date.now() + DUBAI_OFFSET_MS).getUTCHours();
      if (hour < RUN_AFTER_HOUR) return;
      if (Date.now() - lastFailAt < 2 * 60 * 60 * 1000) return;

      const files = await listNightlyBackups();
      if (files.some((f) => f.date === today)) {
        doneFor = today;
        return;
      }
      const r = await runNightlyBackup(null);
      doneFor = today;
      // eslint-disable-next-line no-console
      console.log(`[backup] nightly backup saved: ${r.key} (${r.sizeKb} KB)`);
    } catch (err) {
      lastFailAt = Date.now();
      // eslint-disable-next-line no-console
      console.error("[backup] nightly backup failed", err);
      await writeAuditLog({
        userId: null,
        action: "BACKUP_NIGHTLY_FAILED",
        entity: "Backup",
        meta: { error: err instanceof Error ? err.message.slice(0, 300) : String(err) },
      });
    }
  };

  setTimeout(tick, 90 * 1000);
  setInterval(tick, 30 * 60 * 1000);
}
