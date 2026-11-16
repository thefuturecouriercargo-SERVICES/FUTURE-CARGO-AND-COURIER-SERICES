import { Router } from "express";
import { OrderStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { asyncHandler, ApiError } from "../utils/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";
import { dayRange, monthRange } from "../utils/dates";
import { z } from "zod";
import { assignByScan, scanBillVendors } from "../services/booking.service";
import { withScanLog } from "../services/scanLog.service";
import { writeAuditLog } from "../services/audit.service";
import { emitGlobal, emitToUser } from "../lib/socket";
import { salariesForMonth } from "../lib/salary";
import { updateOrderContact, withContact } from "../lib/orderContact";
import { EMIRATE_LABEL, prayerTimesFor } from "../lib/prayerTimes";
import { collectList } from "./agentReport.routes";
import { driverEmirate, pushConfigured, vapidPublicKey } from "../services/azanPush.service";
const router = Router();
router.use(authenticate, requireRole("DRIVER"));

// Driver corrects the delivery area of one of his own parcels (empty = back to automatic).
router.patch(
  "/orders/:id/area",
  asyncHandler(async (req, res) => {
    const area = typeof req.body?.area === "string" ? req.body.area.trim().toUpperCase().slice(0, 40) : "";
    const order = await prisma.order.findFirst({ where: { id: req.params.id, employeeId: req.user!.sub }, select: { id: true } });
    if (!order) throw new ApiError(404, "Order not found in your list");
    const updated = await prisma.order.update({ where: { id: order.id }, data: { area: area || null }, select: { id: true, area: true } });
    res.json(updated);
  })
);

// Driver fixes the customer's phone / address on one of his own parcels (⋯ → Edit).
router.patch(
  "/orders/:id/contact",
  asyncHandler(async (req, res) => {
    const r = await updateOrderContact(req.params.id, req.body ?? {}, req.user!.sub);
    await writeAuditLog({ userId: req.user!.sub, action: "DRIVER_EDIT_CONTACT", entity: "Order", entityId: r.order.id, meta: { cnNo: r.cnNo, before: r.before, phone: req.body?.phone, address: req.body?.address } });
    emitGlobal("order:changed", { type: "updated", order: r.order });
    res.json(r.order);
  })
);

// Driver's quick "not delivered" note on one of his parcels (status stays the same).
router.patch(
  "/orders/:id/note",
  asyncHandler(async (req, res) => {
    const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 200) : "";
    const order = await prisma.order.findFirst({ where: { id: req.params.id, employeeId: req.user!.sub }, select: { id: true } });
    if (!order) throw new ApiError(404, "Order not found in your list");
    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { driverNote: note || null, driverNoteAt: note ? new Date() : null },
      select: { id: true, driverNote: true, driverNoteAt: true },
    });
    emitGlobal("order:changed", { type: "updated", order: updated });
    res.json(updated);
  })
);

router.get(
  "/orders",
  asyncHandler(async (req, res) => {
    const { start } = dayRange(req.query.date as string | undefined);
    const status = req.query.status as string | undefined;

    const orders = await prisma.order.findMany({
     where: {
  employeeId: req.user!.sub,
  OR: [
    { date: start },
  { status: { in: ["PENDING", "TRANSFER"] }, date: { lt: start } },
  ],
  ...(status ? { status: status as OrderStatus } : {}),
},
      include: {
        vendor: true,
        employee: { select: { id: true, name: true } },
        booking: { select: { customerName: true, customerPhone: true, address: true, emirate: true, items: true, notes: true, vendorRef: true, codAmount: true, lat: true, lng: true } },
        // Most recent transfer for this order (if any) — so the driver receiving it
        // can see who handed it to them, not just that it says TRANSFER.
        transfers: {
          orderBy: { transferredAt: "desc" },
          take: 1,
          include: { fromEmployee: { select: { name: true } } },
        },
      },
      orderBy: { slNo: "asc" },
    });

    const ordersWithTransferInfo = orders.map((o) => ({
      ...withContact(o),
      transferredBy: o.transfers[0]?.fromEmployee.name ?? null,
    }));

    res.json({ date: start.toISOString().slice(0, 10), orders: ordersWithTransferInfo });
  })
);

// Azan reminder: prayer times for the emirate where this driver has the most
// consignments today (today's orders + older still-pending ones, same as /orders).
router.get(
  "/prayer",
  asyncHandler(async (req, res) => {
    const { emirate, counts } = await driverEmirate(req.user!.sub);
    res.json({ emirate, emirateLabel: EMIRATE_LABEL[emirate] ?? emirate, counts, ...prayerTimesFor(emirate) });
  })
);

// Azan push notifications — the phone subscribes once, then gets the Azan alert even with the portal closed.
router.get(
  "/push/key",
  asyncHandler(async (_req, res) => res.json({ key: pushConfigured() ? vapidPublicKey() : null }))
);

router.post(
  "/push/subscribe",
  asyncHandler(async (req, res) => {
    const sub = z
      .object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) })
      .parse(req.body);
    await prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      create: { userId: req.user!.sub, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      update: { userId: req.user!.sub, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    });
    res.json({ ok: true });
  })
);

router.get(
  "/scan-vendors",
  asyncHandler(async (_req, res) => res.json(await scanBillVendors()))
);

// Driver scans a parcel to take it: vendor bookings are accepted to him as Pending.
// He can't take another driver's open order, and there is no driver "unassign".
router.post(
  "/scan-claim",
  asyncHandler(async (req, res) => {
    const { code, confirm, vendorId } = z
      .object({ code: z.string().min(1).max(100), confirm: z.boolean().optional(), vendorId: z.string().optional() })
      .parse(req.body);
    const r = await withScanLog({ byUserId: req.user!.sub, byRole: "DRIVER", driverId: req.user!.sub, code }, () =>
      assignByScan(code, req.user!.sub, { allowReassign: false, confirmed: confirm, vendorId: vendorId || undefined })
    );
    if (r.result !== "ALREADY") {
      await writeAuditLog({ userId: req.user!.sub, action: "DRIVER_SCAN_CLAIM", entity: "Order", entityId: r.order.id, meta: { cnNo: r.order.cnNo } });
      emitGlobal("order:changed", { type: "created", order: r.order });
      emitGlobal("booking:changed", { type: "accepted" });
      emitToUser(req.user!.sub, "order:assigned", { order: r.order });
    }
    res.json(r);
  })
);

router.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const { start } = dayRange(req.query.date as string | undefined);
const orders = await prisma.order.findMany({ where: { employeeId: req.user!.sub, OR: [{ date: start }, { status: { in: ["PENDING", "TRANSFER"] }, date: { lt: start } }] } });

    const delivered = orders.filter((o) => o.status === "DELIVERED");
    res.json({
      date: start.toISOString().slice(0, 10),
      assigned: orders.length,
      delivered: delivered.length,
      pending: orders.filter((o) => o.status === "PENDING").length,
      cancelled: orders.filter((o) => o.status === "CANCELLED").length,
      transferred: orders.filter((o) => o.status === "TRANSFER").length,
      deliveryChargeEarned: delivered.reduce((s, o) => s + o.deliveryCharge, 0),
      cashCollected: delivered.filter((o) => o.payment === "CASH").reduce((s, o) => s + o.total, 0),
      bankCollected: delivered.filter((o) => o.payment === "BANK").reduce((s, o) => s + o.total, 0),
    });
  })
);

router.get(
  "/payroll",
  asyncHandler(async (req, res) => {
    const month = req.query.month as string;
    if (!month) return res.status(400).json({ error: "month is required" });

    const employeeId = req.user!.sub;

    const [employee, payrollRow, entries] = await Promise.all([
      prisma.user.findUnique({ where: { id: employeeId }, select: { id: true, name: true, baseSalary: true } }),
      prisma.payroll.findUnique({ where: { month_employeeId: { month, employeeId } } }),
      prisma.payrollEntry.findMany({
        where: { month, employeeId },
        orderBy: { date: "desc" },
      }),
    ]);

    const salaryThatMonth = (await salariesForMonth(month, [employeeId]))[employeeId];
    res.json({
      employee: employee && salaryThatMonth !== undefined ? { ...employee, baseSalary: salaryThatMonth } : employee,
      workingDays: payrollRow?.workingDays ?? 30,
      entries,
    });
  })
);
router.get(
  "/history",
  asyncHandler(async (req, res) => {
    const { start } = dayRange(req.query.date as string | undefined);

    const orders = await prisma.order.findMany({
      where: { employeeId: req.user!.sub, date: start },
      include: { vendor: true, employee: { select: { id: true, name: true } } },
      orderBy: { slNo: "asc" },
    });

    const delivered = orders.filter((o) => o.status === "DELIVERED");
    res.json({
      date: start.toISOString().slice(0, 10),
      orders,
      summary: {
        total: orders.length,
        delivered: delivered.length,
        pending: orders.filter((o) => o.status === "PENDING").length,
        transferred: orders.filter((o) => o.status === "TRANSFER").length,
        cancelled: orders.filter((o) => o.status === "CANCELLED").length,
        totalSales: delivered.reduce((s, o) => s + o.total, 0),
        totalDeliveryCharge: delivered.reduce((s, o) => s + o.deliveryCharge, 0),
      },
    });
  })
);

router.get(
  "/performance",
  asyncHandler(async (req, res) => {
    const month = req.query.month as string;
    if (!month) return res.status(400).json({ error: "month is required" });
    const { start, end } = monthRange(month);

    const orders = await prisma.order.findMany({
      where: { employeeId: req.user!.sub, date: { gte: start, lte: end } },
      orderBy: { date: "asc" },
    });

    const byDate = new Map<
      string,
      { date: string; delivered: number; pending: number; transferred: number; cancelled: number; totalSales: number; totalDeliveryCharge: number }
    >();

    for (const o of orders) {
      const key = o.date.toISOString().slice(0, 10);
      if (!byDate.has(key)) {
        byDate.set(key, {
          date: key,
          delivered: 0,
          pending: 0,
          transferred: 0,
          cancelled: 0,
          totalSales: 0,
          totalDeliveryCharge: 0,
        });
      }
      const row = byDate.get(key)!;
      if (o.status === "DELIVERED") {
        row.delivered += 1;
        row.totalSales += o.total;
        row.totalDeliveryCharge += o.deliveryCharge;
      } else if (o.status === "PENDING") {
        row.pending += 1;
      } else if (o.status === "TRANSFER") {
        row.transferred += 1;
      } else if (o.status === "CANCELLED") {
        row.cancelled += 1;
      }
    }

    const days = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
    res.json({ month, days });
  })
);

// ---- Live race: today's delivered count per driver, 12 midnight to 12 midnight (Dubai) ----
// Other drivers' counts are never sent — only their place and position on the line.
const RACE_CODES: Record<string, string> = { ANAS: "AN", MASOOD: "MS", NIYAS: "NS", NOUSHAD: "ND", SAVAD: "SV", FARIS: "FS" };
function raceCode(name: string) {
  const first = name.trim().split(/\s+/)[0].toUpperCase();
  return RACE_CODES[first] ?? (first.slice(0, 1) + first.slice(-1));
}
async function raceDay(day: Date, alwaysId?: string) {
  const from = new Date(day.getTime() - 4 * 60 * 60 * 1000);
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  const [drivers, delivered, assigned] = await Promise.all([
    prisma.user.findMany({ where: { role: "DRIVER", active: true, isAgent: false }, select: { id: true, name: true } }),
    prisma.order.groupBy({ by: ["employeeId"], where: { status: "DELIVERED", resolvedAt: { gte: from, lt: to } }, _count: { _all: true }, _max: { resolvedAt: true } }),
    // Working today = parcels dated today, or still in hand (pending / transfer) from earlier days.
    prisma.order.groupBy({ by: ["employeeId"], where: { OR: [{ date: day }, { status: { in: ["PENDING", "TRANSFER"] }, date: { lte: day } }] }, _count: { _all: true } }),
  ]);
  const count = new Map(delivered.map((d) => [d.employeeId, d._count._all]));
  // When each driver reached their current count — on a tie, whoever got there first stays ahead.
  const reached = new Map(delivered.map((d) => [d.employeeId, d._max.resolvedAt?.getTime() ?? Infinity]));
  const working = new Set(assigned.map((a) => a.employeeId));
  return drivers
    .filter((d) => count.has(d.id) || working.has(d.id) || d.id === alwaysId)
    .map((d) => ({ id: d.id, name: d.name, code: raceCode(d.name), n: count.get(d.id) ?? 0, at: reached.get(d.id) ?? Infinity }))
    .sort((a, b) => b.n - a.n || a.at - b.at || a.name.localeCompare(b.name));
}
router.get(
  "/race",
  asyncHandler(async (req, res) => {
    const { date } = dayRange();
    const list = await raceDay(date, req.user!.sub);
    const me = req.user!.sub;
    const lead = Math.max(1, list[0]?.n ?? 0);
    const mine = list.find((d) => d.id === me);
    let winner: { name: string; code: string } | null = null;
    if (!list.some((d) => d.n > 0)) {
      const y = await raceDay(new Date(date.getTime() - 24 * 60 * 60 * 1000));
      if (y[0]?.n) winner = { name: y[0].name, code: y[0].code };
    }
    res.json({
      me: mine
        ? (() => {
            const k = list.indexOf(mine);
            const ahead = list[k - 1];
            const behind = list[k + 1];
            const first = (n: string) => n.split(/\s+/)[0];
            return {
              rank: k + 1,
              delivered: mine.n,
              // Only the gap is sent, never the other drivers' own counts.
              ahead: ahead ? { name: first(ahead.name), need: ahead.n - mine.n + 1 } : null,
              behind: behind ? { name: first(behind.name), gap: mine.n - behind.n } : null,
              total: list.length,
            };
          })()
        : null,
      drivers: list.map((d, i) => ({ code: d.code, name: d.name.split(/\s+/)[0], rank: i + 1, pos: d.n / lead, me: d.id === me })),
      yesterdayWinner: winner,
    });
  })
);

// Personal race box numbers — only the driver's own figures, never anyone else's.
const MONTH_TARGET = 700;
const EXTRA_BONUS = 5;
router.get(
  "/race-stats",
  asyncHandler(async (req, res) => {
    const me = req.user!.sub;
    const H4 = 4 * 60 * 60 * 1000;
    const { start, end, year, month } = monthRange();
    const from = new Date(start.getTime() - H4);
    const to = new Date(end.getTime() + 24 * 60 * 60 * 1000 - H4);
    const prevMonth = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
    const daysInMonth = end.getUTCDate();
    const dayOfMonth = new Date(Date.now() + H4).getUTCDate();

    const [monthDelivered, user, payrollRow, entries, emirateInfo] = await Promise.all([
      prisma.order.count({ where: { employeeId: me, status: "DELIVERED", resolvedAt: { gte: from, lt: to } } }),
      prisma.user.findUnique({ where: { id: me }, select: { baseSalary: true } }),
      prisma.payroll.findUnique({ where: { month_employeeId: { month: prevMonth, employeeId: me } } }),
      prisma.payrollEntry.findMany({ where: { month: prevMonth, employeeId: me }, select: { type: true, amount: true } }),
      driverEmirate(me).catch(() => ({ emirate: "DUBAI" })),
    ]);
    const base = (await salariesForMonth(prevMonth, [me]))[me] ?? user?.baseSalary ?? 0;
    const sum = (t: string) => entries.filter((e) => e.type === t).reduce((a, e) => a + e.amount, 0);
    const earned = Math.round((base / 30) * (payrollRow?.workingDays ?? 30)) + sum("BONUS") - sum("SHORT");
    const received = sum("PAID");

    // Next prayer for the emirate where the driver works most today.
    const pt = prayerTimesFor(emirateInfo.emirate);
    const now = Date.now();
    const next = pt.prayers.find((p) => new Date(p.at).getTime() > now) ?? { name: "fajr", at: pt.nextFajr };

    res.json({
      month: `${year}-${String(month).padStart(2, "0")}`,
      monthDelivered,
      target: MONTH_TARGET,
      left: Math.max(0, MONTH_TARGET - monthDelivered),
      extra: Math.max(0, monthDelivered - MONTH_TARGET),
      bonusPer: EXTRA_BONUS,
      bonus: Math.max(0, monthDelivered - MONTH_TARGET) * EXTRA_BONUS,
      daysLeft: Math.max(0, daysInMonth - dayOfMonth + 1),
      salary: { month: prevMonth, earned: Math.max(0, earned), received, pending: Math.max(0, earned - received), hasSalary: base > 0 },
      nextPrayer: { name: next.name, at: next.at },
    });
  })
);

// Driver's own cancelled and pickup parcels that must come back to the office.
router.get(
  "/returns",
  asyncHandler(async (req, res) => {
    const me = req.user!.sub;
    const list = (await collectList()).filter((e) => e.order.employeeId === me);
    const pack = (t: "CANCEL" | "PICKUP") =>
      list
        .filter((e) => e.type === t)
        .sort((a, b) => Number(!!a.received) - Number(!!b.received) || b.since.getTime() - a.since.getTime())
        .slice(0, 150)
        .map((e) => ({
          cn: e.cn,
          on: new Date(e.since.getTime() + 4 * 3600 * 1000).toISOString().slice(0, 10),
          receivedAt: e.received?.firstSeenAt.toISOString() ?? null,
          vendor: e.order.vendor.name,
          customer: e.order.booking?.customerName ?? null,
          total: e.order.total,
        }));
    res.json({ cancel: pack("CANCEL"), pickup: pack("PICKUP") });
  })
);

// Targets & achievements: this month's target plus personal records and badges.
router.get(
  "/achievements",
  asyncHandler(async (req, res) => {
    const me = req.user!.sub;
    const rows: { d: string; n: number }[] = await prisma.$queryRaw<{ d: string; n: number }[]>`
      SELECT to_char("resolvedAt" + interval '4 hours', 'YYYY-MM-DD') AS d, count(*)::int AS n
      FROM orders WHERE "employeeId" = ${me} AND status = 'DELIVERED' AND "resolvedAt" IS NOT NULL
      GROUP BY 1 ORDER BY 1`;
    const today = new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10);
    const thisMonth = today.slice(0, 7);
    const lifetime = rows.reduce((a, r) => a + r.n, 0);
    const byMonth = new Map<string, number>();
    for (const r of rows) byMonth.set(r.d.slice(0, 7), (byMonth.get(r.d.slice(0, 7)) ?? 0) + r.n);
    const bestDay = rows.reduce<{ d: string; n: number } | null>((b, r) => (!b || r.n > b.n ? r : b), null);
    const monthRows = rows.filter((r) => r.d.startsWith(thisMonth));
    const bestDayMonth = monthRows.reduce<{ d: string; n: number } | null>((b, r) => (!b || r.n > b.n ? r : b), null);
    let bestMonth: { m: string; n: number } | null = null;
    for (const [m, n] of byMonth) if (!bestMonth || n > bestMonth.n) bestMonth = { m, n };
    const todayN = rows.find((r) => r.d === today)?.n ?? 0;
    // Days in a row (ending today or yesterday) with 20+ deliveries.
    const set = new Map<string, number>(rows.map((r) => [r.d, r.n]));
    let streak = 0;
    const cur = new Date(today + "T00:00:00Z");
    if ((set.get(today) ?? 0) < 20) cur.setUTCDate(cur.getUTCDate() - 1);
    while ((set.get(cur.toISOString().slice(0, 10)) ?? 0) >= 20) {
      streak++;
      cur.setUTCDate(cur.getUTCDate() - 1);
    }
    const days30 = monthRows.filter((r) => r.n >= 30).length;
    const monthDelivered = byMonth.get(thisMonth) ?? 0;
    const badges = [
      { key: "d20", label: "20 in a day", got: (bestDay?.n ?? 0) >= 20 },
      { key: "d30", label: "30 in a day", got: (bestDay?.n ?? 0) >= 30 },
      { key: "d40", label: "40 in a day", got: (bestDay?.n ?? 0) >= 40 },
      { key: "d50", label: "50 in a day", got: (bestDay?.n ?? 0) >= 50 },
      { key: "m350", label: "Half target", got: monthDelivered >= MONTH_TARGET / 2 },
      { key: "m700", label: "Target hit", got: monthDelivered >= MONTH_TARGET },
      { key: "l1000", label: "1,000 delivered", got: lifetime >= 1000 },
      { key: "l5000", label: "5,000 delivered", got: lifetime >= 5000 },
      { key: "s5", label: "5-day streak", got: streak >= 5 },
    ];
    res.json({
      today: todayN,
      month: thisMonth,
      monthDelivered,
      target: MONTH_TARGET,
      bonusPer: EXTRA_BONUS,
      bonus: Math.max(0, monthDelivered - MONTH_TARGET) * EXTRA_BONUS,
      lifetime,
      bestDay,
      bestDayMonth,
      bestMonth,
      streak,
      days30,
      daysWorkedMonth: monthRows.length,
      badges,
    });
  })
);

export default router;
