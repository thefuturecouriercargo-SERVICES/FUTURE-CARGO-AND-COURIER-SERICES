/**
 * Best-effort parser for a WhatsApp order message pasted by a vendor.
 * Fills what it can recognise; the vendor reviews every field before saving.
 *
 * Handles labelled messages ("Name: …", "Phone - …", "Total AED 250") and
 * unlabelled ones (name on one line, phone on another, address lines).
 */

export interface ParsedOrder {
  customerName?: string;
  customerPhone?: string;
  address?: string;
  emirate?: string;
  items?: string;
  codAmount?: number;
  notes?: string;
}

const EMIRATE_WORDS: [RegExp, string][] = [
  [/\babu\s*dhabi\b|\babudhabi\b|\bauh\b|\bmussafah\b|\bkhalifa city\b|\breem island\b/i, "ABUDHABI"],
  [/\bal\s*ain\b|\balain\b/i, "AL AIN"],
  [/\bras\s*al\s*khaimah\b|\bras\s*al\s*khaima\b|\brak\b/i, "RAS AL KHAIMAH"],
  [/\bumm\s*al\s*quwain\b|\bumm\s*al\s*qaiwain\b|\buaq\b/i, "UMM AL QUWAIN"],
  [/\bfujairah\b|\bfujeirah\b|\bkhor\s*fakkan\b/i, "FUJAIRAH"],
  [/\bajman\b/i, "AJMAN"],
  [/\bsharjah\b|\bshj\b|\bal\s*nahda\b|\bmuwaileh\b|\bal\s*majaz\b|\bal\s*taawun\b|\babu\s*shagara\b/i, "SHARJAH"],
  [/\bdubai\b|\bdxb\b|\bdeira\b|\bbur\s*dubai\b|\bjlt\b|\bmarina\b|\bal\s*barsha\b|\bkarama\b|\bqusais\b|\bjvc\b|\bmirdif\b|\binternational city\b|\bsilicon oasis\b/i, "DUBAI"],
];

const LABELS: { key: keyof ParsedOrder; re: RegExp }[] = [
  { key: "customerName", re: /^(?:customer\s*)?(?:full\s*)?name|^customer$|^cust(?:omer)?\s*name/i },
  { key: "customerPhone", re: /^(?:mobile|mob|phone|ph|contact|tel|whats\s*app|whatsapp|number|no\.?|cell)(?:\s*(?:no|number|#))?\.?$/i },
  { key: "address", re: /^(?:address|addr|location|area|delivery\s*address|building|flat|villa|street|landmark|place)$/i },
  { key: "emirate", re: /^(?:emirate|city|state)$/i },
  { key: "items", re: /^(?:items?|products?|order|order\s*details|details|description|qty|item\s*details)$/i },
  { key: "codAmount", re: /^(?:total|amount|cod|cod\s*amount|price|grand\s*total|total\s*amount|bill|payable|to\s*collect|collect)$/i },
  { key: "notes", re: /^(?:notes?|remarks?|comments?|instructions?)$/i },
];

// UAE mobiles/landlines in their common written forms.
const PHONE_RE = /(?:\+?971|00971|0)?[\s-]*\(?0?(?:5[024568]|[2-79])\)?[\s-]*\d{3}[\s-]*\d{4}\b/;

function cleanPhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  let d = digits.replace(/^\+/, "");
  if (d.startsWith("00971")) d = d.slice(5);
  else if (d.startsWith("971")) d = d.slice(3);
  if (!d.startsWith("0")) d = "0" + d;
  // 05x xxx xxxx
  if (/^05\d{8}$/.test(d)) return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
  return d;
}

function findAmount(text: string): number | undefined {
  const patterns = [
    /(?:total|amount|cod|grand\s*total|price|payable|collect)[^\d\n]{0,15}(\d[\d,]*(?:\.\d+)?)/i,
    /(?:aed|dhs?|dirhams?)\s*\.?\s*(\d[\d,]*(?:\.\d+)?)/i,
    /(\d[\d,]*(?:\.\d+)?)\s*(?:aed|dhs?|dirhams?)\b/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const n = Number(m[1].replace(/,/g, ""));
      if (Number.isFinite(n) && n >= 0 && n < 1_000_000) return Math.round(n);
    }
  }
  return undefined;
}

function detectEmirate(text: string): string | undefined {
  for (const [re, name] of EMIRATE_WORDS) if (re.test(text)) return name;
  return undefined;
}

export function parseWhatsappOrder(raw: string): ParsedOrder {
  // Strip WhatsApp export prefixes like "[14/10/26, 3:12 PM] Fatima:" and bold/italic markers.
  const lines = raw
    .split(/\r?\n/)
    .map((l) =>
      l
        .replace(/^\[\d{1,2}\/\d{1,2}\/\d{2,4},?\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AP]M)?\]\s*[^:]{1,40}:\s*/i, "")
        .replace(/[*_~]/g, "")
        .replace(/^[\s•\-–—>]+/, "")
        .trim()
    )
    .filter(Boolean);

  const out: ParsedOrder = {};
  const leftovers: string[] = [];
  const itemLines: string[] = [];
  const addressLines: string[] = [];

  for (const line of lines) {
    // "Label: value" / "Label - value" / "Label = value"
    const m = line.match(/^([A-Za-z][A-Za-z .#/]{0,24}?)\s*[:：=\-–]\s*(.+)$/);
    const label = m ? LABELS.find((l) => l.re.test(m[1].trim())) : undefined;
    if (m && label) {
      const value = m[2].trim();
      if (label.key === "customerPhone") {
        const pm = value.match(PHONE_RE);
        if (pm && !out.customerPhone) out.customerPhone = cleanPhone(pm[0]);
      } else if (label.key === "codAmount") {
        const n = findAmount(`total ${value}`) ?? (Number(value.replace(/[^\d.]/g, "")) || undefined);
        if (n !== undefined && out.codAmount === undefined) out.codAmount = n;
      } else if (label.key === "address") {
        addressLines.push(value);
      } else if (label.key === "items") {
        itemLines.push(value);
      } else if (label.key === "emirate") {
        out.emirate = detectEmirate(value) ?? value.toUpperCase();
      } else if (!out[label.key]) {
        (out as Record<string, string>)[label.key] = value;
      }
      continue;
    }

    // Headings like "Order", "New order", "Order details" carry no data.
    if (/^(?:new\s*)?order(?:\s*(?:details|confirmation|#?\s*\d*))?:?$/i.test(line) || /^(?:hi|hello|salam|assalam)/i.test(line)) continue;

    // Instructions for the driver → notes.
    if (/^(?:please\s+)?(?:call|deliver|delivery|don'?t|do not|leave|ring|before|after|urgent|send)\b/i.test(line) && !/\d{3}/.test(line)) {
      out.notes = out.notes ? `${out.notes}; ${line}` : line;
      continue;
    }

    // Unlabelled phone number on its own line (or inside a line).
    const pm = line.match(PHONE_RE);
    if (pm && !out.customerPhone && line.replace(pm[0], "").replace(/[^A-Za-z]/g, "").length < 4) {
      out.customerPhone = cleanPhone(pm[0]);
      continue;
    }

    // Unlabelled amount line ("250 AED", "Total 250").
    if (out.codAmount === undefined && /\b(aed|dhs?|dirhams?|total|cod)\b/i.test(line) && line.length < 40) {
      const n = findAmount(line);
      if (n !== undefined) {
        out.codAmount = n;
        continue;
      }
    }

    // "2 x abaya", "1 pc perfume" → items
    if (/^\d+\s*(?:x|×|pcs?|pieces?|nos?|qty)\b/i.test(line) || /\b(?:x|×)\s*\d+\b/i.test(line)) {
      itemLines.push(line);
      continue;
    }

    leftovers.push(line);
  }

  // Unlabelled: first short line without digits is usually the name; the rest is the address.
  if (!out.customerName && leftovers.length) {
    const idx = leftovers.findIndex((l) => l.length <= 40 && !/\d/.test(l) && !detectEmirate(l) && l.split(/\s+/).length <= 5);
    if (idx >= 0) out.customerName = leftovers.splice(idx, 1)[0];
  }
  addressLines.push(...leftovers);

  if (addressLines.length) out.address = addressLines.join(", ");
  if (itemLines.length) out.items = itemLines.join(", ");
  if (!out.emirate) out.emirate = detectEmirate([out.address, raw].filter(Boolean).join(" "));
  if (out.codAmount === undefined) out.codAmount = findAmount(raw);
  if (!out.customerPhone) {
    const pm = raw.match(PHONE_RE);
    if (pm) out.customerPhone = cleanPhone(pm[0]);
  }
  return out;
}
