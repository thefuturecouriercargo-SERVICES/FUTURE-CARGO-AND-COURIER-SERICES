import webpush from "web-push";
import { prisma } from "../lib/prisma";
import { ApiError } from "../utils/asyncHandler";
import { dayRange } from "../utils/dates";
import { pushConfigured } from "./azanPush.service";

/**
 * KM & fuel tracking for drivers on company cars.
 * - Start KM (typed or meter photo) is required before the driver can tap any delivery.
 * - End KM is entered with "End delivery" on the Cash closing page.
 * - If a driver forgets End delivery, next morning's Start KM closes the open day too
 *   (cars stay parked at the office overnight) and that day is flagged "END KM MISSED".
 */

const MODEL = () => process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

/** Turn kmTracking on for Noushad (only once — admin can switch drivers on/off afterwards). */
export async function initKmTracking(): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE "users" SET "kmTracking" = ("role" = 'DRIVER' AND NOT COALESCE("isAgent", false)) WHERE "kmTracking" IS NULL`
    );
    // One-time switch-ons requested later (skipped once done, so admin can still switch them off).
    for (const name of ["SAVAD"]) {
      const marker = `km-on:${name}`;
      const done = await prisma.auditLog.findFirst({ where: { action: "KM_TRACKING_SET", entity: "Init", entityId: marker } });
      if (done) continue;
      const users = await prisma.user.findMany({ where: { role: "DRIVER", name: { contains: name, mode: "insensitive" } }, select: { id: true } });
      for (const u of users) await prisma.user.update({ where: { id: u.id }, data: { kmTracking: true } });
      const admin = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" }, select: { id: true } });
      if (admin) await prisma.auditLog.create({ data: { userId: admin.id, action: "KM_TRACKING_SET", entity: "Init", entityId: marker } });
      console.log(`[km] tracking switched on for ${name} (${users.length})`);
    }
    // 2026-11-16: rolled out to every driver (once — admin can still switch a driver off afterwards).
    {
      const marker = "km-on:ALL-DRIVERS";
      const done = await prisma.auditLog.findFirst({ where: { action: "KM_TRACKING_SET", entity: "Init", entityId: marker } });
      if (!done) {
        const r = await prisma.user.updateMany({ where: { role: "DRIVER", isAgent: false }, data: { kmTracking: true } });
        const admin = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" }, select: { id: true } });
        if (admin) await prisma.auditLog.create({ data: { userId: admin.id, action: "KM_TRACKING_SET", entity: "Init", entityId: marker } });
        console.log(`[km] tracking switched on for all drivers (${r.count})`);
      }
    }
  } catch (err) {
    console.error("[km] init failed", err);
  }
}

export async function kmEnabled(userId: string): Promise<boolean> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { kmTracking: true, role: true, isAgent: true } });
  // On for every driver (not the agent) unless admin switched it off (null = never set = on).
  return Boolean(u && u.role === "DRIVER" && !u.isAgent && u.kmTracking !== false);
}

/** The day still open (started, no End KM), if any. */
export function openLog(employeeId: string) {
  return prisma.kmLog.findFirst({ where: { employeeId, endKm: null }, orderBy: { date: "desc" } });
}

/** Throws unless the driver has started today (or has a day still open). Only for KM-tracked drivers. */
export async function assertDeliveryStarted(userId: string): Promise<void> {
  if (!(await kmEnabled(userId))) return;
  const { start } = dayRange();
  const today = await prisma.kmLog.findUnique({ where: { employeeId_date: { employeeId: userId, date: start } } });
  if (today) return;
  // A day started before midnight and not yet ended still counts (late-night deliveries).
  const open = await openLog(userId);
  if (open && Date.now() - open.startAt.getTime() < 20 * 60 * 60 * 1000) return;
  throw new ApiError(403, "Start delivery first — enter your Start KM");
}

// ---------- Photos ----------

export async function storePhoto(employeeId: string, kind: "METER" | "RECEIPT" | "EXPENSE", dataUrl: string): Promise<{ id: string; mime: string; base64: string }> {
  const m = String(dataUrl ?? "").match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!m) throw new ApiError(400, "Photo is not a valid image");
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 1_500_000) throw new ApiError(413, "Photo is too large");
  const p = await prisma.kmPhoto.create({ data: { employeeId, kind, mime: m[1], data: buf }, select: { id: true } });
  return { id: p.id, mime: m[1], base64: m[2] };
}

/** Keep meter / receipt photos for one week only (saves storage). Readings stay forever. */
export async function pruneKmPhotos() {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  await prisma.kmPhoto.deleteMany({ where: { createdAt: { lt: cutoff } } }).catch(() => undefined);
}

// ---------- Photo reading (Claude) ----------

async function callReader<T>(base64: string, mime: string, tool: { name: string; description: string; input_schema: unknown }, prompt: string): Promise<T | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL(),
        max_tokens: 600,
        tools: [tool],
        tool_choice: { type: "auto" },
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mime, data: base64 } },
              { type: "text", text: `${prompt}\n\nReply only by calling the ${tool.name} tool.` },
            ],
          },
        ],
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { content?: { type: string; name?: string; text?: string; input?: T }[] };
    if (!res.ok) {
      console.error("[km] reader HTTP", res.status);
      return null;
    }
    const t = body.content?.find((c) => c.type === "tool_use" && c.name === tool.name);
    if (t?.input) return t.input;
    const text = body.content?.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n") ?? "";
    const json = text.match(/\{[\s\S]*\}/);
    return json ? (JSON.parse(json[0]) as T) : null;
  } catch (err) {
    console.error("[km] reader failed", err);
    return null;
  }
}

const METER_TOOL = {
  name: "odometer_reading",
  description: "The total distance (odometer / ODO) shown on a car's dashboard.",
  input_schema: {
    type: "object",
    properties: {
      km: { type: ["integer", "null"], description: "Odometer total in km, whole number. null if not clearly readable." },
      clear: { type: "boolean", description: "true only if every digit is clearly readable" },
    },
    required: ["km", "clear"],
  },
};

export async function readMeter(base64: string, mime: string): Promise<number | null> {
  const r = await callReader<{ km: number | null; clear: boolean }>(
    base64,
    mime,
    METER_TOOL,
    "This is a photo of a car dashboard. Read the ODOMETER total (ODO, total km driven — not the trip meter A/B, not the speed, not the fuel range, not the time). Return it as a whole number of km. If unsure of any digit, set clear=false."
  );
  const km = r?.km;
  if (typeof km !== "number" || !Number.isFinite(km) || km <= 0 || km > 2_000_000 || r?.clear === false) return null;
  return Math.round(km);
}

export interface ReceiptRead {
  amount: number | null;
  litres: number | null;
  pricePerLitre: number | null;
  station: string | null;
  receiptAt: string | null;
}

const RECEIPT_TOOL = {
  name: "fuel_receipt",
  description: "Details printed on a UAE fuel station receipt.",
  input_schema: {
    type: "object",
    properties: {
      amount: { type: ["number", "null"], description: "Total paid in AED" },
      litres: { type: ["number", "null"], description: "Litres / volume filled" },
      pricePerLitre: { type: ["number", "null"], description: "Price per litre in AED" },
      station: { type: ["string", "null"], description: "Company and station, e.g. ADNOC AL QUSAIS, ENOC, EMARAT" },
      receiptAt: { type: ["string", "null"], description: "Date and time on the receipt as YYYY-MM-DD HH:MM" },
    },
    required: ["amount", "litres", "pricePerLitre", "station", "receiptAt"],
  },
};

export async function readReceipt(base64: string, mime: string): Promise<ReceiptRead | null> {
  const r = await callReader<ReceiptRead>(
    base64,
    mime,
    RECEIPT_TOOL,
    "This is a photo of a fuel station receipt (UAE, AED). Read the total amount paid, litres, price per litre, the station name and the date/time. Use null for anything not clearly printed."
  );
  if (!r) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null);
  return {
    amount: num(r.amount),
    litres: num(r.litres),
    pricePerLitre: num(r.pricePerLitre),
    station: r.station ? String(r.station).toUpperCase().slice(0, 60) : null,
    receiptAt: r.receiptAt ? String(r.receiptAt).slice(0, 20) : null,
  };
}

// ---------- Reminder: "tap END DELIVERY" push at 11:30 PM ----------

let remindedDay = "";
async function remindTick() {
  if (!pushConfigured()) return;
  const dubai = new Date(Date.now() + 4 * 60 * 60 * 1000);
  const mins = dubai.getUTCHours() * 60 + dubai.getUTCMinutes();
  const day = dubai.toISOString().slice(0, 10);
  if (mins < 23 * 60 + 30 || remindedDay === day) return;
  remindedDay = day;
  const { start } = dayRange();
  const open = await prisma.kmLog.findMany({ where: { date: start, endKm: null }, select: { employeeId: true } });
  if (!open.length) return;
  const subs = await prisma.pushSubscription.findMany({ where: { userId: { in: open.map((o) => o.employeeId) } } });
  const payload = JSON.stringify({
    title: "END DELIVERY PENDING",
    body: "Enter your End KM — Cash closing → END DELIVERY",
    url: "/driver#cash",
    tag: `km-end-${day}`,
  });
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 60 * 60, urgency: "high" });
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
    }
  }
}

export function startKmScheduler() {
  setInterval(() => {
    remindTick().catch((err) => console.error("[km] remind failed", err));
  }, 60_000);
  void pruneKmPhotos();
  setInterval(() => void pruneKmPhotos(), 6 * 60 * 60 * 1000);
}

/** Any expense bill (fuel, parking, Salik top-up, car wash…): total paid, litres if fuel. */
export async function readBill(base64: string, mime: string): Promise<{ amount: number | null; litres: number | null; station: string | null } | null> {
  const r = await callReader<ReceiptRead>(
    base64,
    mime,
    RECEIPT_TOOL,
    "This is a photo of a receipt or bill paid in the UAE (AED) — fuel, parking, Salik, car wash, workshop, stationery or other. Read the TOTAL amount paid (including VAT). If it is a fuel receipt also read litres. Put the shop/station name in station. Use null for anything not clearly printed."
  );
  if (!r) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null);
  return { amount: num(r.amount), litres: num(r.litres), station: r.station ? String(r.station).toUpperCase().slice(0, 60) : null };
}

/**
 * One-time clean start (asked 17 Nov 2026): drivers were confused on the first day,
 * so every KM day before 17 Nov 2026 is deleted, with its meter photos. Fuel fills
 * and expenses are kept. Runs once (marked in the audit log).
 */
export async function runKmFreshStartOnce() {
  const MARK = "KM_FRESH_START_2026_11_17";
  try {
    const done = await prisma.auditLog.findFirst({ where: { action: MARK }, select: { id: true } });
    if (done) return;
    const cutoff = new Date(Date.UTC(2026, 10, 17));
    const old = await prisma.kmLog.findMany({ where: { date: { lt: cutoff } }, select: { startPhotoId: true, endPhotoId: true } });
    const photoIds = old.flatMap((l) => [l.startPhotoId, l.endPhotoId]).filter((x): x is string => !!x);
    const logs = await prisma.kmLog.deleteMany({ where: { date: { lt: cutoff } } });
    const photos = photoIds.length ? await prisma.kmPhoto.deleteMany({ where: { id: { in: photoIds }, kind: "METER" } }) : { count: 0 };
    await prisma.auditLog.create({ data: { action: MARK, entity: "KmLog", meta: { logs: logs.count, photos: photos.count } } });
    console.log(`[km] fresh start: deleted ${logs.count} KM days before 17 Nov 2026 (${photos.count} photos)`);
  } catch (err) {
    console.error("[km] fresh start failed:", err);
  }
}

/**
 * One-time clean restart (asked 21 Nov 2026): deletes KM days, fuel logs and their
 * KM/receipt photos dated before 21 Nov 2026. expense_entries and EXPENSE photos are
 * kept. Runs once (marked in the audit log).
 */
export async function runKmFreshStart20261121Once() {
  const MARK = "KM_FRESH_START_2026_11_21";
  try {
    const done = await prisma.auditLog.findFirst({ where: { action: MARK }, select: { id: true } });
    if (done) return;
    const cutoff = new Date(Date.UTC(2026, 10, 21));
    const { logs, fuel, meter, receipts } = await prisma.$transaction(
      async (tx) => {
        const oldLogs = await tx.kmLog.findMany({ where: { date: { lt: cutoff } }, select: { startPhotoId: true, endPhotoId: true } });
        const oldFuel = await tx.fuelLog.findMany({ where: { date: { lt: cutoff } }, select: { photoId: true } });
        const kmPhotoIds = Array.from(new Set(oldLogs.flatMap((l) => [l.startPhotoId, l.endPhotoId]).filter((x): x is string => !!x)));
        const fuelPhotoIds = Array.from(new Set(oldFuel.map((f) => f.photoId).filter((x): x is string => !!x)));
        const kept = await tx.expenseEntry.findMany({ where: { photoId: { not: null } }, select: { photoId: true } });
        const keepIds = new Set(kept.map((e) => e.photoId).filter((x): x is string => !!x));
        const logs = await tx.kmLog.deleteMany({ where: { date: { lt: cutoff } } });
        const fuel = await tx.fuelLog.deleteMany({ where: { date: { lt: cutoff } } });
        const meterIds = kmPhotoIds.filter((id) => !keepIds.has(id));
        const meter = meterIds.length ? await tx.kmPhoto.deleteMany({ where: { id: { in: meterIds }, kind: "METER" } }) : { count: 0 };
        const receiptIds = fuelPhotoIds.filter((id) => !keepIds.has(id));
        const receipts = receiptIds.length ? await tx.kmPhoto.deleteMany({ where: { id: { in: receiptIds }, kind: "RECEIPT" } }) : { count: 0 };
        await tx.auditLog.create({
          data: {
            action: MARK,
            entity: "KmLog",
            meta: { cutoff: "2026-11-21", logs: logs.count, fuel: fuel.count, meterPhotos: meter.count, receiptPhotos: receipts.count },
          },
        });
        return { logs, fuel, meter, receipts };
      },
      { timeout: 120000, maxWait: 10000 }
    );
    console.log(`[km] fresh start 21 Nov: deleted ${logs.count} KM days, ${fuel.count} fuel logs (${meter.count} meter + ${receipts.count} receipt photos) before 21 Nov 2026`);
  } catch (err) {
    console.error("[km] fresh start 21 Nov failed:", err);
  }
}
