"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ApiClientError } from "@/lib/api";
import { Booking, BookingInput, EMIRATES, Vendor } from "@/types";

/**
 * Bulk entry from photos of handwritten order slips (e.g. a vendor that only
 * sends WhatsApp pictures). Each photo is read by the AI photo reader, shown
 * next to its suggested fields for checking, then saved as consignments.
 */

type Status = "queued" | "reading" | "ready" | "error" | "saving" | "saved" | "duplicate" | "blocked";

interface Fields {
  vendorRef: string;
  customerName: string;
  customerPhone: string;
  address: string;
  emirate: string;
  items: string;
  codAmount: string;
  notes: string;
}

interface Card {
  key: string;
  fileName: string;
  preview: string;
  status: Status;
  message?: string;
  photoId?: string | null;
  fields: Fields;
  unclear: string[];
  booking?: Booking;
}

interface ReadOrder {
  vendorRef: string | null;
  customerName: string | null;
  agent?: string | null;
  customerPhone: string | null;
  address: string | null;
  emirate: string | null;
  items: string | null;
  codAmount: number | null;
  notes: string | null;
  unclear: string[];
}

const EMPTY: Fields = { vendorRef: "", customerName: "", customerPhone: "", address: "", emirate: "", items: "", codAmount: "", notes: "" };
const CONCURRENCY = 3;

/** Shrink a photo in the browser (keeps upload small and fast on phones). */
async function shrink(file: Blob, maxSide: number, quality: number): Promise<string> {
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

function problems(f: Fields, needBill = false): string[] {
  const p: string[] = [];
  if (needBill && !f.vendorRef.trim()) p.push("vendorRef");
  if (f.customerPhone.replace(/\D/g, "").length < 7) p.push("customerPhone");
  if (!f.address.trim()) p.push("address");
  if (!f.emirate) p.push("emirate");
  if (f.codAmount.trim() === "" || !Number.isFinite(Number(f.codAmount)) ) p.push("codAmount");
  if (!f.customerName.trim()) p.push("customerName");
  return p;
}

export default function PhotoBulkEntry({
  mode,
  vendors,
  vendorName,
  onSaved,
  onPrint,
}: {
  mode: "admin" | "vendor";
  vendors?: Vendor[];
  vendorName?: string;
  onSaved?: () => void;
  onPrint: (ids: string[]) => void;
}) {
  const base = mode === "admin" ? "/bookings" : "/vendor-portal";
  const [vendorId, setVendorId] = useState("");
  const [cards, setCards] = useState<Card[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [savingAll, setSavingAll] = useState(false);
  const [bigPhoto, setBigPhoto] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cardsRef = useRef<Card[]>([]);
  cardsRef.current = cards;

  const chosenVendorName = mode === "admin" ? vendors?.find((v) => v.id === vendorId)?.name ?? "" : vendorName ?? "";
  // EW: the bill No. is the only way to tell their orders apart — always required.
  const needBill = /^EW$/i.test(chosenVendorName.trim());
  const problemsOf = (f: Fields) => problems(f, needBill);

  useEffect(() => {
    apiFetch<{ configured: boolean }>(`${mode === "admin" ? "/bookings" : "/vendor-portal"}/photo-reader/status`)
      .then((r) => setConfigured(r.configured))
      .catch(() => setConfigured(null));
  }, [mode]);

  const patch = useCallback((key: string, change: Partial<Card> | ((c: Card) => Partial<Card>)) => {
    setCards((list) => list.map((c) => (c.key === key ? { ...c, ...(typeof change === "function" ? change(c) : change) } : c)));
  }, []);

  const setField = (key: string, name: keyof Fields, value: string) =>
    patch(key, (c) => {
      const fields = { ...c.fields, [name]: value };
      // Placeholder name follows the bill No. ("EW customer · 7509").
      if (name === "vendorRef" && /^\S+ customer( · .*)?$/.test(c.fields.customerName)) {
        fields.customerName = `${c.fields.customerName.split(" customer")[0]} customer${value.trim() ? ` · ${value.trim()}` : ""}`;
      }
      return { fields, unclear: c.unclear.filter((u) => u !== name) };
    });

  /** Read one photo; a slip with several orders becomes several cards. */
  async function readOne(card: Card, file: Blob, vName: string, vId: string) {
    patch(card.key, { status: "reading" });
    try {
      const [image, thumb] = await Promise.all([shrink(file, 1600, 0.85), shrink(file, 1000, 0.6)]);
      const res = await apiFetch<{ orders: ReadOrder[]; photoId: string | null }>(`${base}/photo-read`, {
        method: "POST",
        body: mode === "admin" ? { vendorId: vId, image, thumb } : { image, thumb },
      });
      // EW never writes the customer's name: a name on their slip is the agent (K, KD, Haira…).
      const noCustomerNames = /^EW$/i.test((vName || "").trim());
      const toFields = (o: ReadOrder): Fields => {
        const agent = o.agent || (noCustomerNames ? o.customerName : null);
        const name = noCustomerNames ? null : o.customerName;
        return {
          vendorRef: o.vendorRef ?? "",
          customerName: name || `${vName || "Vendor"} customer${o.vendorRef ? ` · ${o.vendorRef}` : ""}`,
          customerPhone: o.customerPhone ?? "",
          address: o.address ?? "",
          emirate: o.emirate ?? "",
          items: o.items ?? "",
          codAmount: o.codAmount === null || o.codAmount === undefined ? "" : String(o.codAmount),
          notes: [agent ? `Agent ${agent}` : "", o.notes ?? ""].filter(Boolean).join(" · "),
        };
      };
      if (!res.orders.length) {
        patch(card.key, { status: "ready", photoId: res.photoId, message: "No order found on this photo — type it in or remove it." });
        return;
      }
      const [first, ...rest] = res.orders;
      setCards((list) => {
        const i = list.findIndex((c) => c.key === card.key);
        if (i < 0) return list;
        const main: Card = { ...list[i], status: "ready", photoId: res.photoId, fields: toFields(first), unclear: first.unclear ?? [], message: undefined };
        const extra: Card[] = rest.map((o, n) => ({
          key: `${card.key}-${n + 2}`,
          fileName: `${card.fileName} (order ${n + 2})`,
          preview: card.preview,
          status: "ready",
          photoId: null,
          fields: toFields(o),
          unclear: o.unclear ?? [],
        }));
        return [...list.slice(0, i), main, ...extra, ...list.slice(i + 1)];
      });
    } catch (err) {
      patch(card.key, { status: "error", message: err instanceof Error ? err.message : "Could not read this photo" });
    }
  }

  async function addFiles(files: File[]) {
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    if (mode === "admin" && !vendorId) {
      alert("Choose the vendor first.");
      return;
    }
    const vName = chosenVendorName;
    const vId = vendorId;
    const stamp = Date.now();
    const fresh: { card: Card; file: File }[] = imgs.map((file, i) => ({
      file,
      card: {
        key: `${stamp}-${i}`,
        fileName: file.name || `Photo ${i + 1}`,
        preview: URL.createObjectURL(file),
        status: "queued",
        fields: { ...EMPTY },
        unclear: [],
      },
    }));
    setCards((list) => [...list, ...fresh.map((f) => f.card)]);
    // Read a few at a time.
    let next = 0;
    const worker = async () => {
      while (next < fresh.length) {
        const job = fresh[next++];
        await readOne(job.card, job.file, vName, vId);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, fresh.length) }, worker));
  }

  // Paste photos straight from WhatsApp Web / clipboard.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
      if (files.length) {
        e.preventDefault();
        addFiles(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  async function saveCard(card: Card, confirmDuplicate = false) {
    const f = card.fields;
    const missing = problemsOf(f);
    if (missing.length) {
      patch(card.key, { message: "Fill the red boxes first." });
      return false;
    }
    patch(card.key, { status: "saving", message: undefined });
    const payload: BookingInput & { photoId?: string; vendorId?: string } = {
      // Slip bill numbers repeat (like names), so they are not stored as a unique
      // order No. — only shown in the name and notes to identify the parcel.
      vendorRef: undefined,
      billNo: f.vendorRef.trim() || undefined,
      customerName: f.customerName.trim(),
      customerPhone: f.customerPhone.trim(),
      address: f.address.trim(),
      emirate: f.emirate,
      items: f.items.trim() || undefined,
      codAmount: Math.round(Number(f.codAmount)),
      notes: [f.vendorRef.trim() ? `Bill ${f.vendorRef.trim()}` : "", f.notes.trim()].filter(Boolean).join(" · ") || undefined,
      ...(confirmDuplicate ? { confirmDuplicate: true } : {}),
      ...(card.photoId ? { photoId: card.photoId } : {}),
      ...(mode === "admin" ? { vendorId } : {}),
    };
    try {
      const booking = await apiFetch<Booking>(mode === "admin" ? "/bookings" : "/vendor-portal/bookings", { method: "POST", body: payload });
      patch(card.key, { status: "saved", booking, message: undefined });
      return true;
    } catch (err) {
      const details = err instanceof ApiClientError ? (err.details as { code?: string } | undefined) : undefined;
      if (details?.code === "BILL_REPEAT") {
        patch(card.key, { status: "blocked", message: err instanceof Error ? err.message : "Already entered" });
      } else if (details?.code === "POSSIBLE_DUPLICATE") {
        patch(card.key, { status: "duplicate", message: err instanceof Error ? err.message : "Possible duplicate" });
      } else {
        patch(card.key, { status: "ready", message: err instanceof Error ? err.message : "Could not save" });
      }
      return false;
    }
  }

  async function saveAll() {
    setSavingAll(true);
    try {
      for (const c of cardsRef.current) {
        if (c.status === "ready" && !problemsOf(c.fields).length) await saveCard(c);
      }
      onSaved?.();
    } finally {
      setSavingAll(false);
    }
  }

  const ready = cards.filter((c) => c.status === "ready");
  const readyOk = ready.filter((c) => !problemsOf(c.fields).length);
  const saved = cards.filter((c) => c.status === "saved" && c.booking);
  const reading = cards.filter((c) => c.status === "queued" || c.status === "reading").length;
  // Everything not saved yet, with the reason — so a skipped photo is never missed.
  const notSaved = cards
    .map((c, i) => ({ c, n: i + 1 }))
    .filter(({ c }) => c.status !== "saved" && c.status !== "queued" && c.status !== "reading" && c.status !== "saving")
    .map(({ c, n }) => ({
      key: c.key,
      n,
      why:
        c.status === "blocked"
          ? "same bill already entered"
          : c.status === "duplicate"
            ? "possible duplicate — confirm or remove"
            : c.status === "error"
              ? "photo could not be read"
              : problemsOf(c.fields).length
                ? `missing ${problemsOf(c.fields)
                    .map((k) => ({ vendorRef: "bill no.", customerName: "name", customerPhone: "phone", address: "address", emirate: "emirate", codAmount: "COD" })[k as string] ?? k)
                    .join(", ")}`
                : c.message ?? "not saved yet",
    }));

  const input = "w-full rounded border px-2 py-1.5 text-sm";
  const cls = (c: Card, name: keyof Fields) =>
    `${input} ${problemsOf(c.fields).includes(name) ? "border-cancelled bg-cancelled-bg" : c.unclear.includes(name) ? "border-pending bg-pending-bg" : "border-line"}`;
  const lbl = "mb-0.5 block font-mono text-[10px] uppercase tracking-wide text-ink-soft";

  return (
    <div className="border-2 border-navy bg-white p-4 md:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="font-display text-xl font-semibold text-navy">📷 Read order photos</h2>
        <span className="text-sm text-ink-soft">Select all the slip photos at once (or paste them). Check each one, then Save all.</span>
      </div>

      {configured === false && (
        <p className="mb-3 border border-pending bg-pending-bg p-2 text-sm text-pending">
          The photo reader isn&apos;t switched on yet — the Anthropic API key still needs to be added in Railway.
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-end gap-2">
        {mode === "admin" && (
          <div>
            <label className={lbl}>Vendor</label>
            <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="rounded border border-line px-2.5 py-2 text-sm">
              <option value="">Choose vendor…</option>
              {(vendors ?? [])
                .filter((v) => v.active)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
            </select>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <button
          onClick={() => (mode === "admin" && !vendorId ? alert("Choose the vendor first.") : fileRef.current?.click())}
          className="rounded bg-brass px-4 py-2 font-mono text-xs font-bold uppercase tracking-wide text-white hover:opacity-90"
        >
          ➕ Add photos
        </button>
        {cards.length > 0 && (
          <>
            <button
              onClick={saveAll}
              disabled={savingAll || !readyOk.length}
              className="rounded bg-navy px-4 py-2 font-mono text-xs uppercase tracking-wide text-paper hover:bg-navy-2 disabled:opacity-50"
            >
              {savingAll ? "Saving…" : `💾 Save all checked (${readyOk.length})`}
            </button>
            {saved.length > 0 && (
              <button
                onClick={() => onPrint(saved.map((c) => c.booking!.id))}
                className="rounded border border-navy bg-white px-4 py-2 font-mono text-xs uppercase tracking-wide text-navy hover:bg-paper-2"
              >
                🖨 Labels for saved ({saved.length})
              </button>
            )}
            <button
              onClick={() => setCards((l) => l.filter((c) => c.status !== "saved"))}
              className="text-xs text-ink-soft hover:underline"
            >
              Clear saved
            </button>
          </>
        )}
      </div>

      {cards.length > 0 && (
        <p className="mb-3 font-mono text-[11px] uppercase tracking-wide text-ink-soft">
          {cards.length} card{cards.length === 1 ? "" : "s"} · {reading > 0 ? `reading ${reading}… · ` : ""}
          {ready.length} to check · {saved.length} saved
          {ready.length - readyOk.length > 0 ? ` · ${ready.length - readyOk.length} need fixing (red)` : ""}
          <span className="ml-2 normal-case">Amber = the reader wasn&apos;t sure, please check.</span>
        </p>
      )}

      {saved.length > 0 && notSaved.length > 0 && !savingAll && reading === 0 && (
        <div className="mb-3 border-2 border-cancelled bg-cancelled-bg p-3 text-sm text-cancelled">
          <b>
            ⚠ {saved.length} saved · {notSaved.length} NOT saved
          </b>{" "}
          — fix or remove {notSaved.length === 1 ? "it" : "them"}:
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {notSaved.map((x) => (
              <button
                key={x.key}
                onClick={() => document.getElementById(`photo-card-${x.key}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
                className="rounded border border-cancelled bg-white px-2 py-1 text-xs"
              >
                Photo #{x.n}: {x.why} →
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3">
        {cards.map((c, idx) => (
          <div
            key={c.key}
            id={`photo-card-${c.key}`}
            className={`flex flex-col gap-3 border p-3 md:flex-row ${
              c.status === "saved" ? "border-delivered bg-delivered-bg" : c.status === "error" || c.status === "duplicate" || c.status === "blocked" ? "border-cancelled bg-cancelled-bg" : "border-line"
            }`}
          >
            <div className="shrink-0 md:w-40">
              <div className="mb-1 font-mono text-xs font-bold text-ink-soft">#{idx + 1}</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={c.preview}
                alt={c.fileName}
                onClick={() => setBigPhoto(c.preview)}
                className="max-h-56 w-full cursor-zoom-in border border-line object-contain md:max-h-52"
              />
            </div>

            <div className="min-w-0 flex-1">
              {(c.status === "queued" || c.status === "reading") && <p className="py-6 text-sm text-ink-soft">{c.status === "queued" ? "Waiting…" : "Reading the photo…"}</p>}

              {c.status === "error" && (
                <div className="py-2 text-sm">
                  <p className="text-cancelled">{c.message}</p>
                  <button onClick={() => patch(c.key, { status: "ready", message: undefined })} className="mt-1 text-xs text-brass hover:underline">
                    Type it in by hand instead
                  </button>
                </div>
              )}

              {c.status === "blocked" && (
                <div className="py-2 text-sm">
                  <p className="font-bold text-cancelled">⛔ {c.message}</p>
                  <button onClick={() => setCards((l) => l.filter((x) => x.key !== c.key))} className="mt-1 text-xs text-cancelled hover:underline">
                    Remove this card
                  </button>
                </div>
              )}

              {c.status === "saved" && c.booking && (
                <div className="py-2">
                  <div className="text-sm text-delivered">
                    ✓ Saved — {c.booking.customerName} · {c.booking.emirate} · AED {c.booking.codAmount}
                  </div>
                  <div className="font-mono text-3xl font-bold tracking-wider text-navy">CN {c.booking.cnNo}</div>
                </div>
              )}

              {(c.status === "ready" || c.status === "saving" || c.status === "duplicate") && (
                <>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    <div>
                      <label className={lbl}>Bill no.</label>
                      <input value={c.fields.vendorRef} onChange={(e) => setField(c.key, "vendorRef", e.target.value)} className={cls(c, "vendorRef")} />
                    </div>
                    <div>
                      <label className={lbl}>Phone *</label>
                      <input value={c.fields.customerPhone} onChange={(e) => setField(c.key, "customerPhone", e.target.value)} className={cls(c, "customerPhone")} inputMode="tel" />
                    </div>
                    <div>
                      <label className={lbl}>Emirate *</label>
                      <select value={c.fields.emirate} onChange={(e) => setField(c.key, "emirate", e.target.value)} className={cls(c, "emirate")}>
                        <option value="">—</option>
                        {EMIRATES.filter((e) => e !== "EXCHANGED").map((e) => (
                          <option key={e} value={e}>
                            {e}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={lbl}>COD (AED) *</label>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          title="Make amount minus / plus"
                          onClick={() => {
                            const v = c.fields.codAmount;
                            setField(c.key, "codAmount", v.startsWith("-") ? v.slice(1) : "-" + v);
                          }}
                          className="shrink-0 rounded border border-line px-2 font-mono font-bold"
                        >
                          ±
                        </button>
                        <input
                          value={c.fields.codAmount}
                          onChange={(e) => {
                            const raw = e.target.value.trim();
                            const neg = raw.startsWith("-") || raw.startsWith("−");
                            setField(c.key, "codAmount", (neg ? "-" : "") + raw.replace(/[^\d]/g, ""));
                          }}
                          className={`${cls(c, "codAmount")} min-w-0 flex-1 font-mono font-bold ${c.fields.codAmount.startsWith("-") ? "text-cancelled" : ""}`}
                          inputMode="text"
                        />
                      </div>
                    </div>
                    <div className="col-span-2">
                      <label className={lbl}>Address / area *</label>
                      <input value={c.fields.address} onChange={(e) => setField(c.key, "address", e.target.value)} className={cls(c, "address")} />
                    </div>
                    <div className="col-span-2">
                      <label className={lbl}>Customer name</label>
                      <input value={c.fields.customerName} onChange={(e) => setField(c.key, "customerName", e.target.value)} className={cls(c, "customerName")} />
                    </div>
                    <div className="col-span-2">
                      <label className={lbl}>Items</label>
                      <input value={c.fields.items} onChange={(e) => setField(c.key, "items", e.target.value)} className={cls(c, "items")} />
                    </div>
                    <div className="col-span-2">
                      <label className={lbl}>Notes</label>
                      <input value={c.fields.notes} onChange={(e) => setField(c.key, "notes", e.target.value)} className={cls(c, "notes")} />
                    </div>
                  </div>
                  {c.message && <p className={`mt-2 text-sm ${c.status === "duplicate" ? "text-cancelled" : "text-pending"}`}>{c.message}</p>}
                  <div className="mt-2 flex flex-wrap gap-3">
                    {c.status === "duplicate" ? (
                      <button onClick={() => saveCard(c, true)} className="rounded bg-cancelled px-3 py-1.5 font-mono text-[11px] uppercase text-white">
                        It&apos;s a different order — save anyway
                      </button>
                    ) : (
                      <button
                        onClick={() => saveCard(c)}
                        disabled={c.status === "saving"}
                        className="rounded bg-navy px-3 py-1.5 font-mono text-[11px] uppercase text-paper hover:bg-navy-2 disabled:opacity-50"
                      >
                        {c.status === "saving" ? "Saving…" : "Save this one"}
                      </button>
                    )}
                    <button onClick={() => setCards((l) => l.filter((x) => x.key !== c.key))} className="text-xs text-cancelled hover:underline">
                      Remove
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {bigPhoto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setBigPhoto(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={bigPhoto} alt="Order slip" className="max-h-full max-w-full object-contain" />
        </div>
      )}
    </div>
  );
}
