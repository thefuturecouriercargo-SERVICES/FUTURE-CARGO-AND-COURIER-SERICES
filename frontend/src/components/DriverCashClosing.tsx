"use client";

/**
 * Driver Cash closing (design 2): cash count / cash total, bank count / bank total,
 * expenses (driver adds with type popup + receipt photo), paid to vendors, balance.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ApiClientError } from "@/lib/api";
import { useSocketEvent } from "@/lib/useSocketEvent";
import { fmtDate, fmtNumber } from "@/lib/format";
import { CashClosing, Vendor } from "@/types";
import { KmEndButton, shrink, type KmStatus } from "@/components/DriverKm";

interface ExpenseRow {
  id: string;
  category: string;
  amount: number;
  remarks?: string | null;
  enteredBy?: string | null;
  photoId?: string | null;
}
interface PurchaseEntry {
  id: string;
  amount: number;
  note?: string | null;
  vendor?: { id: string; name: string } | null;
}
interface Preview {
  totalDelivered: number;
  totalDeliveryCharge: number;
  cashPayments: number;
  onlinePayments: number;
  cashCount?: number;
  bankCount?: number;
  expenses: ExpenseRow[];
  totalExpenses: number;
  purchases: PurchaseEntry[];
  totalPurchases: number;
}

const NAVY = "#14203A";
const GOLD = "#D4AF37";

/** Line icons for expense types. */
const TYPE_ICON: Record<string, React.ReactNode> = {
  FUEL: <><path d="M4 21V5a2 2 0 012-2h7a2 2 0 012 2v16M3 21h13" /><path d="M7 7h5v4H7zM15 9h2a2 2 0 012 2v5a1.5 1.5 0 003 0V8l-3-3" /></>,
  PARKING: <><rect x="4" y="3" width="16" height="18" rx="3" /><path d="M10 17V7h3a3 3 0 010 6h-3" /></>,
  SALIK: <><path d="M4 21L9 3M20 21L15 3M12 5v2M12 11v2M12 17v2" /></>,
  CAR_WASH: <><path d="M5 17h14v-4l-2-5H7l-2 5z" /><circle cx="8" cy="17" r="1.5" /><circle cx="16" cy="17" r="1.5" /><path d="M8 3.5c0 1-1 1.5-1 2.5a1 1 0 002 0c0-1-1-1.5-1-2.5zM16 3.5c0 1-1 1.5-1 2.5a1 1 0 002 0c0-1-1-1.5-1-2.5z" /></>,
  DARB: <><path d="M12 3v18M5 7h11l3 3-3 3H5z" /></>,
  WORKSHOP: <><path d="M14.7 6.3a4 4 0 00-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 005.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z" /></>,
  STATIONARY: <><path d="M16 3l5 5L9 20H4v-5z" /><path d="M13 6l5 5" /></>,
  INTERNET: <><path d="M2 9a15 15 0 0120 0M5 12.5a10 10 0 0114 0M8.5 16a5 5 0 017 0" /><circle cx="12" cy="19.5" r="1" /></>,
  OTHER: <><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></>,
};
const TYPES: [string, string][] = [
  ["FUEL", "Fuel"],
  ["PARKING", "Parking"],
  ["SALIK", "Salik"],
  ["CAR_WASH", "Car wash"],
  ["DARB", "Darb"],
  ["WORKSHOP", "Workshop"],
  ["STATIONARY", "Stationary"],
  ["INTERNET", "Internet"],
  ["OTHER", "Other"],
];
const typeLabel = (c: string) => TYPES.find(([k]) => k === c)?.[1] ?? c.replace(/_/g, " ");

function TypeIcon({ type, size = 16 }: { type: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {TYPE_ICON[type] ?? TYPE_ICON.OTHER}
    </svg>
  );
}
function StoreIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 9l1.5-5h15L21 9" />
      <path d="M3 9h18v1a3 3 0 01-6 0 3 3 0 01-6 0 3 3 0 01-6 0V9z" />
      <path d="M5 13v7h14v-7" />
      <path d="M10 20v-4h4v4" />
    </svg>
  );
}
function CameraIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 8h3l2-3h6l2 3h3a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z" />
      <circle cx="12" cy="13.5" r="3.5" />
    </svg>
  );
}

const errText = (e: unknown, f: string) => (e instanceof ApiClientError ? e.message : f);

function Sheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/55 sm:items-center" onClick={onClose}>
      <div className="cc-sheet w-full max-w-md rounded-t-3xl bg-white p-4 pb-6 shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
      <style>{`.cc-sheet{animation:ccUp .28s cubic-bezier(.2,.8,.2,1)}@keyframes ccUp{from{transform:translateY(40px);opacity:.4}to{transform:none;opacity:1}}`}</style>
    </div>
  );
}

/** Step 1: pick type. Step 2: receipt photo (amount read + rounded) and amount. */
function AddExpenseSheet({ date, onClose, onSaved }: { date: string; onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState<string | null>(null);
  const [picking, setPicking] = useState(true);
  const [amount, setAmount] = useState("");
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [litres, setLitres] = useState<number | null>(null);
  const [station, setStation] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setReading(true);
    setMsg(null);
    setError(null);
    try {
      const dataUrl = await shrink(file, 1400, 0.82);
      setPreview(dataUrl);
      const r = await apiFetch<{ photoId: string; raw: number | null; amount: number | null; litres: number | null; station: string | null }>("/cash-closings/expenses/read", {
        method: "POST",
        body: { photo: dataUrl },
      });
      setPhotoId(r.photoId);
      setLitres(r.litres);
      setStation(r.station);
      if (r.amount) {
        setAmount(String(r.amount));
        setMsg(r.raw != null && r.raw !== r.amount ? `Receipt ${r.raw} → ${r.amount}` : `Receipt ${r.amount}`);
      } else setMsg("Couldn't read the amount — type it");
    } catch (e) {
      setMsg(errText(e, "Photo not saved — type the amount"));
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function save() {
    const a = Math.round(Number(amount));
    if (!type) return setPicking(true);
    if (!photoId) return setError("Take a photo of the bill first");
    if (!a || a <= 0) return setError("Enter the amount");
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/cash-closings/expenses", { method: "POST", body: { date, category: type, amount: a, photoId, litres, station } });
      onSaved();
    } catch (e) {
      setError(errText(e, "Couldn't save — try again"));
    } finally {
      setBusy(false);
    }
  }

  if (picking)
    return (
      <Sheet onClose={onClose}>
        <div className="mb-3 flex items-center justify-between">
          <span className="font-mono text-[14px] font-extrabold uppercase text-navy">Select expense type</span>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-full bg-paper text-lg text-navy">×</button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {TYPES.map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setType(k);
                setPicking(false);
              }}
              className={`flex flex-col items-center gap-1.5 rounded-2xl px-1 py-3 font-mono text-[10.5px] font-bold uppercase active:scale-95 ${
                type === k ? "bg-[#FBF6E8] text-navy ring-2 ring-[#D4AF37]" : "bg-white text-navy ring-1 ring-line"
              }`}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: NAVY, color: GOLD }}>
                <TypeIcon type={k} size={18} />
              </span>
              {l}
            </button>
          ))}
        </div>
      </Sheet>
    );

  return (
    <Sheet onClose={onClose}>
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[14px] font-extrabold uppercase text-navy">Add expense</span>
        <button type="button" onClick={() => setPicking(true)} className="flex items-center gap-1.5 rounded-full px-3 py-1.5 font-mono text-[11px] font-bold uppercase text-navy ring-1 ring-[#D4AF37]">
          <TypeIcon type={type!} size={14} /> {typeLabel(type!)} ▾
        </button>
      </div>
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="relative flex h-24 w-full items-center justify-center overflow-hidden rounded-xl border-[1.5px] border-dashed border-[#C9A13B] font-mono text-xs font-bold uppercase text-[#A07E25]"
      >
        {preview && <img src={preview} alt="" className="absolute inset-0 h-full w-full object-cover opacity-30" />}
        <span className="relative flex items-center gap-2">
          <CameraIcon size={18} /> {reading ? "Reading receipt…" : preview ? "Retake receipt photo" : "Receipt photo"}
        </span>
      </button>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onPhoto(e.target.files?.[0])} />
      {msg && <p className="mt-1.5 font-mono text-[10px] uppercase text-ink-soft">{msg}</p>}
      <div className="mt-3 flex items-center gap-2 rounded-xl px-4 ring-1 ring-line focus-within:ring-[#D4AF37]">
        <input
          inputMode="numeric"
          value={amount}
          disabled={!photoId}
          onChange={(e) => {
            setAmount(e.target.value.replace(/[^\d.]/g, ""));
            setError(null);
          }}
          placeholder={photoId ? "0" : "Bill photo first"}
          className="min-w-0 flex-1 bg-transparent py-3 placeholder:text-base disabled:opacity-50 text-center font-mono text-3xl font-bold text-navy outline-none"
        />
        <span className="font-mono text-xs font-bold text-ink-soft">AED</span>
      </div>
      {error && <p className="mt-2 font-mono text-[11px] font-bold uppercase text-cancelled">{error}</p>}
      <button type="button" onClick={save} disabled={busy || reading || !photoId} className="mt-4 w-full rounded-xl py-3.5 font-mono text-sm font-extrabold uppercase tracking-wide text-white active:scale-[0.98] disabled:opacity-60" style={{ background: NAVY }}>
        {busy ? "Saving…" : photoId ? "Save expense" : "Bill photo needed"}
      </button>
    </Sheet>
  );
}

function VendorSheet({ date, vendors, onClose, onSaved }: { date: string; vendors: Vendor[]; onClose: () => void; onSaved: () => void }) {
  const [vendorId, setVendorId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    const a = Number(amount);
    if (!vendorId) return setError("Select a vendor");
    if (!a || a <= 0) return setError("Enter an amount");
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/purchases", { method: "POST", body: { date, amount: a, vendorId, note: note || undefined } });
      onSaved();
    } catch (e) {
      setError(errText(e, "Couldn't save — try again"));
    } finally {
      setBusy(false);
    }
  }
  const f = "w-full rounded-xl bg-white px-3 py-3 font-mono text-sm text-navy outline-none ring-1 ring-line focus:ring-[#D4AF37]";
  return (
    <Sheet onClose={onClose}>
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[14px] font-extrabold uppercase text-navy">Paid to vendor</span>
        <button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-full bg-paper text-lg text-navy">×</button>
      </div>
      <div className="space-y-2">
        <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className={f}>
          <option value="">Select vendor</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <input inputMode="numeric" placeholder="Amount (AED)" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} className={f} />
        <input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} className={f} />
      </div>
      {error && <p className="mt-2 font-mono text-[11px] font-bold uppercase text-cancelled">{error}</p>}
      <button type="button" onClick={save} disabled={busy} className="mt-4 w-full rounded-xl py-3.5 font-mono text-sm font-extrabold uppercase tracking-wide text-white active:scale-[0.98] disabled:opacity-60" style={{ background: NAVY }}>
        {busy ? "Saving…" : "Save payment"}
      </button>
    </Sheet>
  );
}

export default function DriverCashClosing({
  date,
  readOnly,
  onSubmitted,
  onBack,
  km,
  onKmEnded,
}: {
  date: string;
  readOnly?: boolean;
  onSubmitted: () => void;
  onBack?: () => void;
  km?: KmStatus | null;
  onKmEnded?: () => void | Promise<void>;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [existing, setExisting] = useState<CashClosing | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<"expense" | "vendor" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [p, closings] = await Promise.all([apiFetch<Preview>("/cash-closings/preview", { query: { date } }), apiFetch<CashClosing[]>("/cash-closings", { query: { date } })]);
    setPreview(p);
    setExisting(closings[0] ?? null);
  }, [date]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    apiFetch<Vendor[]>("/vendors").then(setVendors).catch(() => undefined);
  }, []);
  useSocketEvent("order:changed", load);
  useSocketEvent("purchase:changed", load);
  useSocketEvent("expense:changed", load);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const closing = await apiFetch<CashClosing>("/cash-closings", { method: "POST", body: { date } });
      setExisting(closing);
      onSubmitted();
    } catch (e) {
      setError(errText(e, "Couldn't submit — try again"));
    } finally {
      setBusy(false);
    }
  }
  async function removeExpense(id: string) {
    if (!confirm("Remove this expense?")) return;
    await apiFetch(`/cash-closings/expenses/${id}`, { method: "DELETE" }).catch((e) => setError(errText(e, "Couldn't remove")));
    load();
  }
  async function removePurchase(id: string) {
    if (!confirm("Remove this payment?")) return;
    await apiFetch(`/purchases/${id}`, { method: "DELETE" }).catch((e) => setError(errText(e, "Couldn't remove")));
    load();
  }

  if (!preview) return null;
  const balance = preview.cashPayments - preview.totalExpenses - preview.totalPurchases;
  const cashCount = preview.cashCount ?? 0;
  const bankCount = preview.bankCount ?? 0;
  const tile = "rounded-2xl bg-white px-3.5 py-2.5 shadow-sm ring-1 ring-line";
  const lab = "font-mono text-[9.5px] font-bold uppercase tracking-wide text-ink-soft";
  const num = "mt-0.5 font-mono text-[19px] font-extrabold leading-tight text-navy";

  return (
    <div className="mt-1">
      {/* Header */}
      <div className="mb-2.5 flex items-center gap-2">
        {onBack && (
          <button type="button" onClick={onBack} aria-label="Back" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy text-sm font-bold text-white active:scale-95">
            ←
          </button>
        )}
        <span className="font-mono text-[14px] font-extrabold uppercase text-navy">Cash closing</span>
        <span className="ml-auto rounded-full bg-white px-2.5 py-1 font-mono text-[10px] font-bold uppercase text-navy ring-1 ring-line">
          {readOnly ? "Locked · " : ""}
          {fmtDate(date)}
        </span>
      </div>

      {/* Cash / bank boxes */}
      <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 1.4fr" }}>
        <div className={tile}>
          <div className={lab}>Cash count</div>
          <div className={num}>{cashCount}</div>
        </div>
        <div className="rounded-2xl px-3.5 py-2.5 shadow-sm" style={{ background: NAVY }}>
          <div className="font-mono text-[9.5px] font-bold uppercase tracking-wide" style={{ color: GOLD }}>Cash total</div>
          <div className="mt-0.5 font-mono text-[19px] font-extrabold leading-tight text-white">
            {fmtNumber(preview.cashPayments)} <span className="text-[11px] font-bold opacity-70">AED</span>
          </div>
        </div>
        <div className={tile}>
          <div className={lab}>Bank count</div>
          <div className={num}>{bankCount}</div>
        </div>
        <div className={tile}>
          <div className={lab}>Bank total</div>
          <div className={num}>
            {fmtNumber(preview.onlinePayments)} <span className="text-[11px] font-bold text-ink-soft">AED</span>
          </div>
        </div>
      </div>

      {/* Expenses */}
      <div className="mt-2 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-line">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] font-extrabold uppercase text-navy">Expenses</span>
          <span className="font-mono text-[12px] font-extrabold text-cancelled">{preview.totalExpenses ? `−${fmtNumber(preview.totalExpenses)}` : "0"}</span>
        </div>
        {preview.expenses.map((e) => (
          <div key={e.id} className="flex items-center gap-2 border-b border-line py-2 last:border-0">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#EFE3C4] text-navy">
              <TypeIcon type={e.category} size={15} />
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] font-bold uppercase text-navy">
              {typeLabel(e.category)}
              {e.photoId && (
                <span className="ml-1.5 inline-block align-[-2px] text-[#C9A13B]">
                  <CameraIcon size={12} />
                </span>
              )}
              {e.enteredBy !== "DRIVER" && <span className="ml-1.5 rounded-full px-1.5 py-0.5 text-[8.5px] text-ink-soft ring-1 ring-line">Admin</span>}
            </span>
            <span className="font-mono text-[13px] font-extrabold text-navy">{fmtNumber(e.amount)}</span>
            {!readOnly && e.enteredBy === "DRIVER" && existing?.status !== "REVIEWED" && (
              <button type="button" onClick={() => removeExpense(e.id)} aria-label="Remove expense" className="ml-1 flex h-6 w-6 items-center justify-center rounded-full text-ink-soft ring-1 ring-line">
                ×
              </button>
            )}
          </div>
        ))}
        {!readOnly && (
          <button
            type="button"
            onClick={() => setSheet("expense")}
            className="mt-2 w-full rounded-xl border border-dashed border-[#C9A13B] py-2.5 font-mono text-[11.5px] font-extrabold uppercase text-[#A07E25] active:scale-[0.98]"
          >
            + Add expense
          </button>
        )}
      </div>

      {/* Paid to vendors */}
      <div className="mt-2 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-line">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] font-extrabold uppercase text-navy">Paid to vendors</span>
          <span className="font-mono text-[12px] font-extrabold text-cancelled">{preview.totalPurchases ? `−${fmtNumber(preview.totalPurchases)}` : "0"}</span>
        </div>
        {preview.purchases.map((p) => (
          <div key={p.id} className="flex items-center gap-2 border-b border-line py-2 last:border-0">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#EFE3C4] text-navy">
              <StoreIcon size={15} />
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] font-bold uppercase text-navy">
              {p.vendor ? p.vendor.name : "General deduction"}
              {p.note && <span className="font-normal text-ink-soft"> · {p.note}</span>}
            </span>
            <span className="font-mono text-[13px] font-extrabold text-navy">{fmtNumber(p.amount)}</span>
            {!readOnly && (
              <button type="button" onClick={() => removePurchase(p.id)} aria-label="Remove payment" className="ml-1 flex h-6 w-6 items-center justify-center rounded-full text-ink-soft ring-1 ring-line">
                ×
              </button>
            )}
          </div>
        ))}
        {!readOnly && (
          <button
            type="button"
            onClick={() => setSheet("vendor")}
            className="mt-2 w-full rounded-xl border border-dashed border-[#C9A13B] py-2.5 font-mono text-[11.5px] font-extrabold uppercase text-[#A07E25] active:scale-[0.98]"
          >
            + Add vendor payment
          </button>
        )}
      </div>

      {/* Balance cash */}
      <div className="mt-2 flex items-center justify-between rounded-2xl px-4 py-3 shadow-sm" style={{ background: NAVY }}>
        <span className="font-mono text-[11px] font-bold uppercase tracking-wide" style={{ color: GOLD }}>Balance cash</span>
        <span className="font-mono text-[22px] font-extrabold leading-tight" style={{ color: GOLD }}>
          {fmtNumber(balance)} <span className="text-[11px] font-bold opacity-80">AED</span>
        </span>
      </div>

      {error && <p className="mt-2 font-mono text-[11px] font-bold uppercase text-cancelled">{error}</p>}

      {/* Submit / End delivery */}
      <div className="mt-2.5">
        {km?.enabled && km.open ? (
          <KmEndButton
            km={km}
            busy={busy}
            onEnded={async () => {
              await onKmEnded?.();
              if (!readOnly && km.open?.date.slice(0, 10) === date) await submit();
            }}
          />
        ) : (
          !readOnly && (
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="w-full rounded-xl py-3.5 font-mono text-sm font-extrabold uppercase tracking-wide text-[#14203A] shadow active:scale-[0.98] disabled:opacity-60"
              style={{ background: GOLD }}
            >
              {busy ? "Ending…" : existing ? "End delivery again" : "End delivery"}
            </button>
          )
        )}
        {existing && (
          <p className="mt-1.5 text-center font-mono text-[9.5px] uppercase text-ink-soft">
            Submitted {new Date(existing.submittedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" })} · {existing.status}
          </p>
        )}
      </div>

      {sheet === "expense" && (
        <AddExpenseSheet
          date={date}
          onClose={() => setSheet(null)}
          onSaved={() => {
            setSheet(null);
            load();
          }}
        />
      )}
      {sheet === "vendor" && (
        <VendorSheet
          date={date}
          vendors={vendors}
          onClose={() => setSheet(null)}
          onSaved={() => {
            setSheet(null);
            load();
          }}
        />
      )}
    </div>
  );
}
