"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { fmtNumber, fmtDate } from "@/lib/format";
import { detectArea } from "@/lib/areas";
import SearchHitCard from "@/components/SearchHitCard";
import { OrderBookingDetails } from "@/types";

type Stage = "AWAITING_PICKUP" | "REJECTED" | "PENDING" | "DELIVERED" | "TRANSFER" | "CANCELLED";

interface Hit {
  key: string;
  kind: "booking" | "order";
  cnNo: number;
  date: string;
  vendorName: string;
  stage: Stage;
  amount: number;
  emirate: string;
  area?: string | null;
  driver?: string | null;
  note?: string | null;
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
  booking?: OrderBookingDetails | null;
  matched: string[];
}

const STAGE: Record<Stage, { text: string; cls: string }> = {
  AWAITING_PICKUP: { text: "Awaiting pickup", cls: "bg-pending-bg text-pending" },
  REJECTED: { text: "Rejected", cls: "bg-cancelled-bg text-cancelled" },
  PENDING: { text: "Pending", cls: "bg-pending-bg text-pending" },
  TRANSFER: { text: "Transfer", cls: "bg-transferred-bg text-transferred" },
  DELIVERED: { text: "Delivered", cls: "bg-delivered-bg text-delivered" },
  CANCELLED: { text: "Cancelled", cls: "bg-cancelled-bg text-cancelled" },
};

/**
 * One search box in the admin header: CN no, order no, bill no, customer name,
 * phone, address, vendor or brand. Results drop down over the page; tap one to
 * see full parcel details. Press "/" anywhere to jump into the box.
 */
export default function AdminSearch() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);
  // The parcel shown in the separate popup window (opened with OPEN).
  const [viewHit, setViewHit] = useState<Hit | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Jump to the order's day on Daily Entry and open it there (Edit / Delete).
  function openInDailyEntry(h: Hit) {
    if (!h.orderId || !h.orderDate) return;
    const detail = { date: h.orderDate, cn: h.cnNo, id: h.orderId };
    setOpen(false);
    setViewHit(null);
    if (window.location.pathname.startsWith("/orders")) {
      window.dispatchEvent(new CustomEvent("fc-open-order", { detail }));
    } else {
      router.push(`/orders?date=${detail.date}&cn=${detail.cn}&open=${detail.id}`);
    }
  }

  // Esc closes the popup window.
  useEffect(() => {
    if (!viewHit) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setViewHit(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewHit]);

  // "/" focuses the search box (unless already typing somewhere).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Ctrl+K palette hands a chosen CN over here, so its full details open below.
  useEffect(() => {
    function onSearch(e: Event) {
      const term = String((e as CustomEvent).detail ?? "");
      setQ(term);
      setOpen(true);
      inputRef.current?.focus();
    }
    window.addEventListener("fc-search", onSearch);
    return () => window.removeEventListener("fc-search", onSearch);
  }, []);

  // Close when clicking outside.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (modalRef.current && modalRef.current.contains(t)) return;
      if (boxRef.current && !boxRef.current.contains(t)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits(null);
      setError("");
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await apiFetch<{ results: Hit[] }>("/search", { query: { q: term } });
        if (cancelled) return;
        setHits(r.results);
        setError("");
        setOpenKey(null);
      } catch (e) {
        if (cancelled) return;
        setHits([]);
        setError(e instanceof Error ? e.message : "Search failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  function clear() {
    setQ("");
    setHits(null);
    setOpenKey(null);
    inputRef.current?.focus();
  }

  const showPanel = open && q.trim().length >= 2;

  return (
    <div ref={boxRef} className="relative w-full">
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" aria-hidden>
          <RadarIcon scanning={loading || (open && q.trim().length > 0)} />
        </span>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              inputRef.current?.blur();
            }
          }}
          inputMode="search"
          enterKeyHint="search"
          aria-label="Search"
          className="h-11 w-full rounded-xl border border-line bg-[#121A2B] pl-10 pr-9 text-sm text-white placeholder:text-ink-soft focus:border-brass focus:outline-none"
        />
        {q && (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 px-1 text-sm text-ink-soft hover:text-navy"
          >
            ✕
          </button>
        )}
      </div>

      {showPanel && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[75vh] overflow-y-auto rounded-2xl border border-line bg-white text-ink shadow-2xl shadow-black/50 md:min-w-[560px]">
          {loading && <p className="p-3 text-sm text-ink-soft">Searching…</p>}
          {!loading && error && <p className="p-3 text-sm text-cancelled">{error}</p>}
          {!loading && !error && hits && hits.length === 0 && (
            <p className="p-3 text-sm text-ink-soft">Nothing found for “{q.trim()}”.</p>
          )}
          {!loading && hits && hits.length > 0 && (
            <p className="border-b border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-ink-soft">
              {hits.length === 60 ? "Showing first 60 — type more to narrow" : `${hits.length} result${hits.length === 1 ? "" : "s"}`}
            </p>
          )}
          {!loading &&
            hits?.map((h) => {
              const st = STAGE[h.stage] ?? STAGE.PENDING;
              const area = h.area || detectArea(h.booking?.address, h.emirate);
              const isOpen = openKey === h.key;
              return (
                <div key={h.key} className="border-b border-line last:border-b-0">
                  <div className={`flex w-full items-start justify-between gap-2 p-3 text-left ${isOpen ? "bg-paper" : ""}`}>
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <b className="font-mono text-sm text-navy">CN {h.cnNo}</b>
                        <span className="text-sm font-semibold">{h.booking?.customerName ?? h.vendorName}</span>
                        {h.booking?.customerPhone && <span className="font-mono text-xs text-ink-soft">{h.booking.customerPhone}</span>}
                      </span>
                      <span className="mt-0.5 block text-xs text-ink-soft">
                        {h.vendorName}
                        {h.vendorRef ? ` · Order #${h.vendorRef}` : ""}
                        {h.billNo ? ` · Bill ${h.billNo}` : ""}
                        {" · "}
                        {fmtDate(h.date)}
                        {area ? ` · ${area}` : ""} · {h.emirate}
                        {" · "}
                        {h.amount === 0 && h.booking ? "Prepaid" : `AED ${fmtNumber(h.amount)}`}
                        {h.driver ? ` · 🚚 ${h.driver}` : ""}
                      </span>
                      {h.matched.length > 0 && (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {h.matched.map((m) => (
                            <span key={m} className="rounded bg-brass/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-navy">
                              {m}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-2">
                      <span className={`whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide ${st.cls}`}>
                        {st.text}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setOpenKey(h.key);
                          setViewHit(h);
                        }}
                        className="rounded-lg bg-[#E2B857] px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wide text-[#1A1405] hover:bg-[#F5D27A]"
                      >
                        Open
                      </button>
                    </span>
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {viewHit &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto bg-black/70 px-4 pb-4 backdrop-blur-sm sm:items-center"
            style={{ paddingTop: "max(1rem, calc(env(safe-area-inset-top) + 0.75rem))", paddingBottom: "max(1rem, calc(env(safe-area-inset-bottom) + 0.75rem))" }}
            onClick={(e) => {
              // Tap anywhere — backdrop or the popup itself — closes it; its buttons and links still work.
              const t = e.target as HTMLElement;
              if (t.closest("a, button")) return;
              setViewHit(null);
            }}
          >
            <div ref={modalRef} role="dialog" aria-modal="true" aria-label={`CN ${viewHit.cnNo}`} className="w-full max-w-[560px] cursor-pointer">
              <div className="mb-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setViewHit(null)}
                  aria-label="Close"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-[#2A3654] bg-[#0D1424] text-[#CBD5E1] hover:border-[#E2B857] hover:text-[#E2B857]"
                >
                  ✕
                </button>
              </div>
              <SearchHitCard
                h={viewHit}
                area={viewHit.area || detectArea(viewHit.booking?.address, viewHit.emirate)}
                onEdit={viewHit.orderId ? () => openInDailyEntry(viewHit) : undefined}
              />
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}


/** Gold radar rings; while searching, a red sweep rotates round like a live radar scan. */
function RadarIcon({ scanning }: { scanning: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="block">
      <circle cx="12" cy="12" r="10" stroke="#D4AF5A" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="6.2" stroke="#D4AF5A" strokeWidth="1.3" opacity="0.75" />
      <circle cx="12" cy="12" r="2.4" stroke="#D4AF5A" strokeWidth="1.2" opacity="0.6" />
      <path d="M12 2v20M2 12h20" stroke="#D4AF5A" strokeWidth="0.8" opacity="0.3" />
      <g className={scanning ? "radar-sweep radar-sweep--on" : "radar-sweep"}>
        <path d="M12 12L12 2A10 10 0 0 1 19.07 4.93Z" fill="#EF4444" opacity={scanning ? 0.45 : 0} />
        <path d="M12 12L19.07 4.93" stroke="#EF4444" strokeWidth="1.6" strokeLinecap="round" opacity={scanning ? 1 : 0} />
      </g>
      {scanning && <circle className="radar-blip" cx="16.4" cy="8.6" r="1.3" fill="#EF4444" />}
      <circle cx="12" cy="12" r="1" fill={scanning ? "#EF4444" : "#D4AF5A"} />
    </svg>
  );
}
