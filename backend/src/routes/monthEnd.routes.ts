import { Router } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";
import { monthRange } from "../utils/dates";

/**
 * Month-end report: the month vs. the month before, with RTO %, vendors,
 * drivers and profit. Same counting rules as the Monthly dashboard (orders by
 * entry date, one row per CN, agents kept out of company figures) and the same
 * profit formula as the P&L page (delivery charges − expenses).
 *
 * Areas are worked out on the page (the area list lives in the frontend), so the
 * response carries a compact [area, address, emirate, status] row per order.
 */
const router = Router();
router.use(authenticate, requireRole("SUPER_ADMIN", "MANAGER"));

type Row = {
  cnNo: number;
  status: string;
  total: number;
  deliveryCharge: number;
  payment: string;
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
      total: true,
      deliveryCharge: true,
      payment: true,
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
  const delivered = orders.filter((o) => o.status === "DELIVERED");
  const cancelled = orders.filter((o) => o.status === "CANCELLED").length;
  const finished = delivered.length + cancelled;
  return {
    orders: orders.length,
    delivered: delivered.length,
    cancelled,
    pending: orders.length - finished,
    // RTO % of finished parcels (pending ones haven't had their chance yet).
    rtoPct: finished ? Math.round((cancelled / finished) * 1000) / 10 : 0,
    sales: delivered.reduce((s, o) => s + o.total, 0),
    dlCharge: delivered.reduce((s, o) => s + o.deliveryCharge, 0),
  };
}

async function summary(monthStr: string) {
  const { start, end } = monthRange(monthStr);
  const all = await monthOrders(monthStr);
  const own = all.filter((o) => !o.employee.isAgent);
  const agent = all.filter((o) => o.employee.isAgent);
  const expenses = await prisma.expenseEntry.aggregate({ where: { date: { gte: start, lte: end } }, _sum: { amount: true } });
  const s = stats(own);
  const exp = expenses._sum.amount ?? 0;
  return { all, own, agent, summary: { ...s, agentOrders: agent.length, agentDelivered: agent.filter((o) => o.status === "DELIVERED").length, expenses: exp, profit: s.dlCharge - exp } };
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

    // Vendors: every order they gave us (incl. ones sent with the agent), since RTO is about their customers.
    const byVendor = new Map<string, Row[]>();
    for (const o of cur.all) byVendor.set(o.vendor.name, [...(byVendor.get(o.vendor.name) ?? []), o]);
    const vendors = [...byVendor.entries()]
      .map(([name, list]) => ({ name, ...stats(list) }))
      .sort((a, b) => b.orders - a.orders);

    const byDriver = new Map<string, Row[]>();
    for (const o of cur.own) byDriver.set(o.employee.name, [...(byDriver.get(o.employee.name) ?? []), o]);
    const drivers = [...byDriver.entries()]
      .map(([name, list]) => ({ name, ...stats(list) }))
      .sort((a, b) => b.delivered - a.delivered);

    const emirates = new Map<string, Row[]>();
    for (const o of cur.all) {
      const em = (o.booking?.emirate || o.emirate || "OTHER").toUpperCase();
      emirates.set(em, [...(emirates.get(em) ?? []), o]);
    }

    res.json({
      month: label,
      prevMonth: prevMonth(label),
      current: cur.summary,
      previous: prev.summary,
      vendors,
      drivers,
      emirates: [...emirates.entries()].map(([name, list]) => ({ name, ...stats(list) })).sort((a, b) => b.orders - a.orders),
      // [chosen area, address, emirate, status initial]
      areaRows: cur.all.map((o) => [o.area ?? "", o.booking?.address ?? o.custAddress ?? "", o.booking?.emirate ?? o.emirate, o.status[0]]),
    });
  })
);

export default router;
