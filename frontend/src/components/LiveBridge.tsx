"use client";

import { useEffect } from "react";
import { getSocket } from "@/lib/socket";
import { triggerRefresh } from "@/lib/useLiveRefresh";

/**
 * Turns server-side changes into a quiet on-screen data refresh, on every page
 * that uses useLiveRefresh. Mounted only inside logged-in areas (admin,
 * driver, vendor portal). Bursts of changes (e.g. a 50-order scan) are
 * grouped into one refresh.
 */
export default function LiveBridge() {
  useEffect(() => {
    const socket = getSocket();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wasDisconnected = false;

    const onAny = () => {
      clearTimeout(timer);
      timer = setTimeout(() => triggerRefresh("socket"), 1200);
    };
    const onDisconnect = () => {
      wasDisconnected = true;
    };
    const onConnect = () => {
      if (wasDisconnected) {
        wasDisconnected = false;
        triggerRefresh("reconnect");
      }
    };

    socket.onAny(onAny);
    socket.on("disconnect", onDisconnect);
    socket.on("connect", onConnect);
    return () => {
      clearTimeout(timer);
      socket.offAny(onAny);
      socket.off("disconnect", onDisconnect);
      socket.off("connect", onConnect);
    };
  }, []);
  return null;
}
