"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { IScannerControls } from "@zxing/browser";
import { apiFetch } from "@/lib/api";
import { fmtNumber } from "@/lib/format";

interface Match {
  id: string;
  cnNo: number;
  date: string;
  vendor: string;
  total: number;
  payment: string;
  emirate: string;
  employee: string;
  status: string;
}

interface BookingMatch {
  id: string;
  cnNo: number;
  vendorRef?: string | null;
  vendor: string;
  customerName: string;
  customerPhone: string;
  address: string;
  emirate: string;
  items?: string | null;
  codAmount: number;
  notes?: string | null;
  status: string;
}

interface ScanResult {
  at: Date;
  source: "Camera" | "Photo" | "Scanner / typed";
  format: string;
  text: string;
  candidates: number[];
  matches: Match[];
  bookings: BookingMatch[];
  lookupError?: string;
}

// Make invisible control characters visible (GS1 barcodes use them as separators).
function visible(text: string) {
  return text.replace(/[\x00-\x1f\x7f]/g, (c) => {
    const code = c.charCodeAt(0);
    if (code === 29) return "⟨GS⟩";
    if (code === 13) return "⟨CR⟩";
    if (code === 10) return "⟨LF⟩";
    if (code === 9) return "⟨TAB⟩";
    return `⟨${code.toString(16).padStart(2, "0")}⟩`;
  });
}

function isUrl(text: string) {
  return /^https?:\/\/\S+$/i.test(text.trim());
}

function beep() {
  try {
    navigator.vibrate?.(80);
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    o.frequency.value = 1200;
    o.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.08);
  } catch {
    /* no sound — fine */
  }
}

async function makeReader() {
  const [{ BrowserMultiFormatReader }, { DecodeHintType }] = await Promise.all([import("@zxing/browser"), import("@zxing/library")]);
  const hints = new Map();
  hints.set(DecodeHintType.TRY_HARDER, true);
  return new BrowserMultiFormatReader(hints);
}

async function formatName(format: number) {
  const { BarcodeFormat } = await import("@zxing/library");
  return (BarcodeFormat as unknown as Record<number, string>)[format] ?? String(format);
}

export default function ScanTestPage() {
  const [results, setResults] = useState<ScanResult[]>([]);
  const [cameraOn, setCameraOn] = useState(false);
  const [error, setError] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const lastRef = useRef<{ text: string; t: number }>({ text: "", t: 0 });
  const typedRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    typedRef.current?.focus();
    return () => controlsRef.current?.stop();
  }, []);

  async function record(source: ScanResult["source"], format: string, text: string) {
    let candidates: number[] = [];
    let matches: Match[] = [];
    let bookings: BookingMatch[] = [];
    let lookupError: string | undefined;
    try {
      const r = await apiFetch<{ candidates: number[]; matches: Match[]; bookings?: BookingMatch[] }>("/scan/lookup", { query: { code: text } });
      candidates = r.candidates;
      matches = r.matches;
      bookings = r.bookings ?? [];
    } catch (err) {
      lookupError = err instanceof Error ? err.message : "Lookup failed";
    }
    setResults((prev) => [{ at: new Date(), source, format, text, candidates, matches, bookings, lookupError }, ...prev].slice(0, 30));
  }

  async function startCamera() {
    setError("");
    try {
      const reader = await makeReader();
      if (!videoRef.current) return;
      setCameraOn(true);
      controlsRef.current = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } },
        videoRef.current,
        async (result) => {
          if (!result) return;
          const text = result.getText();
          // The camera reads the same code many times a second — ignore repeats for 3s.
          const now = Date.now();
          if (text === lastRef.current.text && now - lastRef.current.t < 3000) return;
          lastRef.current = { text, t: now };
          beep();
          await record("Camera", await formatName(result.getBarcodeFormat()), text);
        }
      );
    } catch (err) {
      setCameraOn(false);
      const msg = err instanceof Error ? err.message : String(err);
      setError(
        /permission|denied|notallowed/i.test(msg)
          ? "Camera permission was blocked. Allow camera access for this site in your browser settings, or use 'Scan from photo'."
          : `Couldn't start the camera: ${msg}`
      );
    }
  }

  function stopCamera() {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setCameraOn(false);
  }

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setError("");
    setBusy(true);
    const url = URL.createObjectURL(file);
    try {
      const reader = await makeReader();
      const result = await reader.decodeFromImageUrl(url);
      beep();
      await record("Photo", await formatName(result.getBarcodeFormat()), result.getText());
    } catch {
      setError("No barcode found in that photo. Try again closer, flat, in good light, with the whole barcode in frame.");
    } finally {
      URL.revokeObjectURL(url);
      setBusy(false);
    }
  }

  async function onTyped(e: FormEvent) {
    e.preventDefault();
    const text = typed;
    setTyped("");
    if (!text.trim()) return;
    await record("Scanner / typed", "—", text);
    typedRef.current?.focus();
  }

  const latest = results[0];

  return (
    <div>
      <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-brass">Testing</p>
      <h1 className="mb-2 font-display text-3xl font-semibold text-navy">Scan Test</h1>
      <p className="mb-5 max-w-2xl text-sm text-ink-soft">
        Scan a vendor&apos;s bill to see exactly what its barcode contains, and whether that number matches a consignment
        already in the system. Nothing is saved or changed.
      </p>

      <div className="mb-5 grid max-w-3xl gap-3 sm:grid-cols-3">
        {!cameraOn ? (
          <button onClick={startCamera} className="rounded bg-navy px-4 py-3 font-mono text-xs uppercase tracking-wide text-paper hover:bg-navy-2">
            📷 Scan with camera
          </button>
        ) : (
          <button onClick={stopCamera} className="rounded bg-cancelled px-4 py-3 font-mono text-xs uppercase tracking-wide text-white">
            ■ Stop camera
          </button>
        )}
        <label className="cursor-pointer rounded border border-navy bg-white px-4 py-3 text-center font-mono text-xs uppercase tracking-wide text-navy hover:bg-paper-2">
          {busy ? "Reading…" : "🖼 Scan from photo"}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              onPhoto(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        <form onSubmit={onTyped}>
          <input
            ref={typedRef}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="USB scanner / type…"
            className="h-full w-full rounded border-2 border-brass px-3 py-3 font-mono text-sm"
          />
        </form>
      </div>

      <div className={`mb-5 max-w-md overflow-hidden border border-line bg-black ${cameraOn ? "" : "hidden"}`}>
        <video ref={videoRef} className="block w-full" muted playsInline />
        <p className="bg-white px-3 py-2 text-xs text-ink-soft">Hold the barcode flat, 10–20 cm away, filling most of the frame. It beeps when read.</p>
      </div>

      {error && <p className="mb-4 max-w-2xl text-sm text-cancelled">{error}</p>}

      {latest && (
        <div className="mb-6 max-w-3xl border-2 border-brass bg-white p-5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-[17px] font-semibold text-navy">Latest scan</h2>
            <span className="font-mono text-[11px] text-ink-soft">
              {latest.source} · {latest.at.toLocaleTimeString("en-GB")}
            </span>
          </div>

          <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="font-mono text-[10px] uppercase text-ink-soft">Barcode type</dt>
            <dd className="font-mono">{latest.format}</dd>

            <dt className="font-mono text-[10px] uppercase text-ink-soft">Contains</dt>
            <dd>
              <div className="break-all rounded bg-paper-2 px-2 py-1.5 font-mono text-base">{visible(latest.text)}</div>
              <div className="mt-1 flex flex-wrap gap-3 text-xs text-ink-soft">
                <span>{latest.text.length} characters</span>
                <span>{/^\d+$/.test(latest.text) ? "Numbers only" : "Contains letters/symbols"}</span>
                <button onClick={() => navigator.clipboard?.writeText(latest.text)} className="text-brass hover:underline">
                  Copy
                </button>
                {isUrl(latest.text) && (
                  <a href={latest.text.trim()} target="_blank" rel="noreferrer" className="text-brass hover:underline">
                    Open link ↗
                  </a>
                )}
              </div>
            </dd>

            <dt className="font-mono text-[10px] uppercase text-ink-soft">Numbers found</dt>
            <dd className="font-mono">{latest.candidates.length ? latest.candidates.join(", ") : "none"}</dd>

            <dt className="font-mono text-[10px] uppercase text-ink-soft">In our system</dt>
            <dd>
              {latest.lookupError ? (
                <span className="text-cancelled">{latest.lookupError}</span>
              ) : latest.matches.length === 0 && latest.bookings.length === 0 ? (
                <span className="text-ink-soft">No consignment or vendor booking with this number yet.</span>
              ) : latest.matches.length === 0 ? (
                <span className="text-ink-soft">Not in Daily Entry yet.</span>
              ) : (
                <div className="space-y-1.5">
                  {latest.matches.map((m) => (
                    <div key={m.id} className="rounded border border-delivered bg-delivered-bg px-2 py-1.5">
                      <b className="font-mono">CN {m.cnNo}</b> · {m.vendor} · AED {fmtNumber(m.total)} · {m.payment} · {m.emirate} · {m.employee} ·{" "}
                      <b>{m.status}</b> · {new Date(m.date).toLocaleDateString("en-GB")}
                    </div>
                  ))}
                </div>
              )}
            </dd>

            {latest.bookings.length > 0 && (
              <>
                <dt className="font-mono text-[10px] uppercase text-ink-soft">Vendor booking</dt>
                <dd className="space-y-1.5">
                  {latest.bookings.map((b) => (
                    <div key={b.id} className="rounded border border-brass bg-paper px-2 py-1.5 text-sm">
                      <div>
                        <b className="font-mono">CN {b.cnNo}</b>
                        {b.vendorRef && <span className="text-ink-soft"> · their No. {b.vendorRef}</span>} · {b.vendor} ·{" "}
                        <b>{b.status === "AWAITING_PICKUP" ? "Awaiting pickup" : b.status === "ACCEPTED" ? "Accepted" : "Rejected"}</b>
                      </div>
                      <div>
                        <b>{b.customerName}</b> · {b.customerPhone} · <b>AED {fmtNumber(b.codAmount)}</b>
                      </div>
                      <div className="text-ink-soft">
                        {b.address}, {b.emirate}
                      </div>
                      {b.items && <div className="text-ink-soft">Items: {b.items}</div>}
                      {b.notes && <div className="text-ink-soft">Note: {b.notes}</div>}
                    </div>
                  ))}
                </dd>
              </>
            )}
          </dl>
        </div>
      )}

      {results.length > 1 && (
        <div className="max-w-3xl border border-line bg-white p-5">
          <h2 className="mb-3 font-display text-[17px] font-semibold text-navy">Earlier scans (this session)</h2>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Type</th>
                  <th>Contains</th>
                  <th>Match</th>
                </tr>
              </thead>
              <tbody>
                {results.slice(1).map((r, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap font-mono text-xs">{r.at.toLocaleTimeString("en-GB")}</td>
                    <td className="font-mono text-xs">{r.format}</td>
                    <td className="max-w-[320px] break-all font-mono text-xs">{visible(r.text)}</td>
                    <td className="text-xs">
                      {[...r.matches.map((m) => `CN ${m.cnNo} (${m.vendor})`), ...r.bookings.map((b) => `Booking CN ${b.cnNo} — ${b.customerName}`)].join(", ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
