import React from "react";

/** EW's agents / salesmen — must match AGENTS in backend photoReader.service.ts. */
export const EW_AGENTS = ["N", "T", "THAHSI", "SULU", "F", "M", "KD", "HAIRA", "RAHIMA", "K"] as const;

/** "Pickup delivery": we collect a parcel from the customer. Payment is usually the delivery charge, or nothing. */
export const PICKUP_RE = /\b(pick\s*-?\s*up|p\/u|collect(ion)?\s+from\s+customer|reverse\s+pick)/i;
export function isPickup(b: { notes?: string | null; items?: string | null } | null | undefined): boolean {
  return Boolean(b && (PICKUP_RE.test(b.notes ?? "") || /^\s*pick\s*-?\s*up\b/i.test(b.items ?? "")));
}

export interface NotePart {
  label: string | null;
  text: string;
  strong?: boolean;
}

export interface ParsedNotes {
  bill: string | null;
  agent: string | null;
  parts: NotePart[];
}

const KNOWN_LABELS = /^(alt\.?\s*phone|alt|phone|call|location|loc|time|deliver|delivery|landmark|driver|map|pin|whatsapp)\b\s*[:\-]?\s*/i;

/**
 * Split a booking's notes ("Bill 1211 · Agent KD · TOP URGENT · Alt phone: 050…")
 * into the bill No., the agent and the remaining parts, each with an optional label.
 */
export function parseNotes(notes: string | null | undefined): ParsedNotes {
  const out: ParsedNotes = { bill: null, agent: null, parts: [] };
  const segs = String(notes ?? "")
    .split(/\s*(?:·|\||\n)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const s of segs) {
    const bill = s.match(/^bill\s*(?:no\.?)?\s*[:#-]?\s*(.+)$/i);
    if (bill && !out.bill) {
      out.bill = bill[1].trim();
      continue;
    }
    const agent = s.match(/^agent\s*[:\-]?\s*(.+)$/i);
    if (agent && !out.agent) {
      out.agent = agent[1].trim().toUpperCase();
      continue;
    }
    const colon = s.match(/^([A-Za-z][A-Za-z .]{0,18}?)\s*:\s*(.+)$/);
    if (colon) {
      out.parts.push({ label: colon[1].trim(), text: colon[2].trim() });
      continue;
    }
    const known = s.match(KNOWN_LABELS);
    if (known && s.length > known[0].length) {
      out.parts.push({ label: known[1].trim(), text: s.slice(known[0].length).trim() });
      continue;
    }
    // ALL-CAPS words like "TOP URGENT", "REFUND" are flags — print them strong.
    const flag = (/[A-Z]/.test(s) && s === s.toUpperCase()) || PICKUP_RE.test(s);
    out.parts.push({ label: null, text: s, strong: flag });
  }
  return out;
}

/** Parts left after dropping a bare "PICKUP" / "PICKUP DELIVERY" word (shown as a banner instead). */
export function visibleParts(parts: NotePart[], hidePickup: boolean): NotePart[] {
  return hidePickup ? parts.filter((x) => x.label || !/^\s*pick\s*-?\s*up(\s+delivery)?\s*$/i.test(x.text)) : parts;
}

/** Notes with bold labels, for screens and labels. Bill and agent are left out when shown elsewhere. */
export function NotesText({
  notes,
  hideBill = false,
  hideAgent = false,
  hidePickup = false,
  sep = " | ",
}: {
  notes: string | null | undefined;
  hideBill?: boolean;
  hideAgent?: boolean;
  /** Leave out a bare "PICKUP" word when a pickup banner is already shown. */
  hidePickup?: boolean;
  sep?: string;
}) {
  const p = parseNotes(notes);
  const items: React.ReactNode[] = [];
  if (p.bill && !hideBill) items.push(<><b>BILL:</b> {p.bill}</>);
  if (p.agent && !hideAgent) items.push(<><b>AGENT:</b> <b>{p.agent}</b></>);
  for (const part of visibleParts(p.parts, hidePickup)) {
    if (part.label) items.push(<><b>{part.label.toUpperCase()}:</b> {part.text}</>);
    else if (part.strong) items.push(<b style={{ fontWeight: 800 }}>{part.text}</b>);
    else items.push(<>{part.text}</>);
  }
  if (!items.length) return null;
  return (
    <>
      {items.map((n, i) => (
        <React.Fragment key={i}>
          {i > 0 && sep}
          {n}
        </React.Fragment>
      ))}
    </>
  );
}
