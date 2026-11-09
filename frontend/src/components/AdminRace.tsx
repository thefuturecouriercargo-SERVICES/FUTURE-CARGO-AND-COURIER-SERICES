"use client";

import { useEffect, useRef, useState } from "react";

export interface AdminRaceRow {
  id: string;
  name: string;
  delivered: number;
  pending: number;
  cancelled: number;
  transferred: number;
  total: number;
}

interface Props {
  rows: AdminRaceRow[];
  /** true when the dashboard shows today (single day) — the race is running. */
  live: boolean;
}

type Tone = "good" | "bad" | "warn" | "info";
interface Insight { label: string; text: string; tone: Tone }

const CODES: Record<string, string> = { ANAS: "AN", MASOOD: "MS", NIYAS: "NS", NOUSHAD: "ND", SAVAD: "SV", FARIS: "FS" };
const COLORS = ["#4FD1C5", "#F2836B", "#E2B453", "#A78BFA", "#60A5FA", "#F472B6", "#34D399", "#FB923C"];
const FIXED: Record<string, string> = { AN: "#4FD1C5", MS: "#F2836B", NS: "#E2B453", ND: "#A78BFA", SV: "#60A5FA", FS: "#F472B6" };
const TONE: Record<Tone, string> = { good: "#4ADE80", bad: "#FF8A8A", warn: "#F5B544", info: "#E9ECF5" };

const first = (name: string) => name.trim().split(/\s+/)[0].toUpperCase();
function codeOf(name: string) {
  const f = first(name);
  return CODES[f] ?? (f.slice(0, 1) + f.slice(-1));
}
function colorOf(code: string) {
  if (FIXED[code]) return FIXED[code];
  let h = 0;
  for (const c of code) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}
const pctOf = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "S"}`;

/** Minutes left to 12 midnight, Dubai time. */
function minsToMidnight(now: Date) {
  const d = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Dubai" }));
  return 24 * 60 - (d.getHours() * 60 + d.getMinutes());
}
const hm = (m: number) => `${Math.floor(m / 60)}H ${m % 60}M`;

/** Everything worth telling the admin about the race right now. */
function analyse(sorted: (AdminRaceRow & { code: string; f: string })[], live: boolean, now: Date) {
  const insights: Insight[] = [];
  const ticker: { text: string; tone: Tone }[] = [];
  if (!sorted.length) return { insights, ticker };

  const team = sorted.reduce(
    (s, r) => ({ d: s.d + r.delivered, p: s.p + r.pending, c: s.c + r.cancelled, t: s.t + r.transferred, all: s.all + r.total }),
    { d: 0, p: 0, c: 0, t: 0, all: 0 }
  );
  const minsLeft = minsToMidnight(now);
  const [p1, p2] = sorted;

  // 1 · Lead
  if (p1.delivered === 0) {
    insights.push({ label: "Lead", text: live ? "NO DELIVERIES YET — RACE NOT STARTED" : "NO DELIVERIES ON THIS DAY", tone: "info" });
  } else if (p2 && p2.delivered === p1.delivered) {
    const tied = sorted.filter((r) => r.delivered === p1.delivered).map((r) => r.f);
    insights.push({ label: live ? "Lead" : "Winner", text: `${tied.join(" & ")} TIED AT ${p1.delivered}`, tone: "warn" });
  } else {
    const gap = p2 ? p1.delivered - p2.delivered : 0;
    insights.push({
      label: live ? "Lead" : "Winner",
      text: p2 ? `${p1.f} · ${p1.delivered} DELIVERED · +${gap} ON ${p2.f}` : `${p1.f} · ${p1.delivered} DELIVERED`,
      tone: "good",
    });
  }

  // 2 · Watch — the one thing that needs the admin's attention most
  const idle = sorted.filter((r) => r.delivered === 0 && r.pending > 0);
  const cancelHeavy = sorted.filter((r) => r.cancelled >= 3 && pctOf(r.cancelled, r.total) >= 15).sort((a, b) => pctOf(b.cancelled, b.total) - pctOf(a.cancelled, a.total));
  const mostPending = [...sorted].sort((a, b) => b.pending - a.pending)[0];
  if (live && idle.length) {
    const r = idle.sort((a, b) => b.pending - a.pending)[0];
    insights.push({ label: "Watch", text: `${r.f} — NO DELIVERY YET · ${r.pending} IN HAND${idle.length > 1 ? ` (+${idle.length - 1} MORE)` : ""}`, tone: "bad" });
  } else if (cancelHeavy.length) {
    const r = cancelHeavy[0];
    insights.push({ label: "Watch", text: `${r.f} — ${r.cancelled} CANCELLED (${pctOf(r.cancelled, r.total)}%) · CHECK REASONS`, tone: "bad" });
  } else if (mostPending && mostPending.pending > 0) {
    insights.push({ label: "Watch", text: `${mostPending.f} — MOST IN HAND · ${mostPending.pending} PENDING`, tone: "warn" });
  } else {
    insights.push({ label: "Watch", text: "NOTHING PENDING — ALL CLEAR", tone: "good" });
  }

  // 3 · Pace / team
  if (live && team.p > 0 && minsLeft > 0) {
    const perHr = Math.ceil(team.p / Math.max(1, minsLeft / 60));
    insights.push({ label: "Pace", text: `${team.p} PENDING · ~${perHr}/HR NEEDED TO CLEAR BY 12`, tone: perHr > sorted.length * 4 ? "warn" : "info" });
  } else {
    insights.push({ label: "Team", text: `${team.d} OF ${team.all} DELIVERED · ${pctOf(team.d, team.all)}% CLEAR`, tone: pctOf(team.d, team.all) >= 80 ? "good" : "info" });
  }

  // 4 · Best clear rate (needs a real load to count)
  const loaded = sorted.filter((r) => r.total >= 5);
  const best = [...loaded].sort((a, b) => pctOf(b.delivered, b.total) - pctOf(a.delivered, a.total))[0];
  if (best && best.delivered > 0) insights.push({ label: "Clear rate", text: `${best.f} BEST · ${pctOf(best.delivered, best.total)}% OF LOAD DONE`, tone: "good" });

  // ---- Rotating ticker: everything else that helps ----
  ticker.push({ text: `TEAM: ${team.d} DELIVERED OF ${team.all} · ${pctOf(team.d, team.all)}% CLEAR`, tone: "info" });
  if (live) ticker.push({ text: minsLeft <= 120 ? `FINAL STRETCH — ${hm(minsLeft)} TO 12 MIDNIGHT` : `${hm(minsLeft)} LEFT IN TODAY'S RACE`, tone: minsLeft <= 120 ? "warn" : "info" });

  // Close battles between neighbours
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1], b = sorted[i];
    const gap = a.delivered - b.delivered;
    if (b.delivered > 0 && gap > 0 && gap <= 2) ticker.push({ text: `TIGHT FOR P${i}: ${b.f} JUST ${gap} BEHIND ${a.f}`, tone: "warn" });
    else if (live && gap > 2 && b.pending >= gap) ticker.push({ text: `${b.f} NEEDS ${gap} TO CATCH ${a.f} · HAS ${b.pending} IN HAND`, tone: "info" });
  }

  for (const r of idle) if (live) ticker.push({ text: `${r.f} HAS NOT STARTED · ${plural(r.pending, "PARCEL")} WAITING — CALL TO CHECK`, tone: "bad" });
  for (const r of cancelHeavy) ticker.push({ text: `${r.f}: ${pctOf(r.cancelled, r.total)}% CANCELLED — REVIEW BEFORE RETURN`, tone: "bad" });
  for (const r of sorted.filter((x) => x.transferred > 0)) ticker.push({ text: `${r.f}: ${plural(r.transferred, "TRANSFER")} — CONFIRM HANDOVER`, tone: "warn" });

  if (mostPending && mostPending.pending >= 10) ticker.push({ text: `HEAVIEST LOAD: ${mostPending.f} · ${mostPending.pending} STILL PENDING`, tone: "warn" });
  const slow = [...loaded].sort((a, b) => pctOf(a.delivered, a.total) - pctOf(b.delivered, b.total))[0];
  if (slow && best && slow.id !== best.id && pctOf(slow.delivered, slow.total) < 50)
    ticker.push({ text: `LOWEST CLEAR RATE: ${slow.f} · ${pctOf(slow.delivered, slow.total)}% (${slow.delivered}/${slow.total})`, tone: "warn" });
  if (best && best.delivered > 0) ticker.push({ text: `${best.f} HAS CLEARED ${pctOf(best.delivered, best.total)}% OF THE LOAD — STRONG RUN`, tone: "good" });

  if (team.c === 0 && team.d > 0) ticker.push({ text: "ZERO CANCELS SO FAR — CLEAN DAY", tone: "good" });
  else if (team.c > 0) ticker.push({ text: `${plural(team.c, "CANCEL")} TODAY · ${pctOf(team.c, team.all)}% OF ALL CONSIGNMENTS`, tone: pctOf(team.c, team.all) >= 10 ? "bad" : "info" });

  const avg = Math.round(team.d / sorted.length);
  if (team.d > 0) ticker.push({ text: `AVERAGE ${avg} PER DRIVER · ${sorted.filter((r) => r.delivered > avg).map((r) => r.f).join(", ") || "—"} ABOVE AVERAGE`, tone: "info" });
  if (live && team.p === 0 && team.d > 0) ticker.push({ text: "ALL PARCELS CLEARED — GREAT WORK BY THE TEAM 🏁", tone: "good" });
  if (!live && p1.delivered > 0) ticker.push({ text: `FINAL RESULT · ${p1.f} WINS WITH ${p1.delivered}`, tone: "good" });

  return { insights, ticker };
}

/** Admin's live race: every driver on one track, with counts and running insights.
 * Uses the same rows as the Employee-wise table, so it updates with the dashboard. */
export default function AdminRace({ rows, live }: Props) {
  const [width, setWidth] = useState(0);
  const [tick, setTick] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const [event, setEvent] = useState<{ text: string; tone: Tone } | null>(null);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const trackRef = useRef<HTMLDivElement>(null);
  const prev = useRef<Map<string, { rank: number; delivered: number; cancelled: number }> | null>(null);
  const eventTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sorted = [...rows]
    .map((r) => ({ ...r, code: codeOf(r.name), f: first(r.name) }))
    .sort((a, b) => b.delivered - a.delivered || b.total - a.total || a.name.localeCompare(b.name));
  const sig = sorted.map((r) => `${r.id}:${r.delivered}:${r.cancelled}`).join("|");

  // Live events: overtakes, new deliveries, new cancels.
  useEffect(() => {
    const nowMap = new Map(sorted.map((r, i) => [r.id, { rank: i + 1, delivered: r.delivered, cancelled: r.cancelled }]));
    const was = prev.current;
    prev.current = nowMap;
    if (!was || !live) return;
    let ev: { text: string; tone: Tone } | null = null;
    const bumped = new Set<string>();
    for (const r of sorted) {
      const o = was.get(r.id);
      if (!o) continue;
      const n = nowMap.get(r.id)!;
      if (r.delivered > o.delivered) bumped.add(r.code);
      if (!ev && n.rank < o.rank) {
        const passed = sorted.filter((x) => x.id !== r.id && (was.get(x.id)?.rank ?? 99) < o.rank && nowMap.get(x.id)!.rank > n.rank).map((x) => x.f);
        ev = { tone: "good", text: n.rank === 1 ? `${r.f} TAKES THE LEAD${passed.length ? ` FROM ${passed.join(" & ")}` : ""} 👑` : `${r.f} OVERTOOK ${passed.join(" & ") || "A DRIVER"} → NOW P${n.rank}` };
      }
    }
    if (!ev) {
      const c = sorted.find((r) => r.cancelled > (was.get(r.id)?.cancelled ?? r.cancelled));
      if (c) ev = { tone: "bad", text: `NEW CANCEL · ${c.f} (${c.cancelled} TODAY)` };
    }
    if (!ev && bumped.size) {
      const r = sorted.find((x) => bumped.has(x.code))!;
      const add = r.delivered - (was.get(r.id)?.delivered ?? r.delivered);
      ev = { tone: "info", text: `+${add} ${r.f} · NOW ${r.delivered} DELIVERED (P${nowMap.get(r.id)!.rank})` };
    }
    if (bumped.size) {
      setFlash(bumped);
      setTimeout(() => setFlash(new Set()), 1200);
    }
    if (ev) {
      setEvent(ev);
      if (eventTimer.current) clearTimeout(eventTimer.current);
      eventTimer.current = setTimeout(() => setEvent(null), 12000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, live]);

  useEffect(() => {
    const t = setInterval(() => {
      setTick((n) => n + 1);
      setNow(new Date());
    }, 6000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [rows.length > 0]);

  if (!rows.length) return null;

  const { insights, ticker: extra } = analyse(sorted, live, now);
  // One comment box: the key insights first, then everything else, in rotation.
  const ticker = [...insights.map((i) => ({ text: `${i.label}: ${i.text}`, tone: i.tone })), ...extra];
  const line = event ?? ticker[tick % Math.max(1, ticker.length)];

  // Place pins: ties share one spot (stacked), separate spots never overlap.
  const PIN = 28;
  const lead = Math.max(1, sorted[0].delivered);
  const groups: (typeof sorted)[] = [];
  for (const r of sorted) {
    const g = groups[groups.length - 1];
    if (g && g[0].delivered === r.delivered) g.push(r);
    else groups.push([r]);
  }
  const step = Math.min(PIN + 10, width / Math.max(1, groups.length - 1));
  const xs = groups.map((g) => (g[0].delivered / lead) * 0.96 * width);
  for (let k = 1; k < xs.length; k++) xs[k] = Math.min(xs[k], xs[k - 1] - step);
  if (xs.length) xs[xs.length - 1] = Math.max(xs[xs.length - 1], 10);
  for (let k = xs.length - 2; k >= 0; k--) xs[k] = Math.max(xs[k], xs[k + 1] + step);

  return (
    <div className="arace mb-4 overflow-hidden rounded-xl border border-white/10 bg-[#0A1226] p-3 text-[#E9ECF5]">
      {/* Road: faint direction arrows, gold finish strip */}
      <div className="flex h-[72px] items-center gap-2.5 rounded-lg bg-black/25 pl-[30px] pr-3">
        <div ref={trackRef} className="relative h-4 min-w-0 flex-1">
          <div className="absolute inset-0 flex items-center justify-around font-mono text-[14px] text-white/[0.14]" aria-hidden>
            {Array.from({ length: 14 }, (_, i) => (
              <span key={i} className="arace-arrow" style={{ animationDelay: `${(i * 0.11).toFixed(2)}s` }}>›</span>
            ))}
          </div>
          {width > 0 &&
            groups.flatMap((g, k) => {
              const x = Math.min(xs[k], width);
              return g.map((r, j) => {
                const top = j === 0;
                const under = j;
                const leader = k === 0 && r.delivered > 0;
                const delay = `${((k * 0.37 + j * 0.2) % 1.6).toFixed(2)}s`;
                return (
                  <span
                    key={r.id}
                    className="absolute top-1/2"
                    style={{
                      left: x,
                      transition: "left 1.2s cubic-bezier(.3,.7,.3,1)",
                      zIndex: top ? 20 : 10 - under,
                      transform: `translate(calc(-50% - ${under * 4}px), calc(-14px + ${under * 2}px))`,
                    }}
                    title={`${r.name}: ${r.delivered} delivered · ${r.pending} pending`}
                  >
                    <span className="arace-push relative block" style={{ animationDelay: delay }}>
                      {top && (
                        <>
                          <span className="arace-puff" style={{ animationDelay: delay }} />
                          <span className="arace-puff" style={{ animationDelay: `calc(${delay} + .5s)` }} />
                        </>
                      )}
                      <span
                        className="arace-tilt relative grid place-items-center rounded-full border-2 border-[#0A1226] text-[10px] font-extrabold text-[#0A1226]"
                        style={{
                          width: PIN,
                          height: PIN,
                          background: colorOf(r.code),
                          boxShadow: flash.has(r.code) ? "0 0 0 4px #4ADE80" : leader ? "0 0 0 2px #F3D58E" : undefined,
                          animationDelay: delay,
                        }}
                      >
                        {top ? r.code : ""}
                      </span>
                      {top && (
                        <span className="absolute left-1/2 top-[calc(100%+3px)] -translate-x-1/2 whitespace-nowrap font-mono text-[10px] font-bold tabular-nums" style={{ color: leader ? "#F3D58E" : "rgba(233,236,245,.7)" }}>
                          {r.delivered}
                          {g.length > 1 ? ` ×${g.length}` : ""}
                        </span>
                      )}
                    </span>
                  </span>
                );
              });
            })}
        </div>
        <div className="h-10 w-1 shrink-0 rounded-sm bg-[#F3D58E]/80" aria-hidden />
      </div>

      {/* One comment box — side line colour follows the comment */}
      {line && (
        <div
          key={line.text}
          className="arace-comment mt-2.5 truncate border-l-[3px] px-3 py-2 font-mono text-[10.5px] font-bold uppercase tracking-wide"
          style={{ color: TONE[line.tone], borderColor: TONE[line.tone], background: `${TONE[line.tone]}10` }}
          title={line.text}
        >
          {line.text}
        </div>
      )}

      <style>{`.arace-comment{animation:araceIn .4s ease}@keyframes araceIn{from{opacity:0;transform:translateY(4px)}}
.arace-arrow{animation:araceArrow 1.4s linear infinite}@keyframes araceArrow{0%,100%{color:rgba(255,255,255,.08)}50%{color:rgba(255,255,255,.3)}}
.arace-push{animation:aracePush 1.6s ease-in-out infinite}
@keyframes aracePush{0%,100%{transform:translateX(0)}35%{transform:translateX(7px)}60%{transform:translateX(5px)}}
.arace-tilt{animation:araceTilt .5s ease-in-out infinite alternate}
@keyframes araceTilt{from{transform:rotate(-8deg)}to{transform:rotate(4deg) translateY(-2px)}}
.arace-puff{position:absolute;right:22px;top:10px;width:7px;height:7px;border-radius:50%;background:rgba(233,236,245,.5);animation:aracePuff 1s ease-out infinite}
@keyframes aracePuff{from{transform:translateX(0) scale(.6);opacity:.7}to{transform:translateX(-24px) translateY(-4px) scale(1.6);opacity:0}}
@media (prefers-reduced-motion:reduce){.arace-comment,.arace-arrow,.arace-push,.arace-tilt,.arace-puff{animation:none}}`}</style>
    </div>
  );
}
