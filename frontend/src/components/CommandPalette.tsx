"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { fmtNumber } from "@/lib/format";

type Stage = "AWAITING_PICKUP" | "REJECTED" | "PENDING" | "DELIVERED" | "TRANSFER" | "CANCELLED";
interface Hit {
  key: string;
  cnNo: number;
  vendorName: string;
  stage: Stage;
  amount: number;
  emirate: string;
  driver?: string | null;
}
export interface PaletteLink {
  href: string;
  label: string;
  group: string;
}

const STAGE: Record<Stage, { text: string; cls: string }> = {
  AWAITING_PICKUP: { text: "Awaiting pickup", cls: "pending" },
  REJECTED: { text: "Rejected", cls: "cancelled" },
  PENDING: { text: "Pending", cls: "pending" },
  TRANSFER: { text: "Transfer", cls: "transferred" },
  DELIVERED: { text: "Delivered", cls: "delivered" },
  CANCELLED: { text: "Cancelled", cls: "cancelled" },
};

/** Opens the header search pre-filled with a CN, which shows full parcel details. */
export function openInHeaderSearch(term: string) {
  window.dispatchEvent(new CustomEvent("fc-search", { detail: term }));
}

/**
 * Ctrl + K (⌘K on Mac) quick search: jump to any page, or find a consignment by
 * CN, bill no, name or phone. Arrow keys move, Enter opens, Esc closes.
 */
export default function CommandPalette({ links }: { links: PaletteLink[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("fc-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("fc-palette", onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setHits([]);
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await apiFetch<{ results: Hit[] }>("/search", { query: { q: term } });
        if (!cancelled) setHits(r.results.slice(0, 6));
      } catch {
        if (!cancelled) setHits([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  const pageMatches = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = term ? links.filter((l) => l.label.toLowerCase().includes(term) || l.group.toLowerCase().includes(term)) : links;
    return list.slice(0, term ? 6 : 8);
  }, [q, links]);

  const items: ({ type: "hit"; hit: Hit } | { type: "page"; link: PaletteLink })[] = [
    ...hits.map((hit) => ({ type: "hit" as const, hit })),
    ...pageMatches.map((link) => ({ type: "page" as const, link })),
  ];

  useEffect(() => setActive(0), [q, hits.length]);

  function choose(i: number) {
    const item = items[i];
    if (!item) return;
    setOpen(false);
    if (item.type === "page") router.push(item.link.href);
    else openInHeaderSearch(String(item.hit.cnNo));
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") setOpen(false);
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(active);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center bg-[rgba(3,6,14,0.6)] px-4 pt-[12vh] backdrop-blur-[2px]" onMouseDown={() => setOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Quick search"
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-xl overflow-hidden rounded-[20px] border border-[#2A3550] bg-[#111827] text-[#E8ECF4] shadow-[0_24px_60px_rgba(0,0,0,0.6)]"
        style={{ animation: "assistant-reveal 160ms ease-out" }}
      >
        <label className="flex h-16 items-center gap-3 border-b border-[#1F2A40] px-5 text-[#D4AF5A]">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <span className="sr-only">Search</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search a CN, bill no, name, phone — or a page"
            className="!rounded-none !border-0 !bg-transparent flex-1 text-[16px] text-white placeholder:text-[#6F7B93] focus:!shadow-none focus:outline-none"
          />
          <kbd className="rounded-md border border-[#2A3550] px-1.5 py-0.5 text-[11px] text-[#8C97AD]">Esc</kbd>
        </label>
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {hits.length > 0 && <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#6F7B93]">Consignments</p>}
          {loading && hits.length === 0 && <p className="px-3 py-3 text-sm text-[#8C97AD]">Searching…</p>}
          {items.map((item, i) => {
            const isActive = i === active;
            const header =
              item.type === "page" && (i === 0 || items[i - 1].type === "hit") ? (
                <p key={`h-${i}`} className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#6F7B93]">
                  Pages
                </p>
              ) : null;
            return (
              <div key={item.type === "hit" ? item.hit.key : item.link.href}>
                {header}
                <button
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(i)}
                  className={`flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm ${
                    isActive ? "bg-[#1A1F2E] shadow-[inset_0_0_0_1px_#3A3220]" : ""
                  }`}
                >
                  {item.type === "hit" ? (
                    <>
                      <span className={`font-mono ${isActive ? "text-[#F1D9A0]" : "text-[#C9D1E0]"}`}>{item.hit.cnNo}</span>
                      <span className="flex-1 truncate text-[13px] text-[#8C97AD]">
                        {item.hit.vendorName} · {item.hit.emirate}
                        {item.hit.driver ? ` · ${item.hit.driver}` : ""} · {fmtNumber(item.hit.amount)} AED
                      </span>
                      <span className={`stamp ${STAGE[item.hit.stage]?.cls ?? "pending"}`}>{STAGE[item.hit.stage]?.text ?? item.hit.stage}</span>
                    </>
                  ) : (
                    <>
                      <span className="text-[#D4AF5A]">→</span>
                      <span className="flex-1 text-[#C9D1E0]">{item.link.label}</span>
                      <span className="text-[11px] text-[#6F7B93]">{item.link.group}</span>
                    </>
                  )}
                  {isActive && <span className="text-xs text-[#8C97AD]">↵</span>}
                </button>
              </div>
            );
          })}
          {!loading && q.trim().length >= 2 && items.length === 0 && <p className="px-3 py-6 text-center text-sm text-[#8C97AD]">Nothing found for “{q.trim()}”.</p>}
        </div>
        <div className="flex gap-4 border-t border-[#1F2A40] px-5 py-2.5 text-[11px] text-[#6F7B93]">
          <span>↑↓ move</span>
          <span>↵ open</span>
          <span>Ctrl K anywhere</span>
        </div>
      </div>
    </div>
  );
}
