"use client";

/**
 * KM & fuel tracking for drivers (only drivers switched on by admin).
 * - Start KM (typed, or meter photo read automatically) unlocks the counter box, live race and delivery taps.
 * - End KM is entered with END DELIVERY on the Cash closing page.
 * - Fuel fills: receipt photo is read automatically.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ApiClientError } from "@/lib/api";
import { useSocketEvent } from "@/lib/useSocketEvent";
import { fmtDate } from "@/lib/format";

export interface KmLog {
  id: string;
  date: string;
  startKm: number;
  startAt: string;
  endKm: number | null;
  endAt: string | null;
}
export interface FuelEntry {
  id: string;
  amount: number;
  litres: number | null;
  pricePerLitre: number | null;
  odometer: number | null;
  station: string | null;
  createdAt: string;
}
export interface KmStatus {
  enabled: boolean;
  started?: boolean;
  today?: KmLog | null;
  open?: KmLog | null;
  unclosedOld?: KmLog | null;
  lastKm?: number | null;
  fuelToday?: FuelEntry[];
}

export function useKmStatus() {
  const [km, setKm] = useState<KmStatus | null>(null);
  const load = useCallback(async () => {
    try {
      setKm(await apiFetch<KmStatus>("/km/me"));
    } catch {
      /* keep last */
    }
  }, []);
  useEffect(() => {
    load();
    const onVis = () => {
      if (!document.hidden) load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load]);
  useSocketEvent("km:changed", load);
  return { km, reload: load };
}

/** Shrink a phone photo before upload. */
async function shrink(file: Blob, maxSide = 1280, quality = 0.8): Promise<string> {
  let bitmap: ImageBitmap | HTMLImageElement;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  } catch {
    bitmap = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}

const errText = (e: unknown, fallback: string) => (e instanceof ApiClientError ? e.message : fallback);

function CameraIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 8h3l2-3h6l2 3h3a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z" />
      <circle cx="12" cy="13.5" r="3.5" />
    </svg>
  );
}

function Gauge() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4.5 18a9 9 0 1115 0" />
      <path d="M12 13l4-4" />
      <circle cx="12" cy="13.5" r="1.2" />
    </svg>
  );
}

/** Gold cover over the counter box until Start KM is saved. */
export function KmStartCover({ km, onStart }: { km: KmStatus; onStart: () => void }) {
  return (
    <button
      type="button"
      onClick={onStart}
      className="km-gold flex h-full min-h-[86px] w-full items-center justify-center gap-3 rounded-2xl px-4 text-left shadow active:scale-[0.98]"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#14203A] text-[#E7C873]">
        <Gauge />
      </span>
      <span className="min-w-0">
        <span className="block font-mono text-[15px] font-extrabold uppercase leading-tight tracking-wide text-[#14203A]">Start delivery</span>
        <span className="mt-0.5 block font-mono text-[10px] font-bold uppercase text-[#14203A]/70">
          {km.unclosedOld ? `${fmtDate(km.unclosedOld.date)} not closed · enter KM` : "Enter start KM to unlock"}
        </span>
      </span>
      <style>{`.km-gold{background:linear-gradient(135deg,#B8902F 0%,#E7C873 45%,#C9A13B 100%);background-size:200% 200%;animation:kmShine 3.5s ease-in-out infinite}
@keyframes kmShine{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}
@media (prefers-reduced-motion:reduce){.km-gold{animation:none}}`}</style>
    </button>
  );
}

/** Odometer entry: meter photo (read automatically) or typed KM. */
export function KmEntrySheet({
  mode,
  km,
  onClose,
  onSaved,
}: {
  mode: "start" | "end";
  km: KmStatus;
  onClose: () => void;
  onSaved: (km: number) => void | Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [readKm, setReadKm] = useState<number | null>(null);
  const [reading, setReading] = useState(false);
  const [readMsg, setReadMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const startKm = mode === "end" ? km.open?.startKm ?? null : null;
  const typed = Number(value);
  const total = startKm != null && typed >= startKm ? typed - startKm : null;

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setError(null);
    setReadMsg(null);
    setReading(true);
    try {
      const dataUrl = await shrink(file);
      setPreview(dataUrl);
      const r = await apiFetch<{ photoId: string; km: number | null }>("/km/read-meter", { method: "POST", body: { photo: dataUrl } });
      setPhotoId(r.photoId);
      setReadKm(r.km);
      if (r.km) {
        setValue(String(r.km));
        setReadMsg("Reading filled from photo — check it");
      } else {
        setReadMsg("Couldn't read the meter — type the KM");
      }
    } catch (e) {
      setReadMsg(errText(e, "Photo not saved — type the KM"));
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function save() {
    if (!value || !Number.isFinite(typed) || typed <= 0) {
      setError("Enter the KM or take a meter photo");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(mode === "start" ? "/km/start" : "/km/end", { method: "POST", body: { km: Math.round(typed), photoId: photoId ?? undefined, readKm } });
      await onSaved(Math.round(typed));
    } catch (e) {
      setError(errText(e, "Couldn't save — try again"));
    } finally {
      setBusy(false);
    }
  }

  const title = mode === "start" ? "Start KM" : "End KM";
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 sm:items-center" onClick={onClose}>
      <div className="km-sheet w-full max-w-md rounded-t-3xl bg-[#0E1A33] p-5 pb-7 text-white shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div className="font-mono text-[15px] font-extrabold uppercase tracking-wide text-[#E7C873]">{title}</div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-lg">×</button>
        </div>

        {mode === "start" && km.unclosedOld && (
          <p className="mb-3 rounded-xl bg-[#3A1E22] px-3 py-2 font-mono text-[10px] font-bold uppercase leading-snug text-[#FCA5A5]">
            {fmtDate(km.unclosedOld.date)} — End delivery was not tapped. This reading also closes that day (car was parked at the office).
          </p>
        )}

        <div className="grid grid-cols-2 gap-2 font-mono text-[10px] uppercase text-[#8E9AB8]">
          {mode === "start" ? (
            <div className="rounded-xl bg-white/5 px-3 py-2">Last KM<div className="mt-0.5 text-sm font-bold text-white">{km.lastKm != null ? km.lastKm.toLocaleString() : "—"}</div></div>
          ) : (
            <div className="rounded-xl bg-white/5 px-3 py-2">Start KM<div className="mt-0.5 text-sm font-bold text-white">{startKm != null ? startKm.toLocaleString() : "—"}</div></div>
          )}
          <div className="rounded-xl bg-white/5 px-3 py-2">
            {mode === "start" ? "Gap" : "Today"}
            <div className={`mt-0.5 text-sm font-bold ${mode === "start" && km.lastKm != null && typed - km.lastKm > 2 && !km.unclosedOld ? "text-[#FCA5A5]" : "text-[#E7C873]"}`}>
              {mode === "start"
                ? km.lastKm != null && typed >= km.lastKm && !km.unclosedOld
                  ? `${(typed - km.lastKm).toLocaleString()} KM`
                  : "—"
                : total != null
                  ? `${total.toLocaleString()} KM`
                  : "—"}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="relative mt-3 flex h-24 w-full items-center justify-center gap-2 overflow-hidden rounded-xl border-[1.5px] border-dashed border-[#E7C873] font-mono text-xs font-bold uppercase text-[#E7C873]"
        >
          {preview && <img src={preview} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" />}
          <span className="relative flex items-center gap-2">
            <CameraIcon /> {reading ? "Reading meter…" : preview ? "Retake meter photo" : "Meter photo"}
          </span>
        </button>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onPhoto(e.target.files?.[0])} />
        {readMsg && <p className="mt-1.5 font-mono text-[10px] uppercase text-[#8E9AB8]">{readMsg}</p>}

        <label className="mt-3 block font-mono text-[10px] uppercase text-[#8E9AB8]">Or type the KM</label>
        <input
          inputMode="numeric"
          pattern="[0-9]*"
          value={value}
          onChange={(e) => {
            setValue(e.target.value.replace(/\D/g, "").slice(0, 7));
            setError(null);
          }}
          placeholder={km.lastKm != null ? String(km.lastKm) : "45210"}
          className="mt-1 w-full rounded-xl border border-white/15 bg-[#05090F] px-4 py-3 text-center font-mono text-2xl font-bold tracking-[0.2em] text-white outline-none focus:border-[#E7C873]"
        />
        {error && <p className="mt-2 font-mono text-[11px] font-bold uppercase text-[#FCA5A5]">{error}</p>}

        <button
          type="button"
          onClick={save}
          disabled={busy || reading}
          className="mt-4 w-full rounded-xl bg-[#D4AF37] py-3.5 font-mono text-sm font-extrabold uppercase tracking-wide text-[#0E1A33] active:scale-[0.98] disabled:opacity-60"
        >
          {busy ? "Saving…" : mode === "start" ? "Save & start delivery" : "Save & end delivery"}
        </button>
      </div>
      <style>{`.km-sheet{animation:kmUp .32s cubic-bezier(.2,.8,.2,1)}@keyframes kmUp{from{transform:translateY(40px);opacity:.4}to{transform:none;opacity:1}}`}</style>
    </div>
  );
}

/** END DELIVERY block on the Cash closing page (replaces Submit cash closing). */
export function KmEndButton({ km, onEnded, busy }: { km: KmStatus; onEnded: () => void | Promise<void>; busy?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="mb-3 flex items-center justify-between rounded-xl border border-brass/40 bg-paper-2 px-4 py-2.5 font-mono text-[11px] uppercase text-ink-soft">
        <span>Start KM {km.open?.startKm.toLocaleString()}{km.open && km.open.date.slice(0, 10) !== new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10) ? ` · ${fmtDate(km.open.date)}` : ""}</span>
        <span className="text-brass">End KM needed</span>
      </div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={busy}
        className="w-full rounded-xl bg-[#D4AF37] py-3.5 font-mono text-sm font-extrabold uppercase tracking-wide text-[#0E1A33] shadow active:scale-[0.98] disabled:opacity-60"
      >
        {busy ? "Submitting…" : "End delivery"}
      </button>
      {open && (
        <KmEntrySheet
          mode="end"
          km={km}
          onClose={() => setOpen(false)}
          onSaved={async () => {
            setOpen(false);
            await onEnded();
          }}
        />
      )}
    </>
  );
}

/** Fuel page: add a fill (receipt photo read automatically) + today's list. */
export function DriverFuel({ km, onBack, onChanged }: { km: KmStatus; onBack: () => void; onChanged: () => void }) {
  const [amount, setAmount] = useState("");
  const [litres, setLitres] = useState("");
  const [price, setPrice] = useState("");
  const [odo, setOdo] = useState("");
  const [station, setStation] = useState<string | null>(null);
  const [receiptAt, setReceiptAt] = useState<string | null>(null);
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
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
      const r = await apiFetch<{ photoId: string; read: { amount: number | null; litres: number | null; pricePerLitre: number | null; station: string | null; receiptAt: string | null } | null }>(
        "/km/read-receipt",
        { method: "POST", body: { photo: dataUrl } }
      );
      setPhotoId(r.photoId);
      const d = r.read;
      if (d && (d.amount || d.litres)) {
        if (d.amount) setAmount(String(d.amount));
        if (d.litres) setLitres(String(d.litres));
        if (d.pricePerLitre) setPrice(String(d.pricePerLitre));
        setStation(d.station);
        setReceiptAt(d.receiptAt);
        setMsg("Filled from receipt — check it");
      } else setMsg("Couldn't read the receipt — type the amount");
    } catch (e) {
      setMsg(errText(e, "Photo not saved — type the amount"));
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function save() {
    const a = Number(amount);
    if (!a || a <= 0) {
      setError("Enter the amount or take a receipt photo");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/km/fuel", {
        method: "POST",
        body: {
          amount: a,
          litres: litres ? Number(litres) : null,
          pricePerLitre: price ? Number(price) : null,
          odometer: odo ? Number(odo) : null,
          station,
          receiptAt,
          photoId,
        },
      });
      setAmount("");
      setLitres("");
      setPrice("");
      setOdo("");
      setStation(null);
      setReceiptAt(null);
      setPhotoId(null);
      setPreview(null);
      setMsg("Fuel saved");
      onChanged();
    } catch (e) {
      setError(errText(e, "Couldn't save — try again"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Remove this fuel entry?")) return;
    await apiFetch(`/km/fuel/${id}`, { method: "DELETE" }).catch(() => undefined);
    onChanged();
  }

  const field = "w-full rounded-xl border border-line bg-white px-3 py-2.5 font-mono text-base font-bold text-navy outline-none focus:border-brass";
  const lab = "mb-1 block font-mono text-[10px] font-bold uppercase text-ink-soft";
  return (
    <div className="mt-1">
      <div className="mb-3 flex items-center gap-2">
        <button type="button" onClick={onBack} aria-label="Back" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy text-sm font-bold text-white active:scale-95">←</button>
        <span className="font-mono text-[13px] font-extrabold uppercase text-navy">Add fuel</span>
      </div>
      <div className="rounded-2xl bg-white p-4 shadow ring-1 ring-line">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="relative flex h-24 w-full items-center justify-center overflow-hidden rounded-xl border-[1.5px] border-dashed border-brass font-mono text-xs font-bold uppercase text-brass"
        >
          {preview && <img src={preview} alt="" className="absolute inset-0 h-full w-full object-cover opacity-30" />}
          <span className="relative flex items-center gap-2"><CameraIcon /> {reading ? "Reading receipt…" : preview ? "Retake receipt photo" : "Receipt photo"}</span>
        </button>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onPhoto(e.target.files?.[0])} />
        {msg && <p className="mt-1.5 font-mono text-[10px] uppercase text-ink-soft">{msg}{station ? ` · ${station}` : ""}</p>}

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div>
            <label className={lab}>Amount (AED)</label>
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} className={field} />
          </div>
          <div>
            <label className={lab}>Litres</label>
            <input inputMode="decimal" value={litres} onChange={(e) => setLitres(e.target.value.replace(/[^\d.]/g, ""))} className={field} />
          </div>
          <div>
            <label className={lab}>Price / litre</label>
            <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))} className={field} />
          </div>
          <div>
            <label className={lab}>Odometer (optional)</label>
            <input inputMode="numeric" value={odo} placeholder={km.lastKm != null ? String(km.lastKm) : ""} onChange={(e) => setOdo(e.target.value.replace(/\D/g, ""))} className={field} />
          </div>
        </div>
        {error && <p className="mt-2 font-mono text-[11px] font-bold uppercase text-cancelled">{error}</p>}
        <button type="button" onClick={save} disabled={busy || reading} className="mt-4 w-full rounded-xl bg-navy py-3 font-mono text-sm font-extrabold uppercase tracking-wide text-white active:scale-[0.98] disabled:opacity-60">
          {busy ? "Saving…" : "Save fuel"}
        </button>
      </div>

      {(km.fuelToday?.length ?? 0) > 0 && (
        <div className="mt-3 rounded-2xl bg-white p-3 shadow ring-1 ring-line">
          <div className="mb-1 font-mono text-[10px] font-bold uppercase text-ink-soft">Today</div>
          {km.fuelToday!.map((f) => (
            <div key={f.id} className="flex items-center justify-between border-b border-line py-2 font-mono text-xs uppercase last:border-0">
              <span className="text-navy">
                AED {f.amount}
                {f.litres ? ` · ${f.litres} L` : ""}
                {f.station ? <span className="text-ink-soft"> · {f.station}</span> : null}
              </span>
              <button type="button" onClick={() => remove(f.id)} className="text-[10px] text-cancelled">Remove</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
