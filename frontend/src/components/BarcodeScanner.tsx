"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { IScannerControls } from "@zxing/browser";

export function beep(ok = true) {
  try {
    navigator.vibrate?.(ok ? 60 : [80, 60, 80]);
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    o.frequency.value = ok ? 1200 : 300;
    o.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + (ok ? 0.08 : 0.25));
  } catch {
    /* no sound — fine */
  }
}

/**
 * Two ways to scan, both calling onCode with the barcode text:
 *  - a text box that a USB barcode scanner types into (it presses Enter after each code)
 *  - the phone/laptop camera, reading continuously
 * The same code is ignored for 3 seconds so one parcel isn't counted twice.
 */
export default function BarcodeScanner({
  onCode,
  disabled,
  autoCamera,
  placeholder = "Scan barcode or type CN, then Enter",
}: {
  onCode: (code: string) => Promise<void> | void;
  disabled?: boolean;
  autoCamera?: boolean;
  placeholder?: string;
}) {
  const [typed, setTyped] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const [error, setError] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastRef = useRef<{ text: string; t: number }>({ text: "", t: 0 });
  const busyRef = useRef(false);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled]);

  useEffect(() => {
    if (autoCamera) startCamera();
    return () => controlsRef.current?.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handle(text: string) {
    const code = text.trim();
    if (!code || busyRef.current) return;
    const now = Date.now();
    if (code === lastRef.current.text && now - lastRef.current.t < 3000) return;
    lastRef.current = { text: code, t: now };
    busyRef.current = true;
    try {
      await onCodeRef.current(code);
    } finally {
      busyRef.current = false;
      inputRef.current?.focus();
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const t = typed;
    setTyped("");
    // Typed/USB entries: allow re-entering the same code on purpose.
    lastRef.current = { text: "", t: 0 };
    await handle(t);
  }

  async function startCamera() {
    setError("");
    try {
      const [{ BrowserMultiFormatReader }, { DecodeHintType }] = await Promise.all([import("@zxing/browser"), import("@zxing/library")]);
      const hints = new Map();
      hints.set(DecodeHintType.TRY_HARDER, true);
      const reader = new BrowserMultiFormatReader(hints);
      if (!videoRef.current) return;
      setCameraOn(true);
      controlsRef.current = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } },
        videoRef.current,
        (result) => {
          if (result) handle(result.getText());
        }
      );
    } catch (err) {
      setCameraOn(false);
      const msg = err instanceof Error ? err.message : String(err);
      setError(
        /permission|denied|notallowed/i.test(msg)
          ? "Camera permission was blocked — allow camera access for this site in the browser settings."
          : `Couldn't start the camera: ${msg}`
      );
    }
  }

  function stopCamera() {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setCameraOn(false);
  }

  return (
    <div>
      <div className="flex gap-2">
        <form onSubmit={onSubmit} className="flex-1">
          <input
            ref={inputRef}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            disabled={disabled}
            inputMode="numeric"
            autoComplete="off"
            placeholder={placeholder}
            className="w-full rounded border-2 border-brass px-3 py-3 font-mono text-base disabled:bg-paper-2"
          />
        </form>
        {!cameraOn ? (
          <button
            type="button"
            onClick={startCamera}
            disabled={disabled}
            className="shrink-0 rounded bg-navy px-4 font-mono text-xs uppercase tracking-wide text-paper disabled:opacity-40"
          >
            📷 Camera
          </button>
        ) : (
          <button type="button" onClick={stopCamera} className="shrink-0 rounded bg-cancelled px-4 font-mono text-xs uppercase tracking-wide text-white">
            ■ Stop
          </button>
        )}
      </div>
      <div className={`mt-3 overflow-hidden border border-line bg-black ${cameraOn ? "" : "hidden"}`}>
        <video ref={videoRef} className="block max-h-[45vh] w-full object-cover" muted playsInline />
        <p className="bg-white px-3 py-1.5 text-xs text-ink-soft">Point at the barcode — it beeps when read. Keep scanning the next parcel.</p>
      </div>
      {error && <p className="mt-2 text-sm text-cancelled">{error}</p>}
    </div>
  );
}
