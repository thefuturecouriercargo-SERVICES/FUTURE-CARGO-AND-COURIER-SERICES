import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";

/**
 * One search box for the whole admin side.
 * Finds a consignment by CN no, vendor order no (website order), bill no,
 * customer name, phone, address/area, vendor name or brand — across
 * vendor-portal bookings (awaiting pickup, rejected, picked up) AND
 * plain Daily Entry orders that have no booking behind them.
 */
const router = Router();
router.use(authenticate, requireRole("SUPER_ADMIN", "MANAGER"));

const LIMIT = 60;

type Stage = "AWAITING_PICKUP" | "REJECTED" | "PENDING" | "DELIVERED" | "TRANSFER" | "CANCELLED";

export interface SearchHit {
  key: string;
  kind: "booking" | "order";
  cnNo: number;
  date: string;
  vendorName: string;
  stage: Stage;
  amount: number;
  emirate: string;
  area?: string | null;
  driver?: string | null;
  note?: string | null;
  billNo?: string | null;
  vendorRef?: string | null;
  booking?: {
    customerName: string;
    customerPhone: string;
    address: string;
    emirate: string;
    items?: string | null;
    notes?: string | null;
    vendorRef?: string | null;
    codAmount: number;
    lat?: number | null;
    lng?: number | null;
  } | null;
  matched: string[];
}

const digitsOf = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? "").trim().slice(0, 80);
    if (q.length < 2) return res.json({ results: [] });

    const lower = q.toLowerCase();
    const isNum = /^\d+$/.test(q);
    const cn = isNum && q.length <= 9 ? Number(q) : NaN;
    const digits = digitsOf(q);
    const text = { contains: q, mode: "insensitive" as const };

    // Phones are stored as typed ("050 123 4567", "+971 50…"), so compare digits only.
    // Use the last 9 digits so 0501234567 / 971501234567 / 501234567 all match.
    let phoneIds: string[] = [];
    if (digits.length >= 5 && digits.length >= q.replace(/[\s+\-()]/g, "").length) {
      const tail = digits.length > 9 ? digits.slice(-9) : digits;
      const rows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM bookings
        WHERE regexp_replace("customerPhone", '\\D', '', 'g') LIKE ${"%" + tail + "%"}
        ORDER BY "createdAt" DESC
        LIMIT 200`;
      phoneIds = rows.map((r) => r.id);
    }

    const cnFilter = Number.isSafeInteger(cn) ? [{ cnNo: cn }] : [];

    // ---- Bookings (every portal / website / photo entry, whatever its stage) ----
    const bookingWhere: Prisma.BookingWhereInput = {
      OR: [
        ...cnFilter,
        { vendorRef: text },
        { billNo: text },
        { customerName: text },
        ...(phoneIds.length ? [{ id: { in: phoneIds } }] : []),
        { address: text },
        { vendor: { name: text } },
        { order: { area: text } },
      ],
    };
    const bookings = await prisma.booking.findMany({
      where: bookingWhere,
      include: {
        vendor: { select: { name: true } },
        order: {
          select: {
            id: true,
            date: true,
            status: true,
            total: true,
            area: true,
            remarks: true,
            driverNote: true,
            emirate: true,
            employee: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: LIMIT,
    });

    // ---- Daily Entry orders with no booking (typed in by the office) ----
    const orders = await prisma.order.findMany({
      where: {
        booking: null,
        OR: [
          ...cnFilter,
          { brandName: text },
          { vendor: { name: text } },
          { remarks: text },
          { driverNote: text },
          { area: text },
        ],
      },
      include: {
        vendor: { select: { name: true } },
        employee: { select: { name: true } },
      },
      orderBy: { date: "desc" },
      take: LIMIT,
    });

    const has = (v: string | null | undefined) => !!v && v.toLowerCase().includes(lower);
    const phoneSet = new Set(phoneIds);

    const results: SearchHit[] = [
      ...bookings.map((b) => {
        const matched: string[] = [];
        if (b.cnNo === cn) matched.push("CN no");
        if (has(b.vendorRef)) matched.push("Order no");
        if (has(b.billNo)) matched.push("Bill no");
        if (has(b.customerName)) matched.push("Customer");
        if (phoneSet.has(b.id)) matched.push("Phone");
        if (has(b.address) || has(b.order?.area)) matched.push("Address");
        if (has(b.vendor.name)) matched.push("Vendor");
        const stage: Stage =
          b.status === "AWAITING_PICKUP" ? "AWAITING_PICKUP" : b.status === "REJECTED" ? "REJECTED" : (b.order?.status ?? "PENDING");
        return {
          key: `b-${b.id}`,
          kind: "booking" as const,
          cnNo: b.cnNo,
          date: (b.order?.date ?? b.createdAt).toISOString(),
          vendorName: b.vendor.name,
          stage,
          amount: b.order?.total ?? b.codAmount,
          emirate: b.order?.emirate ?? b.emirate,
          area: b.order?.area ?? null,
          driver: b.order?.employee?.name ?? null,
          note: b.status === "REJECTED" ? b.rejectReason : (b.order?.remarks ?? b.order?.driverNote ?? null),
          billNo: b.billNo,
          vendorRef: b.vendorRef,
          booking: {
            customerName: b.customerName,
            customerPhone: b.customerPhone,
            address: b.address,
            emirate: b.emirate,
            items: b.items,
            notes: b.notes,
            vendorRef: b.vendorRef,
            codAmount: b.codAmount,
            lat: b.lat,
            lng: b.lng,
          },
          matched,
        };
      }),
      ...orders.map((o) => {
        const matched: string[] = [];
        if (o.cnNo === cn) matched.push("CN no");
        if (has(o.brandName)) matched.push("Brand");
        if (has(o.vendor.name)) matched.push("Vendor");
        if (has(o.remarks) || has(o.driverNote)) matched.push("Remarks");
        if (has(o.area)) matched.push("Area");
        return {
          key: `o-${o.id}`,
          kind: "order" as const,
          cnNo: o.cnNo,
          date: o.date.toISOString(),
          vendorName: o.vendor.name,
          stage: o.status as Stage,
          amount: o.total,
          emirate: o.emirate,
          area: o.area,
          driver: o.employee?.name ?? null,
          note: o.remarks ?? o.driverNote ?? null,
          billNo: null,
          vendorRef: null,
          booking: null,
          matched,
        };
      }),
    ];

    // Exact CN hits first, then newest.
    results.sort((a, b) => {
      const ea = a.cnNo === cn ? 1 : 0;
      const eb = b.cnNo === cn ? 1 : 0;
      if (ea !== eb) return eb - ea;
      return b.date.localeCompare(a.date);
    });

    res.json({ results: results.slice(0, LIMIT) });
  })
);

export default router;
