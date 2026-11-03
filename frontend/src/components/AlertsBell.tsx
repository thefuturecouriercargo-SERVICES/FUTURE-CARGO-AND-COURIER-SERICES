"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { agingDays, todayStr } from "@/lib/format";
import { openInHeaderSearch } from "@/components/CommandPalette";
import { Order } from "@/types";

interface AgingCn {
  cn: number;
  days: number;
}

interface AlertGroup {
  key: string;
  count: number;
  title: string;
  sub: string;
  href?: string;
  cta: string;
  tone: "red" | "amber" | "blue";
  items?: AgingCn[];
}

const TONE = {
  red: { tile: "bg-[#2A1418] text-[#F87171] ring-1 ring-[#F87171]/25", dot: "bg-[#F87171]" },
  amber: { tile: "bg-[#2A2214] text-[#FBBF24] ring-1 ring-[#FBBF24]/25", dot: "bg-[#FBBF24]" },
  blue: { tile: "bg-[#142036] text-[#60A5FA] ring-1 ring-[#60A5FA]/25", dot: "bg-[#60A5FA]" },
};

const SEEN_KEY = "fc-alerts-seen";
const CHIP_LIMIT = 9;

function ago(ts: number | null, now: number): string {
  if (!ts) return "";
  const m = Math.floor((now - ts) / 60000);
  if (m < 1) return "Updated just now";
  if (m === 1) return "Updated 1 min ago";
  return `Updated ${m} min ago`;
}

export default function AlertsBell() {
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<AlertGroup[]>([]);
  const [seen, setSeen] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [showAllCns, setShowAllCns] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const today = todayStr();
    const [carry, bank, bookings] = await Promise.allSettled([
      apiFetch<{ orders: Order[] }>("/orders/pending-carryover", { query: { date: today } }),
      apiFetch<{ orders: Order[] }>("/orders/unconfirmed-bank-carryover", { query: { date: today } }),
      apiFetch<{ awaitingCount: number }>("/bookings"),
    ]);
    const out: AlertGroup[] = [];
    if (carry.status === "fulfilled") {
      const old = carry.value.orders
        .map((o) => ({ o, days: agingDays(o.status, o.date) ?? 0 }))
        .filter((x) => x.days >= 5)
        .sort((a, b) => b.days - a.days);
      if (old.length) {
        const who = Array.from(new Set(old.map((x) => x.o.employee?.name).filter(Boolean)));
        out.push({
          key: "aging",
          count: old.length,
          title: "Pending 5+ days",
          sub: `Oldest ${old[0].days} days${who.length ? ` · with ${who.slice(0, 2).join(", ")}${who.length > 2 ? ` +${who.length - 2}` : ""}` : ""}`,
          cta: "Tap a CN to open",
          tone: "red",
          items: old.map((x) => ({ cn: x.o.cnNo, days: x.days })),
        });
      }
    }
    if (bank.status === "fulfilled" && bank.value.orders.length) {
      out.push({
        key: "bank",
        count: bank.value.orders.length,
        title: "Unconfirmed bank payments",
        sub: "From earlier days — drivers haven’t confirmed receipt",
        href: "/bank-ledger",
        cta: "Review",
        tone: "amber",
      });
    }
    if (bookings.status === "fulfilled" && bookings.value.awaitingCount > 0) {
      out.push({
        key: "pickup",
        count: bookings.value.awaitingCount,
        title: "Bookings awaiting pickup",
        sub: "Vendor and website orders not collected yet",
        href: "/awaiting-pickup",
        cta: "Open",
        tone: "blue",
      });
    }
    setGroups(out);
    setUpdatedAt(Date.now());
    setLoading(false);
  }, []);

  useEffect(() => {
    try {
      setSeen(Number(localStorage.getItem(SEEN_KEY)) || 0);
    } catch {
      /* ignore */
    }
    load();
    const t = setInterval(load, 60000);
    const c = setInterval(() => setNow(Date.now()), 15000);
    return () => {
      clearInterval(t);
      clearInterval(c);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const total = groups.reduce((s, g) => s + g.count, 0);
  const unseen = Math.max(0, total - seen);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      setNow(Date.now());
      setShowAllCns(false);
      setSeen(total);
      try {
        localStorage.setItem(SEEN_KEY, String(total));
      } catch {
        /* ignore */
      }
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={toggle}
        aria-label={`Alerts${total ? `, ${total} need attention` : ""}`}
        aria-expanded={open}
        className={`relative flex h-11 w-11 items-center justify-center rounded-xl border transition ${
          open || unseen ? "border-[#D4AF5A] bg-[#1A1F2E] text-[#F1D9A0]" : "border-[#243049] text-[#9AA5BA] hover:border-[#D4AF5A] hover:text-white"
        } ${unseen ? "shadow-[0_0_18px_rgba(212,175,90,0.35)]" : ""}`}
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10 21h4" />
        </svg>
        {total > 0 && (
          <span
            className={`absolute -right-1.5 -top-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full border-2 border-[#0A1020] px-1 text-[11px] font-bold ${
              unseen ? "bg-[#EF4444] text-white" : "bg-[#243049] text-[#C9D1E0]"
            }`}
          >
            {total > 99 ? "99+" : total}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Needs attention"
          className="fixed inset-x-3 top-[80px] z-50 flex max-h-[calc(100vh-96px)] flex-col overflow-hidden rounded-2xl border border-[#2A3550] bg-[#0F1626] text-[#E8ECF4] shadow-[0_24px_60px_rgba(0,0,0,0.6)] sm:absolute sm:inset-x-auto sm:left-0 sm:top-[calc(100%+12px)] sm:w-[420px] sm:max-h-[min(560px,calc(100vh-100px))]"
          style={{ animation: "assistant-reveal 160ms ease-out" }}
        >
          {/* caret pointing at the bell */}
          <span aria-hidden className="absolute -top-[7px] left-[15px] hidden h-3 w-3 rotate-45 border-l border-t border-[#2A3550] bg-[#0F1626] sm:block" />

          <div className="relative flex items-center justify-between gap-3 border-b border-[#1F2A40] bg-[#111A2C] px-4 py-3.5">
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="font-display text-[15px] font-semibold text-white">
                Needs attention
                {total > 0 && <span className="ml-2 rounded-full bg-[#D4AF5A]/15 px-2 py-0.5 text-[11px] font-bold text-[#F1D9A0]">{total}</span>}
              </span>
              <span className="mt-1 text-[11px] text-[#6F7B93]">{loading && !updatedAt ? "Checking…" : ago(updatedAt, now)}</span>
            </div>
            <button
              onClick={load}
              disabled={loading}
              aria-label="Refresh alerts"
              className="flex h-8 items-center gap-1.5 rounded-lg border border-[#2A3550] px-2.5 text-xs font-medium text-[#D4AF5A] transition hover:border-[#D4AF5A] hover:bg-[#1A1F2E] disabled:opacity-60"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={loading ? "animate-spin" : ""}>
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <path d="M21 3v6h-6" />
              </svg>
              Refresh
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {loading && !updatedAt ? (
              <div className="space-y-3 px-4 py-4">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex animate-pulse gap-3">
                    <span className="h-10 w-10 rounded-xl bg-[#1A2338]" />
                    <span className="flex flex-1 flex-col gap-2 pt-1">
                      <span className="h-3 w-2/5 rounded bg-[#1A2338]" />
                      <span className="h-2.5 w-3/4 rounded bg-[#161E30]" />
                    </span>
                  </div>
                ))}
              </div>
            ) : groups.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#0F2A22] text-[#34D399] ring-1 ring-[#34D399]/25">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                </span>
                <span className="text-sm font-semibold">All caught up</span>
                <span className="text-xs text-[#8C97AD]">Nothing overdue right now.</span>
              </div>
            ) : (
              groups.map((g) => {
                const tone = TONE[g.tone];
                const tile = (
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[15px] font-bold tabular-nums ${tone.tile}`}>
                    {g.count > 999 ? "999+" : g.count}
                  </span>
                );
                const heading = (
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[13.5px] font-semibold text-white">{g.title}</span>
                    <span className="text-xs leading-snug text-[#8C97AD]">{g.sub}</span>
                  </span>
                );

                if (g.href) {
                  return (
                    <Link
                      key={g.key}
                      href={g.href}
                      onClick={() => setOpen(false)}
                      className="group flex w-full items-center gap-3 border-b border-[#1B2438] px-4 py-3.5 transition last:border-b-0 hover:bg-[#141D31]"
                    >
                      {tile}
                      <span className="min-w-0 flex-1">{heading}</span>
                      <span className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-[#D4AF5A] transition group-hover:bg-[#D4AF5A]/10">
                        {g.cta}
                        <span aria-hidden className="transition group-hover:translate-x-0.5">→</span>
                      </span>
                    </Link>
                  );
                }

                const items = g.items ?? [];
                const shown = showAllCns ? items : items.slice(0, CHIP_LIMIT);
                return (
                  <div key={g.key} className="flex w-full gap-3 border-b border-[#1B2438] px-4 py-3.5 last:border-b-0">
                    {tile}
                    <span className="flex min-w-0 flex-1 flex-col gap-2.5">
                      {heading}
                      <span className="grid grid-cols-3 gap-1.5">
                        {shown.map((it) => (
                          <button
                            key={it.cn}
                            onClick={() => {
                              setOpen(false);
                              openInHeaderSearch(String(it.cn));
                            }}
                            title={`CN ${it.cn} — pending ${it.days} days`}
                            className="flex items-center justify-between gap-1 rounded-lg border border-[#3A3220] bg-[#16192A] px-2 py-1.5 font-mono text-[11.5px] text-[#F1D9A0] transition hover:border-[#D4AF5A] hover:bg-[#1E2234]"
                          >
                            <span className="truncate">{it.cn}</span>
                            <span className="shrink-0 rounded bg-[#2A1418] px-1 text-[10px] font-bold text-[#F87171]">{it.days}d</span>
                          </button>
                        ))}
                      </span>
                      {items.length > CHIP_LIMIT && (
                        <button
                          onClick={() => setShowAllCns((v) => !v)}
                          className="self-start text-xs font-medium text-[#D4AF5A] hover:underline"
                        >
                          {showAllCns ? "Show less" : `Show all ${items.length}`}
                        </button>
                      )}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          <div className="flex items-center justify-center gap-2 border-t border-[#1B2438] bg-[#0C1322] px-4 py-2.5 text-[11px] text-[#6F7B93]">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#34D399] opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#34D399]" />
            </span>
            Live · refreshes every minute
          </div>
        </div>
      )}
    </div>
  );
}
