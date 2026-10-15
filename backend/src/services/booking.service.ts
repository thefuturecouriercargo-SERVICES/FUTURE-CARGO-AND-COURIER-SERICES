import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { ApiError } from "../utils/asyncHandler";
import { dayRange } from "../utils/dates";

/**
 * System-generated CNs live in their own range so they can never clash with
 * the hand-written bill numbers already in the system (currently < 60,000).
 * Override with CN_START in Railway if ever needed.
 */
export const CN_START = parseInt(process.env.CN_START || "900001", 10) || 900001;

/**
 * Transaction-scoped lock taken before creating any Order. Serialises order
 * creation so the "is this CN already used?" check and the insert can't race.
 * Released automatically when the transaction ends.
 */
export async function lockOrderCreation(tx: Prisma.TransactionClient) {
  await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(7340001)");
}

export const bookingInputSchema = z.object({
  // Optional — the vendor's own order/bill number, kept as a reference only.
  vendorRef: z.string().trim().max(50).optional(),
  customerName: z.string().trim().min(1, "Customer name is required").max(120),
  customerPhone: z
    .string()
    .trim()
    .min(5, "Customer phone is required")
    .max(30)
    .regex(/^[0-9+()\-\s]+$/, "Phone can only contain digits, spaces, + - ( )"),
  address: z.string().trim().min(1, "Address is required").max(500),
  emirate: z.string().trim().min(1).max(30),
  items: z.string().trim().max(500).optional(),
  codAmount: z.number().int().min(0, "COD amount can't be negative"),
  notes: z.string().trim().max(500).optional(),
  // Set after the user saw the "possible duplicate" warning and chose to save anyway.
  confirmDuplicate: z.boolean().optional(),
});
export type BookingInput = z.infer<typeof bookingInputSchema>;

/** Throws 409 if this CN is already used by any order or another booking. */
export async function assertCnFree(cnNo: number, ignoreBookingId?: string) {
  const [order, booking] = await Promise.all([
    prisma.order.findFirst({ where: { cnNo }, select: { date: true, status: true } }),
    prisma.booking.findFirst({
      where: { cnNo, ...(ignoreBookingId ? { id: { not: ignoreBookingId } } : {}) },
      select: { id: true },
    }),
  ]);
  if (order) {
    throw new ApiError(409, `CN No. ${cnNo} already exists (dated ${order.date.toISOString().slice(0, 10)}, ${order.status})`);
  }
  if (booking) throw new ApiError(409, `CN No. ${cnNo} is already booked`);
}

/** Next free number in the system range (skips anything already taken). */
async function nextSystemCn(): Promise<number> {
  const [maxBooking, maxOrder] = await Promise.all([
    prisma.booking.aggregate({ where: { cnNo: { gte: CN_START } }, _max: { cnNo: true } }),
    prisma.order.aggregate({ where: { cnNo: { gte: CN_START } }, _max: { cnNo: true } }),
  ]);
  return Math.max(CN_START - 1, maxBooking._max.cnNo ?? 0, maxOrder._max.cnNo ?? 0) + 1;
}

/** 409 if this vendor already has a booking with the same reference number. */
export async function assertRefFree(vendorId: string, vendorRef: string | undefined, ignoreBookingId?: string) {
  if (!vendorRef) return;
  const dup = await prisma.booking.findFirst({
    where: { vendorId, vendorRef, ...(ignoreBookingId ? { id: { not: ignoreBookingId } } : {}) },
    select: { cnNo: true },
  });
  if (dup) throw new ApiError(409, `Order No. ${vendorRef} is already entered (CN ${dup.cnNo})`);
}

export const phoneDigits = (p: string) => p.replace(/\D/g, "").replace(/^(?:00)?971/, "0").replace(/^(?!0)/, "0");

/**
 * The same WhatsApp order pasted twice would get two CNs. Warn (409 with
 * code POSSIBLE_DUPLICATE) when this vendor already has a non-rejected booking
 * in the last 24h with the same customer phone and the same COD amount.
 */
async function assertNotLikelyDuplicate(vendorId: string, input: BookingInput, ignoreBookingId?: string) {
  if (input.confirmDuplicate) return;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await prisma.booking.findMany({
    where: {
      vendorId,
      codAmount: input.codAmount,
      status: { not: "REJECTED" },
      createdAt: { gte: since },
      ...(ignoreBookingId ? { id: { not: ignoreBookingId } } : {}),
    },
    select: { cnNo: true, customerPhone: true, customerName: true },
  });
  const phone = phoneDigits(input.customerPhone);
  const hit = recent.find((b) => phoneDigits(b.customerPhone) === phone);
  if (hit) {
    throw new ApiError(
      409,
      `Possible duplicate: CN ${hit.cnNo} (${hit.customerName}) has the same phone and amount in the last 24 hours.`,
      { code: "POSSIBLE_DUPLICATE", cnNo: hit.cnNo }
    );
  }
}

/** Creates a booking with the next CN from our own range. Retries on a race. */
export async function createBooking(vendorId: string, input: BookingInput, createdBy: "VENDOR" | "ADMIN" | "WEBSITE") {
  await assertRefFree(vendorId, input.vendorRef || undefined);
  await assertNotLikelyDuplicate(vendorId, input);
  const base = {
    vendorId,
    vendorRef: input.vendorRef || null,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    address: input.address,
    emirate: input.emirate.toUpperCase(),
    items: input.items || null,
    codAmount: input.codAmount,
    notes: input.notes || null,
    createdBy,
  };

  for (let attempt = 0; attempt < 5; attempt++) {
    const cnNo = await nextSystemCn();
    try {
      return await prisma.booking.create({ data: { ...base, cnNo, cnSource: "SYSTEM" }, include: { vendor: true } });
    } catch (err) {
      // Unique clash: two bookings grabbed the same number at once — try the next one.
      const e = err as { code?: string; meta?: { target?: string[] | string } };
      if (e.code === "P2002" && String(e.meta?.target ?? "").includes("vendorRef")) {
        throw new ApiError(409, `Order No. ${input.vendorRef} is already entered`);
      }
      if (e.code === "P2002") continue;
      throw err;
    }
  }
  throw new ApiError(503, "Could not allocate a CN number, please try again");
}

/**
 * Turns an Awaiting Pickup booking into a normal Daily Entry order, assigned to
 * a driver. Payment starts as CASH; the driver switches it to BANK if needed.
 */
export async function acceptBooking(
  bookingId: string,
  opts: { employeeId: string; emirate?: string; date?: string }
) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: { vendor: true } });
  if (!booking) throw new ApiError(404, "Booking not found");
  if (booking.status !== "AWAITING_PICKUP") throw new ApiError(400, `Booking is already ${booking.status.toLowerCase()}`);

  const employee = await prisma.user.findUnique({ where: { id: opts.employeeId } });
  if (!employee || employee.role !== "DRIVER" || !employee.active) throw new ApiError(404, "Driver not found or inactive");

  const existingOrder = await prisma.order.findFirst({ where: { cnNo: booking.cnNo } });
  if (existingOrder) throw new ApiError(409, `CN No. ${booking.cnNo} is already in Daily Entry`);

  const { date } = dayRange(opts.date);

  return prisma.$transaction(async (tx) => {
    // One order creation at a time (shared with Daily Entry), so two people
    // scanning/accepting the same parcel at once can never create it twice.
    await lockOrderCreation(tx);

    // Re-check inside the lock: claim the booking only if it's still waiting.
    const claimed = await tx.booking.updateMany({ where: { id: booking.id, status: "AWAITING_PICKUP" }, data: { status: "ACCEPTED" } });
    if (claimed.count === 0) throw new ApiError(409, `CN No. ${booking.cnNo} was just accepted by someone else`);
    const dup = await tx.order.findFirst({ where: { cnNo: booking.cnNo }, select: { id: true } });
    if (dup) throw new ApiError(409, `CN No. ${booking.cnNo} is already in Daily Entry`);

    const lastSl = await tx.order.aggregate({ where: { date }, _max: { slNo: true } });
    const order = await tx.order.create({
      data: {
        date,
        slNo: (lastSl._max.slNo ?? 0) + 1,
        cnNo: booking.cnNo,
        vendorId: booking.vendorId,
        brandName: booking.vendor.name,
        deliveryCharge: booking.vendor.deliveryCharge,
        total: booking.codAmount,
        payment: "CASH",
        emirate: (opts.emirate || booking.emirate).toUpperCase(),
        employeeId: employee.id,
        status: "PENDING",
      },
      include: { vendor: true, employee: { select: { id: true, name: true } } },
    });
    await tx.booking.update({ where: { id: booking.id }, data: { orderId: order.id } });
    return order;
  });
}

// ---------------------------------------------------------------------------
// Scan to assign
// ---------------------------------------------------------------------------

export type ScanAssignResult = {
  result: "ACCEPTED" | "REASSIGNED" | "ALREADY";
  message: string;
  order: Awaited<ReturnType<typeof prisma.order.findFirstOrThrow>> & {
    vendor: { name: string };
    employee: { id: string; name: string };
  };
  previousEmployeeId?: string;
};

/**
 * What a scanned CN does when assigned to a driver:
 *  - vendor booking still Awaiting Pickup → accepted into Daily Entry for this driver
 *  - order already this driver's            → nothing (ALREADY)
 *  - open order of another driver           → moved to this driver (office only)
 *  - delivered / cancelled / unknown        → refused with a clear message
 */
export async function assignByScan(
  code: string,
  employeeId: string,
  // allowWebFetch: only the office Scan & Assign may look a number up on a
  // vendor's website. Drivers scan every vendor's barcodes, so a number that
  // happens to match an Inspired order must never pull that order in.
  opts: { allowReassign: boolean; allowWebFetch?: boolean; retried?: boolean }
): Promise<ScanAssignResult> {
  const digits = code.trim().replace(/^0+(?=\d)/, "");
  const cnNo = Number(digits);
  if (!/^\d+$/.test(digits) || !Number.isSafeInteger(cnNo)) throw new ApiError(400, `"${code}" is not a CN number`);

  const employee = await prisma.user.findUnique({ where: { id: employeeId } });
  if (!employee || employee.role !== "DRIVER" || !employee.active) throw new ApiError(404, "Driver not found or inactive");

  const include = { vendor: { select: { name: true } }, employee: { select: { id: true, name: true } } } as const;

  // Our CN first; otherwise a vendor's own bill number (e.g. Inspired website
  // order 20308 printed as a barcode on their bill) that is still waiting.
  const booking =
    (await prisma.booking.findUnique({ where: { cnNo } })) ??
    (await prisma.booking.findFirst({ where: { vendorRef: digits, status: "AWAITING_PICKUP" }, orderBy: { createdAt: "desc" } }));
  if (booking && booking.cnNo !== cnNo) {
    // Scanned the vendor's number — continue as if our CN had been scanned.
    return assignByScan(String(booking.cnNo), employeeId, opts);
  }
  if (booking?.status === "AWAITING_PICKUP") {
    await acceptBooking(booking.id, { employeeId });
    const order = await prisma.order.findFirstOrThrow({ where: { cnNo }, include, orderBy: { createdAt: "desc" } });
    return { result: "ACCEPTED", message: `CN ${cnNo} added — ${order.vendor.name}, AED ${order.total}`, order };
  }
  if (booking?.status === "REJECTED") throw new ApiError(400, `CN ${cnNo} was rejected by the office`);

  let order = await prisma.order.findFirst({ where: { cnNo }, include, orderBy: [{ date: "desc" }, { createdAt: "desc" }] });
  if (!order) {
    // A vendor bill number whose booking was already accepted → its order.
    const accepted = await prisma.booking.findFirst({ where: { vendorRef: digits, status: "ACCEPTED", orderId: { not: null } }, orderBy: { createdAt: "desc" } });
    if (accepted?.orderId) order = await prisma.order.findUnique({ where: { id: accepted.orderId }, include });
  }
  if (!order && !opts.retried && opts.allowWebFetch) {
    // Not in our system at all — maybe an Inspired website order placed minutes
    // ago that the 5-minute sync hasn't picked up yet. Fetch it right now.
    const { importInspiredOrderByNumber } = await import("./inspiredWoo.service");
    let imported = false;
    try {
      imported = await importInspiredOrderByNumber(digits);
    } catch (err) {
      throw new ApiError(400, err instanceof Error ? err.message : "Inspired lookup failed");
    }
    if (imported) return assignByScan(code, employeeId, { ...opts, retried: true });
  }
  if (!order) throw new ApiError(404, `${code} not found — not booked or entered yet`);

  if (order.employeeId === employeeId) {
    return { result: "ALREADY", message: `CN ${cnNo} is already ${employee.name}'s`, order };
  }
  if (order.status === "DELIVERED" || order.status === "CANCELLED") {
    throw new ApiError(400, `CN ${cnNo} is already ${order.status.toLowerCase()}`);
  }
  if (!opts.allowReassign) {
    throw new ApiError(403, `CN ${cnNo} is assigned to ${order.employee.name} — ask the office to move it`);
  }

  const updated = await prisma.order.update({ where: { id: order.id }, data: { employeeId }, include });
  return {
    result: "REASSIGNED",
    message: `CN ${cnNo} moved from ${order.employee.name} to ${employee.name}`,
    order: updated,
    previousEmployeeId: order.employeeId,
  };
}
