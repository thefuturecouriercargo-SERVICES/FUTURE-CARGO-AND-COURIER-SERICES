"use client";

import { useEffect, useState } from "react";
import { triggerRefresh } from "@/lib/useLiveRefresh";

const PULL_TRIGGER = 85; // px of finger travel needed to refresh
const SOFT_AFTER_MS = 5_000; // back after 5s+ → quietly re-fetch the data (no page reload)

/**
 * 1. Tap the gold-circled R in "FUTURE COURIER" to refresh (no pull-down refresh).
 * 2. Coming back to the app (other tab / other app / screen back on) quietly
 *    re-fetches each page's data in place. The page itself is NEVER reloaded,
 *    so turning the screen off and on doesn't flash or reset anything, and the
 *    live connection (race, live updates) keeps running.
 */
export default function AppRefresh() {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // Auto-refresh the data (not the page) when returning to the app.
  useEffect(() => {
    let hiddenAt = 0;
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      if (!hiddenAt) return;
      const away = Date.now() - hiddenAt;
      hiddenAt = 0;
      if (away >= SOFT_AFTER_MS) triggerRefresh("resume");
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Manual refresh: tap the gold-circled R in "FUTURE COURIER" (pull-down
  // refresh is switched off so scrolling never reloads by accident).
  useEffect(() => {
    const onRefresh = () => {
      setRefreshing(true);
      setPull(70);
      setTimeout(() => location.reload(), 150);
    };
    window.addEventListener("fc-refresh-now", onRefresh);
    return () => window.removeEventListener("fc-refresh-now", onRefresh);
  }, []);

  if (pull <= 0 && !refreshing) return null;
  const ready = pull >= PULL_TRIGGER * 0.55 || refreshing;
  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        top: 0,
        left: "50%",
        zIndex: 9999,
        transform: `translate(-50%, ${Math.max(pull - 44, -44) + 12}px)`,
        transition: active(pull) ? "none" : "transform .2s ease",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 999,
          background: "#0f172a",
          border: "2px solid #d4af37",
          boxShadow: "0 4px 14px rgba(0,0,0,.3)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#d4af37"
          strokeWidth="2.5"
          strokeLinecap="round"
          style={{
            transform: `rotate(${refreshing ? 0 : pull * 3}deg)`,
            animation: refreshing ? "fcspin .8s linear infinite" : undefined,
            opacity: ready ? 1 : 0.6,
          }}
        >
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <path d="M21 3v6h-6" />
        </svg>
      </div>
      <style>{`@keyframes fcspin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function active(pull: number) {
  return pull > 0 && pull < 110;
}
