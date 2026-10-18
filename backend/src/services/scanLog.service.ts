import { prisma } from "../lib/prisma";
import { ApiError } from "../utils/asyncHandler";
import type { ScanAssignResult } from "./booking.service";

/**
 * Wraps a scan so every attempt is written to the scan log (who scanned, for which
 * driver, the result). "Move from another driver?" questions are not logged — only
 * the final answer is.
 */
export async function withScanLog(
  meta: { byUserId: string; byRole: "OFFICE" | "DRIVER"; driverId: string; code: string },
  run: () => Promise<ScanAssignResult>
): Promise<ScanAssignResult> {
  try {
    const r = await run();
    await write(meta, {
      result: r.result,
      message: r.message,
      order: r.order,
      fromDriverId: (r as { previousEmployeeId?: string }).previousEmployeeId,
    });
    return r;
  } catch (err) {
    const code = err instanceof ApiError ? (err.details as { code?: string } | undefined)?.code : undefined;
    if (code !== "CONFIRM_SCAN") {
      await write(meta, { result: "FAILED", message: err instanceof Error ? err.message : "Scan failed" });
    }
    throw err;
  }
}

async function write(
  meta: { byUserId: string; byRole: "OFFICE" | "DRIVER"; driverId: string; code: string },
  r: { result: string; message: string; order?: ScanAssignResult["order"]; fromDriverId?: string }
) {
  try {
    const ids = [meta.byUserId, meta.driverId, r.fromDriverId].filter(Boolean) as string[];
    const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    const name = (id?: string) => users.find((u) => u.id === id)?.name ?? null;
    const booking = r.order ? await prisma.booking.findFirst({ where: { orderId: r.order.id }, select: { address: true } }) : null;
    await prisma.scanLog.create({
      data: {
        byUserId: meta.byUserId,
        byName: name(meta.byUserId) ?? "?",
        byRole: meta.byRole,
        driverId: meta.driverId,
        driverName: name(meta.driverId),
        code: meta.code.slice(0, 100),
        result: r.result,
        message: r.message.slice(0, 500),
        orderId: r.order?.id ?? null,
        cnNo: r.order?.cnNo ?? null,
        vendorName: r.order?.vendor.name ?? null,
        total: r.order?.total ?? null,
        emirate: r.order?.emirate ?? null,
        address: booking?.address?.slice(0, 300) ?? null,
        fromDriver: name(r.fromDriverId) ?? null,
      },
    });
  } catch (err) {
    console.error("[scanlog] write failed:", err);
  }
}

/** Scans of one Dubai day "YYYY-MM-DD". */
export async function scanLogForDay(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d) - 4 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const rows = await prisma.scanLog.findMany({ where: { createdAt: { gte: start, lt: end } }, orderBy: { createdAt: "asc" }, take: 5000 });
  // Hide scans of consignments that were deleted afterwards (e.g. deleted in Daily Entry).
  const ids = Array.from(new Set(rows.map((r) => r.orderId).filter(Boolean) as string[]));
  const orders = await prisma.order.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      area: true,
      status: true,
      booking: { select: { customerName: true, customerPhone: true, address: true, items: true, notes: true } },
    },
  });
  const byId = new Map(orders.map((o) => [o.id, o]));
  // Attach customer details (name, phone, address, items, notes) for the report / PDF.
  return rows
    .filter((r) => !r.orderId || byId.has(r.orderId))
    .map((r) => {
      const o = r.orderId ? byId.get(r.orderId) : undefined;
      return {
        ...r,
        orderStatus: o?.status ?? null,
        area: o?.area ?? null,
        customerName: o?.booking?.customerName ?? null,
        customerPhone: o?.booking?.customerPhone ?? null,
        address: o?.booking?.address ?? r.address,
        items: o?.booking?.items ?? null,
        notes: o?.booking?.notes ?? null,
      };
    });
}
