"use client";

import { useEffect } from "react";
import { getSocket } from "@/lib/socket";

/** Subscribes to a Socket.IO event for the lifetime of the component and re-runs `handler` on each message. */
export function useSocketEvent(event: string, handler: (payload: unknown) => void) {
  useEffect(() => {
    const socket = getSocket();
    socket.on(event, handler);
    return () => {
      socket.off(event, handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event]);
}
