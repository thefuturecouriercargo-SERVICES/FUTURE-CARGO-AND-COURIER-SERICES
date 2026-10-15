import { prisma } from "../lib/prisma";
import { writeAuditLog } from "./audit.service";
import { emitGlobal } from "../lib/socket";
import { createBooking } from "./booking.service";

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
 *   INSPIRED_WC_STATUSES order statuses to import (default processing,on-hold)
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
    statuses: (process.env.INSPIRED_WC_STATUSES || "processing,on-hold").split(",").map((s) => s.trim()).filter(Boolean),
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

let lastSync: { at: Date; imported: number; skipped: number; errors: string[] } | null = null;
export const lastInspiredSync = () => lastSync;

/** Imports new website orders as Awaiting Pickup bookings. Safe to run repeatedly. */
export async function syncInspiredOrders(triggeredBy: string | null = null) {
  const cfg = inspiredConfig();
  const vendor = await prisma.vendor.findFirst({ where: { name: { equals: cfg.vendorName, mode: "insensitive" } } });
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
  const errors: string[] = [];
  for (const o of orders) {
    const data = mapWooOrder(o);
    const exists = await prisma.booking.findFirst({ where: { vendorId: vendor.id, vendorRef: data.vendorRef }, select: { id: true } });
    if (exists) {
      skipped++;
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

  lastSync = { at: new Date(), imported, skipped, errors };
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
      if (r.imported || r.errors.length) console.log(`[inspired] imported ${r.imported}, errors ${r.errors.length}`);
    } catch (err) {
      lastSync = { at: new Date(), imported: 0, skipped: 0, errors: [err instanceof Error ? err.message : String(err)] };
      // eslint-disable-next-line no-console
      console.error("[inspired] sync failed", err);
    }
  };
  setTimeout(tick, 90 * 1000);
  setInterval(tick, 5 * 60 * 1000);
}
