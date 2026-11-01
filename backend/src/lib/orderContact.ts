import { prisma } from "./prisma";
import { ApiError } from "../utils/asyncHandler";

export const BOOKING_DETAIL_SELECT = {
  customerName: true,
  customerPhone: true,
  address: true,
  emirate: true,
  items: true,
  notes: true,
  vendorRef: true,
  codAmount: true,
  lat: true,
  lng: true,
} as const;

type WithContact = {
  total: number;
  emirate: string;
  custPhone?: string | null;
  custAddress?: string | null;
  booking?: unknown;
};

/**
 * Orders typed in by the office have no Booking, so no phone/address. When the
 * admin or driver adds them with "Edit address & phone", they're kept on the
 * order and shown through the same `booking` shape every screen already reads
 * (`manual: true` so it's never mistaken for a prepaid vendor booking).
 */
export function withContact<T extends WithContact>(o: T): T {
  if (o.booking || (!o.custPhone && !o.custAddress)) return o;
  return {
    ...o,
    booking: {
      customerName: "",
      customerPhone: o.custPhone ?? "",
      address: o.custAddress ?? "",
      emirate: o.emirate,
      items: null,
      notes: null,
      vendorRef: null,
      codAmount: o.total,
      lat: null,
      lng: null,
      manual: true,
    },
  };
}

export function cleanPhone(v: unknown) {
  return typeof v === "string" ? v.replace(/[^\d+ ]/g, "").trim().slice(0, 30) : undefined;
}
export function cleanAddress(v: unknown) {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 300) : undefined;
}

/** Saves a new phone and/or address for one order (on its booking if it has one). */
export async function updateOrderContact(orderId: string, body: { phone?: unknown; address?: unknown }, onlyEmployeeId?: string) {
  const phone = cleanPhone(body.phone);
  const address = cleanAddress(body.address);
  if (phone === undefined && address === undefined) throw new ApiError(400, "Nothing to change");
  const order = await prisma.order.findFirst({
    where: { id: orderId, ...(onlyEmployeeId ? { employeeId: onlyEmployeeId } : {}) },
    select: { id: true, cnNo: true, custPhone: true, custAddress: true, booking: { select: { id: true, customerPhone: true, address: true } } },
  });
  if (!order) throw new ApiError(404, onlyEmployeeId ? "Order not found in your list" : "Order not found");
  const before = order.booking
    ? { phone: order.booking.customerPhone, address: order.booking.address }
    : { phone: order.custPhone, address: order.custAddress };
  if (order.booking) {
    await prisma.booking.update({
      where: { id: order.booking.id },
      data: {
        ...(phone !== undefined && phone ? { customerPhone: phone } : {}),
        ...(address !== undefined && address ? { address } : {}),
      },
    });
  } else {
    await prisma.order.update({
      where: { id: order.id },
      data: {
        ...(phone !== undefined ? { custPhone: phone || null } : {}),
        ...(address !== undefined ? { custAddress: address || null } : {}),
      },
    });
  }
  const fresh = await prisma.order.findUniqueOrThrow({
    where: { id: order.id },
    include: { vendor: true, employee: { select: { id: true, name: true } }, booking: { select: BOOKING_DETAIL_SELECT } },
  });
  return { order: withContact(fresh), before, cnNo: order.cnNo };
}
