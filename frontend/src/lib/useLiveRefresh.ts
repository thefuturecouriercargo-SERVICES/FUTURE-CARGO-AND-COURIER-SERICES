"use client";

import { useEffect, useRef } from "react";

/**
 * App-wide "please reload your data" signal.
 *  - "socket":    something changed on the server (live update)
 *  - "resume":    the app came back to the screen after being in the background
 *  - "reconnect": the live connection dropped and came back (updates may have been missed)
 */
export type RefreshSource = "socket" | "resume" | "reconnect";
export const REFRESH_EVENT = "fc:refresh";

export function triggerRefresh(source: RefreshSource) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(REFRESH_EVENT, { detail: { source } }));
}

/**
 * Re-runs `load` silently (no page reload) whenever the app signals fresh data.
 * Pages that already listen to their own socket events pass { socket: false }
 * so they only refresh on resume/reconnect and don't fetch twice.
 */
export function useLiveRefresh(load: () => unknown, opts: { socket?: boolean } = {}) {
  const loadRef = useRef(load);
  loadRef.current = load;
  const wantSocket = opts.socket !== false;

  useEffect(() => {
    const handler = (e: Event) => {
      const source = (e as CustomEvent<{ source: RefreshSource }>).detail?.source;
      if (source === "socket" && !wantSocket) return;
      try {
        void loadRef.current();
      } catch {
        /* a failed background refresh must never break the page */
      }
    };
    window.addEventListener(REFRESH_EVENT, handler);
    return () => window.removeEventListener(REFRESH_EVENT, handler);
  }, [wantSocket]);
}
