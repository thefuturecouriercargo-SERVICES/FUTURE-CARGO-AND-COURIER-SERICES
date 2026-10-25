import { prisma } from "../lib/prisma";

export type ScanInfo = { by: string; role: "office" | "driver"; at: Date };

/**
 * For orders created in [start, end): which were created by a scan (Scan & Assign or a
 * driver taking the parcel) — with who scanned and when. Orders not in the map were
 * typed in by hand (Daily Entry / vendor portal accepted from the list).
 */
export async function scanInfoFor(orderIds: string[], start?: Date, end?: Date): Promise<Map<string, ScanInfo>> {
  const map = new Map<string, ScanInfo>();
  if (!orderIds.length) return map;
  const logs = await prisma.scanLog.findMany({
    // Window optional: a vendor's entry may be scanned on a later day.
    where: { orderId: { in: orderIds }, result: "ACCEPTED", ...(start && end ? { createdAt: { gte: start, lt: new Date(end.getTime() + 60 * 60 * 1000) } } : {}) },
    select: { orderId: true, byName: true, byRole: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  for (const l of logs) {
    if (!l.orderId || map.has(l.orderId)) continue;
    map.set(l.orderId, { by: l.byName, role: l.byRole === "OFFICE" ? "office" : "driver", at: l.createdAt });
  }
  return map;
}
