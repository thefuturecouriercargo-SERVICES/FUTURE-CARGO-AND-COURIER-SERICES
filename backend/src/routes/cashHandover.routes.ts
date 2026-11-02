import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler, ApiError } from "../utils/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";
import { parseDateParam, formatDate } from "../utils/dates";
import { writeAuditLog } from "../services/audit.service";

/**
 * Driver cash handover (evening).
 *
 *   Collected = cash COD of parcels the driver marked Delivered that Dubai day
 *               (by delivery time, not entry date — that's when the cash is in hand)
 *   Spent     = that day's purchases paid from the driver's cash + admin-entered
 *               expenses for the driver (same deductions as the driver's day closing)
 *   Expected  = Collected − Spent
 *   Received  = what the office actually got (typed in by admin)
 *
 * Any difference carries forward: "Previous balance" is the sum of
 * (expected − received) over every earlier saved handover. A shortage shows as a
 * positive balance (driver owes), extra cash as negative.
 */
const router = Router();
router.use(authenticate, requireRole("SUPER_ADMIN", "MANAGER"));

const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MISSING_LOOKBACK_DAYS = 14;

/** UTC instants for 00:00 → 24:00 Dubai time on the given calendar date. */
function dubaiDayBounds(date: Date) {
  const from = new Date(date.getTime() - DUBAI_OFFSET_MS);
  return { from, to: new Date(from.getTime() + DAY_MS) };
}

function dubaiDayOf(ts: Date) {
  return new Date(ts.getTime() + DUBAI_OFFSET_MS).toISOString().slice(0, 10);
}

type DayFigures = { collected: number; spent: number; expected: number; cashParcels: number; bankParcels: number };

/** Live figures for a set of drivers on one day. */
async function figuresFor(driverIds: string[], date: Date): Promise<Map<string, DayFigures>> {
  const { from, to } = dubaiDayBounds(date);
  const [orders, purchases, expenses] = await Promise.all([
    prisma.order.findMany({
      where: { employeeId: { in: driverIds }, status: "DELIVERED", resolvedAt: { gte: from, lt: to } },
      select: { employeeId: true, total: true, payment: true },
    }),
    prisma.purchase.findMany({ where: { employeeId: { in: driverIds }, date }, select: { employeeId: true, amount: true } }),
    prisma.expenseEntry.findMany({
      where: { employeeId: { in: driverIds }, date, source: "ADMIN" },
      select: { employeeId: true, amount: true },
    }),
  ]);

  const out = new Map<string, DayFigures>();
  for (const id of driverIds) out.set(id, { collected: 0, spent: 0, expected: 0, cashParcels: 0, bankParcels: 0 });
  for (const o of orders) {
    const f = out.get(o.employeeId)!;
    if (o.payment === "CASH") {
      f.collected += o.total;
      f.cashParcels++;
    } else f.bankParcels++;
  }
  for (const p of purchases) out.get(p.employeeId)!.spent += p.amount;
  for (const e of expenses) if (e.employeeId) out.get(e.employeeId)!.spent += e.amount;
  for (const f of out.values()) f.expected = f.collected - f.spent;
  return out;
}

async function activeDrivers() {
  return prisma.user.findMany({
    where: { role: "DRIVER", isAgent: false, active: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const date = parseDateParam(req.query.date as string | undefined);
    const drivers = await activeDrivers();
    const ids = drivers.map((d) => d.id);

    const lookFrom = new Date(date.getTime() - MISSING_LOOKBACK_DAYS * DAY_MS);
    const [live, saved, earlier, recentCash] = await Promise.all([
      figuresFor(ids, date),
      prisma.cashHandover.findMany({ where: { employeeId: { in: ids }, date } }),
      prisma.cashHandover.groupBy({
        by: ["employeeId"],
        where: { employeeId: { in: ids }, date: { lt: date } },
        _sum: { expected: true, received: true },
      }),
      // Days in the last two weeks where a driver delivered cash parcels…
      prisma.order.findMany({
        where: {
          employeeId: { in: ids },
          status: "DELIVERED",
          payment: "CASH",
          resolvedAt: { gte: dubaiDayBounds(lookFrom).from, lt: dubaiDayBounds(date).from },
        },
        select: { employeeId: true, resolvedAt: true },
      }),
    ]);
    // …but no handover was saved for that day.
    const savedDays = await prisma.cashHandover.findMany({
      where: { employeeId: { in: ids }, date: { gte: lookFrom, lt: date } },
      select: { employeeId: true, date: true },
    });
    const savedKey = new Set(savedDays.map((s) => `${s.employeeId}|${formatDate(s.date)}`));
    const missing = new Map<string, Set<string>>();
    for (const o of recentCash) {
      const day = dubaiDayOf(o.resolvedAt!);
      if (savedKey.has(`${o.employeeId}|${day}`)) continue;
      if (!missing.has(o.employeeId)) missing.set(o.employeeId, new Set());
      missing.get(o.employeeId)!.add(day);
    }

    const savedBy = new Map(saved.map((s) => [s.employeeId, s]));
    const prevBy = new Map(earlier.map((e) => [e.employeeId, (e._sum.expected ?? 0) - (e._sum.received ?? 0)]));

    const rows = drivers.map((d) => {
      const f = live.get(d.id)!;
      const h = savedBy.get(d.id);
      const prevBalance = prevBy.get(d.id) ?? 0;
      return {
        driver: d,
        ...f,
        prevBalance,
        totalDue: prevBalance + f.expected,
        handover: h
          ? {
              id: h.id,
              received: h.received,
              expected: h.expected,
              note: h.note,
              byName: h.byName,
              updatedAt: h.updatedAt,
              // The day's figures moved after saving (e.g. a late "Delivered") — save again.
              stale: h.expected !== f.expected,
            }
          : null,
        balanceAfter: h ? prevBalance + h.expected - h.received : null,
        missingDays: [...(missing.get(d.id) ?? [])].sort().reverse(),
      };
    });

    const sum = (fn: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + fn(r), 0);
    res.json({
      date: formatDate(date),
      rows,
      totals: {
        collected: sum((r) => r.collected),
        spent: sum((r) => r.spent),
        expected: sum((r) => r.expected),
        received: sum((r) => r.handover?.received ?? 0),
        outstanding: sum((r) => r.balanceAfter ?? r.totalDue),
      },
    });
  })
);

const saveSchema = z.object({
  employeeId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  received: z.number().int().min(0).max(10_000_000),
  note: z.string().max(300).optional().nullable(),
});

router.put(
  "/",
  asyncHandler(async (req, res) => {
    const data = saveSchema.parse(req.body);
    const date = parseDateParam(data.date);
    const driver = await prisma.user.findUnique({ where: { id: data.employeeId }, select: { id: true, name: true, role: true, isAgent: true } });
    if (!driver || driver.role !== "DRIVER" || driver.isAgent) throw new ApiError(400, "Not one of our drivers");

    const f = (await figuresFor([driver.id], date)).get(driver.id)!;
    const note = data.note?.trim() || null;
    const h = await prisma.cashHandover.upsert({
      where: { employeeId_date: { employeeId: driver.id, date } },
      create: {
        employeeId: driver.id,
        date,
        collected: f.collected,
        spent: f.spent,
        expected: f.expected,
        received: data.received,
        note,
        byUserId: req.user!.sub,
        byName: req.user!.name,
      },
      update: {
        collected: f.collected,
        spent: f.spent,
        expected: f.expected,
        received: data.received,
        note,
        byUserId: req.user!.sub,
        byName: req.user!.name,
      },
    });

    await writeAuditLog({
      userId: req.user!.sub,
      action: "CASH_HANDOVER_SAVE",
      entity: "CashHandover",
      entityId: h.id,
      meta: { driver: driver.name, date: data.date, expected: f.expected, received: data.received, diff: f.expected - data.received },
    });
    res.json(h);
  })
);

router.delete(
  "/:id",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const h = await prisma.cashHandover.findUnique({ where: { id: req.params.id }, include: { employee: { select: { name: true } } } });
    if (!h) throw new ApiError(404, "Handover not found");
    await prisma.cashHandover.delete({ where: { id: h.id } });
    await writeAuditLog({
      userId: req.user!.sub,
      action: "CASH_HANDOVER_DELETE",
      entity: "CashHandover",
      entityId: h.id,
      meta: { driver: h.employee.name, date: formatDate(h.date), expected: h.expected, received: h.received },
    });
    res.status(204).end();
  })
);

/** One driver's saved handovers, oldest → newest, with the running balance. */
router.get(
  "/history/:employeeId",
  asyncHandler(async (req, res) => {
    const list = await prisma.cashHandover.findMany({
      where: { employeeId: req.params.employeeId },
      orderBy: { date: "asc" },
    });
    let balance = 0;
    const rows = list.map((h) => {
      balance += h.expected - h.received;
      return {
        id: h.id,
        date: formatDate(h.date),
        collected: h.collected,
        spent: h.spent,
        expected: h.expected,
        received: h.received,
        diff: h.expected - h.received,
        balance,
        note: h.note,
        byName: h.byName,
      };
    });
    res.json({ rows: rows.reverse(), balance });
  })
);

export default router;
