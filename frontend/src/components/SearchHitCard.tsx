"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "@/components/ui/Feedback";
import { fmtNumber, fmtDate } from "@/lib/format";
import { NotesText, isPickup } from "@/lib/notes";
import CustomerRiskBadge from "@/components/CustomerRiskBadge";
import { OrderBookingDetails } from "@/types";

type Stage = "AWAITING_PICKUP" | "REJECTED" | "PENDING" | "DELIVERED" | "TRANSFER" | "CANCELLED";

export interface SearchHitDetails {
  cnNo: number;
  vendorName: string;
  stage: Stage;
  amount: number;
  emirate: string;
  driver?: string | null;
  billNo?: string | null;
  vendorRef?: string | null;
  orderId?: string | null;
  orderDate?: string | null;
  enteredAt?: string;
  resolvedAt?: string | null;
  deliveryCharge?: number | null;
  payment?: string | null;
  remarks?: string | null;
  driverNote?: string | null;
  driverNoteAt?: string | null;
  rejectReason?: string | null;
  note?: string | null;
  booking?: OrderBookingDetails | null;
  /** Which fields the search term matched ("Order no", "Bill no" …). */
  matched?: string[];
}

const GOLD = "#E2B857";
// Phones: 3 tiles a row; wider screens: all tiles on one row.
const SM_COLS: Record<number, string> = { 1: "sm:grid-cols-1", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-4", 5: "sm:grid-cols-5", 6: "sm:grid-cols-6" };

/** "10 NOV · 12:05 AM" in Dubai time. */
function fmtShort(iso?: string | null) {
  if (!iso) return "—";
  const t = new Date(iso);
  if (isNaN(t.getTime())) return "—";
  const day = t.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "Asia/Dubai" });
  const time = t.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Dubai" });
  return `${day} · ${time}`;
}

/** Whole days the parcel has been open, counted from its sheet day (Dubai calendar). */
function daysOpen(orderDate?: string | null) {
  if (!orderDate) return 0;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });
  const diff = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${orderDate}T00:00:00Z`)) / 86400000;
  return diff > 0 ? Math.floor(diff) : 0;
}

function waNumber(phone: string) {
  const d = phone.replace(/[^0-9]/g, "");
  if (d.startsWith("00")) return d.slice(2);
  if (d.startsWith("0")) return "971" + d.slice(1);
  return d;
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch {
      /* ignore */
    }
    ta.remove();
  }
}

/* ---------- icons (line style) ---------- */
const Svg = ({ children, size = 20, width = 2 }: { children: ReactNode; size?: number; width?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);
const IconCheck = () => <Svg size={14} width={3}><path d="M5 12l5 5L20 7" /></Svg>;
const IconX = () => <Svg size={14} width={3}><path d="M6 6l12 12M18 6L6 18" /></Svg>;
const IconPhone = () => (
  <Svg><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" /></Svg>
);
const IconChat = () => <Svg><path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 21l2.1-5.7A8.4 8.4 0 1 1 21 11.5z" /></Svg>;
const IconPin = () => <Svg><path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z" /><circle cx="12" cy="10" r="2.5" /></Svg>;
const IconCopy = () => <Svg><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></Svg>;
const IconEdit = () => <Svg><path d="M4 20h4L19 9l-4-4L4 16v4z" /></Svg>;
const IconShare = () => (
  <Svg><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" /></Svg>
);
const IconAlert = () => <Svg><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></Svg>;

/* ---------- tracking steps ---------- */
type StepState = "done" | "current" | "failed" | "todo";

function Step({ state, label, sub }: { state: StepState; label: string; sub: string }) {
  const dot =
    state === "done" ? (
      <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full text-[#1A1405]" style={{ background: GOLD }}><IconCheck /></span>
    ) : state === "failed" ? (
      <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-[#EF4444] text-white"><IconX /></span>
    ) : state === "current" ? (
      <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full border-2" style={{ borderColor: GOLD }}>
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: GOLD }} />
      </span>
    ) : (
      <span className="h-[26px] w-[26px] rounded-full border-2 border-[#2A3654]" />
    );
  const labelCls = state === "failed" ? "text-[#FCA5A5]" : state === "current" ? "text-[#E2B857]" : state === "todo" ? "text-[#94A3B8]" : "text-[#E5E7EB]";
  return (
    <div className="flex flex-1 flex-col items-center gap-1.5 text-center">
      {dot}
      <span className={`text-xs font-semibold ${labelCls}`}>{label}</span>
      <span className="whitespace-nowrap text-[11px] text-[#94A3B8]">{sub}</span>
    </div>
  );
}

function Line({ color }: { color: string }) {
  return <div className="mt-3 h-0.5 flex-1" style={{ background: color }} />;
}

function Row({ label, children, tone }: { label: string; children: ReactNode; tone?: "note" | "hit" }) {
  return (
    <div className={`flex justify-between gap-4 border-b border-[#1F2A44] px-3.5 py-3 last:border-b-0 ${tone === "note" ? "bg-[#1E1606]" : tone === "hit" ? "bg-[#1A1608]" : ""}`}>
      <span className="shrink-0 text-[#94A3B8]">{label}</span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}

function Tile({ children, href, onClick, tone = "plain", label }: { children: ReactNode; href?: string; onClick?: () => void; tone?: "gold" | "green" | "plain"; label: string }) {
  const cls =
    tone === "gold"
      ? "bg-[#1A1608] text-[#E2B857] hover:bg-[#2A2210]"
      : tone === "green"
        ? "bg-[#0B2416] text-[#4ADE80] hover:bg-[#10331F]"
        : "bg-[#111A2E] text-[#CBD5E1] hover:bg-[#18233B]";
  const inner = (
    <>
      {children}
      <span>{label}</span>
    </>
  );
  const base = `flex h-[72px] flex-col items-center justify-center gap-1.5 rounded-xl text-xs font-semibold uppercase ${cls}`;
  return href ? (
    <a href={href} target={href.startsWith("tel:") ? undefined : "_blank"} rel="noreferrer" className={base}>
      {inner}
    </a>
  ) : (
    <button type="button" onClick={onClick} className={base}>
      {inner}
    </button>
  );
}

/**
 * Admin search popup: tracking steps, one details table, and the action tiles.
 * A cancelled parcel shows its reason (driver note / office remark) in a red box.
 */
export default function SearchHitCard({ h, area, onEdit }: { h: SearchHitDetails; area?: string | null; onEdit?: () => void }) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<Blob | null>(null);
  const b = h.booking ?? null;
  const cancelled = h.stage === "CANCELLED";
  const rejected = h.stage === "REJECTED";
  const delivered = h.stage === "DELIVERED";
  const open = h.stage === "PENDING" || h.stage === "TRANSFER";
  const days = open ? daysOpen(h.orderDate) : 0;
  const cod = h.amount;

  // ---- header status chip
  const chip = delivered
    ? { text: "Delivered", cls: "bg-[#0B2416] text-[#4ADE80]" }
    : cancelled
      ? { text: "Cancelled", cls: "bg-[#3B0D0D] text-[#FCA5A5]" }
      : rejected
        ? { text: "Rejected", cls: "bg-[#3B0D0D] text-[#FCA5A5]" }
        : h.stage === "AWAITING_PICKUP"
          ? { text: "Awaiting pickup", cls: "bg-[#3A2A06] text-[#F5C451]" }
          : { text: `${h.stage === "TRANSFER" ? "Transfer" : "Pending"}${days > 0 ? ` · ${days} day${days === 1 ? "" : "s"}` : ""}`, cls: "bg-[#3A2A06] text-[#F5C451]" };

  // ---- tracking steps
  const s2: { state: StepState; label: string; sub: string } =
    h.stage === "AWAITING_PICKUP"
      ? { state: "current", label: "Awaiting pickup", sub: h.vendorName }
      : rejected
        ? { state: "failed", label: "Rejected", sub: "Not picked up" }
        : { state: open ? "current" : "done", label: h.stage === "TRANSFER" ? "Transferred" : "With driver", sub: h.driver ?? "Not assigned" };
  const s3: { state: StepState; label: string; sub: string } = delivered
    ? { state: "done", label: "Delivered", sub: fmtShort(h.resolvedAt) }
    : cancelled
      ? { state: "failed", label: "Cancelled", sub: fmtShort(h.resolvedAt) }
      : { state: "todo", label: "Delivered", sub: "Not yet" };
  const line1 = rejected ? "#EF4444" : GOLD;
  const line2 = delivered ? GOLD : cancelled ? "#EF4444" : "#2A3654";

  // ---- reason box (cancelled / rejected)
  const reasonText = rejected ? h.rejectReason : h.driverNote || h.remarks;
  const reasonBy = rejected
    ? "Rejected at pickup"
    : h.driverNote
      ? `Driver note${h.driver ? ` · ${h.driver}` : ""}${h.driverNoteAt ? ` · ${fmtShort(h.driverNoteAt)}` : ""}`
      : h.remarks
        ? "Office remark"
        : "";

  // ---- money
  const codView =
    b && cod === 0 ? (
      <b className="text-[#FCA5A5]">PREPAID — do not collect cash</b>
    ) : cod < 0 ? (
      <b className="text-[#93C5FD]">↩ REFUND — give AED {fmtNumber(-cod)}</b>
    ) : cancelled ? (
      <span className="text-[#94A3B8]">AED {fmtNumber(cod)} · Not collected</span>
    ) : (
      <b style={{ color: GOLD }}>
        AED {fmtNumber(cod)}
        {h.payment ? ` · ${h.payment === "BANK" ? "Bank" : "Cash"}` : ""}
      </b>
    );

  const address = b ? `${b.address}${b.emirate && !b.address.toLowerCase().includes(b.emirate.toLowerCase()) ? `, ${b.emirate}` : ""}` : null;
  const tel = b ? b.customerPhone.replace(/[^0-9+]/g, "") : "";
  const waText = b ? encodeURIComponent(`Hello ${b.customerName}, this is Future Courier about your ${h.vendorName} order (CN ${h.cnNo}).`) : "";
  const mapHref = b
    ? b.lat != null && b.lng != null
      ? `https://www.google.com/maps/search/?api=1&query=${b.lat},${b.lng}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${b.address}, ${b.emirate}, UAE`)}`
    : undefined;
  const copyText = [
    `CN ${h.cnNo} — ${h.vendorName}`,
    b ? `Customer: ${b.customerName}` : "",
    b ? `Phone: ${b.customerPhone}` : "",
    address ? `Address: ${address}` : "",
    b?.items ? `Items: ${b.items}` : "",
    b?.notes ? `Note: ${b.notes}` : "",
    cod === 0 && b ? "PREPAID — do not collect cash" : cod < 0 ? `REFUND: give the customer AED ${fmtNumber(-cod)}` : `COD: AED ${fmtNumber(cod)}`,
  ]
    .filter(Boolean)
    .join("\n");

  const orderNo = h.vendorRef || b?.vendorRef || null;
  const hit = (k: string) => (h.matched ?? []).includes(k);
  // Share = a picture of this popup (without the buttons). The picture is drawn as
  // soon as the popup opens, so tapping Share opens the share sheet straight away
  // (iPhone only allows the share sheet right after a tap).
  async function drawImage(): Promise<Blob | null> {
    if (!cardRef.current) return null;
    const { toBlob } = await import("html-to-image");
    const opts = {
      pixelRatio: 2,
      cacheBust: true,
      backgroundColor: "#0D1424",
      filter: (n: HTMLElement) => !(n instanceof HTMLElement && n.dataset && n.dataset.shareHide),
    };
    try {
      return await toBlob(cardRef.current, opts);
    } catch {
      return await toBlob(cardRef.current, { ...opts, skipFonts: true });
    }
  }
  useEffect(() => {
    imgRef.current = null;
    const t = setTimeout(() => {
      drawImage()
        .then((b) => {
          imgRef.current = b;
        })
        .catch(() => {});
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h.cnNo, h.stage]);

  async function share() {
    setBusy(true);
    try {
      const blob = imgRef.current ?? (await drawImage());
      if (!blob) throw new Error("Could not draw the picture");
      imgRef.current = blob;
      const file = new File([blob], `CN-${h.cnNo}.png`, { type: "image/png" });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.canShare && nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], title: `CN ${h.cnNo}` });
        return;
      }
      // Desktop: download the picture to attach anywhere.
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast("Picture downloaded", "success", `CN-${h.cnNo}.png — attach it in WhatsApp.`);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return; // share sheet closed
      toast("Could not share the picture", "error", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const tiles: ReactNode[] = [];
  if (b) {
    tiles.push(<Tile key="call" tone="gold" label="Call" href={`tel:${tel}`}><IconPhone /></Tile>);
    tiles.push(<Tile key="wa" tone="green" label="WhatsApp" href={`https://wa.me/${waNumber(b.customerPhone)}?text=${waText}`}><IconChat /></Tile>);
    tiles.push(<Tile key="map" label={b.lat != null && b.lng != null ? "Pin" : "Map"} href={mapHref}><IconPin /></Tile>);
  }
  tiles.push(
    <Tile
      key="copy"
      label={copied ? "Copied" : "Copy"}
      onClick={async () => {
        await copyToClipboard(copyText);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <IconCheck /> : <IconCopy />}
    </Tile>
  );
  tiles.push(<Tile key="share" label={busy ? "Wait…" : "Share"} onClick={share}><IconShare /></Tile>);
  if (onEdit) tiles.push(<Tile key="edit" label="Edit" onClick={onEdit}><IconEdit /></Tile>);

  const sub = h.vendorName;

  return (
    <div ref={cardRef} className="overflow-hidden rounded-2xl border border-[#1F2A44] bg-[#0D1424] font-sans uppercase text-[#E5E7EB]">
      {/* header */}
      <div className="flex flex-col gap-1.5 px-5 pb-4 pt-5">
        <div className="flex items-center justify-between gap-3">
          <span className="truncate font-mono text-xs tracking-wider text-[#94A3B8]">
            CN {h.cnNo} · {sub}
          </span>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${chip.cls}`}>{chip.text}</span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate text-2xl font-bold">{b?.customerName ?? h.vendorName}</span>
          <span className={`shrink-0 text-xl font-bold ${cancelled ? "text-[#94A3B8] line-through" : ""}`} style={cancelled ? undefined : { color: GOLD }}>
            {b && cod === 0 ? "Prepaid" : `AED ${fmtNumber(cod)}`}
          </span>
        </div>
      </div>

      {/* tracking */}
      <div className="flex items-start border-y border-[#1F2A44] bg-[#0A1120] px-5 py-4">
        <Step state="done" label="Entered" sub={fmtShort(h.enteredAt)} />
        <Line color={line1} />
        <Step {...s2} />
        <Line color={line2} />
        <Step {...s3} />
      </div>

      {/* reason */}
      {(cancelled || rejected) && (
        <div className="px-5 pt-4">
          <div className="flex gap-3 rounded-xl border border-[#5A1E1E] bg-[#2A0E0E] px-4 py-3.5">
            <span className="mt-0.5 shrink-0 text-[#FCA5A5]"><IconAlert /></span>
            <div className="flex min-w-0 flex-col gap-1">
              <span className="font-mono text-[11px] tracking-wider text-[#FCA5A5]">{rejected ? "Rejection reason" : "Cancellation reason"}</span>
              {reasonText ? (
                <span className="text-base font-semibold text-[#FEE2E2]">{reasonText}</span>
              ) : (
                <span className="text-base font-semibold text-[#FEE2E2]">No reason recorded</span>
              )}
              <span className="text-[13px] text-[#FCA5A5]">
                {reasonText ? reasonBy : "Add it as a remark in Daily Entry"}
                {cancelled && h.resolvedAt ? ` · Cancelled ${fmtShort(h.resolvedAt)}` : ""}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* details table */}
      <div className="px-5 pb-5 pt-4">
        <div className="overflow-hidden rounded-xl border border-[#1F2A44] text-sm">
          {orderNo && (
            <Row label="Order no" tone={hit("Order no") ? "hit" : undefined}>
              <span className="font-mono font-bold" style={{ color: GOLD }}>#{orderNo}</span>
            </Row>
          )}
          {h.billNo && (
            <Row label="Bill no" tone={hit("Bill no") ? "hit" : undefined}>
              <span className="font-mono font-bold" style={{ color: GOLD }}>{h.billNo}</span>
            </Row>
          )}
          {b ? (
            <>
              <Row label="Phone"><span className="font-mono font-bold">{b.customerPhone}</span></Row>
              <Row label="Address">
                <span className="whitespace-pre-wrap">{address}</span>
                {area ? <span className="block text-xs text-[#94A3B8]">Area · {area}</span> : null}
              </Row>
              {b.items && <Row label="Items">{b.items}</Row>}
              {isPickup(b) && (
                <Row label="Type">
                  <b>⇄ Pickup delivery {b.codAmount > 0 ? "· collect delivery charge" : "· no payment"}</b>
                </Row>
              )}
            </>
          ) : (
            <Row label="Customer"><span className="text-[#94A3B8]">No customer details on file</span></Row>
          )}
          {!b && area && <Row label="Area">{area}</Row>}
          <Row label="Emirate">{h.emirate}</Row>
          <Row label="Driver">{h.driver ?? <span className="text-[#94A3B8]">Not assigned</span>}</Row>
          <Row label="COD">
            {codView}
            {b && cod !== b.codAmount && <span className="block text-xs text-[#94A3B8]">Vendor entered {fmtNumber(b.codAmount)}</span>}
          </Row>
          {h.deliveryCharge != null && <Row label="DL charge">AED {fmtNumber(h.deliveryCharge)}</Row>}
          {h.orderDate && <Row label="Sheet day">{fmtDate(h.orderDate)}</Row>}
          {!cancelled && h.driverNote && <Row label="Driver note"><span className="text-[#F59E0B]">{h.driverNote}</span></Row>}
          {!(cancelled && !h.driverNote) && h.remarks && <Row label="Remarks">{h.remarks}</Row>}
          {b?.notes && (
            <Row label="Note" tone="note">
              <span className="text-[#F59E0B]"><NotesText notes={b.notes} /></span>
            </Row>
          )}
        </div>
        {b && (
          <div data-share-hide="1" className="mt-2">
            <CustomerRiskBadge phone={b.customerPhone} excludeCn={h.cnNo} />
          </div>
        )}
      </div>

      {/* actions */}
      <div data-share-hide="1" className={`grid grid-cols-3 gap-2 px-5 pb-5 pt-0 ${SM_COLS[tiles.length] ?? "sm:grid-cols-6"}`}>
        {tiles}
      </div>
    </div>
  );
}
