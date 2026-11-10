"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";

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
const TONE: Record<Tone, string> = { good: "#4ADE80", bad: "#FF8A8A", warn: "#F5B544", info: "#E9ECF5" };

const first = (name: string) => name.trim().split(/\s+/)[0].toUpperCase();
function codeOf(name: string) {
  const f = first(name);
  return CODES[f] ?? (f.slice(0, 1) + f.slice(-1));
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

/** Rotating comment box for admin, under the Employee-wise heading: live overtakes,
 * new deliveries and cancels, plus insights (lead, watch, pace, clear rate and more).
 * Uses the same rows as the Employee-wise table, so it updates with the dashboard. */
export default function AdminRace({ rows, live }: Props) {
  const [tick, setTick] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const [event, setEvent] = useState<{ text: string; tone: Tone } | null>(null);
  const prev = useRef<Map<string, { rank: number; delivered: number; cancelled: number }> | null>(null);
  const eventTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Business-wide comments (milestones, history, P&L, vendors, agent uploads…) from the server.
  const [feed, setFeed] = useState<{ text: string; tone: Tone }[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      apiFetch<{ lines: { text: string; tone: Tone }[] }>("/insights-feed")
        .then((r) => alive && setFeed(r.lines ?? []))
        .catch(() => {});
    load();
    const t = setInterval(load, 5 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

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
    const bumped: string[] = [];
    for (const r of sorted) {
      const o = was.get(r.id);
      if (!o) continue;
      const n = nowMap.get(r.id)!;
      if (r.delivered > o.delivered) bumped.push(r.id);
      if (!ev && n.rank < o.rank) {
        const passed = sorted.filter((x) => x.id !== r.id && (was.get(x.id)?.rank ?? 99) < o.rank && nowMap.get(x.id)!.rank > n.rank).map((x) => x.f);
        ev = { tone: "good", text: n.rank === 1 ? `${r.f} TAKES THE LEAD${passed.length ? ` FROM ${passed.join(" & ")}` : ""} 👑` : `${r.f} OVERTOOK ${passed.join(" & ") || "A DRIVER"} → NOW P${n.rank}` };
      }
    }
    if (!ev) {
      const c = sorted.find((r) => r.cancelled > (was.get(r.id)?.cancelled ?? r.cancelled));
      if (c) ev = { tone: "bad", text: `NEW CANCEL · ${c.f} (${c.cancelled} TODAY)` };
    }
    if (!ev && bumped.length) {
      const r = sorted.find((x) => x.id === bumped[0])!;
      const add = r.delivered - (was.get(r.id)?.delivered ?? r.delivered);
      ev = { tone: "info", text: `+${add} ${r.f} · NOW ${r.delivered} DELIVERED (P${nowMap.get(r.id)!.rank})` };
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

  if (!rows.length) return null;

  const { insights, ticker: extra } = analyse(sorted, live, now);
  // The key insights first, then everything else, in rotation.
  const race = [...insights.map((i) => ({ text: `${i.label}: ${i.text}`, tone: i.tone })), ...extra];
  // Mix: after every 2 race lines, one business comment, so both keep rotating.
  const ticker: { text: string; tone: Tone }[] = [];
  const n = Math.max(race.length, feed.length * 2);
  for (let i = 0, f = 0; i < n || f < feed.length; i++) {
    if (race.length) ticker.push(race[i % race.length]);
    if (i % 2 === 1 && f < feed.length) ticker.push(feed[f++]);
    if (i > race.length + feed.length * 3) break;
  }
  const line = event ?? ticker[tick % Math.max(1, ticker.length)];
  if (!line) return null;

  return (
    <div className="mb-3">
      <div
        key={line.text}
        className="arace-comment line-clamp-2 border-l-[3px] px-3 py-2 font-mono text-[10.5px] font-bold uppercase tracking-wide"
        style={{ color: TONE[line.tone], borderColor: TONE[line.tone], background: `${TONE[line.tone]}14` }}
        title={line.text}
      >
        {line.text}
      </div>
      <style>{`.arace-comment{animation:araceIn .4s ease}@keyframes araceIn{from{opacity:0;transform:translateY(4px)}}
@media (prefers-reduced-motion:reduce){.arace-comment{animation:none}}`}</style>
    </div>
  );
}
