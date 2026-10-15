import { prisma } from "../lib/prisma";
import { writeAuditLog } from "./audit.service";
import { emitGlobal } from "../lib/socket";
import { createBooking, phoneDigits } from "./booking.service";

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
 *   INSPIRED_WC_STATUSES order statuses to import (default processing,on-hold,completed)
 *   INSPIRED_WC_DAYS     how far back the first sync looks (default 2 days)
 */

export function inspiredConfig() {
  const url = (process.env.INSPIRED_WC_URL || "").replace(/\/+$/, "");
  const key = process.env.INSPIRED_WC_KEY || "";
  const secret = process.env.INSPIRED_WC_SECRET || "";
  return {
    url,
    key,
    secret,
    vendorName: process.env.INSPIRED_VENDOR_NAME || "INSPIRED",
    // Inspired marks an order "completed" when it is confirmed (ready to ship), not when delivered.
    statuses: (process.env.INSPIRED_WC_STATUSES || "processing,on-hold,completed").split(",").map((s) => s.trim()).filter(Boolean),
    days: Math.max(1, parseInt(process.env.INSPIRED_WC_DAYS || "2", 10) || 2),
    configured: Boolean(url && key && secret),
  };
}

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
  date_modified_gmt?: string;
  total: string;
  payment_method?: string;
  payment_method_title?: string;
  customer_note?: string;
  billing?: WooAddress & { email?: string };
  shipping?: WooAddress;
  line_items?: { name: string; quantity: number }[];
}

async function wooGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const cfg = inspiredConfig();
  if (!cfg.configured) throw new Error("Inspired website not connected — add INSPIRED_WC_URL, INSPIRED_WC_KEY and INSPIRED_WC_SECRET in Railway");
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${cfg.url}/wp-json/wc/v3/${path}?${qs}`, {
    headers: {
      Authorization: "Basic " + Buffer.from(`${cfg.key}:${cfg.secret}`).toString("base64"),
      Accept: "application/json",
      "User-Agent": "FutureCourier/1.0",
    },
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
    throw new Error(`Inspired website answered ${res.status}: ${msg}`);
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
  const text = `${addr.state ?? ""} ${addr.city ?? ""} ${addr.address_1 ?? ""} ${addr.address_2 ?? ""}`.toLowerCase();
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
  return "OTHER";
}

/** Turns a website order into our booking fields. */
export function mapWooOrder(o: WooOrder) {
  const ship = o.shipping && (o.shipping.address_1 || o.shipping.city) ? o.shipping : o.billing ?? {};
  const bill = o.billing ?? {};
  const name = `${ship.first_name || bill.first_name || ""} ${ship.last_name || bill.last_name || ""}`.trim() || "Customer";
  const phone = (ship.phone || bill.phone || "").trim();
  const address = [ship.address_1, ship.address_2, ship.city].map((s) => (s ?? "").trim()).filter(Boolean).join(", ");
  const items = (o.line_items ?? []).map((li) => `${li.quantity} × ${li.name}`).join(", ");
  const isCod = (o.payment_method ?? "").toLowerCase() === "cod";
  return {
    vendorRef: String(o.number || o.id),
    customerName: name.slice(0, 120),
    customerPhone: (phone || "(no phone)").slice(0, 30),
    address: (address || "(no address on website order)").slice(0, 500),
    emirate: detectEmirate(ship),
    items: items.slice(0, 500) || undefined,
    codAmount: isCod ? Math.round(Number(o.total) || 0) : 0,
    notes: [o.customer_note?.trim(), isCod ? "" : `Paid online (${o.payment_method_title || o.payment_method || "website"})`]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 500) || undefined,
  };
}

/** Latest orders, for the "Test connection" button — shows what the website sends. */
export async function testInspiredConnection() {
  const orders = await wooGet<WooOrder[]>("orders", { per_page: "3", orderby: "date", order: "desc" });
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
  await writeAuditLog({ action: "INSPIRED_LINK_MANUAL", entity: "Booking", entityId: twin.id, meta: { cnNo: twin.cnNo, websiteOrder: data.vendorRef } });
  return true;
}

async function findInspiredVendor() {
  const cfg = inspiredConfig();
  return prisma.vendor.findFirst({ where: { name: { equals: cfg.vendorName, mode: "insensitive" } } });
}

/**
 * Scan of an Inspired bill that isn't in our system yet: look that one order up
 * on their website right now and import it. Returns true if the order is now in
 * Awaiting Pickup (imported, or it already was). Throws if the website says the
 * order is cancelled, so the scan shows why instead of "not found".
 */
export async function importInspiredOrderByNumber(num: string): Promise<boolean> {
  const cfg = inspiredConfig();
  if (!cfg.configured) return false;
  const vendor = await findInspiredVendor();
  if (!vendor) return false;

  let o: WooOrder | null = null;
  try {
    o = await wooGet<WooOrder>(`orders/${encodeURIComponent(num)}`, {});
  } catch {
    o = null;
  }
  if (!o || String(o.number || o.id) !== num) {
    try {
      const list = await wooGet<WooOrder[]>("orders", { search: num, per_page: "10", status: "any" });
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
  if (CANCELLED_STATUSES.includes(o.status)) throw new Error(`Inspired order #${num} is ${o.status} on their website — don't pick it up`);
  if (!cfg.statuses.includes(o.status)) return false;

  const data = mapWooOrder(o);
  const exists = await prisma.booking.findFirst({ where: { vendorId: vendor.id, vendorRef: data.vendorRef }, select: { id: true } });
  if (exists) return true;
  if (await linkToManualTwin(vendor.id, data)) return true;
  await createBooking(vendor.id, { ...data, confirmDuplicate: true }, "WEBSITE");
  emitGlobal("booking:changed", { type: "imported", count: 1 });
  await writeAuditLog({ action: "INSPIRED_IMPORT_ON_SCAN", entity: "Booking", meta: { vendorRef: data.vendorRef } });
  return true;
}

/**
 * Re-checks Inspired orders we already imported (last 14 days) against the website:
 *  - still Awaiting Pickup + cancelled on website → rejected automatically
 *  - still Awaiting Pickup + edited on website    → our copy updated
 *  - already with a driver (Pending/Transfer) + cancelled or amount changed on
 *    website → a ⚠ warning is put in the order's remarks so the driver and office see it
 */
async function refreshImportedInspiredOrders(vendorId: string) {
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
    const list = await wooGet<WooOrder[]>("orders", { include: chunk.join(","), per_page: "100", status: "any" });
    for (const o of list) web.set(String(o.number || o.id), o);
  }

  let updated = 0;
  let rejected = 0;
  let flagged = 0;
  for (const b of open) {
    const o = web.get(b.vendorRef!);
    if (!o) continue;
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

let lastSync: {
  at: Date;
  imported: number;
  skipped: number;
  linked?: number;
  updated?: number;
  rejected?: number;
  flagged?: number;
  errors: string[];
} | null = null;
export const lastInspiredSync = () => lastSync;

/** Imports new website orders as Awaiting Pickup bookings. Safe to run repeatedly. */
export async function syncInspiredOrders(triggeredBy: string | null = null) {
  const cfg = inspiredConfig();
  const vendor = await findInspiredVendor();
  if (!vendor) throw new Error(`No vendor named "${cfg.vendorName}" in the Vendors list`);

  const after = new Date(Date.now() - cfg.days * 24 * 60 * 60 * 1000).toISOString();
  const orders: WooOrder[] = [];
  for (let page = 1; page <= 5; page++) {
    const batch = await wooGet<WooOrder[]>("orders", {
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
      const typed = await prisma.order.findFirst({ where: { cnNo: typedNo, vendorId: vendor.id }, select: { id: true } });
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
      await createBooking(vendor.id, { ...data, confirmDuplicate: true }, "WEBSITE");
      imported++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/already entered/i.test(msg)) skipped++;
      else errors.push(`#${data.vendorRef}: ${msg}`);
    }
  }

  let refresh = { updated: 0, rejected: 0, flagged: 0 };
  try {
    refresh = await refreshImportedInspiredOrders(vendor.id);
  } catch (err) {
    errors.push(`re-check: ${err instanceof Error ? err.message : String(err)}`);
  }

  lastSync = { at: new Date(), imported, skipped, linked, ...refresh, errors };
  if (refresh.updated || refresh.rejected || refresh.flagged) {
    await writeAuditLog({ userId: triggeredBy, action: "INSPIRED_RECHECK", entity: "Booking", meta: refresh });
  }
  if (imported > 0) {
    emitGlobal("booking:changed", { type: "imported", count: imported });
    await writeAuditLog({ userId: triggeredBy, action: "INSPIRED_SYNC", entity: "Booking", meta: { imported, skipped, errors: errors.length } });
  }
  return lastSync;
}

/** Every 5 minutes while the connection is configured. */
export function startInspiredSyncScheduler() {
  const tick = async () => {
    if (!inspiredConfig().configured) return;
    try {
      const r = await syncInspiredOrders(null);
      // eslint-disable-next-line no-console
      if (r.imported || r.updated || r.rejected || r.flagged || r.errors.length)
        // eslint-disable-next-line no-console
        console.log(`[inspired] imported ${r.imported}, updated ${r.updated}, rejected ${r.rejected}, flagged ${r.flagged}, errors ${r.errors.length}`);
    } catch (err) {
      lastSync = { at: new Date(), imported: 0, skipped: 0, errors: [err instanceof Error ? err.message : String(err)] };
      // eslint-disable-next-line no-console
      console.error("[inspired] sync failed", err);
    }
  };
  setTimeout(tick, 90 * 1000);
  setInterval(tick, 5 * 60 * 1000);
}
