import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler, ApiError } from "../utils/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";
import { parseDateParam, formatDate } from "../utils/dates";
import { writeAuditLog } from "../services/audit.service";
import { emitGlobal } from "../lib/socket";

/**
 * Vendor Credit (New) — trial ledger, separate from the old Vendor Credit page.
 *
 * Counts only from the trial start date (default 1 Nov 2026). Balance > 0 = we owe
 * the vendor; balance < 0 = the vendor owes us.
 *
 * AFTER_DELIVERY vendor (we pay after the customer pays):
 *   + every parcel DELIVERED on/after the start date: COD − delivery charge
 *     (a prepaid parcel, COD 0, gives − delivery charge: the vendor owes us the fee)
 *   Pending parcels are shown as "coming" — not owed yet.
 *
 * ADVANCE vendor (we pay when we take the parcel):
 *   + every parcel entered (Daily Entry date) on/after the start date: COD − delivery charge
 *   − if one of those parcels is later CANCELLED it drops out again,
 *     so money already paid for it shows as the vendor owing us back.
 *
 * Then for both:
 *   − payments to the vendor (Vendor Credit payments + driver purchases tagged to the vendor)
 *   + RECEIPT (vendor paid us back) + OPENING / ADJUSTMENT (signed)
 */
const router = Router();
router.use(authenticate, requireRole("SUPER_ADMIN", "MANAGER"));

const DUBAI_MS = 4 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_START = "2026-11-01";
const MODES = ["AFTER_DELIVERY", "ADVANCE"] as const;
type Mode = (typeof MODES)[number];

async function getStart(): Promise<Date> {
  const row = await prisma.vendorCreditTrial.findUnique({ where: { id: 1 } });
  return row?.startDate ?? parseDateParam(DEFAULT_START);
}

/** Dubai calendar day "YYYY-MM-DD" of a timestamp. */
const dubaiDay = (d: Date) => new Date(d.getTime() + DUBAI_MS).toISOString().slice(0, 10);
const todayStr = () => dubaiDay(new Date());

interface Line {
  kind: "PARCEL" | "PAYMENT" | "DRIVER_PAYMENT" | "RECEIPT" | "OPENING" | "ADJUSTMENT";
  id: string;
  day: string; // Dubai day it counts on
  amount: number; // signed effect on the balance (+ we owe more)
  cnNo?: number;
  status?: string;
  total?: number;
  deliveryCharge?: number;
  enteredOn?: string;
  deliveredOn?: string | null;
  customer?: string | null;
  note?: string | null;
  by?: string | null;
}

/** All lines of the ledger (optionally one vendor), plus pending "coming" parcels. */
async function buildLedger(start: Date, vendorId?: string) {
  const startTs = new Date(start.getTime() - DUBAI_MS); // start day 00:00 Dubai
  const vendors = await prisma.vendor.findMany({
    where: vendorId ? { id: vendorId } : {},
    select: { id: true, name: true, active: true, creditMode: true, deliveryCharge: true },
    orderBy: { name: "asc" },
  });
  const ids = vendors.map((v) => v.id);
  const after = vendors.filter((v) => v.creditMode !== "ADVANCE").map((v) => v.id);
  const advance = vendors.filter((v) => v.creditMode === "ADVANCE").map((v) => v.id);

  const orderSelect = {
    id: true,
    vendorId: true,
    cnNo: true,
    date: true,
    status: true,
    total: true,
    deliveryCharge: true,
    resolvedAt: true,
    booking: { select: { customerName: true } },
    employee: { select: { name: true } },
  } as const;

  const [delivered, advanced, pending, payments, driverPays, entries] = await Promise.all([
    after.length
      ? prisma.order.findMany({ where: { vendorId: { in: after }, status: "DELIVERED", resolvedAt: { gte: startTs } }, select: orderSelect })
      : [],
    advance.length ? prisma.order.findMany({ where: { vendorId: { in: advance }, date: { gte: start } }, select: orderSelect }) : [],
    prisma.order.findMany({
      where: {
        vendorId: { in: ids },
        status: { in: ["PENDING", "TRANSFER"] },
        // Advance vendors: only parcels counted in this trial (already payable).
        OR: [{ vendorId: { in: after } }, { vendorId: { in: advance }, date: { gte: start } }],
      },
      select: { vendorId: true, total: true, deliveryCharge: true },
    }),
    prisma.vendorPayment.findMany({ where: { vendorId: { in: ids }, date: { gte: start } } }),
    prisma.purchase.findMany({ where: { vendorId: { in: ids }, date: { gte: start } }, include: { employee: { select: { name: true } } } }),
    prisma.vendorCreditEntry.findMany({ where: { vendorId: { in: ids }, date: { gte: start } } }),
  ]);

  const lines = new Map<string, Line[]>(ids.map((id) => [id, []]));
  const push = (vid: string, l: Line) => lines.get(vid)?.push(l);

  for (const o of delivered) {
    push(o.vendorId, {
      kind: "PARCEL",
      id: o.id,
      day: dubaiDay(o.resolvedAt!),
      amount: o.total - o.deliveryCharge,
      cnNo: o.cnNo,
      status: o.status,
      total: o.total,
      deliveryCharge: o.deliveryCharge,
      enteredOn: formatDate(o.date),
      deliveredOn: dubaiDay(o.resolvedAt!),
      customer: o.booking?.customerName ?? null,
      by: o.employee?.name ?? null,
    });
  }
  for (const o of advanced) {
    push(o.vendorId, {
      kind: "PARCEL",
      id: o.id,
      day: formatDate(o.date),
      // Cancelled: drops out (0). Anything already paid for it is now owed back.
      amount: o.status === "CANCELLED" ? 0 : o.total - o.deliveryCharge,
      cnNo: o.cnNo,
      status: o.status,
      total: o.total,
      deliveryCharge: o.deliveryCharge,
      enteredOn: formatDate(o.date),
      deliveredOn: o.status === "DELIVERED" && o.resolvedAt ? dubaiDay(o.resolvedAt) : null,
      customer: o.booking?.customerName ?? null,
      by: o.employee?.name ?? null,
    });
  }
  for (const p of payments) push(p.vendorId, { kind: "PAYMENT", id: p.id, day: formatDate(p.date), amount: -p.amount, note: p.note });
  for (const p of driverPays) {
    if (p.vendorId) push(p.vendorId, { kind: "DRIVER_PAYMENT", id: p.id, day: formatDate(p.date), amount: -p.amount, note: p.note, by: p.employee?.name ?? null });
  }
  for (const e of entries) {
    const kind = (["RECEIPT", "OPENING", "ADJUSTMENT"].includes(e.type) ? e.type : "ADJUSTMENT") as Line["kind"];
    push(e.vendorId, { kind, id: e.id, day: formatDate(e.date), amount: e.amount, note: e.note });
  }

  const pendingBy = new Map<string, { count: number; payable: number }>();
  for (const o of pending) {
    const p = pendingBy.get(o.vendorId) ?? { count: 0, payable: 0 };
    p.count++;
    p.payable += o.total - o.deliveryCharge;
    pendingBy.set(o.vendorId, p);
  }
  return { vendors, lines, pendingBy };
}

function summarise(mode: Mode, lines: Line[], today: string) {
  let earned = 0,
    parcels = 0,
    cancelled = 0,
    cancelledValue = 0,
    deliveredOfAdvance = 0,
    paid = 0,
    received = 0,
    adjustments = 0,
    earnedToday = 0,
    paidToday = 0;
  let lastPayment: string | null = null;
  for (const l of lines) {
    if (l.kind === "PARCEL") {
      if (l.status === "CANCELLED") {
        cancelled++;
        cancelledValue += (l.total ?? 0) - (l.deliveryCharge ?? 0);
        continue;
      }
      parcels++;
      earned += l.amount;
      if (l.day === today) earnedToday += l.amount;
      if (mode === "ADVANCE" && l.status === "DELIVERED") deliveredOfAdvance++;
    } else if (l.kind === "PAYMENT" || l.kind === "DRIVER_PAYMENT") {
      paid += -l.amount;
      if (l.day === today) paidToday += -l.amount;
      if (!lastPayment || l.day > lastPayment) lastPayment = l.day;
    } else if (l.kind === "RECEIPT") received += l.amount;
    else adjustments += l.amount;
  }
  const balance = earned + adjustments + received - paid;
  return { parcels, earned, cancelled, cancelledValue, deliveredOfAdvance, paid, received, adjustments, balance, earnedToday, paidToday, lastPayment };
}

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const start = await getStart();
    const today = todayStr();
    const { vendors, lines, pendingBy } = await buildLedger(start);
    const rows = vendors.map((v) => {
      const mode = (v.creditMode === "ADVANCE" ? "ADVANCE" : "AFTER_DELIVERY") as Mode;
      const s = summarise(mode, lines.get(v.id) ?? [], today);
      const p = pendingBy.get(v.id) ?? { count: 0, payable: 0 };
      return {
        vendor: { id: v.id, name: v.name, active: v.active, deliveryCharge: v.deliveryCharge },
        mode,
        ...s,
        pendingCount: p.count,
        pendingPayable: p.payable,
        state: s.balance > 0 ? "DUE" : s.balance < 0 ? "VENDOR_OWES" : "SETTLED",
      };
    });
    // Hide vendors with nothing at all in the trial (inactive and empty).
    const shown = rows.filter((r) => r.vendor.active || r.parcels || r.paid || r.received || r.adjustments || r.pendingCount);
    const sum = (f: (r: (typeof rows)[number]) => number) => shown.reduce((t, r) => t + f(r), 0);
    res.json({
      startDate: formatDate(start),
      today,
      rows: shown,
      totals: {
        weOwe: sum((r) => Math.max(0, r.balance)),
        theyOwe: sum((r) => Math.max(0, -r.balance)),
        net: sum((r) => r.balance),
        earned: sum((r) => r.earned),
        paid: sum((r) => r.paid),
        received: sum((r) => r.received),
        earnedToday: sum((r) => r.earnedToday),
        paidToday: sum((r) => r.paidToday),
        pendingPayable: sum((r) => (r.mode === "AFTER_DELIVERY" ? r.pendingPayable : 0)),
        parcels: sum((r) => r.parcels),
      },
    });
  })
);

// One vendor's full ledger, oldest first, with a running balance.
router.get(
  "/:vendorId/ledger",
  asyncHandler(async (req, res) => {
    const start = await getStart();
    const { vendors, lines } = await buildLedger(start, req.params.vendorId);
    const v = vendors[0];
    if (!v) throw new ApiError(404, "Vendor not found");
    const order: Record<Line["kind"], number> = { OPENING: 0, PARCEL: 1, ADJUSTMENT: 2, RECEIPT: 3, DRIVER_PAYMENT: 4, PAYMENT: 5 };
    const list = (lines.get(v.id) ?? []).sort((a, b) => a.day.localeCompare(b.day) || order[a.kind] - order[b.kind] || (a.cnNo ?? 0) - (b.cnNo ?? 0));
    let run = 0;
    const withRun = list.map((l) => ({ ...l, balance: (run += l.amount) }));
    const mode = (v.creditMode === "ADVANCE" ? "ADVANCE" : "AFTER_DELIVERY") as Mode;
    res.json({
      vendor: { id: v.id, name: v.name },
      mode,
      startDate: formatDate(start),
      lines: withRun,
      summary: summarise(mode, list, todayStr()),
    });
  })
);

const settingsSchema = z.object({ startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

// "New start": move the trial start date (nothing is deleted).
router.put(
  "/settings",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const { startDate } = settingsSchema.parse(req.body);
    const d = parseDateParam(startDate);
    const row = await prisma.vendorCreditTrial.upsert({ where: { id: 1 }, create: { id: 1, startDate: d }, update: { startDate: d } });
    await writeAuditLog({ userId: req.user!.sub, action: "UPDATE", entity: "VendorCreditTrial", entityId: "1", meta: { startDate } });
    emitGlobal("vendorPayment:changed", { type: "trial-start" });
    res.json({ startDate: formatDate(row.startDate) });
  })
);

router.put(
  "/:vendorId/mode",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const { mode } = z.object({ mode: z.enum(MODES) }).parse(req.body);
    const v = await prisma.vendor.update({ where: { id: req.params.vendorId }, data: { creditMode: mode }, select: { id: true, name: true, creditMode: true } });
    await writeAuditLog({ userId: req.user!.sub, action: "UPDATE", entity: "Vendor", entityId: v.id, meta: { creditMode: mode } });
    emitGlobal("vendorPayment:changed", { type: "mode" });
    res.json(v);
  })
);

const moneySchema = z.object({
  type: z.enum(["PAYMENT", "RECEIPT", "OPENING", "ADJUSTMENT"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().int(),
  note: z.string().max(300).optional(),
});

// Add money: PAYMENT (we paid the vendor — saved as a normal Vendor Credit payment),
// RECEIPT (vendor paid us back), OPENING / ADJUSTMENT (+ / −).
router.post(
  "/:vendorId/money",
  asyncHandler(async (req, res) => {
    const data = moneySchema.parse(req.body);
    const vendor = await prisma.vendor.findUnique({ where: { id: req.params.vendorId }, select: { id: true } });
    if (!vendor) throw new ApiError(404, "Vendor not found");
    if (data.amount === 0) throw new ApiError(400, "Amount can't be zero");
    if ((data.type === "PAYMENT" || data.type === "RECEIPT") && data.amount < 0) throw new ApiError(400, "Payments and receipts are positive amounts");
    const date = parseDateParam(data.date);
    const start = await getStart();
    if (date < start) throw new ApiError(400, `Date is before the trial start (${formatDate(start)}) — it wouldn't count`);

    let id: string;
    if (data.type === "PAYMENT") {
      const p = await prisma.vendorPayment.create({ data: { vendorId: vendor.id, date, amount: data.amount, note: data.note } });
      id = p.id;
    } else {
      const e = await prisma.vendorCreditEntry.create({ data: { vendorId: vendor.id, date, type: data.type, amount: data.amount, note: data.note } });
      id = e.id;
    }
    await writeAuditLog({ userId: req.user!.sub, action: `VENDOR_CREDIT2_${data.type}`, entity: "Vendor", entityId: vendor.id, meta: { id, ...data } });
    emitGlobal("vendorPayment:changed", { type: "created" });
    res.status(201).json({ id });
  })
);

router.delete(
  "/money/:kind/:id",
  asyncHandler(async (req, res) => {
    const { kind, id } = req.params;
    if (kind === "PAYMENT") await prisma.vendorPayment.delete({ where: { id } });
    else if (["RECEIPT", "OPENING", "ADJUSTMENT"].includes(kind)) await prisma.vendorCreditEntry.delete({ where: { id } });
    else throw new ApiError(400, "Driver payments are removed from the driver's Purchases");
    await writeAuditLog({ userId: req.user!.sub, action: `VENDOR_CREDIT2_DELETE_${kind}`, entity: "Vendor", entityId: id });
    emitGlobal("vendorPayment:changed", { type: "deleted" });
    res.json({ deleted: true });
  })
);

export default router;
