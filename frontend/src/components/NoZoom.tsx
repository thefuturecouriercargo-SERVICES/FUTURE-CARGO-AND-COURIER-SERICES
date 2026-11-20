"use client";

import { useEffect } from "react";

/**
 * Stops pages zooming in/out by accident (two-finger pinch, iPhone gestures).
 * Works with `userScalable: false` in the viewport and `touch-action` in
 * globals.css, because iPhone Safari ignores the viewport setting on its own.
 */
export default function NoZoom() {
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault();
    const multiTouch = (e: TouchEvent) => {
      if (e.touches.length > 1) e.preventDefault();
    };
    document.addEventListener("gesturestart", stop, { passive: false } as AddEventListenerOptions);
    document.addEventListener("gesturechange", stop, { passive: false } as AddEventListenerOptions);
    document.addEventListener("gestureend", stop, { passive: false } as AddEventListenerOptions);
    document.addEventListener("touchmove", multiTouch, { passive: false });
    return () => {
      document.removeEventListener("gesturestart", stop);
      document.removeEventListener("gesturechange", stop);
      document.removeEventListener("gestureend", stop);
      document.removeEventListener("touchmove", multiTouch);
    };
  }, []);
  return null;
}
