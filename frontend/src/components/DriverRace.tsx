"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { apiFetch } from "@/lib/api";
import { useSocketEvent } from "@/lib/useSocketEvent";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import { detectArea } from "@/lib/areas";
import type { Order } from "@/types";

interface RacePin { code: string; name: string; rank: number; pos: number; me: boolean }
interface RaceMe { rank: number; delivered: number; total: number; ahead: { name: string; need: number } | null; behind: { name: string; gap: number } | null }
interface RaceData { me: RaceMe | null; drivers: RacePin[]; yesterdayWinner: { name: string; code: string } | null }
interface RaceStats {
  month: string;
  monthDelivered: number;
  target: number;
  left: number;
  extra: number;
  bonusPer: number;
  bonus: number;
  daysLeft: number;
  salary: { month: string; earned: number; received: number; pending: number; hasSalary: boolean };
  nextPrayer: { name: string; at: string };
}
interface Today { inHand: number; untouched: string[] }

const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const monName = (ym: string) => MON[Number(ym.slice(5, 7)) - 1] ?? ym;
const PRAYER: Record<string, string> = { fajr: "FAJR", dhuhr: "DHUHR", asr: "ASR", maghrib: "MAGHRIB", isha: "ISHA" };
const aed = (n: number) => `AED ${n.toLocaleString("en-US")}`;

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
function ambient(me: RaceMe, now: Date, st: RaceStats | null, today: Today | null): string[] {
  const out: string[] = [];
  // Next round number today: 28 → "2 more to hit 30".
  const nextTen = Math.ceil((me.delivered + 1) / 10) * 10;
  if (me.delivered > 0 && nextTen - me.delivered <= 3) out.push(`Just ${nextTen - me.delivered} more to hit ${nextTen} today! 🔥`);
  if (st) {
    out.push(`${monName(st.month)}: ${st.monthDelivered} delivered so far`);
    if (st.left > 0) {
      const perDay = Math.ceil(st.left / Math.max(1, st.daysLeft));
      out.push(`${st.left} more to hit the ${st.target} target · ~${perDay} a day`);
    } else {
      out.push(`Target ${st.target} done! +${st.extra} extra = ${aed(st.bonus)} bonus 💰`);
      out.push(`Every extra delivery = AED ${st.bonusPer} more`);
    }
    if (st.salary.hasSalary) {
      const m = monName(st.salary.month);
      out.push(st.salary.pending > 0 ? `${m} salary: ${aed(st.salary.received)} received · ${aed(st.salary.pending)} to come` : `${m} salary fully received ✅`);
    }
    const mins = Math.round((new Date(st.nextPrayer.at).getTime() - now.getTime()) / 60000);
    const pn = PRAYER[st.nextPrayer.name] ?? st.nextPrayer.name.toUpperCase();
    if (mins >= 0 && mins <= 25) out.push(`${pn} in ${mins} min — don't miss your namaz 🕌`);
    else if (mins > 25 && mins <= 90) out.push(`Next namaz: ${pn} in ${Math.floor(mins / 60) ? `${Math.floor(mins / 60)}h ` : ""}${mins % 60}m`);
  }
  if (today) {
    if (today.untouched.length) out.push(`Not started yet: ${today.untouched.slice(0, 3).join(", ")}${today.untouched.length > 3 ? ` +${today.untouched.length - 3}` : ""}`);
    if (today.inHand > 0) out.push(`${today.inHand} parcel${today.inHand === 1 ? "" : "s"} still in hand`);
  }
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
export default function DriverRace({ embedded = false }: { embedded?: boolean } = {}) {
  const L = embedded; // light card that sits on the back of the counters
  const [data, setData] = useState<RaceData | null>(null);
  const [width, setWidth] = useState(0);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [event, setEvent] = useState<{ text: string; tone: "good" | "bad" | "info" } | null>(null);
  const [tickN, setTickN] = useState(0);
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<RaceStats | null>(null);
  const [today, setToday] = useState<Today | null>(null);
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
      apiFetch<RaceStats>("/driver/race-stats").then(setStats).catch(() => {});
      apiFetch<{ orders: Order[] }>("/driver/orders")
        .then(({ orders }) => {
          // Areas with parcels in hand where nothing has been delivered yet today.
          const areaOf = (o: Order) => o.area || detectArea(o.booking?.address, o.emirate);
          const open = new Map<string, number>();
          const done = new Set<string>();
          for (const o of orders) {
            const a = areaOf(o);
            if (o.status === "PENDING" || o.status === "TRANSFER") open.set(a, (open.get(a) ?? 0) + 1);
            else if (o.status === "DELIVERED") done.add(a);
          }
          const untouched = [...open.entries()].filter(([a]) => !done.has(a) && a !== "OTHER AREA" && a !== "NO ADDRESS").sort((x, y) => y[1] - x[1]).map(([a]) => a);
          setToday({ inHand: [...open.values()].reduce((x, y) => x + y, 0), untouched });
        })
        .catch(() => {});
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

  // One row, race order. Tied drivers share one spot: the latest to reach that count sits
  // on top, the others peek out underneath as stacked circles. Separate spots never overlap.
  const PIN = 26;
  const ordered = [...data.drivers].sort((a, b) => a.rank - b.rank);
  const groups: RacePin[][] = [];
  for (const p of ordered) {
    const g = groups[groups.length - 1];
    if (g && g[0].pos === p.pos) g.push(p);
    else groups.push([p]);
  }
  const step = Math.min(PIN + 8, width / Math.max(1, groups.length - 1));
  const xs = groups.map((g) => g[0].pos * 0.94 * width);
  for (let k = 1; k < xs.length; k++) xs[k] = Math.min(xs[k], xs[k - 1] - step);
  if (xs.length) xs[xs.length - 1] = Math.max(xs[xs.length - 1], 8);
  for (let k = xs.length - 2; k >= 0; k--) xs[k] = Math.max(xs[k], xs[k + 1] + step);
  const placed = groups.flatMap((g, k) => {
    const x = Math.min(xs[k], width);
    // last in the group (latest to reach) is on top; the rest stack behind it
    return g.map((p, j) => ({ ...p, x, under: g.length - 1 - j, top: j === g.length - 1 }));
  });
  const noOneYet = !data.drivers.some((p) => p.pos > 0);
  const pool = noOneYet && data.yesterdayWinner
    ? [`Yesterday's winner: ${data.yesterdayWinner.name} 🏆`, "New race — first delivery takes the lead"]
    : data.me
      ? ambient(data.me, new Date(), stats, today)
      : [];
  const line = event?.text ?? pool[tickN % Math.max(1, pool.length)] ?? "";

  const pinStyle = (p: RacePin) =>
    L
      ? {
          background: p.me ? "var(--brass)" : "#E9E4D8",
          color: p.me ? "#FFFFFF" : "#14213D",
          boxShadow: flash.has(p.code) ? "0 0 0 4px #0B7A3E" : p.me ? "0 0 0 2px #F3D58E" : undefined,
        }
      : {
          background: colorOf(p.code),
          boxShadow: flash.has(p.code) ? "0 0 0 4px #4ADE80" : p.me ? "0 0 0 2px #F3D58E" : undefined,
        };
  const commentCls = L
    ? event?.tone === "good" ? "text-delivered" : event?.tone === "bad" ? "text-cancelled" : "text-navy"
    : event?.tone === "good" ? "text-[#4ADE80]" : event?.tone === "bad" ? "text-[#FF8A8A]" : "text-[#E9ECF5]";

  return (
    <div className={L ? "h-full" : "mb-3"}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open my month"
        className={`block w-full text-left active:scale-[0.99] ${L ? "h-full rounded-2xl bg-white p-3 text-navy shadow ring-1 ring-line" : "rounded-2xl bg-navy p-3 text-paper shadow-md"}`}
      >
        <div className="flex items-center gap-2 font-mono text-[9.5px] font-bold uppercase tracking-widest">
          {!L && (
            <>
              <span className="race-live h-1.5 w-1.5 rounded-full bg-[#FF5A5F]" />
              <span className="text-[#FF8A8A]">Live race</span>
              <span className="text-paper/50">· to 12 midnight</span>
            </>
          )}
          <span className="ml-auto flex items-center gap-2">
            {data.me && <span className={L ? "text-delivered" : "text-[#F3D58E]"}>{data.me.delivered} today</span>}
            <span className={`race-arrow flex text-[13px] leading-none ${L ? "text-brass" : "text-[#F3D58E]"}`} aria-label="Race direction">
              <i>›</i><i>›</i><i>›</i>
            </span>
          </span>
        </div>
        <div className={`race-road mt-2.5 flex h-[38px] items-center rounded-xl px-[17px] ${L ? "bg-paper" : "bg-black/25"}`}>
          <div ref={trackRef} className={`relative h-[3px] min-w-0 flex-1 rounded ${L ? "race-lane-light" : "race-lane"}`}>
            {width > 0 &&
              placed.map((p, i) => (
                <span
                  key={p.code}
                  className="absolute top-1/2"
                  style={{
                    left: p.x,
                    transition: "left 1.2s cubic-bezier(.3,.7,.3,1)",
                    zIndex: p.top ? 20 : 10 - p.under,
                    transform: `translate(calc(-50% - ${p.under * 4}px), calc(-50% + ${p.under * 2}px))`,
                  }}
                >
                  {p.top && !L && <span className="race-trail absolute right-[18px] top-1/2 h-[3px] w-[18px] -translate-y-1/2 rounded-full" style={{ background: `linear-gradient(90deg, transparent, ${colorOf(p.code)})` }} />}
                  <span
                    className={`race-bob relative grid h-[26px] w-[26px] place-items-center rounded-full border-2 ${L ? "border-white text-[11px] font-black" : "border-navy text-[10px] font-extrabold text-[#0A1226]"}`}
                    style={{ animationDelay: `${(i % 5) * 0.17}s`, ...pinStyle(p) }}
                  >
                    {p.top ? p.code : ""}
                  </span>
                </span>
              ))}
          </div>
        </div>
        <div key={line} className={`race-comment mt-2 truncate font-mono text-[10.5px] font-bold uppercase tracking-wide ${commentCls}`}>{line}</div>
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-3 sm:items-center" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-label="My month"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0A1226] p-4 text-[#E9ECF5] shadow-2xl"
            style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom, 0px))" }}
          >
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="font-display text-lg font-bold">My month</div>
                <div className="font-mono text-[10.5px] uppercase tracking-wide text-[#B7C0DA]">{stats ? `${monName(stats.month)} · ${stats.daysLeft} days left` : "Loading…"}</div>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-lg" aria-label="Close">×</button>
            </div>
            {stats ? (
              <div className="space-y-3">
                {/* Target */}
                <section className="rounded-xl bg-white/[0.05] p-3">
                  <div className="flex items-baseline justify-between">
                    <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-[#B7C0DA]">Target {stats.target}</span>
                    <span className="font-display text-2xl font-extrabold text-[#F3D58E]">{stats.monthDelivered}</span>
                  </div>
                  <Bar parts={[{ v: Math.min(stats.monthDelivered, stats.target), c: "#4ADE80" }, { v: stats.left, c: "rgba(255,255,255,.12)" }]} />
                  {stats.extra > 0 && <Bar parts={[{ v: stats.extra, c: "#F3D58E" }, { v: Math.max(0, stats.target / 5 - stats.extra), c: "rgba(255,255,255,.08)" }]} thin />}
                  <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                    <Tile label="Delivered" value={String(stats.monthDelivered)} />
                    {stats.left > 0 ? <Tile label="To target" value={String(stats.left)} tone="#FF8A8A" /> : <Tile label="Extra" value={`+${stats.extra}`} tone="#F3D58E" />}
                    {stats.left > 0 ? (
                      <Tile label="Per day" value={String(Math.ceil(stats.left / Math.max(1, stats.daysLeft)))} />
                    ) : (
                      <Tile label="Bonus" value={aed(stats.bonus)} tone="#4ADE80" />
                    )}
                  </div>
                  <div className="mt-1.5 text-center font-mono text-[10px] uppercase text-[#B7C0DA]">Every delivery after {stats.target} = AED {stats.bonusPer} bonus</div>
                </section>

                {/* Previous month salary */}
                {stats.salary.hasSalary && (
                  <section className="rounded-xl bg-white/[0.05] p-3">
                    <div className="flex items-baseline justify-between">
                      <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-[#B7C0DA]">{monName(stats.salary.month)} salary</span>
                      <span className="font-mono text-sm font-bold">{aed(stats.salary.earned)}</span>
                    </div>
                    <Bar parts={[{ v: stats.salary.received, c: "#4ADE80" }, { v: stats.salary.pending, c: "#FF8A8A" }]} />
                    <div className="mt-2 grid grid-cols-2 gap-2 text-center">
                      <Tile label="Received" value={aed(stats.salary.received)} tone="#4ADE80" />
                      <Tile label="To receive" value={aed(stats.salary.pending)} tone={stats.salary.pending ? "#FF8A8A" : undefined} />
                    </div>
                  </section>
                )}

                {/* Today */}
                {data.me && (
                  <section className="rounded-xl bg-white/[0.05] p-3">
                    <div className="flex items-baseline justify-between">
                      <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-[#B7C0DA]">Today</span>
                      <span className="font-mono text-[11px] font-bold text-[#F3D58E]">
                        {data.me.delivered} / next {Math.ceil((data.me.delivered + 1) / 10) * 10}
                      </span>
                    </div>
                    <Bar parts={[{ v: data.me.delivered % 10 || (data.me.delivered ? 10 : 0), c: "#60A5FA" }, { v: 10 - (data.me.delivered % 10 || (data.me.delivered ? 10 : 0)), c: "rgba(255,255,255,.12)" }]} />
                    {today && today.untouched.length > 0 && (
                      <div className="mt-2">
                        <div className="font-mono text-[10px] uppercase text-[#B7C0DA]">Not started yet</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {today.untouched.map((a) => (
                            <span key={a} className="rounded-md bg-[#FF8A8A]/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#FF8A8A]">{a}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </section>
                )}

                <div className="rounded-lg bg-[#1E3A2A] px-3 py-2 text-center font-mono text-[11px] font-bold uppercase tracking-wide text-[#4ADE80]">
                  🕌 Next namaz: {PRAYER[stats.nextPrayer.name] ?? stats.nextPrayer.name} ·{" "}
                  {new Date(stats.nextPrayer.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" })}
                </div>
              </div>
            ) : (
              <div className="py-8 text-center font-mono text-xs text-[#B7C0DA]">Loading…</div>
            )}
          </div>
        </div>,
        document.body
      )}
      <style>{`.race-comment{animation:raceIn .4s ease}@keyframes raceIn{from{opacity:0;transform:translateY(4px)}}
.race-lane{background:repeating-linear-gradient(90deg,rgba(255,255,255,.28) 0 10px,transparent 10px 20px);background-size:20px 3px;animation:raceRoad .6s linear infinite}
.race-lane-light{background:repeating-linear-gradient(90deg,rgba(20,33,61,.18) 0 10px,transparent 10px 20px);background-size:20px 3px;animation:raceRoad .6s linear infinite}
@keyframes raceRoad{to{background-position:-20px 0}}
.race-bob{animation:raceBob .5s ease-in-out infinite alternate}
@keyframes raceBob{to{transform:translateY(-1.5px)}}
.race-trail{animation:raceTrail .45s ease-in-out infinite alternate}
@keyframes raceTrail{from{opacity:.35;width:12px}to{opacity:.8;width:20px}}
.race-arrow i{font-style:normal;animation:raceArrow 1.1s infinite}.race-arrow i:nth-child(2){animation-delay:.18s}.race-arrow i:nth-child(3){animation-delay:.36s}
@keyframes raceArrow{0%,100%{opacity:.25}40%{opacity:1}}
.race-live{animation:raceLive 1.2s infinite}@keyframes raceLive{50%{opacity:.2}}
@media (prefers-reduced-motion:reduce){.race-comment,.race-lane,.race-lane-light,.race-bob,.race-trail,.race-live,.race-arrow i{animation:none}}`}</style>
    </div>
  );
}

/** Horizontal stacked bar. */
function Bar({ parts, thin }: { parts: { v: number; c: string }[]; thin?: boolean }) {
  const total = parts.reduce((a, p) => a + Math.max(0, p.v), 0) || 1;
  return (
    <div className={`mt-2 flex w-full overflow-hidden rounded-full bg-white/10 ${thin ? "h-1.5" : "h-3"}`}>
      {parts.map((p, i) => (
        <span key={i} style={{ width: `${(Math.max(0, p.v) / total) * 100}%`, background: p.c, transition: "width .8s ease" }} />
      ))}
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg bg-black/25 px-1.5 py-1.5">
      <div className="font-mono text-[9px] uppercase tracking-wide text-[#B7C0DA]">{label}</div>
      <div className="font-display text-[15px] font-extrabold" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
    </div>
  );
}
