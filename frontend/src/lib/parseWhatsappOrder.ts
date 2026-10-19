/**
 * Best-effort parser for a WhatsApp order message pasted by a vendor.
 * Fills what it can recognise; the vendor reviews every field before saving.
 *
 * Tuned for the two formats Inspired / Escalo receive:
 *  1. WhatsApp catalog confirmation — "✅ Order Received Successfully!", name,
 *     "Ph:", address, "🔹 *product*" blocks with "- Qty : 1", "*Total:* 195.00",
 *     plus thank-you / delivery boilerplate.
 *  2. Manual message — name, "Address:…", "Emirate sharjha", "Mobile no:…",
 *     item lines "Akoya-AED 40," and "Total-AED 160".
 * Also handles generic "Label: value" messages.
 */

import { emirateOfArea, isKnownArea } from "./areas";

export interface ParsedOrder {
  customerName?: string;
  customerPhone?: string;
  address?: string;
  emirate?: string;
  items?: string;
  codAmount?: number;
  notes?: string;
  vendorRef?: string;
  /** Sum of item prices (+ delivery fee) — to flag when it doesn't match the Total line. */
  itemSum?: number;
}

// Emirate words, including common misspellings seen in real messages.
const EMIRATE_WORDS: [RegExp, string][] = [
  [/\bal\s*ain\b|\balain\b/i, "AL AIN"],
  [/\babu\s*dh?abi\b|\babudh?abi\b|\bauh\b|\bmussafah\b|\bkhalifa\s*city\b|\breem\s*island\b|\bmusaffah\b/i, "ABUDHABI"],
  [/\bras\s*al\s*kh?aima?h?\b|\brak\b/i, "RAS AL KHAIMAH"],
  [/\bumm\s*al\s*q[a-z]*\b|\buaq\b/i, "UMM AL QUWAIN"],
  [/\bfuj[ae]i?rah?\b|\bkhor\s*fakk?an\b|\bkalba\b/i, "FUJAIRAH"],
  [/\bajm[a]+n\b/i, "AJMAN"],
  [/\bsh[a]?r[a]?j[a]?h?\b|\bsharjha\b|\bshj\b|\bal\s*nahda\b|\bmuwaileh\b|\bal\s*majaz\b|\bal\s*taawun\b|\babu\s*shagara\b|\bal\s*qasimia\b/i, "SHARJAH"],
  [/\bdub[a]?[iy]\b|\bdxb\b|\bdeira\b|\bbur\s*dubai\b|\bjlt\b|\bmarina\b|\bal\s*barsha\b|\bkarama\b|\bqusais\b|\bjvc\b|\bmirdif\b|\binternational\s*city\b|\bsilicon\s*oasis\b|\bal\s*nahda\s*1\b/i, "DUBAI"],
];

// UAE mobiles/landlines in their common written forms.
const PHONE_RE = /(?:\+?971|00971|0)?[\s-]*\(?0?(?:5[024568]|[2-79])\)?[\s-]*\d{3}[\s-]*\d{4}\b/;

// Lines that carry no customer data (confirmation text, separators, headings).
// A label with nothing after it ("Fragrance:", "Items:") — the items follow on the next lines.
const ITEMS_HEADING = /^(?:fragrances?|perfumes?|scents?|products?|items?|order|order\s+details|your\s+order|selected\s+items?)\s*[:：\-]?$/i;

const BOILERPLATE = [
  /^order\s+received/i,
  /^here\s+(are|is)\s+(your|the)\s+order/i,
  /^order\s+summary/i,
  /^order\s+details?:?$/i,
  /^(new\s+)?order:?$/i,
  /delivery\s+within/i,
  /courier\s+partner/i,
  /^thank\s*(you|s)/i,
  /^(hi|hello|salam|assalam|dear)\b/i,
  /^next\s+type/i,
  /^[-=_*~.\s]+$/,
  /^discount\b/i,
  // Vendor's own order-template text
  /free\s+delivery|delivery\s+(?:all\s+over|across)|cash\s+on\s+delivery\s+available/i,
  /^\(?\s*(?:except|excluding|not\s+including)\b.*\)?$/i,
  /kindly\s+share|please\s+share\s+(?:the|your)|share\s+the\s+following|following\s+details|(?:like|want|wish)\s+to\s+(?:place\s+an\s+)?order|place\s+(?:an|your)\s+order|fill\s+(?:in\s+)?(?:the|your)\s+details/i,
  /^read\s+this\.?$/i,
  /^(?:shipping|billing)\s*(?:address|details|info)?\s*:?$/i,
  /^(?:payment\s*(?:method|mode)?\s*[:\-]?\s*)?(?:cod|cash\s*on\s*delivery|cash)\.?$/i,
  /^(?:ok|okay|done|confirmed|order\s+confirmed|your\s+order)\.?$/i,
];

function cleanPhone(raw: string): string {
  let d = raw.replace(/[^\d+]/g, "").replace(/^\+/, "");
  if (d.startsWith("00971")) d = d.slice(5);
  else if (d.startsWith("971")) d = d.slice(3);
  if (!d.startsWith("0")) d = "0" + d;
  if (/^05\d{8}$/.test(d)) return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
  return d;
}

const EXPLICIT_EMIRATES: [RegExp, string][] = [
  [/\bal\s*ain\b|\balain\b/i, "AL AIN"],
  [/\babu\s*dh?abi\b|\babudh?abi\b/i, "ABUDHABI"],
  [/\bras\s*al\s*kh?aima?h?\b/i, "RAS AL KHAIMAH"],
  [/\bumm\s*al\s*q[a-z]*\b/i, "UMM AL QUWAIN"],
  [/\bfuj[ae]i?rah?\b/i, "FUJAIRAH"],
  [/\bajm[a]+n\b/i, "AJMAN"],
  [/\bsh[a]?r[a]?j[a]?h\b|\bsharjha\b/i, "SHARJAH"],
  [/\bdub[a]?[iy]\b/i, "DUBAI"],
];

function detectEmirate(text: string): string | undefined {
  for (const [re, name] of EXPLICIT_EMIRATES) if (re.test(text)) return name;
  for (const [re, name] of EMIRATE_WORDS) if (re.test(text)) return name;
  return undefined;
}

/** Emirate for the whole order: emirate words first, then a known area name. */
function emirateForOrder(text: string): string | undefined {
  return detectEmirate(text) ?? emirateOfArea(text);
}

const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, dozen: 12 };
const UNIT = String.raw`(?:pcs|pc|pieces?|pce|nos|no|numbers?|bottles?|btls?|btl|units?|packs?|pkts?|boxes|box|sets?|qty|quantity)`;
const CUR = String.raw`(?:aed|dhs|dh|dirhams?|drhm)`;
const SIZE_RE = /\b\d+(?:\.\d+)?\s*(?:ml|m\.l|ltr|l|g|gm|gms|grams?|kg|oz|cm|mm|inch|in)\b/gi;
const ADDRESS_WORDS = /\b(street|st\.|road|rd|building|bldg|villa|flat|floor|room|near|tower|apartment|apt|block|plot|area|makani|behind|opposite|opp|office|shop|unit|suite|warehouse|store|house|home|gate|cluster|plaza|residence|residency|compound|mall|camp|hotel|school|hospital|clinic|masjid|mosque|signal|roundabout|parking|po\s*box)\b/i;

/** "2 × Akoya (AED 80)" — the label and order details read this back with splitItems(). */
export function fmtItem(qty: number, name: string, price?: number): string {
  return `${qty} × ${name}${price !== undefined && price > 0 ? ` (AED ${price})` : ""}`;
}

export interface ParsedItem { qty: number; name: string; price?: number }

/**
 * One manual item line in any of the ways customers type it, e.g.
 *   "Akoya 2pc-AED 80", "2 Akoya 80aed", "Akoya x2 = 80", "Akoya (2) 80 dhs",
 *   "Akoya qty 2 aed 80", "Akoya*2", "two Akoya", "Akoya 100ml 2 bottles 160",
 *   "Akoya - 2 - 80", "2×Akoya", "Akoya 2nos".
 * Bottle sizes (100ml, 50 g) are kept in the name, never read as the quantity.
 * `strict` (default) only accepts lines with a clear price or quantity marker.
 */
export function parseItemLine(raw: string, strict = true): ParsedItem | null {
  let t = ` ${raw.replace(/[,;.]+\s*$/, "").replace(/\s+/g, " ").trim()} `;
  if (!/[a-z]/i.test(t)) return null;
  let price: number | undefined;
  let qty: number | undefined;
  let marked = false;
  const take = (re: RegExp, f: (m: RegExpMatchArray) => void) => {
    const m = t.match(re);
    if (m) { f(m); t = t.replace(m[0], " "); return true; }
    return false;
  };

  // Protect sizes like "100ml" so they are not read as qty/price.
  const sizes: string[] = [];
  t = t.replace(SIZE_RE, (m) => { sizes.push(m); return ` §${sizes.length - 1}§ `; });

  // "Akoya 40*2=80", "Noir 2 x 35 = 70"
  take(/(\d[\d,]*(?:\.\d+)?)\s*[x×*]\s*(\d[\d,]*(?:\.\d+)?)\s*=\s*(?:aed|dhs?)?\s*(\d[\d,]*(?:\.\d+)?)\s*(?:aed|dhs?|\/-)?/i, (m) => {
    const a = num(m[1]) ?? 0, b = num(m[2]) ?? 0;
    price = num(m[3]);
    const q = a <= 20 && (b > 20 || a <= b) ? a : b <= 20 ? b : undefined;
    if (q) qty = q;
  });

  // Price with currency: "AED 80", "80aed", "80/- dhs"
  if (price === undefined) take(new RegExp(String.raw`[-–:=@]?\s*\b${CUR}\.?\s*[:\-]?\s*(\d[\d,]*(?:\.\d+)?)`, "i"), (m) => (price = num(m[1]))) ||
    take(new RegExp(String.raw`[-–:=@]?\s*(\d[\d,]*(?:\.\d+)?)\s*(?:\/-)?\s*${CUR}\b\.?`, "i"), (m) => (price = num(m[1])));

  // Quantity with a marker
  if (qty === undefined) take(new RegExp(String.raw`\b(?:qty|quantity)\s*[:\-=]?\s*(\d{1,3})\b`, "i"), (m) => (qty = Number(m[1]))) ||
    take(new RegExp(String.raw`(?:^|\s|[-–(])(\d{1,3})\s*${UNIT}\b\.?`, "i"), (m) => (qty = Number(m[1]))) ||
    take(/(?:(?:^|\s)x|[×*])\s*(\d{1,3})\b/i, (m) => (qty = Number(m[1]))) ||
    take(/\b(\d{1,3})\s*[x×*](?=\s|[a-z])/i, (m) => (qty = Number(m[1]))) ||
    take(/\(\s*(\d{1,3})\s*\)/, (m) => (qty = Number(m[1]))) ||
    take(new RegExp(String.raw`^\s*(${Object.keys(WORD_NUM).join("|")})\b\s*(?:${UNIT}\b)?`, "i"), (m) => (qty = WORD_NUM[m[1].toLowerCase()]));
  if (qty !== undefined || price !== undefined) marked = true;

  // Remaining bare numbers: "2 Akoya 80", "Akoya - 2 - 80", "Akoya 80"
  const bare = [...t.matchAll(/(?:^|[\s\-–:=@])(\d[\d,]*(?:\.\d+)?)(?=\s|$|[\-–:=,])/g)].map((m) => ({ s: m[0], n: num(m[1]) ?? 0 }));
  for (const b of bare) {
    if (qty === undefined && b.n >= 1 && b.n <= 20 && (price !== undefined || bare.length > 1 || b === bare[0] && /^\s*\d/.test(t))) {
      qty = b.n; t = t.replace(b.s, " "); marked = true;
    } else if (price === undefined && b.n >= 5) {
      price = b.n; t = t.replace(b.s, " "); marked = true;
    }
  }

  let name = t.replace(/§(\d+)§/g, (_, i) => sizes[Number(i)]).replace(/[\s\-–:=@,*()]+$/g, "").replace(/^[\s\-–:=@,*()]+/g, "").replace(/\s+/g, " ").trim();
  name = name.replace(/\s*[-–]\s*$/, "").replace(/^(?:inspired\s+by\s*:?\s*)/i, "").trim();
  if (!/[a-z]{2}/i.test(name) || name.length > 70) return null;
  if (strict && !marked) return null;
  return { qty: qty && qty > 0 ? qty : 1, name, price };
}

/** Drop "United Arab Emirates" / "UAE" and repeated parts ("Sharjah, Sharjah"). */
function tidyAddress(parts: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const seg of parts.join(", ").split(/\s*,\s*/)) {
    const t = seg.replace(/\s+/g, " ").trim();
    if (!t || /^(united\s+arab\s+emirates|u\.?a\.?e\.?)$/i.test(t)) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out.join(", ");
}

function num(s: string): number | undefined {
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 && n < 1_000_000 ? Math.round(n) : undefined;
}

/** Strip emojis, WhatsApp bold/italic markers and bullets. */
function tidy(line: string): string {
  return line
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/^\[\d{1,2}\/\d{1,2}\/\d{2,4},?\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AP]M)?\]\s*[^:]{1,40}:\s*/i, "")
    .replace(/^\d{1,2}\/\d{1,2}\/\d{2,4},?\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AP]M)?\s*[-–]\s*[^:]{1,40}:\s*/i, "")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, "")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\u00A0]/g, " ")
    .replace(/(\d)\s*\*\s*(?=\d)/g, "$1×") // "40*2" is a multiplication, not bold
    .replace(/[*_~]/g, "")
    .replace(/^[\s•\-–—>·]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseWhatsappOrder(raw: string): ParsedOrder {
  const out: ParsedOrder = {};
  const rawLines = raw.split(/\r?\n/);
  const items: string[] = [];
  const addressParts: string[] = [];
  const notes: string[] = [];
  const leftovers: { t: string; i: number }[] = [];
  // Which (non-boilerplate) lines produced an item or a total — plain names next to them are items too.
  const itemLineIdx = new Set<number>();
  let li = -1;
  let itemsSection = false;
  let seenItems = 0;
  let seenTotal: number | undefined;
  let seenPending: unknown = null;
  const markLine = () => {
    if (li >= 0 && (items.length !== seenItems || totalFromLabel !== seenTotal || (pendingItem && pendingItem !== seenPending))) itemLineIdx.add(li);
    seenItems = items.length;
    seenTotal = totalFromLabel;
    seenPending = pendingItem;
  };
  let pendingItem: { name: string; qty: number; rate?: number; amt?: number; fromLabel?: boolean } | null = null;
  let totalFromLabel: number | undefined;
  let subtotal: number | undefined;
  let deliveryFee: number | undefined;
  let prepaid = false;
  const itemPrices: number[] = [];
  const altPhones: string[] = [];
  const addPhone = (p: string) => {
    const c = cleanPhone(p);
    if (!out.customerPhone) out.customerPhone = c;
    else if (c !== out.customerPhone && !altPhones.includes(c)) altPhones.push(c);
  };

  const flushItem = () => {
    if (pendingItem) {
      const price = pendingItem.amt ?? (pendingItem.rate !== undefined ? pendingItem.rate * pendingItem.qty : undefined);
      items.push(fmtItem(pendingItem.qty, pendingItem.name, price));
      if (price !== undefined) itemPrices.push(price);
    }
    pendingItem = null;
  };

  for (const rawLine of rawLines) {
    const isProductBullet = /^\s*(?:🔹|🔸|▪️|▫️|•|◾|➤|👉)/u.test(rawLine);
    let line = tidy(rawLine);
    if (!line) continue;
    if (ITEMS_HEADING.test(line)) {
      itemsSection = true;
      continue;
    }
    if (BOILERPLATE.some((re) => re.test(line))) continue;
    markLine();
    li++;

    // --- Map / location links go to notes for the driver
    const url = line.match(/\bhttps?:\/\/\S+|\b(?:maps\.app\.goo\.gl|goo\.gl\/maps|maps\.google\.\S+)\/\S*/i);
    if (url) {
      notes.push(/maps|goo\.gl|location|pin/i.test(line) ? `Location: ${url[0]}` : url[0]);
      line = line.replace(url[0], "").replace(/^(?:location|pin|map|google\s*map)s?\s*(?:link)?\s*[:\-]?\s*$/i, "").trim();
      if (!line) continue;
    }

    // --- Prepaid ("Payment: Paid", "Already paid online", "Prepaid")
    if (/\b(?:pre-?paid|already\s+paid|paid\s+(?:online|already|by\s+card|via|through)|payment\s+(?:done|received|completed)|fully\s+paid)\b|^(?:payment|status)\s*[:\-]?\s*paid\.?$|^paid\.?$/i.test(line) && !/\b(?:to\s+be\s+paid|unpaid|not\s+paid)\b/i.test(line)) {
      prepaid = true;
      continue;
    }

    // --- Delivery fee / subtotal (used only when there is no Total line)
    const fee = line.match(/^(?:delivery|shipping)\s*(?:charges?|fee|cost)?\s*[:\-=]?\s*(?:aed|dhs?)?\s*(\d[\d,]*(?:\.\d+)?|free)/i);
    if (fee) {
      deliveryFee = /free/i.test(fee[1]) ? 0 : num(fee[1]);
      continue;
    }
    const sub = line.match(/^sub\s*-?\s*total\s*[:\-=]?\s*(?:aed|dhs?)?\s*(\d[\d,]*(?:\.\d+)?)/i);
    if (sub) {
      subtotal = num(sub[1]);
      continue;
    }

    // --- Catalog product blocks: "🔹 Inspired by: Noir…" then "Qty : 1", "Rate", "Amt"
    const qty = line.match(/^qty\s*[:\-]?\s*(\d+)/i);
    if (qty) {
      if (pendingItem) pendingItem.qty = Number(qty[1]);
      continue;
    }
    const money = line.match(/^(rate|amt|amount|price|unit\s*price)\s*[:\-]\s*(?:aed|dhs?)?\s*(\d[\d,]*(?:\.\d+)?)/i);
    if (money && pendingItem) {
      const v = num(money[2]);
      if (/^(amt|amount)/i.test(money[1]) || pendingItem.fromLabel) pendingItem.amt = v;
      else pendingItem.rate = v;
      continue;
    }
    if (/^(rate|amt|amount|price|unit\s*price)\s*[:\-]/i.test(line) && pendingItem) continue;
    if (isProductBullet || /^inspired\s+by\s*:/i.test(line)) {
      flushItem();
      const name = line.replace(/^inspired\s+by\s*:\s*/i, "").trim();
      if (name) pendingItem = { name, qty: 1 };
      continue;
    }
    flushItem();

    // --- Order number (kept only as a reference)
    const ref = line.match(/^(?:order|invoice|bill|inv)\s*(?:no\.?|number|id|#)?\s*[:#\-]?\s*#?\s*([A-Za-z]{0,4}\d{3,})\s*$/i);
    if (ref) {
      if (!out.vendorRef) out.vendorRef = ref[1];
      continue;
    }

    // --- Total (wins over any per-item amount)
    const total = line.match(/^(?:grand\s*|net\s*|final\s*)?total\s*(?:amount|price|payable|to\s*(?:pay|collect))?\s*[:\-=]?\s*(?:aed|dhs?|dirhams?)?\s*[:\-]?\s*(\d[\d,]*(?:\.\d+)?)/i);
    if (total) {
      totalFromLabel = num(total[1]);
      continue;
    }
    const cod = line.match(/^(?:cod|cod\s*amount|cash\s*on\s*delivery|cash|to\s*collect|collect|payable|amount(?:\s*to\s*(?:collect|pay|be\s*paid|be\s*collected))?|bill\s*amount|net\s*amount|price|total\s*price|payment(?:\s*(?:cod|cash))?)\s*(?:amount)?\s*[:\-=]?\s*(?:cod\s*)?(?:aed|dhs?)?\s*[:\-]?\s*(\d[\d,]*(?:\.\d+)?)/i);
    if (cod) {
      totalFromLabel = num(cod[1]);
      continue;
    }

    // --- "Akoya 2 total 80" — a total at the end of another line
    const tail = line.match(/^(.*?[a-z].*?)[\s,;\-–]+(?:grand\s*)?(?:total|cod)\s*(?:amount)?\s*[:\-=]?\s*(?:aed|dhs?)?\s*(\d[\d,]*(?:\.\d+)?)\s*(?:aed|dhs?|dirhams?|\/-)?\s*$/i);
    if (tail) {
      totalFromLabel = num(tail[2]);
      line = tail[1].trim();
    }

    // --- Labelled fields: "Label: value", "Label - value", or "Emirate sharjha"
    const lab = line.match(/^(name|customer(?:\s*name)?|full\s*name|ph|phone|mobile(?:\s*no\.?)?|mob(?:\s*no\.?)?|contact(?:\s*no\.?)?|tel|whats\s*app|whatsapp|number|address|addr|location|loc|area|building|landmark|delivery\s*address|delivery\s*time|preferred\s*time|timing|time|emirate|city|state|items?|products?|fragrances?|perfumes?|scents?|order\s*details|notes?|remarks?|instructions?)\s*(?:[:：=\-–]\s*|\s+(?=\S))(.+)$/i);
    if (lab) {
      const key = lab[1].toLowerCase();
      const value = lab[2].trim().replace(/,$/, "");
      if (/^(ph|phone|mobile|mob|contact|tel|whats|number)/.test(key)) {
        const all = [...value.matchAll(new RegExp(PHONE_RE.source, "g"))];
        for (const pm of all) addPhone(pm[0]);
        if (!all.length) leftovers.push({ t: line, i: li });
      } else if (/^(name|customer|full)/.test(key)) {
        if (!out.customerName) out.customerName = value;
      } else if (/^(address|addr|location|loc|area|building|landmark|delivery)/.test(key)) {
        // "Building 4" / "Area 2" without a colon: the word is part of the address
        addressParts.push(/^(building|area)$/.test(key) && !/^\S+\s*[:：=\-–]/.test(line) ? line.replace(/,$/, "") : value);
      } else if (/^(time|timing|delivery\s*time|preferred\s*time)/.test(key)) {
        notes.push(`Time: ${value}`);
      } else if (/^(emirate|city|state)/.test(key)) {
        out.emirate = detectEmirate(value) ?? value.toUpperCase();
      } else if (/^(item|product|order|fragrance|perfume|scent)/.test(key)) {
        const partsL = value.split(/\s*[,;]\s*/).filter(Boolean);
        const one = partsL.length === 1 ? parseItemLine(partsL[0], false) : null;
        if (one && one.price === undefined && !/\d/.test(partsL[0].replace(SIZE_RE, ""))) {
          // "Product: Akoya" — a "Qty:" / "Price:" line may follow
          pendingItem = { name: one.name, qty: one.qty, fromLabel: true };
          continue;
        }
        for (const part of partsL) {
          const it = parseItemLine(part, false);
          items.push(it ? fmtItem(it.qty, it.name, it.price) : part);
          if (it?.price !== undefined) itemPrices.push(it.price);
        }
      } else {
        notes.push(value);
      }
      continue;
    }

    // --- "Anurag Cp 566905892, Fire Station Road, Muwaileh, Sharjah" — name, phone, address in one line
    const inline = line.match(PHONE_RE);
    if (inline && inline.index !== undefined) {
      const before = line.slice(0, inline.index).replace(/[,\-–:]+\s*$/, "").trim();
      const after = line.slice(inline.index + inline[0].length).replace(/^[\s,\-–:]+/, "").trim();
      const nameLike = before && !/\d/.test(before) && before.split(/\s+/).length <= 5 && !detectEmirate(before);
      if (nameLike && after.length > 3) {
        if (!out.customerName) out.customerName = before;
        addPhone(inline[0]);
        addressParts.push(after);
        continue;
      }
      // "Fatima 0501234567" — name and phone only
      if (nameLike && !after && before.length >= 2) {
        if (!out.customerName) out.customerName = before;
        addPhone(inline[0]);
        continue;
      }
      // "0501234567, Villa 12, Mirdif" — phone then address
      if (!before && after.length > 3 && (ADDRESS_WORDS.test(after) || detectEmirate(after))) {
        addPhone(inline[0]);
        addressParts.push(after);
        continue;
      }
    }

    // --- A line that is only an amount: "120 aed", "AED 120"
    const bare = line.match(/^(?:(?:aed|dhs?)\s*(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s*(?:aed|dhs?|dirhams?))\s*$/i);
    if (bare) {
      if (totalFromLabel === undefined) totalFromLabel = num(bare[1] ?? bare[2]);
      continue;
    }

    // --- Manual item lines in any common style ("Akoya 2pc-AED 80", "2 Akoya 80aed", "Akoya x2", …)
    // A list number ("1.", "2)") in front is not a quantity.
    const lineBeforeNumber = line;
    line = line.replace(/^\d{1,2}\s*[.)]\s*(?=[a-z])/i, "");
    if (!PHONE_RE.test(line) && !ADDRESS_WORDS.test(line) && !(detectEmirate(line) && !/\d/.test(line))) {
      // several items on one line: "Akoya 2pc, Noir 1pc", "akoya 2 noir 1", "1 Noir 1 Akoya"
      const noComma = !/[,;]/.test(line) && !detectEmirate(line) && !new RegExp(String.raw`\b${CUR}\b|\btotal\b|[x×*=]\s*\d|\d\s*(?:${UNIT})\b`, "i").test(line);
      const trailing = noComma && /^(?:\s*[a-z][^\d]*?\s+\d{1,2})(?:\s+[a-z][^\d]*?\s+\d{1,2}){1,}\s*$/i.test(line);
      const leading = noComma && /^(?:\s*\d{1,2}\s+[a-z][^\d]*?)(?:\s+\d{1,2}\s+[a-z][^\d]*?){1,}\s*$/i.test(line);
      if (trailing || leading) {
        const re = trailing ? /([a-z][^\d]*?)\s+(\d{1,2})/gi : /(\d{1,2})\s+([a-z][^\d]*?)(?=\s+\d|\s*$)/gi;
        for (const m of line.matchAll(re)) items.push(trailing ? `${m[2]} × ${m[1].trim()}` : `${m[1]} × ${m[2].trim()}`);
        continue;
      }
      // a lone "Akoya 2" (name then a small number)
      const lone = !detectEmirate(line) && !new RegExp(String.raw`\b${CUR}\b`, "i").test(line) && line.match(/^([a-z][a-z\s'’&.-]{1,50}?)\s+(\d{1,2})$/i);
      if (lone && Number(lone[2]) >= 1 && Number(lone[2]) <= 20) {
        items.push(`${lone[2]} × ${lone[1].trim()}`);
        continue;
      }
      const plus = line.split(/\s*\+\s*/).map((x) => x.trim()).filter(Boolean);
      if (plus.length >= 2 && plus.every((x) => /[a-z]{2}/i.test(x) && x.length <= 50)) {
        for (const x of plus) {
          const it = parseItemLine(x, false);
          items.push(it ? fmtItem(it.qty, it.name, it.price) : fmtItem(1, x));
          if (it?.price !== undefined) itemPrices.push(it.price);
        }
        continue;
      }
      const parts = line.split(/\s*[,;]\s*|\s+&\s+/).filter(Boolean);
      const parsed = parts.map((p) => parseItemLine(p));
      if (parsed.length && parsed.every(Boolean)) {
        for (const it of parsed as ParsedItem[]) {
          items.push(fmtItem(it.qty, it.name, it.price));
          if (it.price !== undefined) itemPrices.push(it.price);
        }
        continue;
      }
    }

    line = lineBeforeNumber;
    // --- Unlabelled phone on its own line
    const pm = line.match(PHONE_RE);
    if (pm && line.replace(pm[0], "").replace(/[^A-Za-z]/g, "").length < 4) {
      addPhone(pm[0]);
      continue;
    }

    // --- Driver instructions
    if (/^(?:please\s+)?(?:call|deliver|delivery|don'?t|do not|leave|ring|before|after|urgent|send)\b/i.test(line) && !/\d{3}/.test(line)) {
      notes.push(line);
      continue;
    }

    leftovers.push({ t: line, i: li });
    if (itemsSection) itemLineIdx.add(li);
  }
  flushItem();
  markLine();

  // Plain product names with no qty/price ("Akoya" / "Noir" above "Total 80") sit next to item or
  // total lines; address lines don't. Walk outwards from the known item lines.
  const isPlainName = (t: string) =>
    t.length <= 40 && !/\d/.test(t) && t.split(/\s+/).length <= 5 && !ADDRESS_WORDS.test(t) && !detectEmirate(t) && !isKnownArea(t) && !/[,;:]/.test(t);
  for (let changed = true; changed; ) {
    changed = false;
    for (const l of leftovers) {
      if (itemLineIdx.has(l.i) || !isPlainName(l.t)) continue;
      if (itemLineIdx.has(l.i - 1) || itemLineIdx.has(l.i + 1)) {
        itemLineIdx.add(l.i);
        changed = true;
      }
    }
  }
  const plainItems = leftovers.filter((l) => itemLineIdx.has(l.i));
  // "ALF" above "Alf classic x2" is a heading, not a separate piece.
  const itemNames = items.map((x) => x.replace(/^\d+\s*×\s*/, "").toLowerCase());
  // Never take every leftover as an item — the name and address must remain.
  if (plainItems.length && (plainItems.length < leftovers.length || (out.customerName && addressParts.length))) {
    for (const l of plainItems) {
      const low = l.t.toLowerCase().trim();
      const isHeading = itemNames.some((n) => n !== low && n.startsWith(low + " "));
      if (isHeading) {
        const at = items.findIndex((x) => x.replace(/^\d+\s*×\s*/, "").toLowerCase().startsWith(low + " "));
        items.splice(at < 0 ? items.length : at, 0, `▸ ${l.t.trim()}`);
      } else items.push(fmtItem(1, l.t));
    }
    leftovers.splice(0, leftovers.length, ...leftovers.filter((l) => !itemLineIdx.has(l.i)));
  }

  // Name: first short line without digits that isn't an emirate word.
  if (!out.customerName) {
    const idx = leftovers.findIndex(({ t: l }) => l.length <= 40 && !/\d/.test(l) && l.split(/\s+/).length <= 5 && !detectEmirate(l));
    if (idx >= 0) out.customerName = leftovers.splice(idx, 1)[0].t;
  }
  if (out.customerName) out.customerName = out.customerName.replace(/^(?:order\s+for|for|customer|name)\s*[:\-]?\s+/i, "").replace(/[,.\-–:]+$/, "").trim();
  addressParts.push(...leftovers.map((l) => l.t));

  if (addressParts.length) out.address = tidyAddress(addressParts);
  if (items.length) out.items = items.join(", ");
  if (altPhones.length) notes.unshift(`Alt phone: ${altPhones.join(" / ")}`);
  if (prepaid) notes.unshift("Prepaid");
  if (notes.length) out.notes = notes.join("; ");
  if (!out.emirate) out.emirate = emirateForOrder([out.address, raw].filter(Boolean).join(" "));
  // No "Total" line: add up the item prices (each line's price is that line's amount).
  const itemSum = subtotal ?? (itemPrices.length ? itemPrices.reduce((a, b) => a + b, 0) : undefined);
  if (itemSum !== undefined) out.itemSum = itemSum + (deliveryFee ?? 0);
  out.codAmount = prepaid ? 0 : totalFromLabel ?? (itemSum !== undefined ? itemSum + (deliveryFee ?? 0) : undefined);
  if (!out.customerPhone) {
    const pm = raw.match(PHONE_RE);
    if (pm) out.customerPhone = cleanPhone(pm[0]);
  }
  return out;
}
