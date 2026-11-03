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
 * From 2026-11-04: the payment PDF marks Delivered; the Excel only marks RTO → CANCELLED.
 * Excel "Delivered" rows are kept for the payment check but wait for the PDF.
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
  source: z.enum(["excel", "pdf"]).optional(),
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

      let action: "change" | "already" | "conflict" | "pending" | "notFound" | "awaiting" | "driver" | "waitPdf";
      if (!order) action = Number.isSafeInteger(n) && waitingSet.has(n) ? "awaiting" : "notFound";
      // Never touch consignments held by our own drivers — only the agent's.
      else if (!order.employee?.isAgent) action = "driver";
      else if (target === "PENDING") action = "pending";
      else if (order.status === target) action = "already";
      // Excel no longer marks Delivered — only the payment PDF does, so unpaid ones stay visible.
      else if (r.source === "excel" && target === "DELIVERED") action = "waitPdf";
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
        waitPdf: count("waitPdf"),
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

/**
 * ── Payment check: Excel "Delivered" vs payment PDF ───────────────────────────
 * Every upload is recorded: Excel rows marked Delivered (with their delivered date)
 * and every CN on the agent's payment PDF (with the PDF's date).
 * "Delivered but not paid" = delivered on or before the latest PDF's date, but on no PDF.
 * Counting starts fresh from RECON_START — anything delivered before it is ignored.
 */
const RECON_START = "2026-11-02";

const recordSchema = z.object({
  rows: z
    .array(
      z.object({
        tracking: z.string().max(40),
        status: z.string().max(80),
        cod: z.number().nullable().optional(),
        source: z.enum(["excel", "pdf"]),
        reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        file: z.string().max(200).nullable().optional(),
      })
    )
    .max(5000),
});

router.post(
  "/record",
  asyncHandler(async (req, res) => {
    const { rows } = recordSchema.parse(req.body);
    const today = dubaiDateStr(new Date());
    // A date in the future is a misread — fall back to the upload day.
    const dayOf = (d?: string | null) => parseDateParam(d && d <= today ? d : today);
    let excel = 0;
    let pdf = 0;
    let removed = 0;

    // Same CN twice in one Excel: the last row wins (as in preview).
    const last = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const cn = r.tracking.replace(/\D/g, "");
      if (cn) last.set(`${r.source}:${cn}`, r);
    }

    for (const [key, r] of last) {
      const cn = key.split(":")[1];
      if (r.source === "pdf") {
        const data = { reportDate: dayOf(r.reportDate), cod: r.cod ?? null, file: r.file ?? null };
        await prisma.agentRecon.upsert({ where: { cn_kind: { cn, kind: "PDF_PAID" } }, create: { cn, kind: "PDF_PAID", ...data }, update: data });
        pdf++;
        continue;
      }
      const target = targetOf(r.status);
      if (target === "DELIVERED") {
        const existing = await prisma.agentRecon.findUnique({ where: { cn_kind: { cn, kind: "EXCEL_DELIVERED" } } });
        // Keep the first delivered date we saw unless the sheet now gives a real one.
        const data = {
          reportDate: r.reportDate ? dayOf(r.reportDate) : existing?.reportDate ?? dayOf(null),
          cod: r.cod ?? existing?.cod ?? null,
          file: r.file ?? null,
        };
        await prisma.agentRecon.upsert({ where: { cn_kind: { cn, kind: "EXCEL_DELIVERED" } }, create: { cn, kind: "EXCEL_DELIVERED", ...data }, update: data });
        excel++;
      } else if (target === "CANCELLED") {
        // Later sheet says RTO — it was never delivered, so nothing is owed.
        const d = await prisma.agentRecon.deleteMany({ where: { cn, kind: "EXCEL_DELIVERED" } });
        removed += d.count;
        // …and the parcel has to come back from the agent: put it on the pickup list (first RTO date kept).
        await prisma.agentRecon.upsert({
          where: { cn_kind: { cn, kind: "RTO_PICKUP" } },
          create: { cn, kind: "RTO_PICKUP", reportDate: dayOf(null), cod: r.cod ?? null, file: r.file ?? null },
          update: {},
        });
      }
    }
    res.json({ excel, pdf, removed });
  })
);

/** GET /unpaid → delivered per Excel, on or before the latest PDF date, but on no payment PDF. */
router.get(
  "/unpaid",
  asyncHandler(async (_req, res) => {
    const start = parseDateParam(RECON_START);
    const lastPdf = await prisma.agentRecon.findFirst({ where: { kind: "PDF_PAID" }, orderBy: { reportDate: "desc" } });
    const lastExcel = await prisma.agentRecon.findFirst({ where: { kind: "EXCEL_DELIVERED" }, orderBy: { updatedAt: "desc" } });
    if (!lastPdf) {
      return res.json({ start: RECON_START, cutoff: null, lastPdfFile: null, lastExcelFile: lastExcel?.file ?? null, rows: [], total: 0 });
    }
    const cutoff = lastPdf.reportDate;

    const delivered = await prisma.agentRecon.findMany({
      where: { kind: "EXCEL_DELIVERED", reportDate: { gte: start, lte: cutoff } },
      orderBy: { reportDate: "asc" },
    });
    const paid = await prisma.agentRecon.findMany({ where: { kind: "PDF_PAID", cn: { in: delivered.map((d) => d.cn) } }, select: { cn: true } });
    const paidSet = new Set(paid.map((p) => p.cn));
    const missing = delivered.filter((d) => !paidSet.has(d.cn));

    const nums = missing.map((m) => (m.cn.length <= 9 ? Number(m.cn) : NaN)).filter((n) => Number.isSafeInteger(n));
    const orders = await prisma.order.findMany({
      where: { cnNo: { in: nums } },
      select: {
        cnNo: true,
        date: true,
        status: true,
        total: true,
        resolvedAt: true,
        vendor: { select: { name: true } },
        employee: { select: { name: true, isAgent: true } },
        booking: { select: { customerName: true } },
      },
      orderBy: { date: "desc" },
    });
    const byCn = new Map<number, (typeof orders)[number]>();
    for (const o of orders) {
      const cur = byCn.get(o.cnNo);
      if (!cur || (!cur.employee?.isAgent && o.employee?.isAgent)) byCn.set(o.cnNo, o);
    }

    const rows = missing
      .map((m) => {
        const o = byCn.get(Number(m.cn));
        return {
          cn: m.cn,
          deliveredOn: m.reportDate.toISOString().slice(0, 10),
          cod: m.cod ?? o?.total ?? null,
          file: m.file,
          order: o
            ? {
                date: o.date.toISOString(),
                status: o.status,
                total: o.total,
                vendor: o.vendor.name,
                customer: o.booking?.customerName ?? null,
                holder: o.employee?.name ?? null,
                resolvedAt: o.resolvedAt?.toISOString() ?? null,
              }
            : null,
        };
      })
      // Fresh start: an order we had already closed as Delivered before the start day is old business — skip it.
      .filter((r) => !(r.order?.status === "DELIVERED" && r.order.resolvedAt && new Date(r.order.resolvedAt).getTime() < start.getTime() - 4 * 3600 * 1000));

    res.json({
      start: RECON_START,
      cutoff: cutoff.toISOString().slice(0, 10),
      lastPdfFile: lastPdf.file,
      lastExcelFile: lastExcel?.file ?? null,
      rows,
      total: rows.reduce((s, r) => s + (r.cod ?? 0), 0),
    });
  })
);

/**
 * ── Returns page (Cancel & Pickup): parcels to receive back at the office ─────
 * Two lists, one scan bar:
 *  - CANCELLED: RTO in the agent's Excel and cancelled in Daily Entry → parcel comes back to us.
 *  - PICKUP: a pickup delivery (label says PICKUP — the agent collects from the customer) that the
 *    agent's Excel or payment PDF shows done → the collected parcel comes back to us.
 * Admin scans the CN when it's back; the server works out which list it belongs to.
 * Counting from PICKUP_START.
 */
const PICKUP_START = "2026-11-04";
const PICKUP_RE = /\b(pick\s*-?\s*up|p\/u|collect(ion)?\s+from\s+customer|reverse\s+pick)/i; // same as frontend lib/notes
const isPickupBooking = (b: { notes: string | null; items: string | null } | null | undefined) =>
  Boolean(b && (PICKUP_RE.test(b.notes ?? "") || /^\s*pick\s*-?\s*up\b/i.test(b.items ?? "")));
const pickupStartTs = () => new Date(parseDateParam(PICKUP_START).getTime() - 4 * 3600 * 1000); // Dubai midnight

async function pickupOrders(cns: string[]) {
  const nums = cns.map((c) => (c.length <= 9 ? Number(c) : NaN)).filter((n) => Number.isSafeInteger(n));
  const orders = await prisma.order.findMany({
    where: { cnNo: { in: nums } },
    select: {
      cnNo: true,
      date: true,
      status: true,
      total: true,
      resolvedAt: true,
      vendor: { select: { name: true } },
      employee: { select: { name: true, isAgent: true } },
      booking: { select: { customerName: true, notes: true, items: true } },
    },
    orderBy: { date: "desc" },
  });
  const byCn = new Map<number, (typeof orders)[number]>();
  for (const o of orders) {
    const cur = byCn.get(o.cnNo);
    if (!cur || (!cur.employee?.isAgent && o.employee?.isAgent)) byCn.set(o.cnNo, o);
  }
  return byCn;
}
type PickupOrderRow = Awaited<ReturnType<typeof pickupOrders>> extends Map<number, infer O> ? O : never;

const orderOut = (o: PickupOrderRow) => ({
  date: o.date.toISOString(),
  status: o.status,
  total: o.total,
  vendor: o.vendor.name,
  customer: o.booking?.customerName ?? null,
  holder: o.employee?.name ?? null,
  isAgent: !!o.employee?.isAgent,
  resolvedAt: o.resolvedAt?.toISOString() ?? null,
});

/**
 * Everything that has to come back to the office, from the agent AND our own drivers:
 *  - CANCEL: order Cancelled since the start (or RTO on the agent's Excel), not a pickup delivery.
 *  - PICKUP: pickup delivery done — Delivered since the start, or the agent's Excel/PDF shows it done.
 */
async function collectList() {
  const since = pickupStartTs();
  const rto = await prisma.agentRecon.findMany({ where: { kind: "RTO_PICKUP", firstSeenAt: { gte: since } } });
  const done = await prisma.agentRecon.findMany({ where: { kind: { in: ["EXCEL_DELIVERED", "PDF_PAID"] }, firstSeenAt: { gte: since } } });
  const resolved = await prisma.order.findMany({
    where: { resolvedAt: { gte: since }, status: { in: ["CANCELLED", "DELIVERED"] } },
    select: { cnNo: true },
  });
  const rtoAt = new Map(rto.map((r) => [r.cn, r.firstSeenAt]));
  const doneAt = new Map<string, Date>();
  for (const d of done) if (!doneAt.has(d.cn) || d.firstSeenAt < doneAt.get(d.cn)!) doneAt.set(d.cn, d.firstSeenAt);

  const cns = [...new Set([...rto.map((r) => r.cn), ...done.map((d) => d.cn), ...resolved.map((o) => String(o.cnNo))])];
  const byCn = await pickupOrders(cns);
  const got = await prisma.agentRecon.findMany({ where: { kind: { in: ["RTO_RECEIVED", "PICKUP_RECEIVED"] }, cn: { in: cns } } });
  const gotKey = new Map(got.map((g) => [`${g.kind}:${g.cn}`, g]));

  type Entry = { cn: string; type: "CANCEL" | "PICKUP"; since: Date; order: PickupOrderRow; received: (typeof got)[number] | undefined };
  const out: Entry[] = [];
  for (const cn of cns) {
    const o = byCn.get(Number(cn));
    if (!o) continue;
    const resolvedSince = !!o.resolvedAt && o.resolvedAt >= since;
    if (isPickupBooking(o.booking)) {
      // A pickup that went RTO was never collected — nothing comes back.
      const agentDone = !!o.employee?.isAgent && doneAt.has(cn) && o.status !== "CANCELLED";
      if ((o.status === "DELIVERED" && resolvedSince) || agentDone) {
        const at = doneAt.get(cn) ?? o.resolvedAt ?? new Date();
        out.push({ cn, type: "PICKUP", since: at, order: o, received: gotKey.get(`PICKUP_RECEIVED:${cn}`) });
      }
    } else if (o.status === "CANCELLED" && (resolvedSince || rtoAt.has(cn))) {
      const at = rtoAt.get(cn) ?? o.resolvedAt ?? new Date();
      out.push({ cn, type: "CANCEL", since: at, order: o, received: gotKey.get(`RTO_RECEIVED:${cn}`) });
    }
  }
  return out;
}

router.get(
  "/pickup",
  asyncHandler(async (_req, res) => {
    const list = await collectList();
    const toReceive = (t: "CANCEL" | "PICKUP") =>
      list
        .filter((e) => e.type === t && !e.received)
        .sort((a, b) => a.since.getTime() - b.since.getTime())
        .map((e) => ({ cn: e.cn, on: dubaiDateStr(e.since), order: orderOut(e.order) }));
    const received = (t: "CANCEL" | "PICKUP") =>
      list
        .filter((e) => e.type === t && e.received)
        .sort((a, b) => b.received!.firstSeenAt.getTime() - a.received!.firstSeenAt.getTime())
        .slice(0, 200)
        .map((e) => ({ cn: e.cn, on: dubaiDateStr(e.since), receivedAt: e.received!.firstSeenAt.toISOString(), by: e.received!.file, order: orderOut(e.order) }));
    res.json({
      start: PICKUP_START,
      cancel: { pending: toReceive("CANCEL"), received: received("CANCEL") },
      pickup: { pending: toReceive("PICKUP"), received: received("PICKUP") },
    });
  })
);

const cnSchema = z.object({ cn: z.string().min(1).max(40), type: z.enum(["CANCEL", "PICKUP"]).optional() });

router.post(
  "/pickup/receive",
  asyncHandler(async (req, res) => {
    const cn = cnSchema.parse(req.body).cn.replace(/\D/g, "");
    if (!cn) return res.status(400).json({ error: "Not a CN number" });
    const entries = (await collectList()).filter((e) => e.cn === cn);
    if (entries.length === 0) {
      const o = (await pickupOrders([cn])).get(Number(cn));
      return res.status(404).json({
        error: o ? `CN ${cn} is ${o.status} (${o.employee?.name ?? "—"}) — not on the cancelled or pickup list` : `CN ${cn} not found`,
      });
    }
    const open = entries.find((e) => !e.received);
    if (!open) return res.status(409).json({ error: `CN ${cn} already received back (${dubaiDateStr(entries[0].received!.firstSeenAt)})` });
    if (open.type === "CANCEL" && open.order.status !== "CANCELLED")
      return res.status(409).json({ error: `CN ${cn} is ${open.order.status} in Daily Entry — not cancelled yet` });

    const user = await prisma.user.findUnique({ where: { id: req.user!.sub }, select: { name: true } });
    const kind = open.type === "CANCEL" ? "RTO_RECEIVED" : "PICKUP_RECEIVED";
    await prisma.agentRecon.create({ data: { cn, kind, reportDate: parseDateParam(dubaiDateStr(new Date())), cod: open.order.total, file: user?.name ?? null } });
    await writeAuditLog({ userId: req.user!.sub, action: kind, entity: "Order", entityId: null, meta: { cn, vendor: open.order.vendor.name, total: open.order.total } });
    res.json({ ok: true, cn, type: open.type, order: orderOut(open.order) });
  })
);

router.post(
  "/pickup/undo",
  asyncHandler(async (req, res) => {
    const { cn: raw, type } = cnSchema.parse(req.body);
    const cn = raw.replace(/\D/g, "");
    const kinds = type === "PICKUP" ? ["PICKUP_RECEIVED"] : type === "CANCEL" ? ["RTO_RECEIVED"] : ["RTO_RECEIVED", "PICKUP_RECEIVED"];
    const d = await prisma.agentRecon.deleteMany({ where: { cn, kind: { in: kinds } } });
    res.json({ ok: d.count > 0 });
  })
);

export default router;
