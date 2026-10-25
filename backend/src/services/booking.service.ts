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
  // Bill No. from a slip (repeats over time; used only for the repeat-entry block).
  billNo: z.string().trim().max(30).optional(),
  customerName: z.string().trim().min(1, "Customer name is required").max(120),
  customerPhone: z
    .string()
    .trim()
    .min(5, "Customer phone is required")
    .max(30)
    .regex(/^[0-9+()\-\s]+$/, "Phone can only contain digits, spaces, + - ( )"),
  address: z.string().trim().min(1, "Address is required").max(500),
  emirate: z.string().trim().min(1).max(30),
  items: z.string().trim().max(1500).optional(),
  // Negative = refund: the driver gives this amount back to the customer.
  codAmount: z.number().int().min(-100000).max(1000000),
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
/**
 * Hard block (no "save anyway"): same vendor + same bill No. + same phone + same
 * COD within 60 days is the same slip entered twice.
 */
async function assertBillNotRepeated(vendorId: string, input: BookingInput, ignoreBookingId?: string) {
  const bill = input.billNo?.trim();
  if (!bill) return;
  const since = new Date(Math.max(Date.now() - 60 * 24 * 60 * 60 * 1000, CN_REUSE_CUTOFF.getTime()));
  const same = await prisma.booking.findMany({
    where: {
      vendorId,
      billNo: { equals: bill, mode: "insensitive" },
      codAmount: input.codAmount,
      status: { not: "REJECTED" },
      createdAt: { gte: since },
      ...(ignoreBookingId ? { id: { not: ignoreBookingId } } : {}),
    },
    select: { cnNo: true, customerPhone: true, createdAt: true },
  });
  const phone = phoneDigits(input.customerPhone);
  const hit = same.find((b) => phoneDigits(b.customerPhone) === phone);
  if (hit) {
    const d = new Date(hit.createdAt.getTime() + 4 * 3600 * 1000).toISOString().slice(0, 10);
    throw new ApiError(
      409,
      `Already entered: bill ${bill}, same phone and AED ${input.codAmount} is CN ${hit.cnNo} (${d}). Not saved again.`,
      { code: "BILL_REPEAT", cnNo: hit.cnNo }
    );
  }
}

async function assertNotLikelyDuplicate(vendorId: string, input: BookingInput, ignoreBookingId?: string) {
  if (input.confirmDuplicate) return;
  const since = new Date(Math.max(Date.now() - 24 * 60 * 60 * 1000, CN_REUSE_CUTOFF.getTime()));
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
/** True if no order and no booking uses this CN. */
/**
 * Manual Daily Entry CNs typed before this moment are ignored when a vendor's
 * website order No. is used as CN (owner's instruction: old hand-typed numbers
 * don't block website numbers). Railway variable CN_REUSE_CUTOFF can move it.
 */
export const CN_REUSE_CUTOFF = new Date(process.env.CN_REUSE_CUTOFF || "2026-10-19T00:00:00+04:00");
const recentOrders = { createdAt: { gte: CN_REUSE_CUTOFF } };

export async function isCnFree(cnNo: number) {
  const [order, booking] = await Promise.all([
    prisma.order.findFirst({ where: { cnNo, ...recentOrders }, select: { id: true } }),
    prisma.booking.findUnique({ where: { cnNo }, select: { id: true } }),
  ]);
  return !order && !booking;
}

const dubaiDayOf = (d: Date) => new Date(d.getTime() + 4 * 3600 * 1000).toISOString().slice(0, 10);

/**
 * The vendor stopped taking orders for today (e.g. 10 PM, they leave): an order placed
 * after that moment, the same day, is dated tomorrow 00:00 Dubai so it shows in
 * tomorrow's lists. The stop expires by itself at midnight.
 */
export async function nextDayIfStopped(vendorId: string, placedAt: Date): Promise<{ createdAt?: Date }> {
  const v = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { ordersStopAt: true } });
  const stop = v?.ordersStopAt;
  const now = new Date();
  if (!stop || dubaiDayOf(stop) !== dubaiDayOf(now) || placedAt < stop) return {};
  const [y, m, d] = dubaiDayOf(now).split("-").map(Number);
  return { createdAt: new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 30) - 4 * 3600 * 1000) };
}

/** Is "Stop today's orders" active right now for this vendor? */
export async function ordersStopState(vendorId: string) {
  const v = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { ordersStopAt: true } });
  const active = !!v?.ordersStopAt && dubaiDayOf(v.ordersStopAt) === dubaiDayOf(new Date());
  return { active, stoppedAt: active ? v!.ordersStopAt : null };
}

/**
 * preferredCn: website orders use the vendor's own order No. as our CN (their
 * printed barcode then IS the CN), when that number is free. If another
 * consignment already uses it, a CN from our own range is used instead.
 */
export async function createBooking(
  vendorId: string,
  input: BookingInput,
  createdBy: "VENDOR" | "ADMIN" | "WEBSITE",
  opts: { preferredCn?: number; placedAt?: Date; webStatus?: string; lat?: number; lng?: number } = {}
) {
  await assertRefFree(vendorId, input.vendorRef || undefined);
  await assertBillNotRepeated(vendorId, input);
  await assertNotLikelyDuplicate(vendorId, input);
  const base = {
    vendorId,
    vendorRef: input.vendorRef || null,
    billNo: input.billNo?.trim() || null,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    address: input.address,
    emirate: input.emirate.toUpperCase(),
    items: input.items || null,
    codAmount: input.codAmount,
    notes: input.notes || null,
    createdBy,
    webStatus: opts.webStatus ?? null,
    lat: opts.lat ?? null,
    lng: opts.lng ?? null,
    // After the vendor pressed "Stop today's orders", new orders belong to tomorrow's list.
    ...(await nextDayIfStopped(vendorId, opts.placedAt ?? new Date())),
  };

  const pref = opts.preferredCn;
  if (pref && Number.isSafeInteger(pref) && pref > 0 && pref < CN_START && (await isCnFree(pref))) {
    try {
      return await prisma.booking.create({ data: { ...base, cnNo: pref, cnSource: "VENDOR" }, include: { vendor: true } });
    } catch (err) {
      const e = err as { code?: string; meta?: { target?: string[] | string } };
      if (e.code === "P2002" && String(e.meta?.target ?? "").includes("vendorRef")) {
        throw new ApiError(409, `Order No. ${input.vendorRef} is already entered`);
      }
      if (e.code !== "P2002") throw err;
      // Someone took that CN a moment ago — fall back to our own range below.
    }
  }

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

  const existingOrder = await prisma.order.findFirst({ where: { cnNo: booking.cnNo, ...recentOrders } });
  if (existingOrder) throw new ApiError(409, `CN No. ${booking.cnNo} is already in Daily Entry`);

  const { date } = dayRange(opts.date);

  return prisma.$transaction(async (tx) => {
    // One order creation at a time (shared with Daily Entry), so two people
    // scanning/accepting the same parcel at once can never create it twice.
    await lockOrderCreation(tx);

    // Re-check inside the lock: claim the booking only if it's still waiting.
    const claimed = await tx.booking.updateMany({ where: { id: booking.id, status: "AWAITING_PICKUP" }, data: { status: "ACCEPTED" } });
    if (claimed.count === 0) throw new ApiError(409, `CN No. ${booking.cnNo} was just accepted by someone else`);
    const dup = await tx.order.findFirst({ where: { cnNo: booking.cnNo, ...recentOrders }, select: { id: true } });
    if (dup) throw new ApiError(409, `CN No. ${booking.cnNo} is already in Daily Entry`);

    // Website orders go into Daily Entry with the vendor's own order No. as CN
    // (their printed barcode), if a generated CN was given earlier and that
    // number is free.
    let cnNo = booking.cnNo;
    const own = Number(booking.vendorRef);
    if (booking.createdBy === "WEBSITE" && booking.cnSource === "SYSTEM" && Number.isSafeInteger(own) && own > 0 && own < CN_START) {
      const taken =
        (await tx.order.findFirst({ where: { cnNo: own, ...recentOrders }, select: { id: true } })) ??
        (await tx.booking.findFirst({ where: { cnNo: own, id: { not: booking.id } }, select: { id: true } }));
      if (!taken) {
        await tx.booking.update({ where: { id: booking.id }, data: { cnNo: own, cnSource: "VENDOR" } });
        cnNo = own;
      }
    }

    const lastSl = await tx.order.aggregate({ where: { date }, _max: { slNo: true } });
    const order = await tx.order.create({
      data: {
        date,
        slNo: (lastSl._max.slNo ?? 0) + 1,
        cnNo,
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
/** Thrown when a scan matched something that should be checked by a person first. */
function needsConfirm(message: string, preview: Record<string, unknown>): never {
  throw new ApiError(409, message, { code: "CONFIRM_SCAN", preview });
}

export async function assignByScan(
  code: string,
  employeeId: string,
  // confirmed: the office already accepted the "move it from another driver?" check.
  // vendorId: "scanning this vendor's own printed bills" — the code is then that
  // vendor's order No., matched ONLY against that vendor's orders.
  opts: { allowReassign: boolean; confirmed?: boolean; vendorId?: string; retried?: boolean }
): Promise<ScanAssignResult> {
  const digits = code.trim().replace(/^0+(?=\d)/, "");
  const cnNo = Number(digits);
  if (!/^\d+$/.test(digits) || !Number.isSafeInteger(cnNo)) throw new ApiError(400, `"${code}" is not a CN number`);

  const employee = await prisma.user.findUnique({ where: { id: employeeId } });
  if (!employee || employee.role !== "DRIVER" || !employee.active) throw new ApiError(404, "Driver not found or inactive");

  const include = { vendor: { select: { name: true } }, employee: { select: { id: true, name: true } } } as const;

  // vendorId "OWN" = the office/driver picked "our CN" after a clash with a vendor bill No.
  const ownOnly = opts.vendorId === "OWN";
  if (opts.vendorId && !ownOnly) {
    // Vendor bill mode: their numbers overlap with other vendors' numbers, so
    // look only inside this one vendor's orders.
    const vendor = await prisma.vendor.findUnique({ where: { id: opts.vendorId } });
    if (!vendor) throw new ApiError(404, "Vendor not found");
    const byRef = await prisma.booking.findFirst({
      where: { vendorId: vendor.id, vendorRef: digits, status: { not: "REJECTED" }, createdAt: { gte: CN_REUSE_CUTOFF } },
      orderBy: { createdAt: "desc" },
    });
    if (!byRef && !opts.retried) {
      // Connected website (Inspired, Escalo…): an order placed minutes ago may not
      // be synced yet — fetch that one order now (recent orders only).
      const { importWooOrderByNumber, wooConnForVendor } = await import("./inspiredWoo.service");
      const conn = await wooConnForVendor(vendor.id);
      if (conn) {
        try {
          if (await importWooOrderByNumber(conn, digits)) return assignByScan(code, employeeId, { ...opts, retried: true });
        } catch (err) {
          throw new ApiError(400, err instanceof Error ? err.message : "Lookup failed");
        }
      }
    }
    if (!byRef) {
      throw new ApiError(404, `No ${vendor.name} order with bill No. ${digits}. Check the bill type selected, or that the order is in Awaiting Pickup.`);
    }
    const r = await assignByScan(String(byRef.cnNo), employeeId, { ...opts, vendorId: undefined });
    return { ...r, message: `${vendor.name} #${digits} · ${byRef.customerName} → ${r.message}` };
  }

  // Auto mode: the number may be our CN or an Inspired / Escalo bill No. — no need
  // to pick the bill type first. Anything entered before the fresh start
  // (CN_REUSE_CUTOFF) is ignored, so old paper-era numbers never match.
  const booking = await prisma.booking.findUnique({ where: { cnNo } });
  const billVendors = await scanBillVendors();
  const refHits = billVendors.length && !ownOnly
    ? await prisma.booking.findMany({
        where: {
          vendorRef: digits,
          vendorId: { in: billVendors.map((v) => v.id) },
          status: { not: "REJECTED" },
          createdAt: { gte: CN_REUSE_CUTOFF },
          ...(booking ? { id: { not: booking.id } } : {}),
        },
        select: { cnNo: true, vendorId: true, customerName: true, vendor: { select: { name: true } } },
      })
    : [];
  const ownLive = booking && booking.status !== "REJECTED" && (booking.status === "AWAITING_PICKUP" || booking.createdAt >= CN_REUSE_CUTOFF);
  if ((ownLive && refHits.length) || refHits.length > 1) {
    const names = [...(ownLive ? ["our CN"] : []), ...refHits.map((h) => `${h.vendor.name} bill`)];
    // Let the scanner screen ask which one it is (no bill-type selector any more).
    const ownVendor = ownLive ? await prisma.vendor.findUnique({ where: { id: booking!.vendorId }, select: { name: true } }) : null;
    const choices = [
      ...(ownLive ? [{ vendorId: "OWN", label: `Our CN ${digits} — ${ownVendor?.name ?? ""} · ${booking!.customerName}` }] : []),
      ...refHits.map((h) => ({ vendorId: h.vendorId, label: `${h.vendor.name} bill #${digits} — ${h.customerName} (CN ${h.cnNo})` })),
    ];
    throw new ApiError(409, `${digits} matches ${names.join(" and ")} — which parcel is it?`, { code: "CHOOSE_VENDOR", choices });
  }
  if (!ownLive && refHits.length === 1) {
    const r = await assignByScan(String(refHits[0].cnNo), employeeId, { ...opts, vendorId: undefined });
    return { ...r, message: `${refHits[0].vendor.name} #${digits} → ${r.message}` };
  }

  if (booking?.status === "AWAITING_PICKUP") {
    const created = await acceptBooking(booking.id, { employeeId });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: created.id }, include });
    return { result: "ACCEPTED", message: `CN ${order.cnNo} added — ${order.vendor.name}, AED ${order.total}`, order };
  }
  if (booking?.status === "REJECTED") throw new ApiError(400, `CN ${cnNo} was rejected by the office`);

  const order = await prisma.order.findFirst({
    where: { cnNo, createdAt: { gte: CN_REUSE_CUTOFF } },
    include,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  if (!order) {
    // Maybe a website order placed minutes ago that hasn't synced yet.
    if (!opts.retried && billVendors.length && digits.length <= 8) {
      const { importWooOrderByNumber, wooConnForVendor } = await import("./inspiredWoo.service");
      let imported = 0;
      for (const v of billVendors) {
        const conn = await wooConnForVendor(v.id);
        if (!conn) continue;
        try {
          if (await importWooOrderByNumber(conn, digits)) imported++;
        } catch {
          /* not on that website */
        }
      }
      if (imported) return assignByScan(code, employeeId, { ...opts, retried: true });
    }
    throw new ApiError(404, `${code} is not one of our barcodes — no consignment or vendor order with this number. Enter this parcel in Daily Entry.`);
  }

  if (order.employeeId === employeeId) {
    return { result: "ALREADY", message: `CN ${order.cnNo} is already ${employee.name}'s`, order };
  }
  if (order.status === "DELIVERED" || order.status === "CANCELLED") {
    throw new ApiError(400, `CN ${order.cnNo} (${order.vendor.name}) is already ${order.status.toLowerCase()}`);
  }
  if (!opts.allowReassign) {
    throw new ApiError(403, `CN ${order.cnNo} is assigned to ${order.employee.name} — ask the office to move it`);
  }
  // Moving a parcel between drivers (or a match by vendor bill No.) — confirm first.
  if (!opts.confirmed) {
    needsConfirm(
      `CN ${order.cnNo} (${order.vendor.name}, AED ${order.total}) is with ${order.employee.name}. Move it to ${employee.name}?`,
      { vendor: order.vendor.name, cnNo: order.cnNo, from: order.employee.name, to: employee.name }
    );
  }

  const updated = await prisma.order.update({ where: { id: order.id }, data: { employeeId }, include });
  return {
    result: "REASSIGNED",
    message: `CN ${order.cnNo} moved from ${order.employee.name} to ${employee.name}`,
    order: updated,
    previousEmployeeId: order.employeeId,
  };
}


/**
 * Vendors that print their OWN bills, shown as "<NAME> bill" on the scan screens.
 * A fixed list (Railway variable SCAN_BILL_VENDORS, comma-separated vendor names),
 * so other vendors never appear there by accident.
 */
export async function scanBillVendors() {
  const names = (process.env.SCAN_BILL_VENDORS || "INSPIRED,ESCALO")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
  const found = await Promise.all(
    names.map((name) => prisma.vendor.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { id: true, name: true } }))
  );
  return found.filter((v): v is { id: string; name: string } => Boolean(v));
}
