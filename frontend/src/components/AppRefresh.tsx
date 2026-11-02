"use client";

import { useEffect, useRef, useState } from "react";
import { triggerRefresh } from "@/lib/useLiveRefresh";

const PULL_TRIGGER = 85; // px of finger travel needed to refresh
const SOFT_AFTER_MS = 15_000; // back from background after 15s → quietly reload data
const HARD_AFTER_MS = 60_000; // after 1 min → reload the whole page (only if nothing is being typed)

/**
 * 1. Pull down from the top to refresh (installed app only — normal Chrome
 *    already has its own pull-to-refresh, so we don't double it there).
 * 2. Coming back to the app after switching away refreshes it automatically.
 *    If the person was typing something, the page is NOT reloaded (no lost
 *    work) — data is refreshed quietly instead.
 */
export default function AppRefresh() {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const typed = useRef(false);

  // Remember if anything has been typed on this page (so we never wipe a half-filled form).
  useEffect(() => {
    const mark = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
        const type = (t as HTMLInputElement).type;
        if (type !== "checkbox" && type !== "radio") typed.current = true;
      }
    };
    document.addEventListener("input", mark, true);
    return () => document.removeEventListener("input", mark, true);
  }, []);

  // Auto-refresh when returning to the app.
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
      const onAuthPage = /^\/(login|vendor-login)(\/|$)/.test(location.pathname);
      if (away >= HARD_AFTER_MS && !typed.current && !onAuthPage && !document.querySelector("video")) {
        location.reload();
      } else if (away >= SOFT_AFTER_MS) {
        triggerRefresh("resume");
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Pull-to-refresh (installed app only).
  useEffect(() => {
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (!standalone) return;

    let startY = 0;
    let active = false;
    let dist = 0;

    const scrolledInside = (el: EventTarget | null) => {
      let n = el as HTMLElement | null;
      while (n && n !== document.body) {
        if (n.scrollTop > 0) return true;
        const pos = getComputedStyle(n).position;
        if (pos === "fixed" && n.getAttribute("role") === "dialog") return true;
        n = n.parentElement;
      }
      return false;
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || window.scrollY > 0 || scrolledInside(e.target)) return;
      startY = e.touches[0].clientY;
      active = true;
      dist = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (!active) return;
      dist = e.touches[0].clientY - startY;
      if (dist <= 0 || window.scrollY > 0) {
        setPull(0);
        return;
      }
      setPull(Math.min(dist * 0.55, 110));
    };
    const onEnd = () => {
      if (!active) return;
      active = false;
      if (dist >= PULL_TRIGGER) {
        setRefreshing(true);
        setPull(70);
        setTimeout(() => location.reload(), 150);
      } else {
        setPull(0);
      }
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: true });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onEnd);
    document.documentElement.style.overscrollBehaviorY = "contain";
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
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
