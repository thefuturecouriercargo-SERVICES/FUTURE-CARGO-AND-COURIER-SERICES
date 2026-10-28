import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";
import { dayRange } from "../utils/dates";
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
      const sd = (r.sender ?? "").replace(/\D/g, "");
      if (sd && sd === (r.sender ?? "").trim() && Number.isSafeInteger(toNum(sd))) cnNums.add(toNum(sd));
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
    // Newest order per CN.
    const orderByCn = new Map<number, (typeof orders)[number]>();
    const dupCn = new Set<number>();
    for (const o of orders) {
      if (orderByCn.has(o.cnNo)) dupCn.add(o.cnNo);
      else orderByCn.set(o.cnNo, o);
    }
    // CNs still sitting in Awaiting Pickup (not yet in Daily Entry).
    const waiting = await prisma.booking.findMany({
      where: { cnNo: { in: [...cnNums] }, status: "AWAITING_PICKUP" },
      select: { cnNo: true },
    });
    const waitingSet = new Set(waiting.map((b) => b.cnNo));

    const items = [...byCn.entries()].map(([cn, r]) => {
      const target = targetOf(r.status);
      let n = toNum(cn);
      let order = Number.isSafeInteger(n) ? orderByCn.get(n) : undefined;
      let matchedBy: "cn" | "sender" | null = order ? "cn" : null;
      if (!order) {
        const sd = (r.sender ?? "").trim();
        if (/^\d+$/.test(sd) && orderByCn.has(toNum(sd))) {
          n = toNum(sd);
          order = orderByCn.get(n);
          matchedBy = "sender";
        }
      }

      let action: "change" | "already" | "conflict" | "pending" | "notFound" | "awaiting";
      if (!order) action = Number.isSafeInteger(n) && waitingSet.has(n) ? "awaiting" : "notFound";
      else if (target === "PENDING") action = "pending";
      else if (order.status === target) action = "already";
      else if (order.status === "DELIVERED" || order.status === "CANCELLED") action = "conflict";
      else action = "change";

      const warnings: string[] = [];
      if (order && r.cod != null && r.cod !== order.total) warnings.push(`Amount: report ${r.cod}, ours ${order.total}`);
      if (order && dupCn.has(order.cnNo)) warnings.push("CN used on more than one order — newest picked");
      if (order && !order.employee?.isAgent) warnings.push(`Not with an agent (with ${order.employee?.name ?? "—"})`);
      if (matchedBy === "sender") warnings.push(`Matched by Sender Name ${r.sender}, not tracking no`);

      return {
        tracking: r.tracking,
        reportStatus: r.status,
        target,
        cod: r.cod ?? null,
        emirate: r.emirate ?? null,
        sheet: r.sheet ?? null,
        action,
        matchedBy,
        // Tick by default only for clean changes.
        selected: action === "change" && matchedBy === "cn",
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
    const done: string[] = [];
    const skipped: { orderId: string; reason: string }[] = [];

    for (const u of updates) {
      const existing = await prisma.order.findUnique({ where: { id: u.orderId } });
      if (!existing) {
        skipped.push({ orderId: u.orderId, reason: "Order not found" });
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
        meta: { from: existing.status, to: u.status, reason, carriedOverToToday: isCarryover, source: "AGENT_REPORT", file: fileName, tracking: u.tracking },
      });
      emitGlobal("order:changed", { type: "updated", order });
      done.push(order.id);
    }

    res.json({ updated: done.length, skipped });
  })
);

export default router;
