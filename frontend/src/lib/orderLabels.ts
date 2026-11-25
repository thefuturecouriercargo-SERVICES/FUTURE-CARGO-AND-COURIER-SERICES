import { Booking, Order } from "@/types";

const KEY = "fc:orderLabels";

/** Turns a Daily Entry consignment into the shape the shipping label prints. */
export function orderToLabel(o: Order): Booking {
  const b = o.booking;
  return {
    id: o.id,
    vendorId: o.vendorId,
    vendor: { id: o.vendor?.id ?? o.vendorId, name: o.vendor?.name ?? o.brandName, deliveryCharge: o.deliveryCharge },
    cnNo: o.cnNo,
    cnSource: "SYSTEM",
    vendorRef: b?.vendorRef ?? null,
    customerName: b?.customerName ?? "",
    customerPhone: b?.customerPhone ?? "",
    address: b?.address ?? "",
    emirate: b?.emirate || o.emirate,
    items: b?.items ?? null,
    // The consignment's own amount wins — editing it on Daily Entry must change the label.
    // (booking.codAmount is only what the vendor first entered.)
    codAmount: b && !b.manual ? o.total : o.payment === "CASH" ? o.total : 0,
    notes: b?.notes ?? null,
    status: "ACCEPTED",
    createdBy: "ADMIN",
    lat: b?.lat ?? null,
    lng: b?.lng ?? null,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

/** Opens the label print page for these consignments (reprint — nothing is marked). */
export function printOrderLabels(orders: Order[]) {
  if (!orders.length) return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(orders.map(orderToLabel)));
  } catch {
    /* storage unavailable */
  }
  window.open("/print-labels?from=orders", "_blank");
}

export function readOrderLabels(): Booking[] {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? "[]") as Booking[];
  } catch {
    return [];
  }
}
