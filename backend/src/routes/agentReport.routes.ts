import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";
import { dayRange, dubaiDateStr, parseDateParam } from "../utils/dates";
import { writeAuditLog } from "../services/audit.service";
import { emitGlobal } from "../lib/socket";

/**
 * Agent status reports (Excel / PDF the agents send us).
 * The browser reads the file and sends the rows here:
 *   POST /preview — matches each row to our order by CN and says what would change (changes nothing)
 *   POST /apply   — marks the ticked orders Delivered / Cancelled
 * Report "Delivered" → DELIVERED, "RTO" → CANCELLED, anything else = still pending (left alone).
 */
const router = Router();
router.use(authenticate, requireRole("SUPER_ADMIN", "MANAGER"));

type Target = "DELIVERED" | "CANCELLED" | "PENDING";

function targetOf(raw: string): Target {
  const s = raw.trim().toLowerCase();
  if (s === "delivered" || s === "delivery done" || s === "dlvd") return "DELIVERED";
  if (s === "rto" || s.startsWith("rto ") || s.includes("return to origin") || s.includes("returned to shipper") || s === "returned")
    return "CANCELLED";
  return "PENDING";
}

const rowSchema = z.object({
  tracking: z.string().max(40),
  status: z.string().max(80),
  cod: z.number().nullable().optional(),
  emirate: z.string().max(60).nullable().optional(),
  sender: z.string().max(80).nullable().optional(),
  sheet: z.string().max(60).nullable().optional(),
});

const previewSchema = z.object({ rows: z.array(rowSchema).max(5000) });

router.post(
  "/preview",
  asyncHandler(async (req, res) => {
    const { rows } = previewSchema.parse(req.body);

    // Same CN listed twice (e.g. "Failed" one day, "Delivered" later): the last row wins.
    const byCn = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const cn = r.tracking.replace(/\D/g, "");
      if (cn) byCn.set(cn, r);
    }
    const toNum = (s: string) => (s.length <= 9 ? Number(s) : NaN);

    const cnNums = new Set<number>();
    for (const [cn, r] of byCn) {
      const n = toNum(cn);
      if (Number.isSafeInteger(n)) cnNums.add(n);
    }

    const orders = await prisma.order.findMany({
      where: { cnNo: { in: [...cnNums] } },
      select: {
        id: true,
        cnNo: true,
        date: true,
        status: true,
        total: true,
        emirate: true,
        vendor: { select: { name: true } },
        employee: { select: { name: true, isAgent: true } },
        booking: { select: { customerName: true } },
      },
      orderBy: { date: "desc" },
    });
    // One order per CN. If a CN was used more than once, prefer the one with the agent, then the newest.
    const allByCn = new Map<number, (typeof orders)[number][]>();
    for (const o of orders) allByCn.set(o.cnNo, [...(allByCn.get(o.cnNo) ?? []), o]);
    const orderByCn = new Map<number, (typeof orders)[number]>();
    const dupCn = new Set<number>();
    for (const [cnNo, list] of allByCn) {
      if (list.length > 1) dupCn.add(cnNo);
      orderByCn.set(cnNo, list.find((o) => o.employee?.isAgent) ?? list[0]); // list is newest-first
    }
    // CNs still sitting in Awaiting Pickup (not yet in Daily Entry).
    const waiting = await prisma.booking.findMany({
      where: { cnNo: { in: [...cnNums] }, status: "AWAITING_PICKUP" },
      select: { cnNo: true },
    });
    const waitingSet = new Set(waiting.map((b) => b.cnNo));

    const items = [...byCn.entries()].map(([cn, r]) => {
      const target = targetOf(r.status);
      const n = toNum(cn);
      const order = Number.isSafeInteger(n) ? orderByCn.get(n) : undefined;
      const matchedBy: "cn" | "sender" | null = order ? "cn" : null;
      // Only the tracking number counts. Sender Name is the vendor's bill no (repeats),
      // so matching on it hit unrelated old orders — never used.

      let action: "change" | "already" | "conflict" | "pending" | "notFound" | "awaiting" | "driver";
      if (!order) action = Number.isSafeInteger(n) && waitingSet.has(n) ? "awaiting" : "notFound";
      // Never touch consignments held by our own drivers — only the agent's.
      else if (!order.employee?.isAgent) action = "driver";
      else if (target === "PENDING") action = "pending";
      else if (order.status === target) action = "already";
      // The report always wins: Delivered → Delivered, RTO → Cancelled, whatever we had before.
      else action = "change";

      const warnings: string[] = [];
      const amountDiff = !!order && r.cod != null && r.cod !== order.total;
      const notWithAgent = !!order && !order.employee?.isAgent;
      const dup = !!order && dupCn.has(order.cnNo);
      if (amountDiff) warnings.push(`Amount differs: report ${r.cod}, ours ${order!.total} — check it's the same parcel`);
      if (notWithAgent) warnings.push(`With driver ${order!.employee?.name ?? "—"} — not touched`);
      if (dup) warnings.push(`CN ${order!.cnNo} is on more than one order — check the date`);
      if (order && target === "CANCELLED" && order.status === "DELIVERED") warnings.push("Was Delivered — report says RTO");
      if (order && target === "DELIVERED" && order.status === "CANCELLED") warnings.push("Was Cancelled — report says Delivered");

      return {
        tracking: r.tracking,
        reportStatus: r.status,
        target,
        cod: r.cod ?? null,
        emirate: r.emirate ?? null,
        sheet: r.sheet ?? null,
        action,
        matchedBy,
        // Ticked by default only when it's clearly the same parcel: CN equal, with the agent,
        // same amount, CN used once. Anything doubtful is shown but left for you to tick.
        selected: action === "change" && matchedBy === "cn" && !amountDiff && !notWithAgent && !dup,
        warnings,
        order: order
          ? {
              id: order.id,
              cnNo: order.cnNo,
              date: order.date.toISOString(),
              status: order.status,
              total: order.total,
              vendor: order.vendor.name,
              holder: order.employee?.name ?? null,
              customer: order.booking?.customerName ?? null,
            }
          : null,
      };
    });

    const count = (a: string) => items.filter((i) => i.action === a).length;
    res.json({
      items,
      summary: {
        rows: rows.length,
        unique: items.length,
        toDeliver: items.filter((i) => i.action === "change" && i.target === "DELIVERED").length,
        toCancel: items.filter((i) => i.action === "change" && i.target === "CANCELLED").length,
        already: count("already"),
        conflict: count("conflict"),
        pending: count("pending"),
        notFound: count("notFound") + count("awaiting"),
        driver: count("driver"),
      },
    });
  })
);

const applySchema = z.object({
  fileName: z.string().max(200).optional(),
  updates: z
    .array(z.object({ orderId: z.string().min(1), status: z.enum(["DELIVERED", "CANCELLED"]), tracking: z.string().max(40).optional() }))
    .min(1)
    .max(3000),
});

router.post(
  "/apply",
  asyncHandler(async (req, res) => {
    const { updates, fileName } = applySchema.parse(req.body);
    const { start: todayStart } = dayRange();
    const batch = new Date().toISOString(); // groups this upload's updates in the history
    const done: string[] = [];
    const skipped: { orderId: string; reason: string }[] = [];

    for (const u of updates) {
      const existing = await prisma.order.findUnique({ where: { id: u.orderId }, include: { employee: { select: { name: true, isAgent: true } } } });
      if (!existing) {
        skipped.push({ orderId: u.orderId, reason: "Order not found" });
        continue;
      }
      // Hard rule: an agent report can only change consignments held by an agent.
      if (!existing.employee?.isAgent) {
        skipped.push({ orderId: u.orderId, reason: `With driver ${existing.employee?.name ?? "—"} — not touched` });
        continue;
      }
      if (existing.status === u.status) {
        skipped.push({ orderId: u.orderId, reason: "Already " + u.status.toLowerCase() });
        continue;
      }
      const reason = u.status === "CANCELLED" ? "RTO — agent report" : undefined;
      // Same rule as marking by hand: an older order that gets resolved moves to today's sheet.
      const isCarryover = existing.date.getTime() < todayStart.getTime();

      const order = await prisma.$transaction(async (tx) => {
        let carry: { date?: Date; slNo?: number } = {};
        if (isCarryover) {
          const last = await tx.order.aggregate({ where: { date: todayStart }, _max: { slNo: true } });
          carry = { date: todayStart, slNo: (last._max.slNo ?? 0) + 1 };
        }
        return tx.order.update({
          where: { id: existing.id },
          data: {
            status: u.status,
            ...carry,
            resolvedAt: new Date(),
            ...(u.status === "CANCELLED" ? { remarks: reason } : existing.status === "CANCELLED" ? { remarks: null } : {}),
          },
          include: { vendor: true, employee: { select: { id: true, name: true } } },
        });
      });

      await writeAuditLog({
        userId: req.user!.sub,
        action: "STATUS_UPDATE",
        entity: "Order",
        entityId: order.id,
        meta: {
          from: existing.status,
          to: u.status,
          reason,
          carriedOverToToday: isCarryover,
          source: "AGENT_REPORT",
          batch,
          file: fileName,
          tracking: u.tracking,
          cnNo: order.cnNo,
          vendor: order.vendor.name,
          total: order.total,
          orderDate: existing.date.toISOString(),
        },
      });
      emitGlobal("order:changed", { type: "updated", order });
      done.push(order.id);
    }

    res.json({ updated: done.length, skipped });
  })
);

/**
 * Date-wise history of what agent-report uploads changed.
 * GET /history?date=YYYY-MM-DD (Dubai day, default today) →
 *   days: last 60 days that had updates (with counts), entries: that day's updates.
 */
router.get(
  "/history",
  asyncHandler(async (req, res) => {
    const DUBAI = 4 * 60 * 60 * 1000;
    const day = parseDateParam(typeof req.query.date === "string" && req.query.date ? req.query.date : undefined);
    const from = new Date(day.getTime() - DUBAI);
    const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
    const where = { action: "STATUS_UPDATE", entity: "Order", meta: { path: ["source"], equals: "AGENT_REPORT" } };

    const recent = await prisma.auditLog.findMany({
      where: { ...where, createdAt: { gte: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) } },
      select: { createdAt: true },
    });
    const counts = new Map<string, number>();
    for (const r of recent) {
      const d = dubaiDateStr(r.createdAt);
      counts.set(d, (counts.get(d) ?? 0) + 1);
    }
    const days = [...counts.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([date, count]) => ({ date, count }));

    const logs = await prisma.auditLog.findMany({
      where: { ...where, createdAt: { gte: from, lt: to } },
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    // Current state of those orders (customer, status now) for checking.
    const ids = [...new Set(logs.map((l) => l.entityId).filter((x): x is string => !!x))];
    const orders = await prisma.order.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        cnNo: true,
        status: true,
        total: true,
        vendor: { select: { name: true } },
        employee: { select: { name: true } },
        booking: { select: { customerName: true } },
      },
    });
    const byId = new Map(orders.map((o) => [o.id, o]));

    const entries = logs.map((l) => {
      const m = (l.meta ?? {}) as Record<string, unknown>;
      const o = l.entityId ? byId.get(l.entityId) : undefined;
      return {
        id: l.id,
        at: l.createdAt.toISOString(),
        batch: (m.batch as string) ?? l.createdAt.toISOString().slice(0, 16),
        file: (m.file as string) ?? null,
        by: l.user?.name ?? null,
        from: (m.from as string) ?? null,
        to: (m.to as string) ?? null,
        tracking: (m.tracking as string) ?? null,
        cnNo: o?.cnNo ?? (m.cnNo as number) ?? null,
        vendor: o?.vendor.name ?? (m.vendor as string) ?? null,
        customer: o?.booking?.customerName ?? null,
        holder: o?.employee?.name ?? null,
        total: o?.total ?? (m.total as number) ?? null,
        statusNow: o?.status ?? null,
      };
    });

    res.json({ date: day.toISOString().slice(0, 10), days, entries });
  })
);

export default router;
