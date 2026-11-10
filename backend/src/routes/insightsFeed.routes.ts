import { Router } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";
import { displayDate, dubaiDateStr } from "../utils/dates";

/**
 * Comment feed for the rotating box under Employee-wise Performance.
 * Every line is worked out from the app's own data: milestones, records,
 * predictions and chances, vendors, agent report uploads, areas, cash handover,
 * and (admin only) expenses, P&L and salaries — plus some light humour.
 * GET /insights-feed → { lines: [{ text, tone }] }
 */
const router = Router();
router.use(authenticate, requireRole("SUPER_ADMIN", "MANAGER"));

type Tone = "good" | "bad" | "warn" | "info";
interface Line { text: string; tone: Tone }

const DAY = 86400000;
const DUBAI = 4 * 60 * 60 * 1000;
const TARGET = 700;
const BONUS_PER = 5;
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const first = (name: string) => name.trim().split(/\s+/)[0].toUpperCase();
const key = (d: Date) => d.toISOString().slice(0, 10);
const WEEKDAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const CAT: Record<string, string> = {
  FUEL: "FUEL", INSURANCE: "INSURANCE", SALARY: "SALARY", WORKSHOP: "WORKSHOP", CAR_WASH: "CAR WASH",
  ROOM_RENT: "ROOM RENT", CAR_RENT: "CAR RENT", STATIONARY: "STATIONERY", PARKING: "PARKING", VISA: "VISA",
  MEDICAL: "MEDICAL", COMMISSION: "COMMISSION", OTHER: "OTHER", DARB: "DARB", SALIK: "SALIK", INTERNET: "INTERNET", LICENSE: "LICENCE",
};
const OUTSIDE = ["UMM AL QUWAIN", "FUJAIRAH", "AL AIN", "RAS AL KHAIMAH", "RAK", "UAQ"];

/** Chance (0–99) of reaching a target from a straight-line projection. */
function chance(projected: number, target: number) {
  if (target <= 0) return 99;
  const r = projected / target;
  if (r >= 1.25) return 97;
  if (r <= 0.6) return 3;
  return Math.max(3, Math.min(97, Math.round(((r - 0.6) / 0.65) * 94 + 3)));
}
const pick = <T,>(arr: T[], seed: number) => arr[Math.abs(seed) % arr.length];

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const isAdmin = req.user!.role === "SUPER_ADMIN";
    const nowDubai = new Date(Date.now() + DUBAI);
    const today = new Date(Date.UTC(nowDubai.getUTCFullYear(), nowDubai.getUTCMonth(), nowDubai.getUTCDate()));
    const y = today.getUTCFullYear();
    const m = today.getUTCMonth();
    const dom = today.getUTCDate();
    const monthStart = new Date(Date.UTC(y, m, 1));
    const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const lastMonthStart = new Date(Date.UTC(y, m - 1, 1));
    const lastMonthDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const lastMonthSameDay = new Date(Date.UTC(y, m - 1, Math.min(dom, lastMonthDays)));
    const lastMonthEnd = new Date(Date.UTC(y, m, 0));
    const yearStart = new Date(Date.UTC(y, 0, 1));
    const hour = nowDubai.getUTCHours();
    const seed = Math.floor(Date.now() / (10 * 60 * 1000)); // humour changes every 10 min
    const lines: Line[] = [];
    const add = (text: string, tone: Tone = "info") => lines.push({ text: text.toUpperCase(), tone });
    const safe = async (fn: () => Promise<void>) => {
      try { await fn(); } catch (e) { console.error("insights-feed section failed", e); }
    };

    // ---------- Daily history: records, comparisons ----------
    let todayDelivered = 0;
    await safe(async () => {
      const since = new Date(today.getTime() - 400 * DAY);
      const days = await prisma.order.groupBy({ by: ["date"], where: { date: { gte: since, lte: today }, status: "DELIVERED" }, _count: { _all: true } });
      const byDay = new Map<string, number>(days.map((d) => [key(d.date), d._count._all] as [string, number]));
      todayDelivered = byDay.get(key(today)) ?? 0;
      const past = days.filter((d) => key(d.date) !== key(today));
      if (!past.length) return;
      const best = past.reduce((a, b) => (b._count._all > a._count._all ? b : a));
      const bestN = best._count._all;
      if (todayDelivered > bestN) add(`🏆 NEW RECORD DAY! ${todayDelivered} DELIVERED — BEATS ${bestN} ON ${displayDate(best.date)}`, "good");
      else if (todayDelivered > 0) add(`BEST EVER DAY: ${bestN} ON ${displayDate(best.date)} · TODAY IS ${bestN - todayDelivered} AWAY`, "info");

      const week = byDay.get(key(new Date(today.getTime() - 7 * DAY)));
      if (week !== undefined && todayDelivered > 0) {
        const d = todayDelivered - week;
        add(`LAST ${WEEKDAYS[today.getUTCDay()]}: ${week} DELIVERED · TODAY ${d >= 0 ? "+" : ""}${d}`, d >= 0 ? "good" : "warn");
      }
      const month = byDay.get(key(lastMonthSameDay));
      if (month !== undefined) add(`ON THIS DAY LAST MONTH: ${month} DELIVERED · TODAY ${todayDelivered}`, todayDelivered >= month ? "good" : "info");

      const sameWeekday = past.filter((d) => d.date.getUTCDay() === today.getUTCDay()).map((d) => d._count._all).sort((a, b) => b - a);
      if (sameWeekday.length >= 3 && todayDelivered > 0) {
        const rank = sameWeekday.filter((n) => n > todayDelivered).length + 1;
        if (rank <= 3) add(`THIS IS THE ${["", "BEST", "2ND BEST", "3RD BEST"][rank]} ${WEEKDAYS[today.getUTCDay()]} EVER SO FAR 🔥`, "good");
      }
      const avg30 = past.filter((d) => d.date.getTime() >= today.getTime() - 30 * DAY);
      if (avg30.length >= 5) {
        const avg = Math.round(avg30.reduce((s, d) => s + d._count._all, 0) / avg30.length);
        add(`30-DAY AVERAGE: ${avg} DELIVERED A DAY`, "info");
      }
      // Weekday pattern
      const byWd = new Array(7).fill(0).map(() => ({ s: 0, n: 0 }));
      for (const d of past) { const w = byWd[d.date.getUTCDay()]; w.s += d._count._all; w.n++; }
      const wdAvg = byWd.map((w, i) => ({ i, a: w.n ? w.s / w.n : 0 })).filter((w) => w.a > 0).sort((a, b) => b.a - a.a);
      if (wdAvg.length >= 3) add(`BUSIEST DAY OF THE WEEK: ${WEEKDAYS[wdAvg[0].i]} (AVG ${Math.round(wdAvg[0].a)})`, "info");
    });

    // ---------- Month & year: projections, milestones ----------
    await safe(async () => {
      const [monthD, lastSame, lastFull, yearD, allD, monthC, lastC, lastMonthD] = await Promise.all([
        prisma.order.count({ where: { date: { gte: monthStart, lte: today }, status: "DELIVERED" } }),
        prisma.order.count({ where: { date: { gte: lastMonthStart, lte: lastMonthSameDay }, status: "DELIVERED" } }),
        prisma.order.count({ where: { date: { gte: lastMonthStart, lte: lastMonthEnd }, status: "DELIVERED" } }),
        prisma.order.count({ where: { date: { gte: yearStart, lte: today }, status: "DELIVERED" } }),
        prisma.order.count({ where: { status: "DELIVERED" } }),
        prisma.order.count({ where: { date: { gte: monthStart, lte: today }, status: "CANCELLED" } }),
        prisma.order.count({ where: { date: { gte: lastMonthStart, lte: lastMonthEnd }, status: "CANCELLED" } }),
        prisma.order.count({ where: { date: { gte: lastMonthStart, lte: lastMonthEnd }, status: { in: ["DELIVERED", "CANCELLED"] } } }),
      ]);
      const projected = Math.round((monthD / Math.max(1, dom)) * daysInMonth);
      if (monthD > 0) add(`MONTH SO FAR: ${fmt(monthD)} DELIVERED · PROJECTED ${fmt(projected)} BY MONTH END`, "info");
      if (lastSame > 0) {
        const g = pct(monthD - lastSame, lastSame);
        add(`THIS MONTH IS ${g >= 0 ? "UP" : "DOWN"} ${Math.abs(g)}% VS SAME DAYS LAST MONTH`, g >= 0 ? "good" : "warn");
      }
      if (lastFull > 0 && monthD > 0) {
        const c = chance(projected, lastFull);
        add(`CHANCE OF BEATING LAST MONTH (${fmt(lastFull)}): ${c}%`, c >= 60 ? "good" : c >= 35 ? "warn" : "bad");
        if (monthD < lastFull) add(`${fmt(lastFull - monthD)} MORE TO MATCH LAST MONTH · ~${Math.ceil((lastFull - monthD) / Math.max(1, daysInMonth - dom + 1))} A DAY NEEDED`, "info");
        else add(`ALREADY BEAT LAST MONTH'S ${fmt(lastFull)} WITH ${daysInMonth - dom} DAYS TO SPARE 🎉`, "good");
      }
      const step = (n: number) => (n >= 10000 ? 5000 : n >= 2000 ? 1000 : 500);
      if (yearD > 0) {
        const s = step(yearD);
        const next = Math.ceil((yearD + 1) / s) * s;
        add(`${y}: ${fmt(yearD)} DELIVERED SO FAR · ${fmt(next - yearD)} TO THE ${fmt(next)} MILESTONE`, "info");
        if (yearD % s < todayDelivered && yearD >= s) add(`🎉 MILESTONE: ${fmt(Math.floor(yearD / s) * s)} DELIVERIES THIS YEAR REACHED TODAY!`, "good");
      }
      if (allD > 0) add(`ALL TIME: ${fmt(allD)} PARCELS DELIVERED BY THE FUTURE COURIER`, "good");
      const mAll = monthD + monthC;
      if (mAll > 20 && lastMonthD > 20) {
        const now = pct(monthC, mAll), was = pct(lastC, lastMonthD);
        add(`RTO THIS MONTH ${now}% (LAST MONTH ${was}%)`, now <= was ? "good" : "bad");
      }
    });

    // ---------- Drivers: target, bonus, lifetime, streaks ----------
    await safe(async () => {
      const drivers = await prisma.user.findMany({ where: { role: "DRIVER", active: true, isAgent: false }, select: { id: true, name: true } });
      if (!drivers.length) return;
      const ids = drivers.map((d) => d.id);
      const [month, life, week] = await Promise.all([
        prisma.order.groupBy({ by: ["employeeId"], where: { employeeId: { in: ids }, date: { gte: monthStart, lte: today }, status: "DELIVERED" }, _count: { _all: true } }),
        prisma.order.groupBy({ by: ["employeeId"], where: { employeeId: { in: ids }, status: "DELIVERED" }, _count: { _all: true } }),
        prisma.order.groupBy({ by: ["employeeId", "status"], where: { employeeId: { in: ids }, date: { gte: new Date(today.getTime() - 6 * DAY), lte: today } }, _count: { _all: true } }),
      ]);
      const mBy = new Map<string, number>(month.map((r) => [r.employeeId, r._count._all] as [string, number]));
      const lBy = new Map<string, number>(life.map((r) => [r.employeeId, r._count._all] as [string, number]));
      let bonusTotal = 0;
      const rows = drivers.map((d) => {
        const md = mBy.get(d.id) ?? 0;
        const proj = Math.round((md / Math.max(1, dom)) * daysInMonth);
        return { ...d, f: first(d.name), md, proj, life: lBy.get(d.id) ?? 0 };
      }).sort((a, b) => b.md - a.md);

      for (const r of rows) {
        if (r.md === 0) continue;
        if (r.md >= TARGET) {
          const bonus = (r.md - TARGET) * BONUS_PER;
          bonusTotal += bonus;
          add(`${r.f} HAS HIT THE ${TARGET} TARGET 🎯 · BONUS SO FAR AED ${fmt(bonus)}`, "good");
        } else {
          const c = chance(r.proj, TARGET);
          const perDay = Math.ceil((TARGET - r.md) / Math.max(1, daysInMonth - dom + 1));
          add(`${r.f}: ${r.md}/${TARGET} THIS MONTH · NEEDS ${perDay} A DAY · CHANCE ${c}%`, c >= 60 ? "good" : c >= 30 ? "warn" : "info");
          if (r.proj > TARGET) bonusTotal += (r.proj - TARGET) * BONUS_PER;
        }
      }
      if (rows[0] && rows[0].md > 0) add(`DRIVER OF THE MONTH SO FAR: ${rows[0].f} WITH ${rows[0].md} 👑`, "good");
      if (isAdmin && bonusTotal > 0) add(`PROJECTED DRIVER BONUS THIS MONTH: AED ${fmt(bonusTotal)}`, "warn");
      for (const r of rows) {
        const s = r.life >= 5000 ? 1000 : 500;
        const next = Math.ceil((r.life + 1) / s) * s;
        if (r.life > 0 && next - r.life <= 50) add(`${r.f} IS ${next - r.life} AWAY FROM ${fmt(next)} LIFETIME DELIVERIES`, "good");
      }
      const best = [...rows].sort((a, b) => b.life - a.life)[0];
      if (best && best.life > 0) add(`MOST LIFETIME DELIVERIES: ${best.f} · ${fmt(best.life)} PARCELS 🏅`, "good");

      // 7-day zero-cancel runs
      const w = new Map<string, { d: number; c: number }>();
      for (const g of week) {
        const e = w.get(g.employeeId) ?? { d: 0, c: 0 };
        if (g.status === "DELIVERED") e.d += g._count._all;
        if (g.status === "CANCELLED") e.c += g._count._all;
        w.set(g.employeeId, e);
      }
      for (const r of rows) {
        const e = w.get(r.id);
        if (e && e.d >= 40 && e.c === 0) add(`${r.f}: ${e.d} DELIVERED IN 7 DAYS WITH ZERO RTO 🔥`, "good");
      }
    });

    // ---------- Vendors ----------
    await safe(async () => {
      const [cur, prev, recent, vendors] = await Promise.all([
        prisma.order.groupBy({ by: ["vendorId", "status"], where: { date: { gte: monthStart, lte: today } }, _count: { _all: true } }),
        prisma.order.groupBy({ by: ["vendorId"], where: { date: { gte: lastMonthStart, lte: lastMonthSameDay } }, _count: { _all: true } }),
        prisma.order.groupBy({ by: ["vendorId"], where: { date: { gte: new Date(today.getTime() - 30 * DAY), lte: today } }, _max: { date: true }, _count: { _all: true } }),
        prisma.vendor.findMany({ where: { active: true }, select: { id: true, name: true } }),
      ]);
      const name = new Map(vendors.map((v) => [v.id, v.name.toUpperCase()]));
      const tot = new Map<string, { all: number; c: number }>();
      for (const g of cur) {
        const e = tot.get(g.vendorId) ?? { all: 0, c: 0 };
        e.all += g._count._all;
        if (g.status === "CANCELLED") e.c += g._count._all;
        tot.set(g.vendorId, e);
      }
      const list = [...tot.entries()].filter(([id]) => name.has(id)).map(([id, e]) => ({ id, n: name.get(id)!, ...e })).sort((a, b) => b.all - a.all);
      const grand = list.reduce((s, v) => s + v.all, 0);
      if (list[0]) add(`TOP VENDOR THIS MONTH: ${list[0].n} · ${fmt(list[0].all)} PARCELS (${pct(list[0].all, grand)}%)`, "good");
      if (list[1]) add(`VENDOR LEAGUE: 1. ${list[0].n} ${list[0].all} · 2. ${list[1].n} ${list[1].all}${list[2] ? ` · 3. ${list[2].n} ${list[2].all}` : ""}`, "info");
      if (list[0] && pct(list[0].all, grand) >= 35) add(`${list[0].n} IS ${pct(list[0].all, grand)}% OF ALL PARCELS — BIG DEPENDENCE ON ONE VENDOR`, "warn");
      const prevBy = new Map<string, number>(prev.map((p) => [p.vendorId, p._count._all] as [string, number]));
      const growth = list.filter((v) => (prevBy.get(v.id) ?? 0) >= 20).map((v) => ({ ...v, g: pct(v.all - prevBy.get(v.id)!, prevBy.get(v.id)!) })).sort((a, b) => b.g - a.g);
      if (growth[0] && growth[0].g >= 10) add(`RISING STAR ⭐ ${growth[0].n} UP ${growth[0].g}% VS LAST MONTH`, "good");
      const falling = growth[growth.length - 1];
      if (falling && falling.g <= -20) add(`${falling.n} IS DOWN ${Math.abs(falling.g)}% VS LAST MONTH — WORTH A CALL`, "warn");
      for (const p of prevBy.keys()) if (!tot.has(p) && name.has(p) && (prevBy.get(p) ?? 0) >= 20) add(`${name.get(p)} SENT ${prevBy.get(p)} PARCELS BY THIS DAY LAST MONTH, NONE THIS MONTH`, "bad");
      const rated = list.filter((v) => v.all >= 30);
      const worst = [...rated].sort((a, b) => b.c / b.all - a.c / a.all)[0];
      const bestV = [...rated].sort((a, b) => a.c / a.all - b.c / b.all)[0];
      if (worst && pct(worst.c, worst.all) >= 8) add(`HIGHEST RTO: ${worst.n} · ${pct(worst.c, worst.all)}% CANCELLED THIS MONTH`, "bad");
      if (bestV && bestV.id !== worst?.id) add(`LOWEST RTO: ${bestV.n} · ${pct(bestV.c, bestV.all)}% — MOST RELIABLE CUSTOMERS`, "good");
      const quiet = recent.filter((r) => name.has(r.vendorId) && r._count._all >= 10 && r._max.date && today.getTime() - r._max.date.getTime() >= 4 * DAY);
      if (quiet.length) add(`${quiet.length} VENDOR${quiet.length > 1 ? "S" : ""} QUIET FOR 4+ DAYS: ${quiet.slice(0, 3).map((q) => name.get(q.vendorId)).join(", ")} — CALL THEM?`, "warn");
    });

    // ---------- Agent report uploads ----------
    await safe(async () => {
      const [lastPdf, lastExcel, lastApply, agentPending] = await Promise.all([
        prisma.agentRecon.findFirst({ where: { kind: "PDF_PAID" }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true, reportDate: true } }),
        prisma.agentRecon.findFirst({ where: { kind: { in: ["EXCEL_DELIVERED", "RTO_PICKUP"] } }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
        prisma.auditLog.findFirst({ where: { action: "STATUS_UPDATE", entity: "Order", meta: { path: ["source"], equals: "AGENT_REPORT" } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
        prisma.order.findMany({ where: { status: { in: ["PENDING", "TRANSFER"] }, employee: { isAgent: true } }, select: { date: true, total: true, employee: { select: { name: true } } } }),
      ]);
      const daysSince = (d?: Date | null) => (d ? Math.floor((today.getTime() - new Date(dubaiDateStr(d)).getTime()) / DAY) : null);
      const pdfDays = daysSince(lastPdf?.updatedAt);
      const xlDays = daysSince(lastExcel?.updatedAt ?? lastApply?.createdAt);
      const agentName = agentPending[0] ? first(agentPending[0].employee.name) : "AGENT";

      if (xlDays === null && pdfDays === null) {
        if (agentPending.length) add(`NO AGENT REPORT UPLOADED YET · ${agentPending.length} PARCELS WITH THE AGENT`, "warn");
      } else {
        if (xlDays !== null) {
          if (xlDays >= 2) add(`⚠️ ${agentName}'S EXCEL REPORT NOT UPLOADED FOR ${xlDays} DAYS`, "bad");
          else if (xlDays === 0) add(`AGENT EXCEL UPLOADED TODAY ✅`, "good");
        }
        if (pdfDays !== null) {
          if (pdfDays >= 2) add(`⚠️ AGENT PAYMENT PDF MISSING FOR ${pdfDays} DAYS · CASH MAY BE PENDING`, "bad");
          else if (pdfDays === 0) add(`AGENT PAYMENT PDF UPLOADED TODAY ✅`, "good");
        }
        if (xlDays === 0 && pdfDays !== null && pdfDays > 0) add(`EXCEL UPLOADED TODAY, BUT THE PAYMENT PDF IS STILL PENDING`, "warn");
        if (pdfDays === 0 && xlDays !== null && xlDays > 0) add(`PAYMENT PDF UPLOADED, BUT THE EXCEL IS MISSING — RTO CAN'T BE CHECKED`, "warn");
        if (lastPdf?.reportDate) add(`LAST AGENT PAYMENT PDF DATED ${displayDate(lastPdf.reportDate)}`, "info");
        if ((xlDays ?? 9) >= 2 && (pdfDays ?? 9) >= 2) add(pick([
          `${agentName}'S REPORT IS PLAYING HIDE AND SEEK AGAIN 🙈`,
          `THE AGENT UPLOAD PAGE IS FEELING LONELY — ${Math.min(xlDays ?? 9, pdfDays ?? 9)} DAYS WITHOUT A VISIT 😅`,
        ], seed), "warn");
      }
      if (agentPending.length) {
        const old = agentPending.filter((o) => today.getTime() - o.date.getTime() >= 5 * DAY);
        const cod = agentPending.reduce((s, o) => s + o.total, 0);
        add(`${agentPending.length} PARCELS STILL WITH THE AGENT · COD AED ${fmt(cod)}`, "info");
        if (old.length) add(`${old.length} PARCELS WITH THE AGENT FOR 5+ DAYS WITH NO STATUS — FOLLOW UP?`, "bad");
      }
    });

    // ---------- Areas (today) ----------
    await safe(async () => {
      const g = await prisma.order.groupBy({ by: ["emirate"], where: { date: today }, _count: { _all: true } });
      const s = g.sort((a, b) => b._count._all - a._count._all);
      if (s[0] && s[0]._count._all > 0) add(`BUSIEST EMIRATE TODAY: ${s[0].emirate.replace(/_/g, " ")} · ${s[0]._count._all} PARCELS`, "info");
      const out = s.filter((r) => OUTSIDE.some((o) => r.emirate.replace(/_/g, " ").toUpperCase().includes(o))).reduce((t, r) => t + r._count._all, 0);
      if (out > 0) add(`${out} OUTSIDE-AREA PARCELS TODAY — THESE EARN THE MOST PER PARCEL`, "good");
      const pendOld = await prisma.order.count({ where: { status: "PENDING", date: { lt: new Date(today.getTime() - 2 * DAY) }, employee: { isAgent: false } } });
      if (pendOld > 0) add(`${pendOld} DRIVER PARCELS PENDING FOR 3+ DAYS — CHECK OR RETURN`, "warn");
    });

    // ---------- Cash handover ----------
    await safe(async () => {
      const hand = await prisma.cashHandover.findMany({ where: { date: { gte: new Date(today.getTime() - 30 * DAY), lte: today } }, select: { date: true, expected: true, received: true, lessAmount: true, employee: { select: { name: true } } } });
      const shortOf = (h: (typeof hand)[number]) => h.expected - h.lessAmount - h.received;
      const t = hand.filter((h) => key(h.date) === key(today));
      const shorts = t.filter((h) => shortOf(h) > 0);
      if (t.length && !shorts.length) add(`ALL ${t.length} CASH HANDOVERS TODAY MATCH — CLEAN DAY ✅`, "good");
      for (const h of shorts.slice(0, 3)) add(`${first(h.employee.name)} IS AED ${fmt(shortOf(h))} SHORT IN TODAY'S HANDOVER`, "bad");
      // Streak of days without a short
      const days = [...new Set(hand.map((h) => key(h.date)))].sort().reverse();
      let streak = 0;
      for (const d of days) {
        if (hand.some((h) => key(h.date) === d && shortOf(h) > 0)) break;
        streak++;
      }
      if (streak >= 3) add(`${streak} HANDOVER DAYS IN A ROW WITH ZERO CASH SHORT 💪`, "good");
      if (isAdmin) {
        const monthShort = hand.filter((h) => h.date >= monthStart).reduce((s, h) => s + Math.max(0, shortOf(h)), 0);
        if (monthShort > 0) add(`CASH SHORT THIS MONTH SO FAR: AED ${fmt(monthShort)}`, "warn");
      }
    });

    // ---------- Admin only: P&L, expenses, salaries ----------
    if (isAdmin) await safe(async () => {
      const own = { employee: { isAgent: false } };
      const [rev, revLast, revLastSame, revToday, exp, expLast, expLastSame, lastExp, salaryCost, payroll] = await Promise.all([
        prisma.order.aggregate({ where: { date: { gte: monthStart, lte: today }, status: "DELIVERED", ...own }, _sum: { deliveryCharge: true }, _count: { _all: true } }),
        prisma.order.aggregate({ where: { date: { gte: lastMonthStart, lte: lastMonthEnd }, status: "DELIVERED", ...own }, _sum: { deliveryCharge: true }, _count: { _all: true } }),
        prisma.order.aggregate({ where: { date: { gte: lastMonthStart, lte: lastMonthSameDay }, status: "DELIVERED", ...own }, _sum: { deliveryCharge: true } }),
        prisma.order.aggregate({ where: { date: today, status: "DELIVERED", ...own }, _sum: { deliveryCharge: true } }),
        prisma.expenseEntry.groupBy({ by: ["category"], where: { date: { gte: monthStart, lte: today } }, _sum: { amount: true } }),
        prisma.expenseEntry.groupBy({ by: ["category"], where: { date: { gte: lastMonthStart, lte: lastMonthEnd } }, _sum: { amount: true } }),
        prisma.expenseEntry.aggregate({ where: { date: { gte: lastMonthStart, lte: lastMonthSameDay } }, _sum: { amount: true } }),
        prisma.expenseEntry.findFirst({ orderBy: { date: "desc" }, select: { date: true } }),
        prisma.expenseEntry.aggregate({ where: { date: { gte: lastMonthStart, lte: lastMonthEnd }, category: "SALARY" }, _sum: { amount: true } }),
        prisma.user.aggregate({ where: { active: true, role: { in: ["DRIVER", "MANAGER"] }, isAgent: false }, _sum: { baseSalary: true } }),
      ]);
      const R = rev._sum.deliveryCharge ?? 0;
      const RL = revLast._sum.deliveryCharge ?? 0;
      const RLS = revLastSame._sum.deliveryCharge ?? 0;
      const sum = (g: { _sum: { amount: number | null } }[]) => g.reduce((s, x) => s + (x._sum.amount ?? 0), 0);
      const E = sum(exp), EL = sum(expLast), ELS = expLastSame._sum.amount ?? 0;
      const P = R - E, PL = RL - EL;
      const rToday = revToday._sum.deliveryCharge ?? 0;

      if (rToday > 0) add(`TODAY'S DELIVERY CHARGE EARNED: AED ${fmt(rToday)}`, "good");
      if (R > 0) add(`P&L THIS MONTH: AED ${fmt(R)} IN · AED ${fmt(E)} OUT · PROFIT AED ${fmt(P)}`, P >= 0 ? "good" : "bad");
      if (RLS > 0) {
        const g = pct(R - RLS, RLS);
        add(`REVENUE ${g >= 0 ? "UP" : "DOWN"} ${Math.abs(g)}% VS SAME DAYS LAST MONTH`, g >= 0 ? "good" : "warn");
      }
      const projRev = (R / Math.max(1, dom)) * daysInMonth;
      const projExp = Math.max(E, (E / Math.max(1, dom)) * daysInMonth);
      if (R > 0) add(`PROFIT IS TRENDING TO AED ${fmt(projRev - projExp)} BY MONTH END`, projRev - projExp >= PL ? "good" : "warn");
      if (PL !== 0 && R > 0) {
        const c = chance(projRev - projExp, PL);
        add(`CHANCE OF BEATING LAST MONTH'S PROFIT (AED ${fmt(PL)}): ${c}%`, c >= 60 ? "good" : c >= 35 ? "warn" : "bad");
      }
      if (rev._count._all > 0 && revLast._count._all > 0) {
        const ppp = P / rev._count._all, pppL = PL / revLast._count._all;
        add(`PROFIT PER PARCEL: AED ${ppp.toFixed(2)} (LAST MONTH AED ${pppL.toFixed(2)})`, ppp >= pppL ? "good" : "warn");
      }
      if (RL > 0) add(`LAST MONTH CLOSED WITH AED ${fmt(PL)} ${PL >= 0 ? "PROFIT" : "LOSS"}`, PL >= 0 ? "good" : "bad");
      // Break-even today
      if (rev._count._all > 0 && E > 0) {
        const avgCharge = R / rev._count._all;
        const dailyCost = EL > 0 ? EL / lastMonthDays : E / dom;
        const need = Math.ceil(dailyCost / Math.max(1, avgCharge));
        const ownToday = await prisma.order.count({ where: { date: today, status: "DELIVERED", ...own } });
        add(ownToday >= need ? `BREAK-EVEN FOR TODAY REACHED (${need} PARCELS) — EVERYTHING NOW IS PROFIT 💰` : `${need - ownToday} MORE DELIVERIES TO BREAK EVEN TODAY`, ownToday >= need ? "good" : "info");
      }
      // Expenses
      if (E > 0 && ELS > 0) {
        const g = pct(E - ELS, ELS);
        add(`EXPENSES SO FAR AED ${fmt(E)} · ${g >= 0 ? "UP" : "DOWN"} ${Math.abs(g)}% VS SAME DAYS LAST MONTH`, g <= 0 ? "good" : "warn");
      }
      const top = [...exp].sort((a, b) => (b._sum.amount ?? 0) - (a._sum.amount ?? 0))[0];
      if (top && (top._sum.amount ?? 0) > 0) add(`BIGGEST EXPENSE THIS MONTH: ${CAT[top.category] ?? top.category} · AED ${fmt(top._sum.amount ?? 0)}`, "info");
      const fuel = exp.find((x) => x.category === "FUEL")?._sum.amount ?? 0;
      const fuelL = expLast.find((x) => x.category === "FUEL")?._sum.amount ?? 0;
      if (fuel > 0 && rev._count._all > 0) add(`FUEL COST PER PARCEL: AED ${(fuel / rev._count._all).toFixed(2)}${fuelL && revLast._count._all ? ` (LAST MONTH AED ${(fuelL / revLast._count._all).toFixed(2)})` : ""}`, "info");
      if (fuel > 0 && fuelL > 0) {
        const fp = pct((fuel / dom) - (fuelL / lastMonthDays), fuelL / lastMonthDays);
        if (fp >= 10) add(`FUEL IS RUNNING ${fp}% HIGHER PER DAY THAN LAST MONTH ⛽`, "warn");
      }
      if (lastExp?.date) {
        const gap = Math.floor((today.getTime() - lastExp.date.getTime()) / DAY);
        if (gap >= 2) add(`NO EXPENSE ENTERED FOR ${gap} DAYS — ANYTHING MISSED?`, "warn");
      }
      // Salaries
      const base = payroll._sum.baseSalary ?? 0;
      if (base > 0) add(`MONTHLY BASE PAYROLL: AED ${fmt(base)} · PAID DURING NEXT MONTH`, "info");
      const sal = salaryCost._sum.amount ?? 0;
      if (sal > 0 && RL > 0) add(`SALARY WAS ${pct(sal, RL)}% OF LAST MONTH'S REVENUE`, pct(sal, RL) <= 45 ? "good" : "warn");
      if (rev._count._all > 0) add(`EVERY 10 EXTRA PARCELS A DAY ≈ AED ${fmt((R / rev._count._all) * 10 * 30)} EXTRA A MONTH`, "info");
      if (R > 0 && E > R) add(`EXPENSES ARE AHEAD OF REVENUE THIS MONTH — WATCH SPENDING`, "bad");
    });

    // ---------- Time of day & humour ----------
    const minsLeft = 24 * 60 - (nowDubai.getUTCHours() * 60 + nowDubai.getUTCMinutes());
    if (hour < 11) add(pick(["GOOD MORNING ☀️ TODAY'S PARCELS ARE WAITING — LET'S GO", "SABAH AL KHAIR — A FRESH DAY, A FRESH RACE ☀️"], seed), "info");
    else if (hour >= 21) add(`${Math.floor(minsLeft / 60)}H ${minsLeft % 60}M TO MIDNIGHT — FINISH STRONG 🏁`, "warn");
    if (today.getUTCDay() === 5) add("JUMMA MUBARAK 🕌", "good");
    const nd = new Date(Date.UTC(today.getUTCMonth() === 11 && dom > 2 ? y + 1 : y, 11, 2));
    const toNd = Math.round((nd.getTime() - today.getTime()) / DAY);
    if (toNd === 0) add("HAPPY UAE NATIONAL DAY 🇦🇪", "good");
    else if (toNd > 0 && toNd <= 30) add(`UAE NATIONAL DAY IN ${toNd} DAYS 🇦🇪 — EXPECT A BUSY WEEK`, "info");

    if (todayDelivered > 0) {
      const mins = Math.max(1, (hour - 8) * 60 + nowDubai.getUTCMinutes());
      const every = (mins / todayDelivered).toFixed(1);
      add(pick([
        `${todayDelivered} DELIVERED — THAT'S ONE EVERY ${every} MINUTES. DO THESE GUYS EVEN BLINK? 😄`,
        `THE VANS HAVE DONE MORE TRIPS TODAY THAN THE DUBAI METRO 🚇`,
        `AT THIS SPEED THE PARCELS ARRIVE BEFORE THE CUSTOMER ORDERS THEM 😂`,
        `${todayDelivered} HAPPY CUSTOMERS TODAY — AND COUNTING 📦`,
        `THE DRIVERS ARE DELIVERING FASTER THAN THE SHAWARMA SHOP ON THE CORNER 🌯`,
        `IF DELIVERIES WERE GOALS, TODAY WOULD BE A HAT-TRICK ⚽`,
      ], seed), "good");
    }
    if (isAdmin) add(pick([
      "PROFIT CHECK DONE. THE CALCULATOR HAS ASKED FOR A RAISE 🧮",
      "REMEMBER: EVERY RTO IS A FREE RIDE FOR THE PARCEL — LET'S CUT THOSE 😅",
      "THE ACCOUNTANT SMILES WHEN CASH SHORT IS ZERO. KEEP HIM SMILING 😁",
    ], seed + 1), "info");

    res.json({ lines, at: new Date().toISOString() });
  })
);

export default router;
