"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useSocketEvent } from "@/lib/useSocketEvent";
import { useLiveRefresh } from "@/lib/useLiveRefresh";

interface RacePin { code: string; name: string; rank: number; pos: number; me: boolean }
interface RaceMe { rank: number; delivered: number; total: number; ahead: { name: string; need: number } | null; behind: { name: string; gap: number } | null }
interface RaceData { me: RaceMe | null; drivers: RacePin[]; yesterdayWinner: { name: string; code: string } | null }

const COLORS = ["#4FD1C5", "#F2836B", "#E2B453", "#A78BFA", "#60A5FA", "#F472B6", "#34D399", "#FB923C"];
const FIXED: Record<string, string> = { AN: "#4FD1C5", MS: "#F2836B", NS: "#E2B453", ND: "#A78BFA", SV: "#60A5FA", FS: "#F472B6" };
function colorOf(code: string) {
  if (FIXED[code]) return FIXED[code];
  let h = 0;
  for (const c of code) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

const SAFE = ["Every delivery moves you forward", "Safe ride first — the race is long", "Bismillah, keep going", "One good hour can change everything"];

/** Comments that fit the driver's situation right now (shown in rotation). */
function ambient(me: RaceMe, now: Date): string[] {
  const out: string[] = [];
  const minsLeft = 24 * 60 - (now.getHours() * 60 + now.getMinutes());
  if (me.delivered === 0) out.push("Your first delivery puts you on the board");
  if (me.ahead) {
    out.push(me.ahead.need <= 2 ? `Just ${me.ahead.need} more and you pass ${me.ahead.name}!` : `${me.ahead.need} more to catch ${me.ahead.name}`);
  } else {
    out.push("You're leading the race 👑");
    if (me.behind) out.push(me.behind.gap <= 1 ? `${me.behind.name} is right behind you — don't slow down` : `Leading by ${me.behind.gap} — keep it up`);
  }
  if (me.ahead && me.behind && me.behind.gap <= 1) out.push(`${me.behind.name} is close behind you`);
  if (me.rank === me.total && me.total > 1) out.push("Plenty of time — one good run changes everything");
  if (me.delivered > 0 && me.delivered % 10 === 0) out.push(`${me.delivered} delivered — great run!`);
  if (minsLeft <= 120) out.push(`Final stretch — ${Math.floor(minsLeft / 60)}h ${minsLeft % 60}m to 12`);
  else out.push(`${Math.floor(minsLeft / 60)}h ${minsLeft % 60}m left to 12 midnight`);
  out.push(SAFE[now.getHours() % SAFE.length]);
  return out;
}

/** One-line live race to 12 midnight. Shows places only — never other drivers' counts. */
export default function DriverRace() {
  const [data, setData] = useState<RaceData | null>(null);
  const [width, setWidth] = useState(0);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [event, setEvent] = useState<{ text: string; tone: "good" | "bad" | "info" } | null>(null);
  const [tickN, setTickN] = useState(0);
  const [open, setOpen] = useState(false);
  const eventTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const prevRanks = useRef<Map<string, number>>(new Map());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await apiFetch<RaceData>("/driver/race");
      const gained = new Set<string>();
      for (const p of d.drivers) {
        const before = prevRanks.current.get(p.code);
        if (before !== undefined && p.rank < before) gained.add(p.code);
      }
      // Overtake comments: compare places with the last refresh.
      const prev = prevRanks.current;
      if (prev.size) {
        const was = (c: string) => prev.get(c);
        const meNow = d.drivers.find((p) => p.me);
        let ev: { text: string; tone: "good" | "bad" | "info" } | null = null;
        if (meNow && was(meNow.code) !== undefined) {
          const myOld = was(meNow.code)!;
          if (meNow.rank < myOld) {
            const passed = d.drivers.filter((p) => !p.me && (was(p.code) ?? 99) < myOld && p.rank > meNow.rank).map((p) => p.name);
            ev = { tone: "good", text: meNow.rank === 1 ? `You took the lead! ${passed.length ? passed.join(" & ") + " overtaken" : ""} 👑` : `You overtook ${passed.join(" & ") || "a driver"}! Now P${meNow.rank} 🔥` };
          } else if (meNow.rank > myOld) {
            const by = d.drivers.filter((p) => !p.me && (was(p.code) ?? 99) > myOld && p.rank < meNow.rank).map((p) => p.name);
            ev = { tone: "bad", text: `${by.join(" & ") || "Someone"} just passed you — take it back!` };
          }
        }
        if (!ev) {
          const mover = d.drivers.find((p) => !p.me && (was(p.code) ?? 99) > p.rank);
          if (mover) {
            const victim = d.drivers.find((p) => !p.me && p.code !== mover.code && (was(p.code) ?? 99) < (was(mover.code) ?? 99) && p.rank > mover.rank);
            ev = { tone: "info", text: mover.rank === 1 ? `${mover.name} takes the lead!` : `${mover.name} overtook ${victim?.name ?? "a driver"} → P${mover.rank}` };
          }
        }
        if (ev) {
          setEvent(ev);
          if (eventTimer.current) clearTimeout(eventTimer.current);
          eventTimer.current = setTimeout(() => setEvent(null), 12000);
        }
      }
      prevRanks.current = new Map(d.drivers.map((p) => [p.code, p.rank]));
      setData(d);
      if (gained.size) {
        setFlash(gained);
        setTimeout(() => setFlash(new Set()), 1000);
      }
    } catch {
      /* the race is a nice-to-have; never break the page */
    }
  }, []);

  // Refresh when a delivery changes (debounced), on app resume, and every 2 minutes.
  const soon = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(load, 3000);
  }, [load]);
  useSocketEvent("order:changed", soon);
  useLiveRefresh(load, { socket: false });
  useEffect(() => {
    load();
    const i = setInterval(load, 120000);
    const r = setInterval(() => setTickN((n) => n + 1), 7000);
    return () => {
      clearInterval(i);
      clearInterval(r);
    };
  }, [load]);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [data !== null]);

  if (!data || data.drivers.length === 0) return null;

  // One clean row, no overlaps: drivers in race order; anyone close or tied lines up
  // one pin-width behind the driver in front (ties: who reached the count first is in front).
  const PIN = 26;
  const ordered = [...data.drivers].sort((a, b) => a.rank - b.rank);
  const step = Math.min(PIN + 4, width / Math.max(1, ordered.length - 1));
  const xs = ordered.map((p) => p.pos * 0.94 * width);
  for (let k = 1; k < xs.length; k++) xs[k] = Math.min(xs[k], xs[k - 1] - step);
  if (xs.length) xs[xs.length - 1] = Math.max(xs[xs.length - 1], 0);
  for (let k = xs.length - 2; k >= 0; k--) xs[k] = Math.max(xs[k], xs[k + 1] + step);
  const placed = ordered.map((p, k) => ({ ...p, x: Math.min(xs[k], width) }));
  const noOneYet = !data.drivers.some((p) => p.pos > 0);
  const pool = noOneYet && data.yesterdayWinner
    ? [`Yesterday's winner: ${data.yesterdayWinner.name} 🏆`, "New race — first delivery takes the lead"]
    : data.me
      ? ambient(data.me, new Date())
      : [];
  const line = event?.text ?? pool[tickN % Math.max(1, pool.length)] ?? "";

  const ordered2 = [...data.drivers].sort((a, b) => a.rank - b.rank);
  const pinStyle = (p: RacePin) => ({
    background: colorOf(p.code),
    boxShadow: flash.has(p.code) ? "0 0 0 4px #4ADE80" : p.me ? "0 0 0 2px #F3D58E" : undefined,
  });
  const commentCls = event?.tone === "good" ? "text-[#4ADE80]" : event?.tone === "bad" ? "text-[#FF8A8A]" : "text-[#E9ECF5]";

  return (
    <div className="mt-2.5">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open today's race"
        className="flex h-[42px] w-full items-center rounded-xl border border-white/15 bg-[#0A1226] px-[13px] active:scale-[0.99]"
      >
        <div ref={trackRef} className="relative h-[3px] min-w-0 flex-1 rounded bg-white/15">
          {width > 0 &&
            placed.map((p) => (
              <span
                key={p.code}
                className="absolute top-1/2 grid h-[26px] w-[26px] place-items-center rounded-full text-[10px] font-extrabold text-[#0A1226]"
                style={{ left: p.x, transform: "translate(-50%, -50%)", transition: "left 1s cubic-bezier(.3,.7,.3,1)", zIndex: p.me ? 9 : 8 - p.rank, ...pinStyle(p) }}
              >
                {p.code}
              </span>
            ))}
        </div>
      </button>
      <div className="mt-1.5 flex items-center gap-2 px-1 text-[12.5px]">
        <span key={line} className={`race-comment min-w-0 flex-1 truncate font-semibold ${commentCls}`}>{line}</span>
        {data.me && <span className="shrink-0 font-mono text-[11px] text-[#B7C0DA]">P{data.me.rank} · {data.me.delivered} today</span>}
      </div>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-3 sm:items-center" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-label="Today's race"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0A1226] p-4 text-[#E9ECF5] shadow-2xl"
            style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom, 0px))" }}
          >
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="font-display text-lg font-bold">Today&apos;s race</div>
                <div className="font-mono text-[10.5px] uppercase tracking-wide text-[#B7C0DA]">12 midnight to 12 midnight</div>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-lg" aria-label="Close">×</button>
            </div>
            <div className="space-y-2.5">
              {ordered2.map((p) => (
                <div key={p.code} className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 ${p.me ? "bg-[#2A2410]" : "bg-white/[0.04]"}`}>
                  <span className="w-6 text-center font-display text-base font-extrabold text-[#B7C0DA]">{p.rank}</span>
                  <span className="w-[68px] truncate text-[13px] font-bold">{p.me ? "You" : p.name}</span>
                  <div className="relative mx-[13px] h-[3px] flex-1 rounded bg-white/15">
                    <span
                      className="absolute top-1/2 grid h-[26px] w-[26px] place-items-center rounded-full text-[10px] font-extrabold text-[#0A1226]"
                      style={{ left: `${p.pos * 100}%`, transform: "translate(-50%, -50%)", transition: "left 1s cubic-bezier(.3,.7,.3,1)", ...pinStyle(p) }}
                    >
                      {p.code}
                    </span>
                  </div>
                  <span className="h-4 w-1.5 shrink-0 rounded-sm" style={{ background: "repeating-linear-gradient(#fff 0 4px,#222 4px 8px)" }} aria-hidden="true" />
                </div>
              ))}
            </div>
            <div className={`mt-3 rounded-lg bg-white/[0.06] px-3 py-2 text-[13px] font-semibold ${commentCls}`}>{line}</div>
            <div className="mt-2 text-center font-mono text-[10.5px] text-[#B7C0DA]">Ties: whoever reached the count first stays ahead</div>
          </div>
        </div>
      )}
      <style>{`.race-comment{animation:raceIn .4s ease}@keyframes raceIn{from{opacity:0;transform:translateY(4px)}}@media (prefers-reduced-motion:reduce){.race-comment{animation:none}}`}</style>
    </div>
  );
}
