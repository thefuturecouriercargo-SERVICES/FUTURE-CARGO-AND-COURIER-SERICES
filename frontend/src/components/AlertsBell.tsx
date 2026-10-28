"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { agingDays, todayStr } from "@/lib/format";
import { openInHeaderSearch } from "@/components/CommandPalette";
import { Order } from "@/types";

interface AlertGroup {
  key: string;
  count: number;
  title: string;
  sub: string;
  href?: string;
  cta: string;
  tone: "red" | "amber" | "blue";
  cns?: number[];
}

const TONE = {
  red: "bg-cancelled-bg text-cancelled",
  amber: "bg-pending-bg text-pending",
  blue: "bg-transferred-bg text-transferred",
};

const SEEN_KEY = "fc-alerts-seen";

/**
 * Header bell: things that need attention right now — consignments pending
 * 5+ days, bank payments drivers haven't confirmed from earlier days, and
 * vendor bookings waiting for pickup. Refreshes every minute. The red count
 * shows how many items are new since the bell was last opened.
 */
export default function AlertsBell() {
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<AlertGroup[]>([]);
  const [seen, setSeen] = useState<number>(0);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const today = todayStr();
    const [carry, bank, bookings] = await Promise.allSettled([
      apiFetch<{ orders: Order[] }>("/orders/pending-carryover", { query: { date: today } }),
      apiFetch<{ orders: Order[] }>("/orders/unconfirmed-bank-carryover", { query: { date: today } }),
      apiFetch<{ awaitingCount: number }>("/bookings"),
    ]);
    const out: AlertGroup[] = [];
    if (carry.status === "fulfilled") {
      const old = carry.value.orders.filter((o) => (agingDays(o.status, o.date) ?? 0) >= 5);
      if (old.length) {
        const who = Array.from(new Set(old.map((o) => o.employee?.name).filter(Boolean))).slice(0, 2).join(", ");
        out.push({
          key: "aging",
          count: old.length,
          title: `Pending 5+ days`,
          sub: `${old.slice(0, 3).map((o) => o.cnNo).join(" · ")}${old.length > 3 ? " …" : ""}${who ? ` — with ${who}` : ""}`,
          cta: "View",
          tone: "red",
          cns: old.map((o) => o.cnNo),
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
  }, []);

  useEffect(() => {
    try {
      setSeen(Number(localStorage.getItem(SEEN_KEY)) || 0);
    } catch {
      /* ignore */
    }
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
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
          className="absolute right-0 top-[calc(100%+10px)] z-50 w-[min(400px,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-[#2A3550] bg-[#111827] text-[#E8ECF4] shadow-[0_20px_50px_rgba(0,0,0,0.55)]"
          style={{ animation: "assistant-reveal 160ms ease-out" }}
        >
          <div className="flex items-center justify-between border-b border-[#1F2A40] px-4 py-3.5">
            <span className="font-display text-[15px] font-semibold">Needs attention</span>
            <button onClick={load} className="text-xs text-[#D4AF5A] hover:underline">
              Refresh
            </button>
          </div>
          {groups.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#0F2A22] text-[#34D399]">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
                  <path d="M5 12l5 5L20 7" />
                </svg>
              </span>
              <span className="text-sm font-semibold">All caught up</span>
              <span className="text-xs text-[#8C97AD]">Nothing overdue right now.</span>
            </div>
          ) : (
            groups.map((g) => {
              const body = (
                <>
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-sm font-bold ${TONE[g.tone]}`}>{g.count}</span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
                    <span className="text-[13.5px] font-semibold">{g.title}</span>
                    <span className="truncate text-xs text-[#8C97AD]">{g.sub}</span>
                  </span>
                  <span className="shrink-0 self-center whitespace-nowrap text-xs text-[#D4AF5A]">{g.cta} →</span>
                </>
              );
              const cls = "flex w-full gap-3 border-b border-[#1B2438] px-4 py-3.5 transition hover:bg-[#162036]";
              return g.href ? (
                <Link key={g.key} href={g.href} onClick={() => setOpen(false)} className={cls}>
                  {body}
                </Link>
              ) : (
                <div key={g.key} className="flex w-full gap-3 border-b border-[#1B2438] px-4 py-3.5">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-sm font-bold ${TONE[g.tone]}`}>{g.count}</span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span className="text-[13.5px] font-semibold">{g.title}</span>
                    <span className="flex flex-wrap gap-1.5">
                      {(g.cns ?? []).slice(0, 8).map((cn) => (
                        <button
                          key={cn}
                          onClick={() => {
                            setOpen(false);
                            openInHeaderSearch(String(cn));
                          }}
                          className="rounded-lg border border-[#3A3220] bg-[#1A1F2E] px-2 py-1 font-mono text-[11.5px] text-[#F1D9A0] hover:border-[#D4AF5A]"
                        >
                          {cn}
                        </button>
                      ))}
                      {(g.cns?.length ?? 0) > 8 && <span className="self-center text-xs text-[#8C97AD]">+{(g.cns?.length ?? 0) - 8} more</span>}
                    </span>
                  </span>
                </div>
              );
            })
          )}
          <p className="px-4 py-2.5 text-center text-[11px] text-[#6F7B93]">Updates every minute</p>
        </div>
      )}
    </div>
  );
}
