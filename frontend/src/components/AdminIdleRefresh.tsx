"use client";

import { useEffect } from "react";

const IDLE_MS = 5 * 60_000; // reload after 5 minutes without any touch, click, key or scroll

/**
 * Admin only: when the page is open on screen but nobody has used it for 5 minutes,
 * reload it so the figures (and any new app version) are fresh when someone looks again.
 * Never reloads while something is being typed, a popup/dialog is open, or the page is hidden.
 */
export default function AdminIdleRefresh() {
  useEffect(() => {
    let last = Date.now();
    const touch = () => {
      last = Date.now();
    };
    const events = ["pointerdown", "keydown", "wheel", "touchstart", "scroll", "mousemove"] as const;
    for (const e of events) window.addEventListener(e, touch, { passive: true, capture: true });
    // Coming back to the tab counts as use, so it never reloads the moment you return.
    const onVis = () => {
      if (document.visibilityState === "visible") touch();
    };
    document.addEventListener("visibilitychange", onVis);

    const busy = () => {
      const a = document.activeElement as HTMLElement | null;
      if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT" || a.isContentEditable)) return true;
      if (document.querySelector('[role="dialog"], [aria-modal="true"]')) return true;
      // Anything typed into a text box that hasn't been saved yet.
      for (const el of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        'textarea, input:not([type]), input[type="text"], input[type="number"], input[type="tel"], input[type="email"]',
      )) {
        if (el.value && el.value !== el.defaultValue) return true;
      }
      return false;
    };

    const i = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - last < IDLE_MS) return;
      if (busy()) {
        touch();
        return;
      }
      window.location.reload();
    }, 30_000);

    return () => {
      clearInterval(i);
      for (const e of events) window.removeEventListener(e, touch, { capture: true });
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return null;
}
