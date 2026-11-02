"use client";

import { useEffect } from "react";

// Registers /sw.js so the app can be installed / packaged as an Android APK.
// Does nothing if the browser doesn't support it, so it can never break the app.
export default function RegisterSW() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
