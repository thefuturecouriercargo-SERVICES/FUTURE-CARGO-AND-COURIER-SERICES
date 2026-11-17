import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler, ApiError } from "../utils/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";
import { dayRange, monthRange } from "../utils/dates";
import { writeAuditLog } from "../services/audit.service";
import { emitGlobal, emitToUser } from "../lib/socket";
import { kmEnabled, openLog, readMeter, readReceipt, storePhoto } from "../services/km.service";

const router = Router();
router.use(authenticate);

const GAP_ALLOW = 2; // km difference allowed between last End KM and next Start KM (car parked overnight)
const MISMATCH_ALLOW = 2; // typed vs photo reading
const MAX_DAY_KM = 600; // more than this in one day = a wrong reading, never real driving
const UNUSUAL_FACTOR = 2.5; // a day this many times the driver's usual KM (and 50+ KM over it) is reported

type LogRow = {
  id: string;
  employeeId: string;
  date: Date;
  startKm: number;
  startAt: Date;
  startPhotoId: string | null;
  startReadKm: number | null;
  endKm: number | null;
  endAt: Date | null;
  endPhotoId: string | null;
  endReadKm: number | null;
  endMissed: boolean;
};

/** Flags for one log, given the previous day's log of the same driver. */
function flagsFor(log: LogRow, prev: LogRow | null): string[] {
  const f: string[] = [];
  if (log.endMissed) f.push("END KM MISSED");
  if (prev?.endKm != null && log.startKm - prev.endKm > GAP_ALLOW && !prev.endMissed) f.push(`USED WHILE PARKED ${log.startKm - prev.endKm} KM`);
  // Next morning's Start lower than last night's End — one of the two readings is wrong.
  if (prev?.endKm != null && prev.endKm - log.startKm > GAP_ALLOW) f.push(`START ${log.startKm} BELOW LAST END ${prev.endKm}`);
  if (log.endKm != null && log.endKm < log.startKm) f.push("END BELOW START");
  else if (log.endKm != null && log.endKm - log.startKm > MAX_DAY_KM) f.push(`UNUSUAL KM ${log.endKm - log.startKm}`);
  if (log.startReadKm != null && Math.abs(log.startReadKm - log.startKm) > MISMATCH_ALLOW) f.push(`START PHOTO SHOWS ${log.startReadKm}`);
  if (log.endKm != null && log.endReadKm != null && Math.abs(log.endReadKm - log.endKm) > MISMATCH_ALLOW) f.push(`END PHOTO SHOWS ${log.endReadKm}`);
  return f;
}

// =====================================================================
// Driver
// =====================================================================

async function requireKmDriver(userId: string) {
  if (!(await kmEnabled(userId))) throw new ApiError(403, "KM tracking is not on for you");
}

router.get(
  "/me",
  requireRole("DRIVER"),
  asyncHandler(async (req, res) => {
    const userId = req.user!.sub;
    const enabled = await kmEnabled(userId);
    if (!enabled) return res.json({ enabled: false });
    const { start } = dayRange();
    const [today, open, last, fuelToday] = await Promise.all([
      prisma.kmLog.findUnique({ where: { employeeId_date: { employeeId: userId, date: start } } }),
      openLog(userId),
      prisma.kmLog.findFirst({ where: { employeeId: userId }, orderBy: { date: "desc" } }),
      prisma.fuelLog.findMany({ where: { employeeId: userId, date: start }, orderBy: { createdAt: "asc" } }),
    ]);
    // Started before midnight and still open (late-night deliveries) counts as started.
    const recentOpen = open && Date.now() - open.startAt.getTime() < 20 * 60 * 60 * 1000 ? open : null;
    const started = Boolean(today) || Boolean(recentOpen);
    const lastKm = last ? (last.endKm ?? last.startKm) : null;
    res.json({
      enabled: true,
      started,
      today,
      open, // the day that needs End KM (today's, or an older forgotten one)
      unclosedOld: open && open.date.getTime() < start.getTime() && !recentOpen ? open : null,
      lastKm,
      fuelToday,
    });
  })
);

const photoSchema = z.object({ photo: z.string().min(20) });

// Read the odometer from a meter photo (saves the photo, returns what was read).
router.post(
  "/read-meter",
  requireRole("DRIVER"),
  asyncHandler(async (req, res) => {
    await requireKmDriver(req.user!.sub);
    const { photo } = photoSchema.parse(req.body);
    const p = await storePhoto(req.user!.sub, "METER", photo);
    const km = await readMeter(p.base64, p.mime);
    res.json({ photoId: p.id, km });
  })
);

const kmSchema = z.object({ km: z.coerce.number().int().positive().max(2_000_000), photoId: z.string().optional(), readKm: z.number().int().nullable().optional() });

router.post(
  "/start",
  requireRole("DRIVER"),
  asyncHandler(async (req, res) => {
    const userId = req.user!.sub;
    await requireKmDriver(userId);
    const { km, photoId, readKm } = kmSchema.parse(req.body);
    const { start } = dayRange();

    const today = await prisma.kmLog.findUnique({ where: { employeeId_date: { employeeId: userId, date: start } } });
    if (today) {
      if (today.endKm != null) throw new ApiError(409, "Today is already ended");
      // Correction of today's Start KM.
      const updated = await prisma.kmLog.update({ where: { id: today.id }, data: { startKm: km, startPhotoId: photoId ?? today.startPhotoId, startReadKm: readKm ?? today.startReadKm } });
      emitGlobal("km:changed", { employeeId: userId });
      return res.json(updated);
    }

    // A forgotten earlier day: the car was parked at the office, so its End KM = this morning's reading.
    const open = await openLog(userId);
    if (open) {
      if (km < open.startKm) throw new ApiError(400, `KM can't be lower than ${open.startKm} (start of ${open.date.toISOString().slice(0, 10)})`);
      await prisma.kmLog.update({ where: { id: open.id }, data: { endKm: km, endAt: new Date(), endMissed: true, endPhotoId: photoId, endReadKm: readKm ?? null } });
      await writeAuditLog({ userId, action: "KM_END_MISSED", entity: "KmLog", entityId: open.id, meta: { date: open.date.toISOString().slice(0, 10), endKm: km } });
    } else {
      const last = await prisma.kmLog.findFirst({ where: { employeeId: userId }, orderBy: { date: "desc" } });
      const lastKm = last ? (last.endKm ?? last.startKm) : null;
      if (lastKm != null && km < lastKm) throw new ApiError(400, `KM can't be lower than your last reading ${lastKm}`);
    }

    const log = await prisma.kmLog.create({
      data: { employeeId: userId, date: start, startKm: km, startPhotoId: photoId ?? null, startReadKm: readKm ?? null },
    });
    await writeAuditLog({ userId, action: "KM_START", entity: "KmLog", entityId: log.id, meta: { km } });
    emitGlobal("km:changed", { employeeId: userId });
    emitToUser(userId, "km:changed", {});
    res.status(201).json(log);
  })
);

router.post(
  "/end",
  requireRole("DRIVER"),
  asyncHandler(async (req, res) => {
    const userId = req.user!.sub;
    await requireKmDriver(userId);
    const { km, photoId, readKm } = kmSchema.parse(req.body);
    const open = await openLog(userId);
    if (!open) throw new ApiError(400, "No started day to end — Start KM was not entered");
    if (km < open.startKm) throw new ApiError(400, `End KM can't be lower than Start KM ${open.startKm}`);
    if (km - open.startKm > 1500) throw new ApiError(400, `${km - open.startKm} KM in one day looks wrong — check the reading`);
    const log = await prisma.kmLog.update({ where: { id: open.id }, data: { endKm: km, endAt: new Date(), endPhotoId: photoId ?? null, endReadKm: readKm ?? null } });
    await writeAuditLog({ userId, action: "KM_END", entity: "KmLog", entityId: log.id, meta: { km, total: km - open.startKm } });
    emitGlobal("km:changed", { employeeId: userId });
    res.json(log);
  })
);

router.post(
  "/read-receipt",
  requireRole("DRIVER"),
  asyncHandler(async (req, res) => {
    await requireKmDriver(req.user!.sub);
    const { photo } = photoSchema.parse(req.body);
    const p = await storePhoto(req.user!.sub, "RECEIPT", photo);
    const read = await readReceipt(p.base64, p.mime);
    res.json({ photoId: p.id, read });
  })
);

const fuelSchema = z.object({
  amount: z.coerce.number().positive().max(2000),
  litres: z.coerce.number().positive().max(300).nullable().optional(),
  pricePerLitre: z.coerce.number().positive().max(20).nullable().optional(),
  odometer: z.coerce.number().int().positive().max(2_000_000).nullable().optional(),
  station: z.string().max(60).nullable().optional(),
  receiptAt: z.string().max(20).nullable().optional(),
  photoId: z.string().nullable().optional(),
});

router.post(
  "/fuel",
  requireRole("DRIVER"),
  asyncHandler(async (req, res) => {
    const userId = req.user!.sub;
    await requireKmDriver(userId);
    const d = fuelSchema.parse(req.body);
    const { start } = dayRange();
    let litres = d.litres ?? null;
    if (!litres && d.pricePerLitre) litres = Math.round((d.amount / d.pricePerLitre) * 100) / 100;
    const fuel = await prisma.fuelLog.create({
      data: {
        employeeId: userId,
        date: start,
        amount: d.amount,
        litres,
        pricePerLitre: d.pricePerLitre ?? null,
        odometer: d.odometer ?? null,
        station: d.station?.toUpperCase() ?? null,
        receiptAt: d.receiptAt ?? null,
        photoId: d.photoId ?? null,
      },
    });
    await writeAuditLog({ userId, action: "FUEL_ADD", entity: "FuelLog", entityId: fuel.id, meta: { amount: d.amount, litres } });
    emitGlobal("km:changed", { employeeId: userId });
    res.status(201).json(fuel);
  })
);

router.delete(
  "/fuel/:id",
  requireRole("DRIVER", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const f = await prisma.fuelLog.findUnique({ where: { id: req.params.id } });
    if (!f) throw new ApiError(404, "Not found");
    if (req.user!.role === "DRIVER") {
      const { start } = dayRange();
      if (f.employeeId !== req.user!.sub || f.date.getTime() !== start.getTime()) throw new ApiError(403, "You can only remove today's fuel entries");
    }
    await prisma.fuelLog.delete({ where: { id: f.id } });
    emitGlobal("km:changed", { employeeId: f.employeeId });
    res.json({ ok: true });
  })
);

// =====================================================================
// Admin / manager
// =====================================================================

router.get(
  "/photo/:id",
  requireRole("SUPER_ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const p = await prisma.kmPhoto.findUnique({ where: { id: req.params.id } });
    if (!p) throw new ApiError(404, "Photo deleted (photos are kept for 7 days)");
    res.setHeader("Content-Type", p.mime);
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.send(Buffer.from(p.data));
  })
);

router.get(
  "/drivers",
  requireRole("SUPER_ADMIN", "MANAGER"),
  asyncHandler(async (_req, res) => {
    const drivers = await prisma.user.findMany({ where: { role: "DRIVER", active: true, isAgent: false }, select: { id: true, name: true, kmTracking: true }, orderBy: { name: "asc" } });
    res.json(drivers.map((d) => ({ ...d, kmTracking: d.kmTracking !== false })));
  })
);

router.patch(
  "/drivers/:id",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const enabled = z.object({ enabled: z.boolean() }).parse(req.body).enabled;
    const u = await prisma.user.update({ where: { id: req.params.id }, data: { kmTracking: enabled }, select: { id: true, name: true, kmTracking: true } });
    await writeAuditLog({ userId: req.user!.sub, action: "KM_TRACKING_SET", entity: "User", entityId: u.id, meta: { enabled } });
    emitToUser(u.id, "km:changed", {});
    res.json(u);
  })
);

// Admin corrects a reading.
router.patch(
  "/logs/:id",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const d = z.object({ startKm: z.coerce.number().int().positive().optional(), endKm: z.coerce.number().int().positive().nullable().optional() }).parse(req.body);
    const log = await prisma.kmLog.update({ where: { id: req.params.id }, data: { ...(d.startKm ? { startKm: d.startKm } : {}), ...(d.endKm !== undefined ? { endKm: d.endKm, endAt: d.endKm ? new Date() : null } : {}) } });
    await writeAuditLog({ userId: req.user!.sub, action: "KM_EDIT", entity: "KmLog", entityId: log.id, meta: d });
    emitGlobal("km:changed", { employeeId: log.employeeId });
    res.json(log);
  })
);

/** Month report: per driver per day KM, deliveries and fuel, plus totals and flags. */
router.get(
  "/report",
  requireRole("SUPER_ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const { start, end } = monthRange(req.query.month as string | undefined);
    const prevDay = new Date(start.getTime() - 10 * 24 * 60 * 60 * 1000); // earlier days only to check the first gap
    const [logs, fuel, delivered, users] = await Promise.all([
      prisma.kmLog.findMany({ where: { date: { gte: prevDay, lte: end } }, orderBy: [{ employeeId: "asc" }, { date: "asc" }] }),
      prisma.fuelLog.findMany({ where: { date: { gte: start, lte: end } }, orderBy: { createdAt: "asc" } }),
      prisma.order.groupBy({ by: ["employeeId", "date"], where: { date: { gte: start, lte: end }, status: "DELIVERED" }, _count: { _all: true } }),
      prisma.user.findMany({ where: { OR: [{ role: "DRIVER", active: true, isAgent: false, OR: [{ kmTracking: true }, { kmTracking: null }] }, { kmLogs: { some: { date: { gte: start, lte: end } } } }] }, select: { id: true, name: true, kmTracking: true } }),
    ]);
    const key = (id: string | null, d: Date) => `${id}|${d.toISOString().slice(0, 10)}`;
    const delMap = new Map(delivered.map((g) => [key(g.employeeId, g.date), g._count._all]));

    const drivers = users.map((u) => {
      const mine = logs.filter((l) => l.employeeId === u.id);
      const myFuel = fuel.filter((f) => f.employeeId === u.id);
      // The driver's usual day (median of normal, properly ended days) — to catch odd
      // lengths, mainly on End-missed days whose End came from next morning's Start.
      const normal = mine
        .filter((l) => l.endKm != null && !l.endMissed && l.endKm >= l.startKm && l.endKm - l.startKm <= MAX_DAY_KM)
        .map((l) => l.endKm! - l.startKm)
        .sort((a, b) => a - b);
      const usual = normal.length >= 3 ? normal[Math.floor(normal.length / 2)] : null;
      const days = mine
        .map((l, i) => ({ l, prev: i > 0 ? mine[i - 1] : null }))
        .filter(({ l }) => l.date.getTime() >= start.getTime())
        .map(({ l, prev }) => {
          const ds = l.date.toISOString().slice(0, 10);
          const km = l.endKm != null ? l.endKm - l.startKm : null;
          const deliveries = delMap.get(key(u.id, l.date)) ?? 0;
          const dayFuel = myFuel.filter((f) => f.date.getTime() === l.date.getTime());
          const gap = prev?.endKm != null && !prev.endMissed ? Math.max(0, l.startKm - prev.endKm) : 0;
          const flags = flagsFor(l, prev);
          if (km != null && km >= 0 && km <= MAX_DAY_KM && usual != null && km > usual * UNUSUAL_FACTOR && km - usual > 50) {
            flags.push(`UNUSUAL KM ${km} (USUAL ${usual})`);
          }
          // Wrong-looking readings are kept out of the month totals until corrected.
          const check = km != null && (km < 0 || km > MAX_DAY_KM || flags.some((f) => f.startsWith("UNUSUAL KM")));
          return {
            id: l.id,
            date: ds,
            startKm: l.startKm,
            endKm: l.endKm,
            km,
            gapKm: gap > GAP_ALLOW ? gap : 0,
            deliveries,
            kmPerDelivery: km != null && km >= 0 && deliveries ? Math.round((km / deliveries) * 10) / 10 : null,
            fuelAmount: dayFuel.reduce((s, f) => s + f.amount, 0),
            fuelLitres: dayFuel.reduce((s, f) => s + (f.litres ?? 0), 0),
            startAt: l.startAt,
            endAt: l.endAt,
            startPhotoId: l.startPhotoId,
            endPhotoId: l.endPhotoId,
            flags,
            check,
          };
        });
      const totalKm = days.reduce((s, d) => s + (d.check ? 0 : d.km ?? 0), 0);
      const checkDays = days.filter((d) => d.check).length;
      const gapKm = days.reduce((s, d) => s + d.gapKm, 0);
      const deliveries = days.reduce((s, d) => s + d.deliveries, 0);
      const fuelAmount = Math.round(myFuel.reduce((s, f) => s + f.amount, 0) * 100) / 100;
      const fuelLitres = Math.round(myFuel.reduce((s, f) => s + (f.litres ?? 0), 0) * 100) / 100;
      const allKm = totalKm + gapKm;
      return {
        id: u.id,
        name: u.name,
        kmTracking: u.kmTracking !== false,
        totalKm,
        gapKm,
        deliveries,
        fuelAmount,
        fuelLitres,
        kmPerLitre: fuelLitres ? Math.round((allKm / fuelLitres) * 10) / 10 : null,
        aedPerKm: allKm ? Math.round((fuelAmount / allKm) * 100) / 100 : null,
        // Only days with a good, finished KM reading — so open or wrong days don't skew it.
        kmPerDelivery: (() => {
          const del = days.filter((d) => d.km != null && !d.check).reduce((s, d) => s + d.deliveries, 0);
          return del ? Math.round((totalKm / del) * 10) / 10 : null;
        })(),
        missedEnds: days.filter((d) => d.flags.includes("END KM MISSED")).length,
        checkDays,
        days,
        fuel: myFuel.map((f) => ({ ...f, date: f.date.toISOString().slice(0, 10) })),
      };
    });
    res.json({ drivers });
  })
);

/** Recent problems for the admin bell (last 3 days). */
router.get(
  "/alerts",
  requireRole("SUPER_ADMIN", "MANAGER"),
  asyncHandler(async (_req, res) => {
    const { start } = dayRange();
    const from = new Date(start.getTime() - 4 * 24 * 60 * 60 * 1000);
    const logs = await prisma.kmLog.findMany({ where: { date: { gte: from } }, orderBy: [{ employeeId: "asc" }, { date: "asc" }], include: { employee: { select: { name: true } } } });
    const out: { name: string; date: string; flag: string }[] = [];
    logs.forEach((l, i) => {
      const prev = i > 0 && logs[i - 1].employeeId === l.employeeId ? logs[i - 1] : null;
      if (l.date.getTime() < start.getTime() - 3 * 24 * 60 * 60 * 1000) return;
      for (const f of flagsFor(l, prev)) out.push({ name: l.employee.name, date: l.date.toISOString().slice(0, 10), flag: f });
    });
    res.json({ alerts: out });
  })
);

export default router;
