"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useSocketEvent } from "@/lib/useSocketEvent";
import { useLiveRefresh } from "@/lib/useLiveRefresh";

interface RacePin { code: string; name: string; rank: number; pos: number; me: boolean }
interface RaceData { me: { rank: number; delivered: number } | null; drivers: RacePin[]; yesterdayWinner: { name: string; code: string } | null }

const COLORS = ["#4FD1C5", "#F2836B", "#E2B453", "#A78BFA", "#60A5FA", "#F472B6", "#34D399", "#FB923C"];
function colorOf(code: string) {
  let h = 0;
  for (const c of code) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

/** One-line live race to 12 midnight. Shows places only — never other drivers' counts. */
export default function DriverRace() {
  const [data, setData] = useState<RaceData | null>(null);
  const [width, setWidth] = useState(0);
  const [flash, setFlash] = useState<Set<string>>(new Set());
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
    return () => clearInterval(i);
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

  // Leader sits at 90% of the line; pins that get close stack above / below.
  const sorted = [...data.drivers].sort((a, b) => a.pos - b.pos || b.rank - a.rank);
  let lastX = -99;
  let lvl = 0;
  const placed = sorted.map((p) => {
    const x = p.pos * 0.9 * width;
    lvl = x - lastX < 28 ? lvl + 1 : 0;
    lastX = x;
    return { ...p, x, y: lvl ? (lvl % 2 ? -16 : 16) : 0 };
  });
  const noOneYet = !data.drivers.some((p) => p.pos > 0);

  return (
    <div className="mb-5">
      <div className="flex h-[60px] items-center gap-3 rounded-2xl border border-[#24335F] bg-[#0E1A38] px-3.5 shadow-md">
        <span className="min-w-[34px] text-center font-display text-2xl font-extrabold text-[#F3D58E]">
          {data.me ? `P${data.me.rank}` : "—"}
        </span>
        <div ref={trackRef} className="relative mx-4 h-1 min-w-0 flex-1 rounded bg-white/15">
          {width > 0 &&
            placed.map((p) => (
              <span
                key={p.code}
                title={p.name}
                className="absolute top-1/2 grid h-[30px] w-[30px] place-items-center rounded-full border-2 border-[#0E1A38] text-[11px] font-extrabold text-[#0A1226]"
                style={{
                  left: p.x,
                  background: colorOf(p.code),
                  transform: `translate(-50%, calc(-50% + ${p.y}px))`,
                  transition: "left 1s cubic-bezier(.3,.7,.3,1), transform .5s",
                  zIndex: p.me ? 9 : 8 - p.rank,
                  boxShadow: flash.has(p.code) ? "0 0 0 5px #4ADE80" : p.me ? "0 0 0 2px #F3D58E" : undefined,
                }}
              >
                {p.code}
              </span>
            ))}
        </div>
        <span
          className="shrink-0 rounded px-[7px] py-[3px] font-display text-[15px] font-extrabold text-[#111]"
          style={{ background: "repeating-conic-gradient(#fff 0 25%,#ccc 0 50%) 0 0/8px 8px" }}
        >
          12
        </span>
      </div>
      <div className="mt-1.5 pl-1 text-[13px] text-ink-soft">
        {noOneYet && data.yesterdayWinner ? (
          <>Yesterday&apos;s winner: <b className="text-ink">{data.yesterdayWinner.name}</b></>
        ) : data.me ? (
          <>You · <b className="text-ink">{data.me.delivered}</b> delivered today</>
        ) : null}
      </div>
    </div>
  );
}
