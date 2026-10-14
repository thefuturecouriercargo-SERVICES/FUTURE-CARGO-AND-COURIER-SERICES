import { z } from "zod";
import { prisma } from "../lib/prisma";
import { ApiError } from "../utils/asyncHandler";
import { dayRange } from "../utils/dates";

/**
 * System-generated CNs live in their own range so they can never clash with
 * the hand-written bill numbers already in the system (currently < 60,000).
 * Override with CN_START in Railway if ever needed.
 */
export const CN_START = parseInt(process.env.CN_START || "900001", 10) || 900001;

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

/** Creates a booking with the next CN from our own range. Retries on a race. */
export async function createBooking(vendorId: string, input: BookingInput, createdBy: "VENDOR" | "ADMIN") {
  await assertRefFree(vendorId, input.vendorRef || undefined);
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
    await tx.booking.update({ where: { id: booking.id }, data: { status: "ACCEPTED", orderId: order.id } });
    return order;
  });
}
