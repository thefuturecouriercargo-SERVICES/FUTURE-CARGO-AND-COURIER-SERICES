import { Router } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";
import { monthRange, formatDate } from "../utils/dates";

/**
 * Month-end TEAM report: consignment movement only — no money figures at all
 * (it is shared with the whole team). Everything in the main report counts
 * OUR drivers only: the month vs. the month before, RTO, daily movement,
 * vendors, drivers (with last month's numbers for "most improved"), areas and
 * emirates. Parcels handed to an agent are reported separately under `agent`
 * (shown on the last page). Same counting rules as the Monthly dashboard
 * (orders by entry date, one row per CN).
 *
 * Areas are worked out on the page (the area list lives in the frontend), so the
 * response carries a compact [area, address, emirate, status] row per order.
 */
const router = Router();
router.use(authenticate, requireRole("SUPER_ADMIN", "MANAGER"));

type Row = {
  cnNo: number;
  status: string;
  date: Date;
  createdAt: Date;
  area: string | null;
  custAddress: string | null;
  emirate: string;
  vendor: { name: string };
  employee: { id: string; name: string; isAgent: boolean };
  booking: { address: string; emirate: string } | null;
};

async function monthOrders(monthStr: string) {
  const { start, end } = monthRange(monthStr);
  const raw: Row[] = await prisma.order.findMany({
    where: { date: { gte: start, lte: end } },
    select: {
      cnNo: true,
      status: true,
      date: true,
      createdAt: true,
      area: true,
      custAddress: true,
      emirate: true,
      vendor: { select: { name: true } },
      employee: { select: { id: true, name: true, isAgent: true } },
      booking: { select: { address: true, emirate: true } },
    },
  });
  const seen = new Set<number>();
  return raw
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .filter((o) => (seen.has(o.cnNo) ? false : (seen.add(o.cnNo), true)));
}

function stats(orders: Row[]) {
  const delivered = orders.filter((o) => o.status === "DELIVERED").length;
  const cancelled = orders.filter((o) => o.status === "CANCELLED").length;
  const finished = delivered + cancelled;
  return {
    orders: orders.length,
    delivered,
    cancelled,
    pending: orders.length - finished,
    // RTO % of finished parcels (pending ones haven't had their chance yet).
    rtoPct: finished ? Math.round((cancelled / finished) * 1000) / 10 : 0,
  };
}

function groupBy(orders: Row[], key: (o: Row) => string) {
  const m = new Map<string, Row[]>();
  for (const o of orders) {
    const k = key(o);
    const list = m.get(k);
    if (list) list.push(o);
    else m.set(k, [o]);
  }
  return m;
}

function driverStats(own: Row[]) {
  return [...groupBy(own, (o) => o.employee.name).entries()]
    .map(([name, list]) => ({ name, days: new Set(list.map((o) => formatDate(o.date))).size, ...stats(list) }))
    .sort((a, b) => b.delivered - a.delivered);
}

async function summary(monthStr: string) {
  const all = await monthOrders(monthStr);
  const own = all.filter((o) => !o.employee.isAgent);
  const agent = all.filter((o) => o.employee.isAgent);
  return {
    all,
    own,
    agent,
    summary: {
      ...stats(own),
      agentOrders: agent.length,
      agentDelivered: agent.filter((o) => o.status === "DELIVERED").length,
      agentCancelled: agent.filter((o) => o.status === "CANCELLED").length,
      vendorCount: new Set(own.map((o) => o.vendor.name)).size,
      activeDays: new Set(own.map((o) => formatDate(o.date))).size,
    },
  };
}

function prevMonth(monthStr: string) {
  const [y, m] = monthStr.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { year, month } = monthRange(req.query.month as string | undefined);
    const label = `${year}-${String(month).padStart(2, "0")}`;
    const [cur, prev] = await Promise.all([summary(label), summary(prevMonth(label))]);

    const byName = (list: Row[], key: (o: Row) => string) =>
      [...groupBy(list, key).entries()].map(([name, rows]) => ({ name, ...stats(rows) })).sort((a, b) => b.orders - a.orders);
    const emirateOf = (o: Row) => (o.booking?.emirate || o.emirate || "OTHER").toUpperCase();

    // Our drivers only — agent parcels are reported separately below.
    const vendors = byName(cur.own, (o) => o.vendor.name);
    const days = [...groupBy(cur.own, (o) => formatDate(o.date)).entries()]
      .map(([date, list]) => ({ date, ...stats(list) }))
      .sort((a, b) => a.date.localeCompare(b.date));

    res.json({
      month: label,
      prevMonth: prevMonth(label),
      current: cur.summary,
      previous: prev.summary,
      vendors,
      drivers: driverStats(cur.own),
      prevDrivers: driverStats(prev.own).map(({ name, delivered, rtoPct }) => ({ name, delivered, rtoPct })),
      days,
      emirates: byName(cur.own, emirateOf),
      // [chosen area, address, emirate, status initial] — our drivers only
      areaRows: cur.own.map((o) => [o.area ?? "", o.booking?.address ?? o.custAddress ?? "", o.booking?.emirate ?? o.emirate, o.status[0]]),
      // Parcels handed to agents — shown separately on the last page.
      agent: {
        current: stats(cur.agent),
        previous: stats(prev.agent),
        agents: byName(cur.agent, (o) => o.employee.name),
        vendors: byName(cur.agent, (o) => o.vendor.name),
        emirates: byName(cur.agent, emirateOf),
      },
    });
  })
);

export default router;
