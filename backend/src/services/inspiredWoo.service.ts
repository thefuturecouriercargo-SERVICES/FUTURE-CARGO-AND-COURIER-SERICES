import { prisma } from "../lib/prisma";
import { writeAuditLog } from "./audit.service";
import { emitGlobal } from "../lib/socket";
import { createBooking, phoneDigits, isCnFree, CN_START } from "./booking.service";

/**
 * Inspired Market website (WooCommerce) → Awaiting Pickup.
 *
 * Read-only: uses a WooCommerce REST key with Read permission. New orders are
 * imported as vendor bookings with our own CN; the website order number is kept
 * as the booking's vendorRef, which (a) makes every order import exactly once
 * and (b) lets the barcode on Inspired's own bill be scanned on Scan & Assign.
 *
 * Railway variables (backend):
 *   INSPIRED_WC_URL      e.g. https://inspired.market
 *   INSPIRED_WC_KEY      ck_…
 *   INSPIRED_WC_SECRET   cs_…
 *   INSPIRED_VENDOR_NAME vendor name in our Vendors list (default INSPIRED)
 *   INSPIRED_WC_STATUSES order statuses to import (default completed)
 *   INSPIRED_WC_DAYS     how far back the first sync looks (default 2 days)
 */

/**
 * Connected vendor websites. WOO_VENDORS lists the connection keys (default
 * INSPIRED,ESCALO); each key reads <KEY>_WC_URL, <KEY>_WC_KEY, <KEY>_WC_SECRET
 * and optionally <KEY>_VENDOR_NAME, <KEY>_WC_STATUSES, <KEY>_WC_DAYS.
 */
export function wooConnections(): string[] {
  return (process.env.WOO_VENDORS || "INSPIRED,ESCALO")
    .split(",")
    .map((k) => k.trim().toUpperCase())
    .filter(Boolean);
}

export function wooConfig(conn: string) {
  const env = (k: string) => process.env[`${conn}_${k}`] || "";
  const url = env("WC_URL").replace(/\/+$/, "");
  const key = env("WC_KEY");
  const secret = env("WC_SECRET");
  return {
    conn,
    url,
    key,
    secret,
    vendorName: env("VENDOR_NAME") || conn,
    // Vendors mark an order "completed" when it is confirmed (ready to ship), not when delivered.
    // Only completed orders are brought in.
    statuses: (env("WC_STATUSES") || "completed").split(",").map((x) => x.trim()).filter(Boolean),
    days: Math.max(1, parseInt(env("WC_DAYS") || "2", 10) || 2),
    configured: Boolean(url && key && secret),
  };
}

/** Back-compat helper used elsewhere. */
export const inspiredConfig = () => wooConfig("INSPIRED");

interface WooAddress {
  first_name?: string;
  last_name?: string;
  company?: string;
  address_1?: string;
  address_2?: string;
  city?: string;
  state?: string;
  postcode?: string;
  country?: string;
  phone?: string;
}

export interface WooOrder {
  id: number;
  number?: string;
  status: string;
  date_created: string;
  date_created_gmt?: string;
  date_modified_gmt?: string;
  total: string;
  payment_method?: string;
  payment_method_title?: string;
  customer_note?: string;
  billing?: WooAddress & { email?: string };
  shipping?: WooAddress;
  line_items?: {
    id?: number;
    name: string;
    quantity: number;
    total?: string;
    total_tax?: string;
    // WooCommerce Product Bundles / Composite Products
    bundled_by?: string | number;
    bundled_items?: (string | number)[];
    composite_parent?: string | number;
    composite_children?: (string | number)[];
  }[];
}

/** true: website orders use the website order No. as our CN (when free). false: our own CN series. */
const WEBSITE_NO_AS_CN = true;

/** When the customer placed the order (GMT), so "Stop today's orders" goes by order time. */
function placedAtOf(o: WooOrder): Date | undefined {
  const t = o.date_created_gmt ? new Date(`${o.date_created_gmt}Z`) : null;
  return t && !Number.isNaN(t.getTime()) ? t : undefined;
}

async function wooGet<T>(conn: string, path: string, params: Record<string, string>, method = "GET", body?: unknown): Promise<T> {
  const cfg = wooConfig(conn);
  if (!cfg.configured) throw new Error(`${cfg.vendorName} website not connected — add ${conn}_WC_URL, ${conn}_WC_KEY and ${conn}_WC_SECRET in Railway`);
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${cfg.url}/wp-json/wc/v3/${path}${qs ? `?${qs}` : ""}`, {
    method,
    headers: {
      Authorization: "Basic " + Buffer.from(`${cfg.key}:${cfg.secret}`).toString("base64"),
      Accept: "application/json",
      "User-Agent": "FutureCourier/1.0",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let msg = text.slice(0, 200);
    try {
      msg = (JSON.parse(text) as { message?: string }).message ?? msg;
    } catch {
      /* not JSON */
    }
    throw new Error(`${cfg.vendorName} website answered ${res.status}: ${msg}`);
  }
  return (await res.json()) as T;
}

const STATE_TO_EMIRATE: Record<string, string> = {
  DU: "DUBAI",
  DXB: "DUBAI",
  SH: "SHARJAH",
  SHJ: "SHARJAH",
  AZ: "ABUDHABI",
  AUH: "ABUDHABI",
  AJ: "AJMAN",
  RK: "RAS AL KHAIMAH",
  FU: "FUJAIRAH",
  UQ: "UMM AL QUWAIN",
};

function detectEmirate(addr: WooAddress): string {
  return emirateFromText(`${addr.state ?? ""} ${addr.city ?? ""} ${addr.address_1 ?? ""} ${addr.address_2 ?? ""}`, addr.state);
}

/** Emirate from a free-text address (state code first when given). "OTHER" when unknown. */
export function emirateFromText(raw: string, stateCode?: string): string {
  const text = raw.toLowerCase();
  const addr = { state: stateCode };
  if (/\bal\s*ain\b|\balain\b/.test(text)) return "AL AIN";
  const code = (addr.state ?? "").toUpperCase().trim();
  if (STATE_TO_EMIRATE[code]) return STATE_TO_EMIRATE[code];
  if (/abu\s*dhabi|abudhabi|mussafah/.test(text)) return "ABUDHABI";
  if (/ras\s*al\s*khaim|\brak\b/.test(text)) return "RAS AL KHAIMAH";
  if (/umm\s*al\s*q|\buaq\b/.test(text)) return "UMM AL QUWAIN";
  if (/fujair|khor\s*fakkan/.test(text)) return "FUJAIRAH";
  if (/ajman/.test(text)) return "AJMAN";
  if (/sharjah|\bshj\b/.test(text)) return "SHARJAH";
  if (/dubai|\bdxb\b/.test(text)) return "DUBAI";
  // No emirate written: well-known area names decide (Deira, Qusais… → Dubai; Muwaileh, Taawun… → Sharjah).
  if (/(?:\b|al)(muwail|muweil|taawun|tawoon|qasimi|majaz|abu\s*shag|rolla|butina|yarmook|sajaa|al\s*khan\b|zahia|aljada|university\s*city|maysaloon)/.test(text)) return "SHARJAH";
  if (/(?:\b|al)(deira|qusais|karama|mankh?ool|bur\s*dub|rigga|riqqa|naif|nayef|murar|muteena|baraha|hor\s*al\s*anz|horl[ae]nz|abu\s*hail|buhail|mamzar|garhoud|muhaisn|mirdif|warqa|rashidiya|qouz|quoz|barsha|jlt|jvc|jbr|marina|business\s*bay|downtown|silicon|international\s*city|jebel\s*ali|jabal\s*ali|furjan|discovery\s*garden|dip\b|satwa|jumeira|oud\s*metha|jaddaf|waheda|wuheida|wuhaida|twar|mizhar|khawaneej|nad\s*al|ras\s*al\s*khor|dubailand|arjan|motor\s*city|sports\s*city|meydan|damascus\s*st)/.test(text)) return "DUBAI";
  return "OTHER";
}

/** Turns a website order into our booking fields. */
export function mapWooOrder(o: WooOrder) {
  const ship = o.shipping && (o.shipping.address_1 || o.shipping.city) ? o.shipping : o.billing ?? {};
  const bill = o.billing ?? {};
  const name = `${ship.first_name || bill.first_name || ""} ${ship.last_name || bill.last_name || ""}`.trim() || "Customer";
  const phone = (ship.phone || bill.phone || "").trim();
  const address = [ship.address_1, ship.address_2, ship.city].map((s) => (s ?? "").trim()).filter(Boolean).join(", ");
  // "2 × Akoya (AED 80)" — line total incl. tax, so the label shows each item's price.
  const items = (o.line_items ?? [])
    .map((li) => {
      const amt = Math.round((Number(li.total) || 0) + (Number(li.total_tax) || 0));
      // A bundle/combo parent is a heading on the label, not a piece to pack.
      const isParent = (li.bundled_items?.length ?? 0) > 0 || (li.composite_children?.length ?? 0) > 0;
      return `${isParent ? "▸ " : ""}${li.quantity} × ${li.name.replace(/,/g, " ")}${amt > 0 ? ` (AED ${amt})` : ""}`;
    })
    .join(", ");
  const isCod = (o.payment_method ?? "").toLowerCase() === "cod";
  return {
    vendorRef: String(o.number || o.id),
    customerName: name.slice(0, 120),
    customerPhone: (phone || "(no phone)").slice(0, 30),
    address: (address || "(no address on website order)").slice(0, 500),
    emirate: detectEmirate(ship),
    items: items.slice(0, 1500) || undefined,
    codAmount: isCod ? Math.round(Number(o.total) || 0) : 0,
    notes: [o.customer_note?.trim(), isCod ? "" : `Paid online (${o.payment_method_title || o.payment_method || "website"})`]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 500) || undefined,
  };
}

/** Latest orders, for the "Test connection" button — shows what the website sends. */
export async function testWooConnection(conn: string) {
  const orders = await wooGet<WooOrder[]>(conn, "orders", { per_page: "3", orderby: "date", order: "desc" });
  return orders.map((o) => ({
    id: o.id,
    number: o.number ?? String(o.id),
    status: o.status,
    date: o.date_created,
    total: o.total,
    paymentMethod: o.payment_method_title || o.payment_method,
    mapped: mapWooOrder(o),
  }));
}

const CANCELLED_STATUSES = ["cancelled", "refunded", "failed", "trash"];

/**
 * The same order may already have been entered by hand (vendor portal or office)
 * before it arrives from the website. Same vendor, same customer phone, same
 * COD amount, entered in the last 48h, not yet linked to a website order → it's
 * the same order: link it (store the website order No.) instead of creating a
 * second CN.
 */
async function linkToManualTwin(vendorId: string, data: ReturnType<typeof mapWooOrder>): Promise<boolean> {
  const phone = phoneDigits(data.customerPhone);
  if (phone.length < 9) return false;
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const candidates = await prisma.booking.findMany({
    where: { vendorId, vendorRef: null, createdBy: { not: "WEBSITE" }, codAmount: data.codAmount, status: { not: "REJECTED" }, createdAt: { gte: since } },
    select: { id: true, cnNo: true, customerPhone: true },
    orderBy: { createdAt: "asc" },
  });
  const twin = candidates.find((c) => phoneDigits(c.customerPhone) === phone);
  if (!twin) return false;
  await prisma.booking.update({ where: { id: twin.id }, data: { vendorRef: data.vendorRef } });
  await writeAuditLog({ action: "WEBSITE_LINK_MANUAL", entity: "Booking", entityId: twin.id, meta: { cnNo: twin.cnNo, websiteOrder: data.vendorRef } });
  return true;
}

/** The website connection key for this vendor, or null if its website isn't connected. */
export async function wooConnForVendor(vendorId: string): Promise<string | null> {
  for (const conn of wooConnections()) {
    if (!wooConfig(conn).configured) continue;
    const v = await findWooVendor(conn);
    if (v?.id === vendorId) return conn;
  }
  return null;
}

export async function isInspiredVendor(vendorId: string) {
  return (await wooConnForVendor(vendorId)) !== null;
}

async function findWooVendor(conn: string) {
  const cfg = wooConfig(conn);
  return prisma.vendor.findFirst({ where: { name: { equals: cfg.vendorName, mode: "insensitive" } } });
}

/**
 * Scan of an Inspired bill that isn't in our system yet: look that one order up
 * on their website right now and import it. Returns true if the order is now in
 * Awaiting Pickup (imported, or it already was). Throws if the website says the
 * order is cancelled, so the scan shows why instead of "not found".
 */
export async function importWooOrderByNumber(conn: string, num: string): Promise<boolean> {
  const cfg = wooConfig(conn);
  if (!cfg.configured) return false;
  const vendor = await findWooVendor(conn);
  if (!vendor) return false;

  let o: WooOrder | null = null;
  try {
    o = await wooGet<WooOrder>(conn, `orders/${encodeURIComponent(num)}`, {});
  } catch {
    o = null;
  }
  if (!o || String(o.number || o.id) !== num) {
    try {
      const list = await wooGet<WooOrder[]>(conn, "orders", { search: num, per_page: "10", status: "any" });
      o = list.find((x) => String(x.number || x.id) === num) ?? null;
    } catch {
      o = null;
    }
  }
  if (!o) return false;
  // Only a recent, live order counts. Another vendor's bill number can easily
  // equal an old Inspired order number (e.g. Escalo #9563) — never import those.
  const ageMs = Date.now() - new Date(o.date_created).getTime();
  if (!(ageMs >= 0 && ageMs <= 3 * 24 * 60 * 60 * 1000)) return false;
  if (CANCELLED_STATUSES.includes(o.status)) throw new Error(`${cfg.vendorName} order #${num} is ${o.status} on their website — don't pick it up`);
  if (!cfg.statuses.includes(o.status)) return false;

  const data = mapWooOrder(o);
  const exists = await prisma.booking.findFirst({ where: { vendorId: vendor.id, vendorRef: data.vendorRef }, select: { id: true } });
  if (exists) return true;
  if (await linkToManualTwin(vendor.id, data)) return true;
  await createBooking(vendor.id, { ...data, confirmDuplicate: true }, "WEBSITE", { ...(WEBSITE_NO_AS_CN ? { preferredCn: Number(data.vendorRef) } : {}), placedAt: placedAtOf(o), webStatus: o.status });
  emitGlobal("booking:changed", { type: "imported", count: 1 });
  await writeAuditLog({ action: "WEBSITE_IMPORT_ON_SCAN", entity: "Booking", meta: { vendorRef: data.vendorRef } });
  return true;
}

/**
 * Re-checks Inspired orders we already imported (last 14 days) against the website:
 *  - still Awaiting Pickup + cancelled on website → rejected automatically
 *  - still Awaiting Pickup + edited on website    → our copy updated
 *  - already with a driver (Pending/Transfer) + cancelled or amount changed on
 *    website → a ⚠ warning is put in the order's remarks so the driver and office see it
 */
async function refreshImportedWooOrders(conn: string, vendorId: string) {
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const bookings = await prisma.booking.findMany({
    // Website imports and hand-entered orders linked to a website order.
    where: { vendorId, status: { in: ["AWAITING_PICKUP", "ACCEPTED"] }, createdAt: { gte: since }, vendorRef: { not: null } },
    include: { order: { select: { id: true, status: true, total: true, remarks: true } } },
  });
  const open = bookings.filter((b) => b.status === "AWAITING_PICKUP" || (b.order && (b.order.status === "PENDING" || b.order.status === "TRANSFER")));
  const refs = open.map((b) => b.vendorRef!).filter((r) => /^\d+$/.test(r));
  const web = new Map<string, WooOrder>();
  for (let i = 0; i < refs.length; i += 100) {
    const chunk = refs.slice(i, i + 100);
    const list = await wooGet<WooOrder[]>(conn, "orders", { include: chunk.join(","), per_page: "100", status: "any" });
    for (const o of list) web.set(String(o.number || o.id), o);
  }

  let updated = 0;
  let rejected = 0;
  let flagged = 0;

  // (Old behaviour, now off: website orders used to switch to the website order No. as CN.
  // They now keep our own CN series; the order No. is printed on the label instead.)
  for (const b of WEBSITE_NO_AS_CN ? open : []) {
    if (b.status !== "AWAITING_PICKUP" || b.cnSource !== "SYSTEM" || b.labelPrintedAt || !b.createdBy || b.createdBy !== "WEBSITE") continue;
    const own = Number(b.vendorRef);
    if (!Number.isSafeInteger(own) || own <= 0 || own >= CN_START || own === b.cnNo) continue;
    if (!(await isCnFree(own))) continue;
    try {
      await prisma.booking.update({ where: { id: b.id }, data: { cnNo: own, cnSource: "VENDOR" } });
      b.cnNo = own;
      updated++;
    } catch {
      /* taken meanwhile — keep the generated CN */
    }
  }

  // Website orders already in Daily Entry with a generated CN → their own order No.
  const acceptedGenerated = await prisma.booking.findMany({
    where: { vendorId, createdBy: "WEBSITE", cnSource: "SYSTEM", status: "ACCEPTED", orderId: { not: null }, vendorRef: { not: null }, createdAt: { gte: since } },
    select: { id: true, orderId: true, vendorRef: true, cnNo: true },
  });
  let renumbered = 0;
  for (const b of WEBSITE_NO_AS_CN ? acceptedGenerated : []) {
    const own = Number(b.vendorRef);
    if (!Number.isSafeInteger(own) || own <= 0 || own >= CN_START || own === b.cnNo) continue;
    if (!(await isCnFree(own))) continue;
    try {
      await prisma.$transaction([
        prisma.order.update({ where: { id: b.orderId! }, data: { cnNo: own } }),
        prisma.booking.update({ where: { id: b.id }, data: { cnNo: own, cnSource: "VENDOR" } }),
      ]);
      renumbered++;
    } catch {
      /* taken meanwhile — keep the generated CN */
    }
  }
  if (renumbered) {
    updated += renumbered;
    emitGlobal("order:changed", { type: "renumbered" });
  }

  for (const b of open) {
    const o = web.get(b.vendorRef!);
    if (!o) continue;
    if (b.createdBy === "WEBSITE" && b.webStatus !== o.status) {
      await prisma.booking.update({ where: { id: b.id }, data: { webStatus: o.status } });
      b.webStatus = o.status;
    }
    const cancelled = CANCELLED_STATUSES.includes(o.status);
    const m = mapWooOrder(o);

    if (b.status === "AWAITING_PICKUP") {
      if (cancelled) {
        await prisma.booking.update({ where: { id: b.id }, data: { status: "REJECTED", rejectReason: `Cancelled on Inspired website (${o.status})` } });
        rejected++;
        continue;
      }
      // Only take the website's version if it was edited there after our copy
      // was last saved — so a correction made by the office isn't overwritten.
      const webModified = o.date_modified_gmt ? new Date(`${o.date_modified_gmt}Z`).getTime() : 0;
      if (!webModified || webModified <= b.updatedAt.getTime()) continue;
      const changed =
        b.customerName !== m.customerName ||
        b.customerPhone !== m.customerPhone ||
        b.address !== m.address ||
        b.emirate !== m.emirate ||
        (b.items ?? undefined) !== m.items ||
        b.codAmount !== m.codAmount ||
        (b.notes ?? undefined) !== m.notes;
      if (changed) {
        await prisma.booking.update({
          where: { id: b.id },
          data: {
            customerName: m.customerName,
            customerPhone: m.customerPhone,
            address: m.address,
            emirate: m.emirate,
            items: m.items ?? null,
            codAmount: m.codAmount,
            notes: m.notes ?? null,
          },
        });
        updated++;
      }
      continue;
    }

    // Already handed to a driver — warn rather than change it under them.
    if (!b.order) continue;
    const warning = cancelled
      ? `⚠ Cancelled on Inspired website — do not deliver, check with office`
      : m.codAmount !== b.order.total
        ? `⚠ Amount changed on Inspired website: collect AED ${m.codAmount} (was ${b.order.total}) — check with office`
        : null;
    if (warning && b.order.remarks !== warning) {
      await prisma.order.update({ where: { id: b.order.id }, data: { remarks: warning } });
      flagged++;
    }
  }

  if (updated || rejected) emitGlobal("booking:changed", { type: "refreshed" });
  if (flagged) emitGlobal("order:changed", { type: "flagged" });
  return { updated, rejected, flagged };
}

type SyncResult = {
  at: Date;
  imported: number;
  skipped: number;
  linked?: number;
  updated?: number;
  rejected?: number;
  flagged?: number;
  errors: string[];
};
const lastSyncs = new Map<string, SyncResult>();
export const lastWooSync = (conn: string) => lastSyncs.get(conn) ?? null;

/** Imports new website orders as Awaiting Pickup bookings. Safe to run repeatedly. */
export async function syncWooOrders(conn: string, triggeredBy: string | null = null) {
  const cfg = wooConfig(conn);
  const vendor = await findWooVendor(conn);
  if (!vendor) throw new Error(`No vendor named "${cfg.vendorName}" in the Vendors list`);

  const after = new Date(Date.now() - cfg.days * 24 * 60 * 60 * 1000).toISOString();
  const orders: WooOrder[] = [];
  for (let page = 1; page <= 5; page++) {
    const batch = await wooGet<WooOrder[]>(conn, "orders", {
      status: cfg.statuses.join(","),
      after,
      per_page: "50",
      page: String(page),
      orderby: "date",
      order: "asc",
    });
    orders.push(...batch);
    if (batch.length < 50) break;
  }

  let imported = 0;
  let skipped = 0;
  let linked = 0;
  const errors: string[] = [];
  for (const o of orders) {
    const data = mapWooOrder(o);
    const exists = await prisma.booking.findFirst({ where: { vendorId: vendor.id, vendorRef: data.vendorRef }, select: { id: true } });
    if (exists) {
      skipped++;
      continue;
    }
    // Already typed into Daily Entry by hand with Inspired's own order No. as the CN.
    const typedNo = Number(data.vendorRef);
    if (Number.isSafeInteger(typedNo)) {
      // Only a recent hand entry can be this same order; older ones are ignored.
      const typed = await prisma.order.findFirst({
        where: { cnNo: typedNo, vendorId: vendor.id, createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
        select: { id: true },
      });
      if (typed) {
        skipped++;
        continue;
      }
    }
    if (await linkToManualTwin(vendor.id, data)) {
      linked++;
      continue;
    }
    try {
      await createBooking(vendor.id, { ...data, confirmDuplicate: true }, "WEBSITE", { ...(WEBSITE_NO_AS_CN ? { preferredCn: Number(data.vendorRef) } : {}), placedAt: placedAtOf(o), webStatus: o.status });
      imported++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/already entered/i.test(msg)) skipped++;
      else errors.push(`#${data.vendorRef}: ${msg}`);
    }
  }

  let refresh = { updated: 0, rejected: 0, flagged: 0 };
  try {
    refresh = await refreshImportedWooOrders(conn, vendor.id);
  } catch (err) {
    errors.push(`re-check: ${err instanceof Error ? err.message : String(err)}`);
  }

  const lastSync: SyncResult = { at: new Date(), imported, skipped, linked, ...refresh, errors };
  lastSyncs.set(conn, lastSync);
  if (refresh.updated || refresh.rejected || refresh.flagged) {
    await writeAuditLog({ userId: triggeredBy, action: `${conn}_RECHECK`, entity: "Booking", meta: refresh });
  }
  if (imported > 0) {
    emitGlobal("booking:changed", { type: "imported", count: imported });
    await writeAuditLog({ userId: triggeredBy, action: `${conn}_SYNC`, entity: "Booking", meta: { imported, skipped, errors: errors.length } });
  }
  return lastSync;
}

/** Every 5 minutes, for each connected vendor website. */
export function startWooSyncScheduler() {
  const tick = async () => {
    for (const conn of wooConnections()) {
      if (!wooConfig(conn).configured) continue;
      try {
        const r = await syncWooOrders(conn, null);
        if (r.imported || r.updated || r.rejected || r.flagged || r.errors.length)
          // eslint-disable-next-line no-console
          console.log(`[${conn.toLowerCase()}] imported ${r.imported}, updated ${r.updated}, rejected ${r.rejected}, flagged ${r.flagged}, errors ${r.errors.length}`);
      } catch (err) {
        lastSyncs.set(conn, { at: new Date(), imported: 0, skipped: 0, errors: [err instanceof Error ? err.message : String(err)] });
        // eslint-disable-next-line no-console
        console.error(`[${conn.toLowerCase()}] sync failed`, err);
      }
    }
  };
  setTimeout(tick, 90 * 1000);
  setInterval(tick, 5 * 60 * 1000);
}

/**
 * Parcels saved with emirate "OTHER" whose address clearly names a place
 * ("Al Muteena, Deira", "Firj Murar") get the right emirate — bookings and
 * their orders. Safe to run on every start: it only touches "OTHER" ones.
 */
export async function fixOtherEmirates(): Promise<number> {
  const since = new Date(Date.now() - 60 * 24 * 3600 * 1000);
  const list = await prisma.booking.findMany({
    where: { emirate: "OTHER", createdAt: { gte: since } },
    select: { id: true, address: true, orderId: true },
  });
  let fixed = 0;
  for (const b of list) {
    const em = emirateFromText(b.address);
    if (em === "OTHER") continue;
    await prisma.booking.update({ where: { id: b.id }, data: { emirate: em } });
    if (b.orderId) await prisma.order.updateMany({ where: { id: b.orderId, emirate: "OTHER" }, data: { emirate: em } });
    fixed++;
  }
  return fixed;
}

/**
 * Labels printed for website orders → mark those orders "completed" on the vendor's
 * website (what they used to do by hand after printing). Never blocks printing:
 * returns how many were marked and the first error, if any.
 */
export async function markWebsiteCompleted(bookingIds: string[]): Promise<{ marked: number; failed: number; error?: string }> {
  const list = await prisma.booking.findMany({
    where: { id: { in: bookingIds }, createdBy: "WEBSITE", vendorRef: { not: null }, status: { not: "REJECTED" } },
    select: { id: true, vendorId: true, vendorRef: true, webStatus: true },
  });
  let marked = 0;
  let failed = 0;
  let error: string | undefined;
  const connOf = new Map<string, string | null>();
  for (const b of list) {
    if (b.webStatus === "completed") continue;
    if (!connOf.has(b.vendorId)) connOf.set(b.vendorId, await wooConnForVendor(b.vendorId));
    const conn = connOf.get(b.vendorId);
    if (!conn) continue;
    try {
      // vendorRef is the order number; find the order's id if the shop numbers orders differently.
      let id = b.vendorRef!;
      let current: WooOrder | null = null;
      try {
        current = await wooGet<WooOrder>(conn, `orders/${id}`, {});
        if (String(current.number ?? current.id) !== b.vendorRef) current = null;
      } catch {
        current = null;
      }
      if (!current) {
        const found = await wooGet<WooOrder[]>(conn, "orders", { search: b.vendorRef!, per_page: "10", status: "any" });
        current = found.find((x) => String(x.number ?? x.id) === b.vendorRef) ?? null;
      }
      if (!current) throw new Error(`order #${b.vendorRef} not found on the website`);
      id = String(current.id);
      if (CANCELLED_STATUSES.includes(current.status)) {
        await prisma.booking.update({ where: { id: b.id }, data: { webStatus: current.status } });
        continue;
      }
      if (current.status !== "completed") await wooGet(conn, `orders/${id}`, {}, "PUT", { status: "completed" });
      await prisma.booking.update({ where: { id: b.id }, data: { webStatus: "completed" } });
      marked++;
    } catch (err) {
      failed++;
      error ??= err instanceof Error ? err.message : String(err);
    }
  }
  if (failed) console.error(`[woo] mark completed: ${failed} failed — ${error}`);
  return { marked, failed, error };
}
