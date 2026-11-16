"use client";

import { useEffect, useState } from "react";

/**
 * Full-screen "UPDATE REQUIRED" popup for the driver and admin portals.
 * Opens automatically whenever a new version is deployed: the page's own build
 * ID is compared with the server's (/app-version) every minute and when the
 * app comes back to the screen. UPDATE NOW fills a bar to 100% and reloads.
 * The feature lines come from src/lib/releaseNotes.ts (served by the new build).
 */
const MY_BUILD = process.env.NEXT_PUBLIC_BUILD_ID || "";
const GOLD = "#C9A24A";

export default function UpdatePopup({ portal }: { portal: "driver" | "admin" }) {
  const [open, setOpen] = useState(false);
  const [features, setFeatures] = useState<string[]>([]);
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    if (!MY_BUILD) return;
    let stop = false;
    const check = async () => {
      try {
        const r = await fetch(`/app-version?t=${Date.now()}`, { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json();
        if (stop || !j?.build || j.build === MY_BUILD) return;
        setFeatures(Array.isArray(j.notes?.[portal]) ? j.notes[portal] : []);
        setOpen(true);
      } catch {}
    };
    check();
    const t = setInterval(check, 60000);
    const onVis = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [portal]);

  const startUpdate = () => {
    if (progress !== null) return;
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
        {features.map((f, i) => (
          <div key={f} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className="h-3 w-3 shrink-0 rounded-full" style={{ border: `2px solid ${GOLD}` }} />
              {i < features.length - 1 && <div className="w-[2px] flex-1" style={{ background: GOLD, opacity: 0.5, minHeight: 22 }} />}
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
