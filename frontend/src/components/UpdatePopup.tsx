"use client";

import { useEffect, useState } from "react";

/**
 * Full-screen "update required" popup for the driver portal.
 * Shows from 16 Nov 2026, 8 PM Dubai time until the driver taps UPDATE NOW;
 * then a bar fills to 100% and the app reloads with the new version.
 */
const SHOW_FROM = Date.parse("2026-11-16T20:00:00+04:00");
const KEY = "fc-update-2026-11-16";

const GOLD = "#C9A24A";

const FEATURES = [
  "START / END KM TRACKING",
  "ADD EXPENSE WITH BILL PHOTO",
  "NEW HOME SCREEN",
  "FULL-SCREEN SCANNER",
];

function seen() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export default function UpdatePopup() {
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    const check = () => {
      if (!seen() && Date.now() >= SHOW_FROM) setOpen(true);
    };
    check();
    const t = setInterval(check, 15000);
    return () => clearInterval(t);
  }, []);

  const startUpdate = () => {
    if (progress !== null) return;
    try {
      localStorage.setItem(KEY, "1");
    } catch {}
    setProgress(0);
    const started = Date.now();
    const DURATION = 2600;
    const tick = setInterval(() => {
      const p = Math.min(100, Math.round(((Date.now() - started) / DURATION) * 100));
      setProgress(p);
      if (p >= 100) {
        clearInterval(tick);
        setTimeout(async () => {
          try {
            if ("caches" in window) {
              const keys = await caches.keys();
              await Promise.all(keys.map((k) => caches.delete(k)));
            }
          } catch {}
          window.location.reload();
        }, 450);
      }
    }, 40);
  };

  if (!open) return null;

  const updating = progress !== null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center px-7 text-center uppercase"
      style={{ background: "#0A0A0A", color: "#fff" }}
    >
      <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
        <path d="M7 11l5 5 5-5" />
        <path d="M12 4v12" />
      </svg>

      <div className="mt-5 text-[22px] font-bold tracking-wide">Update required</div>
      <div className="mt-2 text-[12px] tracking-wide" style={{ color: "#B4B2A9" }}>
        New features added · bugs cleared
      </div>

      <div className="mt-7 w-full max-w-[300px] text-left">
        {FEATURES.map((f, i) => (
          <div key={f} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className="h-3 w-3 shrink-0 rounded-full" style={{ border: `2px solid ${GOLD}` }} />
              {i < FEATURES.length - 1 && <div className="w-[2px] flex-1" style={{ background: GOLD, opacity: 0.5, minHeight: 22 }} />}
            </div>
            <div className="-mt-[3px] pb-4 text-[13px] tracking-wide">{f}</div>
          </div>
        ))}
        <div className="mt-1 flex items-center gap-2 text-[12px] tracking-wide" style={{ color: "#9FE1CB" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12l5 5L20 7" />
          </svg>
          All reported bugs fixed
        </div>
      </div>

      <div className="mt-9 w-full max-w-[300px]">
        {!updating ? (
          <button
            onClick={startUpdate}
            className="w-full rounded-xl py-3.5 text-[15px] font-bold tracking-wider"
            style={{ background: GOLD, color: "#0A0A0A" }}
          >
            Update now
          </button>
        ) : (
          <div>
            <div className="h-3 w-full overflow-hidden rounded-full" style={{ background: "#2C2C2A" }}>
              <div
                className="h-full rounded-full transition-[width] duration-100 ease-linear"
                style={{ width: `${progress}%`, background: GOLD }}
              />
            </div>
            <div className="mt-3 text-[13px] font-bold tracking-wider" style={{ color: GOLD }}>
              {progress! >= 100 ? "Updated · opening" : `Updating ${progress}%`}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
