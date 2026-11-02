import { Router } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";

/**
 * P&L → Insights & suggestions.
 * Looks at the last 6 calendar months (Dubai time) and turns the numbers into
 * trends, warnings, expense-control ideas and expert notes. Rule-based: every
 * line is worked out from the app's own data, nothing is guessed.
 *
 * Same revenue rule as the P&L page: delivery charge of DELIVERED orders,
 * agent orders excluded.
 */
const router = Router();
router.use(authenticate, requireRole("SUPER_ADMIN", "MANAGER"));

const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000;
const MONTHS_BACK = 6;
const DRAW_START = "2026-09"; // Cash in hand daily cost starts here
const DRAW_DEFAULT_RATE = 200;

type Tone = "good" | "warn" | "bad" | "info";
interface Insight {
  tone: Tone;
  title: string;
  text: string;
}

const CATEGORY_LABEL: Record<string, string> = {
  FUEL: "Fuel",
  INSURANCE: "Insurance",
  SALARY: "Salary",
  WORKSHOP: "Workshop",
  CAR_WASH: "Car wash",
  ROOM_RENT: "Room rent",
  CAR_RENT: "Car rent",
  STATIONARY: "Stationery",
  PARKING: "Parking",
  VISA: "Visa",
  MEDICAL: "Medical",
  COMMISSION: "Commission",
  OTHER: "Other",
  DARB: "Darb (Abu Dhabi toll)",
  SALIK: "Salik",
};

/** Practical ideas per expense category for a UAE last-mile courier. */
const CATEGORY_IDEAS: Record<string, string> = {
  FUEL: "Group each driver's run by area (e.g. all Deira, then all Al Qusais) instead of order of arrival, and avoid sending two drivers into the same area on the same day. Use fuel cards per vehicle so you can compare AED per delivery between drivers.",
  SALIK: "Plan routes to cross Salik gates once per run, not back and forth. Check which drivers pass gates most per delivery — the gap usually comes from route habits, not distance.",
  DARB: "Batch Abu Dhabi / Musaffah orders onto fewer trips per week and avoid peak-hour Darb charges (7–9 am, 3–7 pm) where possible.",
  PARKING: "Use loading bays and quick drop-offs; ask customers to come down for COD in towers. Track parking fines separately from paid parking so fines are visible.",
  WORKSHOP: "Move from repair-when-broken to scheduled servicing (oil, tyres, brakes) on fixed km. Get quotes from two garages for anything over 500 AED.",
  CAR_WASH: "Set a fixed wash schedule (e.g. weekly per car) or a monthly package with one wash station instead of paying per visit.",
  CAR_RENT: "Compare monthly vs yearly rental rates, and check if a car is idle on low days — one less rented car often costs less than the extra fuel of stretching routes.",
  ROOM_RENT: "Review accommodation per head; shared rooms near the office cut both rent and fuel/commute.",
  SALARY: "Pay part of driver pay per delivery above a daily base — it rewards productive days and keeps cost in line with volume.",
  COMMISSION: "Tie commission to delivered (not dispatched) orders, so returns don't cost you twice.",
  STATIONARY: "With barcode labels now, cut paper bills and print only what is scanned. A label printer pays for itself on paper and ink.",
  VISA: "Plan visa renewals ahead to avoid fines and urgent fees; spread the cost across months in the P&L.",
  MEDICAL: "Compare insurance plans at renewal; group policies for all staff are usually cheaper per head.",
  INSURANCE: "Get two renewal quotes per vehicle and check if fleet cover is cheaper than single policies.",
  OTHER: "‘Other’ hides money. Ask staff to pick a real category or write a clear note, so leaks become visible.",
};

function dubaiToday() {
  const d = new Date(Date.now() + DUBAI_OFFSET_MS);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function monthKey(y: number, m: number) {
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** Days that are not Sunday, from the 1st up to `until` (inclusive). */
function nonSundays(year: number, month: number, until: Date) {
  let n = 0;
  for (let d = new Date(Date.UTC(year, month - 1, 1)); d.getUTCMonth() === month - 1 && d <= until; d = new Date(d.getTime() + 86400000)) {
    if (d.getUTCDay() !== 0) n++;
  }
  return n;
}

const pct = (part: number, whole: number) => (whole ? (part / whole) * 100 : 0);
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const fmt1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString("en-US");

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const today = dubaiToday();

    // Last N months, oldest first.
    const keys: { key: string; y: number; m: number; start: Date; end: Date; isCurrent: boolean }[] = [];
    for (let i = MONTHS_BACK - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth() + 1;
      keys.push({
        key: monthKey(y, m),
        y,
        m,
        start: d,
        end: new Date(Date.UTC(y, m, 0)),
        isCurrent: i === 0,
      });
    }

    const drawRows = await prisma.cashInHandMonth.findMany({ where: { month: { in: keys.map((k) => k.key) } } });
    const drawBy = new Map(drawRows.map((r) => [r.month, r]));

    const months = await Promise.all(
      keys.map(async (k) => {
        const range = { gte: k.start, lte: k.end };
        const own = { employee: { isAgent: false } };
        const [statusGroups, revenueAgg, expenseGroups, activeDayGroups, driverGroups] = await Promise.all([
          prisma.order.groupBy({ by: ["status"], where: { date: range, ...own }, _count: { _all: true } }),
          prisma.order.aggregate({ where: { date: range, status: "DELIVERED", ...own }, _sum: { deliveryCharge: true } }),
          prisma.expenseEntry.groupBy({ by: ["category"], where: { date: range }, _sum: { amount: true } }),
          prisma.order.groupBy({ by: ["date"], where: { date: range, status: "DELIVERED", ...own } }),
          prisma.order.groupBy({ by: ["employeeId"], where: { date: range, status: "DELIVERED", ...own } }),
        ]);
        const count = (s: string) => statusGroups.find((g) => g.status === s)?._count._all ?? 0;
        const delivered = count("DELIVERED");
        const cancelled = count("CANCELLED");
        const pending = count("PENDING") + count("TRANSFER");
        const revenue = revenueAgg._sum.deliveryCharge ?? 0;
        const byCategory: Record<string, number> = {};
        for (const g of expenseGroups) byCategory[g.category] = g._sum.amount ?? 0;
        const expenses = Object.values(byCategory).reduce((t, v) => t + v, 0);

        const workingDaysSoFar = nonSundays(k.y, k.m, k.isCurrent ? today : k.end);
        const workingDaysFull = nonSundays(k.y, k.m, k.end);

        // Owner's daily cost (Cash in hand), same rule as that panel.
        let draw = 0;
        if (k.key >= DRAW_START) {
          const s = drawBy.get(k.key);
          const days = s?.workingDays ?? workingDaysSoFar;
          draw = s?.costOverride ?? days * (s?.dailyRate ?? DRAW_DEFAULT_RATE);
        }

        return {
          month: k.key,
          isCurrent: k.isCurrent,
          revenue,
          expenses,
          profit: revenue - expenses,
          draw,
          delivered,
          cancelled,
          pending,
          activeDays: activeDayGroups.length,
          drivers: driverGroups.length,
          workingDaysSoFar,
          workingDaysFull,
          byCategory,
        };
      })
    );

    // Drop leading months with no activity at all (before the app was in use).
    while (months.length > 1 && months[0].revenue === 0 && months[0].expenses === 0 && months[0].delivered === 0) months.shift();

    const current = months[months.length - 1];
    const fullMonths = months.filter((m) => !m.isCurrent);
    const last = fullMonths[fullMonths.length - 1];
    const prev = fullMonths[fullMonths.length - 2];

    // Vendor share of revenue over the last 90 days.
    const ninetyAgo = new Date(today.getTime() - 89 * 86400000);
    const vendorGroups = await prisma.order.groupBy({
      by: ["vendorId"],
      where: { date: { gte: ninetyAgo, lte: today }, status: "DELIVERED", employee: { isAgent: false } },
      _sum: { deliveryCharge: true },
      _count: { _all: true },
    });
    const vendorNames = await prisma.vendor.findMany({ where: { id: { in: vendorGroups.map((v) => v.vendorId) } }, select: { id: true, name: true } });
    const nameOf = new Map(vendorNames.map((v) => [v.id, v.name]));
    const vendorTotal = vendorGroups.reduce((t, v) => t + (v._sum.deliveryCharge ?? 0), 0);
    const topVendors = vendorGroups
      .map((v) => ({ name: nameOf.get(v.vendorId) ?? "—", revenue: v._sum.deliveryCharge ?? 0, delivered: v._count._all }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5)
      .map((v) => ({ ...v, share: pct(v.revenue, vendorTotal) }));

    // ---------- KPIs (last full month if there is one, else current) ----------
    const base = last ?? current;
    const avgCharge = base.delivered ? base.revenue / base.delivered : 0;
    const costPerDelivery = base.delivered ? base.expenses / base.delivered : 0;
    const margin = pct(base.profit, base.revenue);
    const cancelRate = pct(base.cancelled, base.delivered + base.cancelled);
    const perDriverDay = base.drivers && base.activeDays ? base.delivered / (base.drivers * base.activeDays) : 0;
    const breakEvenPerDay = avgCharge && base.workingDaysFull ? (base.expenses + base.draw) / avgCharge / base.workingDaysFull : 0;
    const actualPerDay = base.workingDaysFull ? base.delivered / base.workingDaysFull : 0;

    // Current month run-rate projection.
    const runFactor = current.workingDaysSoFar ? current.workingDaysFull / current.workingDaysSoFar : 0;
    const projection = {
      revenue: Math.round(current.revenue * runFactor),
      expenses: Math.round(current.expenses * runFactor),
      profit: Math.round((current.revenue - current.expenses) * runFactor),
      daysSoFar: current.workingDaysSoFar,
      daysFull: current.workingDaysFull,
    };

    const trends: Insight[] = [];
    const suggestions: Insight[] = [];
    const expenseIdeas: Insight[] = [];
    const expert: Insight[] = [];

    // ---------- Trends ----------
    if (last && prev) {
      const ch = (a: number, b: number) => (b ? ((a - b) / Math.abs(b)) * 100 : null);
      const rev = ch(last.revenue, prev.revenue);
      const exp = ch(last.expenses, prev.expenses);
      const del = ch(last.delivered, prev.delivered);
      if (rev !== null)
        trends.push({
          tone: rev >= 0 ? "good" : "bad",
          title: `Revenue ${rev >= 0 ? "up" : "down"} ${fmt1(Math.abs(rev))}%`,
          text: `${last.month}: ${fmt(last.revenue)} AED vs ${fmt(prev.revenue)} AED the month before (${fmt(last.delivered)} vs ${fmt(prev.delivered)} deliveries${del !== null ? `, ${del >= 0 ? "+" : ""}${fmt1(del)}%` : ""}).`,
        });
      if (exp !== null)
        trends.push({
          tone: exp <= 0 ? "good" : rev !== null && exp > rev ? "bad" : "warn",
          title: `Expenses ${exp >= 0 ? "up" : "down"} ${fmt1(Math.abs(exp))}%`,
          text:
            rev !== null && exp > rev
              ? `Costs grew faster than revenue (${fmt1(exp)}% vs ${fmt1(rev)}%). That squeezes profit even when volume rises.`
              : `${fmt(last.expenses)} AED vs ${fmt(prev.expenses)} AED.`,
        });
    }
    if (fullMonths.length >= 3) {
      const l3 = fullMonths.slice(-3).map((m) => m.profit);
      const rising = l3[0] < l3[1] && l3[1] < l3[2];
      const falling = l3[0] > l3[1] && l3[1] > l3[2];
      if (rising || falling)
        trends.push({
          tone: rising ? "good" : "bad",
          title: `Profit ${rising ? "rising" : "falling"} 3 months in a row`,
          text: fullMonths
            .slice(-3)
            .map((m) => `${m.month}: ${fmt(m.profit)}`)
            .join(" → ") + " AED.",
        });
    }
    if (current.workingDaysSoFar >= 3) {
      trends.push({
        tone: projection.profit >= 0 ? "info" : "warn",
        title: `This month on track for ${fmt(projection.profit)} AED profit`,
        text: `At the pace of the first ${projection.daysSoFar} working days: about ${fmt(projection.revenue)} AED revenue and ${fmt(projection.expenses)} AED expenses by month end. Early-month expenses (rent, salary, visa) can make this look worse than it will end.`,
      });
    } else {
      trends.push({
        tone: "info",
        title: "Month just started",
        text: `Only ${current.workingDaysSoFar} working day(s) in. The projection appears from the 3rd working day; until then use last month as the guide.`,
      });
    }
    if (last && last.draw > 0) {
      const after = last.profit - last.draw;
      trends.push({
        tone: after >= 0 ? "good" : "bad",
        title: `After the daily cost: ${fmt(after)} AED`,
        text: `${last.month} profit ${fmt(last.profit)} AED minus ${fmt(last.draw)} AED daily cost (Cash in hand). ${after < 0 ? "The business paid this from cash, not from profit." : "Profit covered it."}`,
      });
    }

    // ---------- Suggestions ----------
    if (base.delivered > 0) {
      if (breakEvenPerDay > 0) {
        const gap = actualPerDay - breakEvenPerDay;
        suggestions.push({
          tone: gap >= 0 ? "good" : "bad",
          title: `Break-even: ${fmt1(breakEvenPerDay)} deliveries a day`,
          text: `To cover expenses${base.draw ? " and the daily cost" : ""} at ${fmt1(avgCharge)} AED per delivery you need about ${Math.ceil(breakEvenPerDay)} delivered orders per working day. You averaged ${fmt1(actualPerDay)}. ${gap >= 0 ? `That's ${fmt1(gap)} a day above break-even.` : `You need ${Math.ceil(-gap)} more a day — or lower costs — to break even.`}`,
        });
      }
      if (costPerDelivery > avgCharge) {
        suggestions.push({
          tone: "bad",
          title: "Each delivery costs more than it earns",
          text: `Cost per delivery ${fmt1(costPerDelivery)} AED vs charge ${fmt1(avgCharge)} AED. Either volume per driver has to go up, or the delivery charge for low-paying vendors has to.`,
        });
      }
      if (cancelRate >= 10) {
        suggestions.push({
          tone: cancelRate >= 20 ? "bad" : "warn",
          title: `${fmt1(cancelRate)}% of orders cancelled / returned`,
          text: "Every return costs fuel and driver time with no fee. Call or WhatsApp customers before dispatch, ask vendors to confirm COD orders, and consider a return charge for vendors with high return rates.",
        });
      } else if (base.delivered + base.cancelled > 20) {
        suggestions.push({
          tone: "good",
          title: `Low return rate (${fmt1(cancelRate)}%)`,
          text: "Keep confirming orders before dispatch — this is better than most COD couriers.",
        });
      }
      if (perDriverDay > 0) {
        suggestions.push({
          tone: perDriverDay >= 25 ? "good" : perDriverDay >= 15 ? "info" : "warn",
          title: `${fmt1(perDriverDay)} deliveries per driver per day`,
          text:
            perDriverDay < 15
              ? "Low drops per driver means the fixed costs (car, salary, rent) are spread thin. Tighter area routes or fewer drivers on slow days will help."
              : perDriverDay < 25
                ? "Reasonable. Grouping by area and dispatching in two waves (morning / afternoon) usually lifts this further."
                : "Strong productivity. Watch delivery quality and driver fatigue as volume grows.",
        });
      }
    }
    if (topVendors[0] && topVendors[0].share >= 40) {
      suggestions.push({
        tone: "warn",
        title: `${topVendors[0].name} brings ${fmt1(topVendors[0].share)}% of revenue`,
        text: "Relying on one vendor is risky — if they slow down or leave, profit drops at once. Put effort into growing 2–3 mid-sized vendors.",
      });
    }
    if (current.pending > 0 && current.delivered > 0 && pct(current.pending, current.delivered) > 25) {
      suggestions.push({
        tone: "warn",
        title: `${fmt(current.pending)} orders still pending this month`,
        text: "Pending orders are unearned revenue. Follow up the oldest first — after a few days they mostly turn into returns.",
      });
    }

    // ---------- Expense control ideas ----------
    const cats = Object.entries(base.byCategory)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]);
    for (const [cat, amount] of cats.slice(0, 5)) {
      const share = pct(amount, base.expenses);
      const prevAmt = prev && base === last ? prev.byCategory[cat] ?? 0 : 0;
      const growth = prevAmt ? ((amount - prevAmt) / prevAmt) * 100 : null;
      const perDel = base.delivered ? amount / base.delivered : 0;
      expenseIdeas.push({
        tone: growth !== null && growth > 25 ? "warn" : "info",
        title: `${CATEGORY_LABEL[cat] ?? cat}: ${fmt(amount)} AED (${fmt1(share)}%)`,
        text: `${perDel ? `${fmt1(perDel)} AED per delivery. ` : ""}${growth !== null ? `${growth >= 0 ? "Up" : "Down"} ${fmt1(Math.abs(growth))}% on the month before. ` : ""}${CATEGORY_IDEAS[cat] ?? ""}`,
      });
    }
    const otherAmt = base.byCategory.OTHER ?? 0;
    if (otherAmt > 0 && pct(otherAmt, base.expenses) > 10 && !cats.slice(0, 5).some(([c]) => c === "OTHER")) {
      expenseIdeas.push({ tone: "warn", title: `‘Other’ is ${fmt1(pct(otherAmt, base.expenses))}% of expenses`, text: CATEGORY_IDEAS.OTHER });
    }
    const vehicle = ["FUEL", "SALIK", "DARB", "PARKING", "CAR_WASH", "WORKSHOP", "CAR_RENT", "INSURANCE"].reduce((t, c) => t + (base.byCategory[c] ?? 0), 0);
    if (vehicle > 0 && base.drivers > 0) {
      expenseIdeas.push({
        tone: "info",
        title: `Vehicle running cost ${fmt(vehicle / base.drivers)} AED per driver`,
        text: `All car costs together (fuel, tolls, parking, wash, workshop, rent, insurance) were ${fmt(vehicle)} AED — ${fmt1(pct(vehicle, base.expenses))}% of expenses. Compare this per driver each month; the highest one is where to look first.`,
      });
    }

    // ---------- Expert notes ----------
    if (base.revenue > 0) {
      expert.push({
        tone: margin >= 15 ? "good" : margin >= 5 ? "info" : "bad",
        title: `Net margin ${fmt1(margin)}%`,
        text:
          margin >= 15
            ? "Healthy for last-mile delivery, where margins are usually thin. Protect it as you grow — costs tend to rise faster than volume."
            : margin >= 5
              ? "Thin but positive — normal for a growing courier. Small savings per delivery (fuel, returns) move this a lot."
              : "Below a safe level. In last-mile delivery, profit comes from density — more drops per km per driver — not just more orders.",
      });
    }
    expert.push({
      tone: "info",
      title: "Density beats volume",
      text: "Ten deliveries in one building cost far less than ten across the city. Prefer vendors whose customers cluster in your strong areas, and price far areas (Abu Dhabi, Al Ain, northern emirates) higher.",
    });
    expert.push({
      tone: "info",
      title: "Know your price floor",
      text: avgCharge
        ? `Your average charge is ${fmt1(avgCharge)} AED and cost per delivery ${fmt1(costPerDelivery)} AED. Don't quote new vendors below cost per delivery — volume at a loss only makes the loss bigger.`
        : "Work out your cost per delivery each month and never quote a vendor below it.",
    });
    expert.push({
      tone: "info",
      title: "Cash flow is not profit",
      text: "Vendors paid after delivery and COD held by drivers mean money is owed to you before it's in hand. Collect driver cash daily and settle vendor balances on a fixed weekly day.",
    });

    res.json({
      basedOn: base.month,
      kpis: {
        avgCharge,
        costPerDelivery,
        margin,
        cancelRate,
        perDriverDay,
        breakEvenPerDay,
        actualPerDay,
      },
      months: months.map(({ byCategory: _bc, ...m }) => m),
      projection,
      topVendors,
      trends,
      suggestions,
      expenseIdeas,
      expert,
    });
  })
);

export default router;
