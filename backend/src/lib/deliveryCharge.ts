/**
 * Delivery charge per parcel.
 *
 * Outside areas — Umm Al Quwain, Fujairah, Al Ain, Ras Al Khaimah, Sajja and Kalba —
 * are charged 20 for every vendor, except RIJUS and ATHEEN who pay 25 there.
 * Everywhere else the vendor's own rate applies.
 */
const OUTSIDE_EMIRATES = new Set(["UMM AL QUWAIN", "FUJAIRAH", "AL AIN", "RAS AL KHAIMAH"]);
const OUTSIDE_AREA_RE = /\b(?:al[\s\-]*)?saj+a'?a?h?\b|\bsajja\b|\bkalba\b|\bqalba\b|\bkhalba\b/i;
const OUTSIDE_EMIRATE_TEXT_RE =
  /\bumm[\s\-]*al[\s\-]*q[a-z]*\b|\buaq\b|\bfujair?ah?\b|\bfujeirah\b|\bal[\s\-]*ain\b|\bras[\s\-]*al[\s\-]*kh?aima?h?\b|\brak\b/i;

export const OUTSIDE_CHARGE = 20;
const OUTSIDE_SPECIAL: Record<string, number> = { RIJUS: 25, ATHEEN: 25 };

export function isOutsideArea(emirate?: string | null, address?: string | null): boolean {
  const em = (emirate ?? "").toUpperCase().trim();
  if (OUTSIDE_EMIRATES.has(em)) return true;
  const text = address ?? "";
  if (OUTSIDE_AREA_RE.test(text)) return true;
  // Emirate field left as OTHER / blank but the address names an outside emirate.
  if ((!em || em === "OTHER") && OUTSIDE_EMIRATE_TEXT_RE.test(text)) return true;
  return false;
}

export function chargeFor(vendor: { name: string; deliveryCharge: number }, emirate?: string | null, address?: string | null): number {
  if (!isOutsideArea(emirate, address)) return vendor.deliveryCharge;
  const key = vendor.name.toUpperCase().replace(/[^A-Z]/g, "");
  return OUTSIDE_SPECIAL[key] ?? OUTSIDE_CHARGE;
}
