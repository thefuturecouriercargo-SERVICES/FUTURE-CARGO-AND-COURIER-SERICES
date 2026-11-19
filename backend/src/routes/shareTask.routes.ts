import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";
import { emitGlobal } from "../lib/socket";
import { outsideAreaOf } from "../lib/deliveryCharge";

/**
 * Daily sharing reminders for admin / manager (the bell rings until each is done):
 *  - OUTSIDE_COUNTS: Inspired & Escalo outside-area counts — from 12 midnight, as
 *    soon as the day's scanned batch has any outside parcels.
 *  - AGENT_EXCEL: Excel of the CNs scanned to the agent (Ashraf) — from 12 midnight,
 *    as soon as anything was scanned to an agent that day.
 *  - DAILY_REPORT: the dashboard's WhatsApp daily report (covers 10 AM–12 midnight) —
 *    shows from 12 midnight for the day just ended, until shared or marked done.
 */
const router = Router();
router.use(authenticate);

const TASKS = ["OUTSIDE_COUNTS", "DAILY_REPORT", "AGENT_EXCEL"] as const;
type Task = (typeof TASKS)[number];


const dubaiNow = () => new Date(Date.now() + 4 * 3600 * 1000);
const dayStr = (d: Date) => d.toISOString().slice(0, 10);
function dubaiDay(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d) - 4 * 3600 * 1000);
  return { start, end: new Date(start.getTime() + 86400000) };
}
function addDay(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return dayStr(d);
}

/** Inspired/Escalo parcels of the batch scanned on `day` (added the day before) going outside. */
async function outsideCount(day: string) {
  const today = dubaiDay(day);
  const rows = await prisma.booking.findMany({
    where: {
      createdAt: { gte: new Date(today.start.getTime() - 86400000), lt: today.start },
      status: { notIn: ["REJECTED", "AWAITING_PICKUP"] },
      OR: [{ vendor: { name: { contains: "INSPIRED", mode: "insensitive" } } }, { vendor: { name: { contains: "ESCALO", mode: "insensitive" } } }],
    },
    select: { emirate: true, address: true },
  });
  return rows.filter((b) => outsideAreaOf(b.emirate, b.address)).length;
}

/** CNs scanned to an agent (e.g. Ashraf) on `day`, and the agent names. */
async function agentScans(day: string) {
  const agents = await prisma.user.findMany({ where: { isAgent: true }, select: { id: true, name: true } });
  if (!agents.length) return { count: 0, names: [] as string[] };
  const { start, end } = dubaiDay(day);
  const logs = await prisma.scanLog.findMany({
    where: { createdAt: { gte: start, lt: end }, driverId: { in: agents.map((a) => a.id) }, result: { in: ["ACCEPTED", "REASSIGNED"] } },
    select: { cnNo: true, driverName: true },
  });
  return { count: new Set(logs.map((l) => l.cnNo)).size, names: Array.from(new Set(logs.map((l) => l.driverName).filter(Boolean) as string[])) };
}

router.get(
  "/due",
  requireRole("SUPER_ADMIN", "MANAGER"),
  asyncHandler(async (_req, res) => {
    const now = dubaiNow();
    const today = dayStr(now);
    const yesterday = addDay(today, -1);
    const done = await prisma.shareTaskDone.findMany({ where: { day: { in: [today, yesterday] } } });
    const isDone = (day: string, task: Task) => done.some((d) => d.day === day && d.task === task);

    const due: { task: Task; day: string; title: string; sub: string; href: string; count?: number }[] = [];
    if (!isDone(today, "OUTSIDE_COUNTS")) {
      const n = await outsideCount(today);
      if (n > 0) due.push({ task: "OUTSIDE_COUNTS", day: today, title: "Share outside area counts", sub: `${n} Inspired / Escalo parcel${n > 1 ? "s" : ""} for outside areas`, href: "/assign", count: n });
    }
    if (!isDone(today, "AGENT_EXCEL")) {
      const a = await agentScans(today);
      if (a.count > 0)
        due.push({ task: "AGENT_EXCEL", day: today, title: `Share ${a.names.join(", ") || "agent"} scanned Excel`, sub: `${a.count} CN${a.count > 1 ? "s" : ""} scanned to the agent today`, href: "/assign", count: a.count });
    }
    if (!isDone(yesterday, "DAILY_REPORT")) due.push({ task: "DAILY_REPORT", day: yesterday, title: "Share yesterday's daily report", sub: "10 AM–12 midnight report to the employee group", href: `/dashboard?date=${yesterday}` });
    res.json({ due });
  })
);

const doneSchema = z.object({ task: z.enum(TASKS), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), auto: z.boolean().optional(), driverName: z.string().optional() });

router.post(
  "/done",
  requireRole("SUPER_ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const d = doneSchema.parse(req.body);
    // An Excel export only counts for the agent reminder when it was the agent's sheet.
    if (d.task === "AGENT_EXCEL" && d.auto) {
      const agent = await prisma.user.findFirst({ where: { isAgent: true, name: d.driverName ?? "" }, select: { id: true } });
      if (!agent) return res.json({ ok: false });
    }
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub }, select: { name: true } });
    await prisma.shareTaskDone.upsert({
      where: { day_task: { day: d.day, task: d.task } },
      create: { day: d.day, task: d.task, doneById: req.user!.sub, doneByName: me?.name ?? "", how: d.auto ? "AUTO" : "MANUAL" },
      update: {},
    });
    emitGlobal("sharetask:changed", { task: d.task, day: d.day });
    res.json({ ok: true });
  })
);

export default router;
