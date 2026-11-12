import { emirateFromAddress } from "./areas";
/**
 * Delivery charge per parcel.
 *
 * Outside areas — Umm Al Quwain, Fujairah, Al Ain, Ras Al Khaimah, Sajja, Kalba and Damac Hills 2 —
 * are charged 20 for every vendor, except RIJUS and ATHEEN who pay 25 there.
 * Everywhere else the vendor's own rate applies.
 *
 * The ADDRESS decides, not only the emirate field: vendors often pick the wrong
 * emirate ("Ummul Kuvain" saved as ABUDHABI), so an outside place written in the
 * address always counts, however it is spelled.
 */
export const OUTSIDE_EMIRATES = ["UMM AL QUWAIN", "FUJAIRAH", "AL AIN", "RAS AL KHAIMAH"] as const;
export const OUTSIDE_AREAS = ["UMM AL QUWAIN", "FUJAIRAH", "AL AIN", "RAS AL KHAIMAH", "SAJJA", "KALBA", "DAMAC HILLS 2"] as const;
export type OutsideArea = (typeof OUTSIDE_AREAS)[number];

/** Spelling-tolerant patterns for each outside place (first match wins). */
const OUTSIDE_TEXT: [RegExp, OutsideArea][] = [
  // Umm Al Quwain · Ummul Kuvain · Um al Qaiwain · Ummulquwain · Umm Al Quain · Umin al Quin · UAQ · Kuwain
  [/\bu+m+[aeiu]*n?[\s\-'’]*(?:[aeu]l+[\s\-'’]*)?[qkg][aeiouwv]{1,6}n\b|\b[qk]u[wv]+a?i?y?n\b|\bu\.?a\.?q\b/i, "UMM AL QUWAIN"],
  // Fujairah · Fujaira · Fujeirah · Fujira · Fojaira
  [/\bf[uo]+j+[aeiy]{0,3}r+a*h?\b/i, "FUJAIRAH"],
  // Al Ain · Alain · Al Ayn — but not "Al Ain road" (that runs through Dubai)
  [/\bal[\s\-]*a[iy]n\b(?![\s\-]*(?:road|rd|street|st|highway|hwy)\b)/i, "AL AIN"],
  // Ras Al Khaimah · Ras al Kaima · Ras Alkhema · RAK (not RAK bank / RAK ceramics)
  [/\bras[\s\-'’]*(?:[aeu]l+)?[\s\-'’]*kh?[aei]{1,2}ma?h?\b|\brak\b(?![\s\-]*(?:bank|ceramics?|porcelain|insurance)\b)/i, "RAS AL KHAIMAH"],
  // Al Sajaa · Sajja · Saja'a
  [/\b(?:al[\s\-]*)?saj+a'?a?h?\b|\bsajja\b/i, "SAJJA"],
  // Kalba · Qalba · Khalba
  [/\b(?:kh?|q)al+ba\b/i, "KALBA"],
  // Damac Hills 2 · Damac Hills II · DH2 · Akoya Oxygen (its old name)
  [/\bdamac[\s\-'’]*hills?[\s\-'’]*(?:2|ii|two)\b|\bdh[\s\-]?2\b|\bakoya[\s\-'’]*oxygen\b/i, "DAMAC HILLS 2"],
];

/** Outside place named in an address, if any. */
export function outsidePlaceInText(text?: string | null): OutsideArea | null {
  const t = text ?? "";
  if (!t) return null;
  for (const [re, name] of OUTSIDE_TEXT) if (re.test(t)) return name;
  return null;
}

/** Which outside area a parcel goes to (address first, then the emirate field), or null. */
export function outsideAreaOf(emirate?: string | null, address?: string | null): OutsideArea | null {
  const fromText = outsidePlaceInText(address);
  if (fromText) return fromText;
  const em = (emirate ?? "").toUpperCase().trim();
  return (OUTSIDE_EMIRATES as readonly string[]).includes(em) ? (em as OutsideArea) : null;
}

export function isOutsideArea(emirate?: string | null, address?: string | null): boolean {
  return outsideAreaOf(emirate, address) !== null;
}

/**
 * Right emirate for a parcel: when the address names an outside emirate
 * (Umm Al Quwain, Fujairah, Al Ain, Ras Al Khaimah) and does NOT also name the
 * chosen emirate, the address wins. Sajja / Kalba stay with Sharjah.
 */
const EMIRATE_WORD: Record<string, RegExp> = {
  DUBAI: /\bdub[a]?[iy]\b|\bdxb\b/i,
  SHARJAH: /\bsh[a]?r[a]?j[a]?h?\b|\bsharjha\b|\bshj\b/i,
  ABUDHABI: /\babu\s*dh?abi\b|\babudh?abi\b|\bauh\b/i,
  AJMAN: /\bajm[a]+n\b|\bajm\b/i,
};
export function correctEmirate(emirate: string, address?: string | null): string {
  const em = (emirate ?? "").toUpperCase().trim();
  const place = outsidePlaceInText(address);
  // No outside emirate in the address → check Dubai / Sharjah / Ajman / Abu Dhabi against the area named.
  if (!place || !(OUTSIDE_EMIRATES as readonly string[]).includes(place)) return emirateFromAddress(em, address);
  if (place === em) return em;
  const own = EMIRATE_WORD[em];
  if (own && own.test(address ?? "")) return em; // address names both → keep what was chosen
  return place;
}

export const OUTSIDE_CHARGE = 20;
const OUTSIDE_SPECIAL: Record<string, number> = { RIJUS: 25, ATHEEN: 25 };

export function chargeFor(vendor: { name: string; deliveryCharge: number }, emirate?: string | null, address?: string | null): number {
  if (!isOutsideArea(emirate, address)) return vendor.deliveryCharge;
  const key = vendor.name.toUpperCase().replace(/[^A-Z]/g, "");
  return OUTSIDE_SPECIAL[key] ?? OUTSIDE_CHARGE;
}
