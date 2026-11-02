import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

/** Last 9 digits of a phone (UAE mobile without 0/971), or null if too short to match safely. */
export function phoneKey(phone: string | null | undefined): string | null {
  const d = (phone ?? "").replace(/[^0-9]/g, "");
  return d.length >= 9 ? d.slice(-9) : null;
}

export type RiskOrder = {
  id: string;
  cnNo: number;
  status: "DELIVERED" | "CANCELLED";
  date: string;
  vendor: string;
  reason: string | null;
};

/**
 * Past finished orders (Delivered / Cancelled = RTO) for a customer phone, across
 * every vendor. The phone is the booking's customer phone, or the one typed onto
 * the order for office entries.
 */
export async function phoneHistory(phone: string, opts: { excludeCn?: number } = {}) {
  const key = phoneKey(phone);
  if (!key) return null;

  const rows = await prisma.$queryRaw<
    { id: string; cnNo: number; status: string; date: Date; vendor: string; driverNote: string | null; remarks: string | null }[]
  >(Prisma.sql`
    SELECT o.id, o."cnNo", o.status::text AS status, o.date, v.name AS vendor, o."driverNote", o.remarks
    FROM orders o
    JOIN vendors v ON v.id = o."vendorId"
    LEFT JOIN bookings b ON b."orderId" = o.id
    WHERE o.status::text IN ('DELIVERED', 'CANCELLED')
      AND right(regexp_replace(coalesce(b."customerPhone", o."custPhone", ''), '[^0-9]', '', 'g'), 9) = ${key}
    ORDER BY o.date DESC, o."createdAt" DESC
    LIMIT 60
  `);

  // One row per CN (a CN can exist twice after a re-entry) — newest wins.
  const seen = new Set<number>();
  const orders: RiskOrder[] = [];
  for (const r of rows) {
    if (seen.has(r.cnNo) || r.cnNo === opts.excludeCn) continue;
    seen.add(r.cnNo);
    orders.push({
      id: r.id,
      cnNo: r.cnNo,
      status: r.status as RiskOrder["status"],
      date: r.date.toISOString().slice(0, 10),
      vendor: r.vendor,
      reason: r.driverNote || r.remarks || null,
    });
  }

  const cancelled = orders.filter((o) => o.status === "CANCELLED").length;
  const delivered = orders.length - cancelled;
  // 1 refusal = caution; 2+ refusals (or refusing more than accepting) = high risk.
  const level = cancelled === 0 ? "none" : cancelled >= 2 || cancelled > delivered ? "high" : "caution";
  return { cancelled, delivered, level, orders };
}

/**
 * Many phones at once (Awaiting Pickup list): only the phones with at least one
 * refusal are returned, keyed by phoneKey().
 */
export async function riskForPhones(phones: string[]) {
  const keys = [...new Set(phones.map(phoneKey).filter((k): k is string => Boolean(k)))].slice(0, 1000);
  if (!keys.length) return {};
  const rows = await prisma.$queryRaw<{ key: string; cnNo: number; status: string }[]>(Prisma.sql`
    SELECT DISTINCT ON (o."cnNo")
      right(regexp_replace(coalesce(b."customerPhone", o."custPhone", ''), '[^0-9]', '', 'g'), 9) AS key,
      o."cnNo", o.status::text AS status
    FROM orders o
    LEFT JOIN bookings b ON b."orderId" = o.id
    WHERE o.status::text IN ('DELIVERED', 'CANCELLED')
      AND right(regexp_replace(coalesce(b."customerPhone", o."custPhone", ''), '[^0-9]', '', 'g'), 9) = ANY(${keys})
    ORDER BY o."cnNo", o."createdAt" DESC
  `);
  const out: Record<string, { cancelled: number; delivered: number; level: string }> = {};
  for (const r of rows) {
    const e = (out[r.key] ??= { cancelled: 0, delivered: 0, level: "none" });
    if (r.status === "CANCELLED") e.cancelled++;
    else e.delivered++;
  }
  for (const [k, e] of Object.entries(out)) {
    if (e.cancelled === 0) delete out[k];
    else e.level = e.cancelled >= 2 || e.cancelled > e.delivered ? "high" : "caution";
  }
  return out;
}
