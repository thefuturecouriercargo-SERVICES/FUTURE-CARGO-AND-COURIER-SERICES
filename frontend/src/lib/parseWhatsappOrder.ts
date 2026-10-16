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

export interface ParsedOrder {
  customerName?: string;
  customerPhone?: string;
  address?: string;
  emirate?: string;
  items?: string;
  codAmount?: number;
  notes?: string;
  vendorRef?: string;
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
  /^(sub\s*total|shipping|delivery\s*charge|discount)\b/i,
];

function cleanPhone(raw: string): string {
  let d = raw.replace(/[^\d+]/g, "").replace(/^\+/, "");
  if (d.startsWith("00971")) d = d.slice(5);
  else if (d.startsWith("971")) d = d.slice(3);
  if (!d.startsWith("0")) d = "0" + d;
  if (/^05\d{8}$/.test(d)) return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
  return d;
}

function detectEmirate(text: string): string | undefined {
  for (const [re, name] of EMIRATE_WORDS) if (re.test(text)) return name;
  return undefined;
}

function num(s: string): number | undefined {
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 && n < 1_000_000 ? Math.round(n) : undefined;
}

/** Strip emojis, WhatsApp bold/italic markers and bullets. */
function tidy(line: string): string {
  return line
    .replace(/^\[\d{1,2}\/\d{1,2}\/\d{2,4},?\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AP]M)?\]\s*[^:]{1,40}:\s*/i, "")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, "")
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
  const leftovers: string[] = [];
  let pendingItem: { name: string; qty: number } | null = null;
  let totalFromLabel: number | undefined;
  let lastAedAmount: number | undefined;

  const flushItem = () => {
    if (pendingItem) items.push(`${pendingItem.qty} × ${pendingItem.name}`);
    pendingItem = null;
  };

  for (const rawLine of rawLines) {
    const isProductBullet = /^\s*(?:🔹|🔸|▪️|▫️|•|◾|➤|👉)/u.test(rawLine);
    const line = tidy(rawLine);
    if (!line) continue;
    if (BOILERPLATE.some((re) => re.test(line))) continue;

    // --- Catalog product blocks: "🔹 Inspired by: Noir…" then "Qty : 1", "Rate", "Amt"
    const qty = line.match(/^qty\s*[:\-]?\s*(\d+)/i);
    if (qty) {
      if (pendingItem) pendingItem.qty = Number(qty[1]);
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
    const total = line.match(/^(?:grand\s*)?total\s*(?:amount)?\s*[:\-=]?\s*(?:aed|dhs?|dirhams?)?\s*[:\-]?\s*(\d[\d,]*(?:\.\d+)?)/i);
    if (total) {
      totalFromLabel = num(total[1]);
      continue;
    }
    const cod = line.match(/^(?:cod|cod\s*amount|to\s*collect|collect|payable)\s*[:\-=]?\s*(?:aed|dhs?)?\s*(\d[\d,]*(?:\.\d+)?)/i);
    if (cod) {
      totalFromLabel = num(cod[1]);
      continue;
    }

    // --- Labelled fields: "Label: value", "Label - value", or "Emirate sharjha"
    const lab = line.match(/^(name|customer(?:\s*name)?|full\s*name|ph|phone|mobile(?:\s*no\.?)?|mob(?:\s*no\.?)?|contact(?:\s*no\.?)?|tel|whats\s*app|whatsapp|number|address|addr|location|area|building|landmark|delivery\s*address|emirate|city|state|items?|products?|order\s*details|notes?|remarks?|instructions?)\s*(?:[:：=\-–]\s*|\s+(?=\S))(.+)$/i);
    if (lab) {
      const key = lab[1].toLowerCase();
      const value = lab[2].trim().replace(/,$/, "");
      if (/^(ph|phone|mobile|mob|contact|tel|whats|number)/.test(key)) {
        const pm = value.match(PHONE_RE);
        if (pm && !out.customerPhone) out.customerPhone = cleanPhone(pm[0]);
        else if (!pm) leftovers.push(line);
      } else if (/^(name|customer|full)/.test(key)) {
        if (!out.customerName) out.customerName = value;
      } else if (/^(address|addr|location|area|building|landmark|delivery)/.test(key)) {
        addressParts.push(value);
      } else if (/^(emirate|city|state)/.test(key)) {
        out.emirate = detectEmirate(value) ?? value.toUpperCase();
      } else if (/^(item|product|order)/.test(key)) {
        items.push(value);
      } else {
        notes.push(value);
      }
      continue;
    }

    // --- A line that is only an amount: "120 aed", "AED 120"
    const bare = line.match(/^(?:(?:aed|dhs?)\s*(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s*(?:aed|dhs?|dirhams?))\s*$/i);
    if (bare) {
      if (totalFromLabel === undefined) totalFromLabel = num(bare[1] ?? bare[2]);
      continue;
    }

    // --- Manual item lines: "Akoya-AED 40,", "Noir - 40 AED", "Ahl 40 dhs"
    const itemLine =
      line.match(/^(.{2,60}?)\s*[-–:=]?\s*(?:aed|dhs?|dirhams?)\s*\.?\s*(\d[\d,]*(?:\.\d+)?)\s*,?$/i) ||
      line.match(/^(.{2,60}?)\s*[-–:=]\s*(\d[\d,]*(?:\.\d+)?)\s*(?:aed|dhs?|dirhams?)?\s*,?$/i) ||
      line.match(/^(.{2,60}?)\s+(\d[\d,]*(?:\.\d+)?)\s*(?:aed|dhs?|dirhams?)\s*,?$/i);
    if (itemLine && !PHONE_RE.test(line) && /[a-z]/i.test(itemLine[1])) {
      items.push(itemLine[1].replace(/[-–:=,\s]+$/, "").trim());
      lastAedAmount = num(itemLine[2]);
      continue;
    }

    // --- "2 x Abaya", "1 pc perfume"
    if (/^\d+\s*(?:x|×|pcs?|pieces?|nos?|qty)\b/i.test(line) || /\b(?:x|×)\s*\d+\b/i.test(line)) {
      items.push(line);
      continue;
    }

    // --- Unlabelled phone on its own line
    const pm = line.match(PHONE_RE);
    if (pm && line.replace(pm[0], "").replace(/[^A-Za-z]/g, "").length < 4) {
      if (!out.customerPhone) out.customerPhone = cleanPhone(pm[0]);
      continue;
    }

    // --- Driver instructions
    if (/^(?:please\s+)?(?:call|deliver|delivery|don'?t|do not|leave|ring|before|after|urgent|send)\b/i.test(line) && !/\d{3}/.test(line)) {
      notes.push(line);
      continue;
    }

    leftovers.push(line);
  }
  flushItem();

  // Name: first short line without digits that isn't an emirate word.
  if (!out.customerName) {
    const idx = leftovers.findIndex((l) => l.length <= 40 && !/\d/.test(l) && l.split(/\s+/).length <= 5 && !detectEmirate(l));
    if (idx >= 0) out.customerName = leftovers.splice(idx, 1)[0];
  }
  addressParts.push(...leftovers);

  if (addressParts.length) out.address = addressParts.join(", ");
  if (items.length) out.items = items.join(", ");
  if (notes.length) out.notes = notes.join("; ");
  if (!out.emirate) out.emirate = detectEmirate([out.address, raw].filter(Boolean).join(" "));
  out.codAmount = totalFromLabel ?? (items.length <= 1 ? lastAedAmount : undefined);
  if (!out.customerPhone) {
    const pm = raw.match(PHONE_RE);
    if (pm) out.customerPhone = cleanPhone(pm[0]);
  }
  return out;
}
