"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { agingDays, todayStr } from "@/lib/format";
import { openInHeaderSearch } from "@/components/CommandPalette";
import { Order } from "@/types";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useSocketEvent } from "@/lib/useSocketEvent";
import { fmtDate, fmtNumber } from "@/lib/format";
import { toast } from "@/components/ui/Feedback";

interface Reminder {
  id: string;
  date: string;
  category: string;
  amount: number;
  note: string | null;
  employeeId: string | null;
  employeeName: string | null;
  createdByName: string;
  createdAt: string;
}

/** Short two-note chime made in the browser (no sound file needed). */
function chime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      const t = ctx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.4);
    });
    setTimeout(() => ctx.close().catch(() => {}), 1200);
  } catch {
    /* sound blocked — the shaking bell still shows it */
  }
}

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
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === "SUPER_ADMIN";
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [remOpen, setRemOpen] = useState(false);
  const [remBusy, setRemBusy] = useState<string | null>(null);
  const knownRem = useRef<Set<string> | null>(null);

  const loadReminders = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const list = await apiFetch<Reminder[]>("/reminders/pending");
      // Sound only for reminders that just arrived (not on first load of the page).
      if (knownRem.current && list.some((r) => !knownRem.current!.has(r.id))) chime();
      knownRem.current = new Set(list.map((r) => r.id));
      setReminders(list);
      if (!list.length) setRemOpen(false);
    } catch {
      /* ignore */
    }
  }, [isAdmin]);
  useSocketEvent("reminder:changed", () => loadReminders());
  useEffect(() => {
    loadReminders();
    const t = setInterval(loadReminders, 30000);
    return () => clearInterval(t);
  }, [loadReminders]);

  async function confirmReminder(r: Reminder) {
    setRemBusy(r.id);
    try {
      await apiFetch(`/reminders/${r.id}/confirm`, { method: "POST" });
      if (r.category === "SALARY") {
        setRemOpen(false);
        const q = new URLSearchParams({ remind: "1", employeeId: r.employeeId ?? "", amount: String(r.amount), date: r.date.slice(0, 10), note: r.note ?? "" });
        router.push(`/payroll?${q.toString()}`);
      } else {
        toast(`${r.category.replace(/_/g, " ")} expense saved`, "success", `${fmtNumber(r.amount)} AED on ${fmtDate(r.date)}`);
      }
      await loadReminders();
    } catch (e) {
      toast("Couldn't confirm", "error", e instanceof Error ? e.message : undefined);
    } finally {
      setRemBusy(null);
    }
  }
  async function dismissReminder(r: Reminder) {
    setRemBusy(r.id);
    try {
      await apiFetch(`/reminders/${r.id}/dismiss`, { method: "POST" });
      await loadReminders();
    } finally {
      setRemBusy(null);
    }
  }

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
  const ringing = reminders.length > 0;

  function toggle() {
    // A manager's reminder opens its own popup until the admin confirms it.
    if (ringing && !open) {
      setRemOpen(true);
      return;
    }
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
          ringing ? "border-[#EF4444] bg-[#2A1418] text-[#FCA5A5]" : open || unseen ? "border-[#D4AF5A] bg-[#1A1F2E] text-[#F1D9A0]" : "border-[#243049] text-[#9AA5BA] hover:border-[#D4AF5A] hover:text-white"
        } ${ringing ? "shadow-[0_0_18px_rgba(239,68,68,0.45)]" : unseen ? "shadow-[0_0_18px_rgba(212,175,90,0.35)]" : ""}`}
      >
        <svg className={ringing ? "bell-ring" : ""} width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10 21h4" />
        </svg>
        {ringing && (
          <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full border-2 border-[#0A1020] bg-[#EF4444] px-1 text-[11px] font-bold text-white">
            {reminders.length}
          </span>
        )}
        {!ringing && total > 0 && (
          <span
            className={`absolute -right-1.5 -top-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full border-2 border-[#0A1020] px-1 text-[11px] font-bold ${
              unseen ? "bg-[#EF4444] text-white" : "bg-[#243049] text-[#C9D1E0]"
            }`}
          >
            {total > 99 ? "99+" : total}
          </span>
        )}
      </button>

      <style>{`.bell-ring{transform-origin:50% 2px;animation:bellRing 1.1s ease-in-out infinite}
@keyframes bellRing{0%,55%,100%{transform:rotate(0)}5%{transform:rotate(18deg)}12%{transform:rotate(-16deg)}19%{transform:rotate(13deg)}26%{transform:rotate(-10deg)}33%{transform:rotate(6deg)}40%{transform:rotate(-3deg)}}
@media (prefers-reduced-motion:reduce){.bell-ring{animation:none}}`}</style>

      {remOpen && ringing && (
        <div className="fixed inset-0 z-[90] flex items-start justify-center bg-black/60 p-3 pt-[80px]" onClick={() => setRemOpen(false)}>
          <div
            role="dialog"
            aria-label="Reminders from manager"
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[calc(100vh-110px)] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[#EF4444]/40 bg-[#0F1626] text-[#E8ECF4] shadow-[0_24px_60px_rgba(0,0,0,0.6)]"
          >
            <div className="flex items-center justify-between border-b border-[#1F2A40] bg-[#1A1220] px-4 py-3">
              <span className="font-display text-[15px] font-semibold text-white">
                🔔 Reminder{reminders.length > 1 ? "s" : ""} from manager
                <span className="ml-2 rounded-full bg-[#EF4444]/20 px-2 py-0.5 text-[11px] font-bold text-[#FCA5A5]">{reminders.length}</span>
              </span>
              <button onClick={() => setRemOpen(false)} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full border border-[#2A3550] text-lg">
                ×
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3">
              {reminders.map((r) => (
                <div key={r.id} className="rounded-xl border border-[#2A3550] bg-[#131C30] p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[13px] font-bold uppercase tracking-wide text-[#F1D9A0]">{r.category.replace(/_/g, " ")}</div>
                      {r.employeeName && <div className="text-[12.5px] font-semibold text-white">{r.employeeName}</div>}
                      <div className="mt-0.5 text-[11.5px] text-[#8C97AD]">
                        {fmtDate(r.date)} · from {r.createdByName}
                      </div>
                    </div>
                    <div className="shrink-0 font-mono text-[17px] font-bold text-white">{fmtNumber(r.amount)} AED</div>
                  </div>
                  {r.note && <div className="mt-2 rounded-lg bg-black/25 px-2.5 py-1.5 text-[12.5px]">{r.note}</div>}
                  <div className="mt-2.5 flex gap-2">
                    <button
                      disabled={remBusy === r.id}
                      onClick={() => confirmReminder(r)}
                      className="h-9 flex-1 rounded-lg bg-[#D4AF5A] text-[13px] font-bold text-[#0A1020] hover:brightness-110 disabled:opacity-60"
                    >
                      {r.category === "SALARY" ? "Confirm → Payroll" : "Confirm & save"}
                    </button>
                    <button
                      disabled={remBusy === r.id}
                      onClick={() => dismissReminder(r)}
                      className="h-9 rounded-lg border border-[#2A3550] px-3 text-[12.5px] text-[#9AA5BA] hover:border-[#F87171] hover:text-[#F87171] disabled:opacity-60"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={() => {
                setRemOpen(false);
                setOpen(true);
              }}
              className="border-t border-[#1B2438] bg-[#0C1322] px-4 py-2.5 text-center text-[12px] font-medium text-[#D4AF5A] hover:underline"
            >
              Other alerts →
            </button>
          </div>
        </div>
      )}

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
