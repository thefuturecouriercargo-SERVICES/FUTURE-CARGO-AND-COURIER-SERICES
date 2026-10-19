"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };

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

/** Phones/tablets: don't focus the CN box by itself — that pops the keyboard over the camera. */
export function isTouchDevice() {
  try {
    return window.matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
  } catch {
    return false;
  }
}

/**
 * Same-number clash (our CN = a vendor's bill No.): ask which parcel it is.
 * Returns the vendorId to scan again with ("OWN" = our CN), or null to skip.
 */
export function pickClashChoice(err: unknown): string | null | undefined {
  const d = (err as { details?: { code?: string; choices?: { vendorId: string; label: string }[] } } | null)?.details;
  if (d?.code !== "CHOOSE_VENDOR" || !d.choices?.length) return undefined;
  const list = d.choices.map((c, i) => `${i + 1}. ${c.label}`).join("\n");
  const ans = window.prompt(`${(err as Error).message}\n\n${list}\n\nType the number:`, "1");
  const n = Number(ans);
  return Number.isInteger(n) && n >= 1 && n <= d.choices.length ? d.choices[n - 1].vendorId : null;
}

export type ScanResult = { text: string; tone: "ok" | "warn" | "bad"; id: number };

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
  lastResult,
}: {
  onCode: (code: string) => Promise<void> | void;
  disabled?: boolean;
  autoCamera?: boolean;
  placeholder?: string;
  /** Latest scan's result — flashes just above the camera so it's seen while scanning. */
  lastResult?: ScanResult | null;
}) {
  const [typed, setTyped] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const [error, setError] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [torch, setTorch] = useState<boolean | null>(null); // null = not supported
  const inputRef = useRef<HTMLInputElement>(null);
  const lastRef = useRef<{ text: string; t: number }>({ text: "", t: 0 });
  const busyRef = useRef(false);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  // USB scanner on a computer types into the box, so keep it focused there — but not on
  // phones, where focusing would pop the keyboard up while the camera is scanning.
  useEffect(() => {
    if (!disabled && !isTouchDevice()) inputRef.current?.focus();
  }, [disabled]);

  useEffect(() => {
    if (autoCamera) startCamera();
    return () => stopCamera();
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
      if (!isTouchDevice()) inputRef.current?.focus();
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

  /**
   * Camera scanning: only the part inside the on-screen rectangle is read, at the
   * camera's full resolution, so thin barcodes on small labels still decode. Uses
   * the phone's built-in barcode reader when it has one (fast, accurate), with
   * ZXing as the fallback. Reads our labels' QR code and Code-128 barcode.
   */
  async function startCamera() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      // Continuous autofocus where the phone allows it.
      try {
        const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { focusMode?: string[]; torch?: boolean };
        if (caps.focusMode?.includes("continuous")) await track.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] });
        setTorch(caps.torch ? false : null);
      } catch {
        /* optional */
      }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      setCameraOn(true);

      // Pick a decoder.
      let detector: Detector | null = null;
      const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector & { getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector;
      if (BD) {
        try {
          const wanted = ["qr_code", "code_128", "ean_13", "code_39", "ean_8", "upc_a"];
          const supported = (await (BD as unknown as { getSupportedFormats?: () => Promise<string[]> }).getSupportedFormats?.()) ?? wanted;
          const formats = wanted.filter((f) => supported.includes(f));
          if (formats.length) detector = new BD({ formats });
        } catch {
          detector = null;
        }
      }
      let zxingDecode: ((c: HTMLCanvasElement) => string | null) | null = null;
      if (!detector) {
        const [{ BrowserMultiFormatReader }, { DecodeHintType, BarcodeFormat }] = await Promise.all([import("@zxing/browser"), import("@zxing/library")]);
        const hints = new Map();
        hints.set(DecodeHintType.TRY_HARDER, true);
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE, BarcodeFormat.CODE_128, BarcodeFormat.EAN_13, BarcodeFormat.CODE_39]);
        const reader = new BrowserMultiFormatReader(hints);
        zxingDecode = (c) => {
          try {
            return reader.decodeFromCanvas(c).getText();
          } catch {
            return null;
          }
        };
      }

      const canvas = canvasRef.current ?? document.createElement("canvas");
      canvasRef.current = canvas;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      let busy = false;
      const tick = async () => {
        loopRef.current = window.setTimeout(tick, 120);
        if (busy || !video.videoWidth) return;
        busy = true;
        try {
          // Crop to the guide rectangle: 86% of the width, 40% of the height, centred.
          const vw = video.videoWidth;
          const vh = video.videoHeight;
          const cw = Math.round(vw * 0.86);
          const ch = Math.round(vh * 0.4);
          canvas.width = cw;
          canvas.height = ch;
          ctx.drawImage(video, (vw - cw) / 2, (vh - ch) / 2, cw, ch, 0, 0, cw, ch);
          let text: string | null = null;
          if (detector) {
            const found = await detector.detect(canvas);
            text = found[0]?.rawValue ?? null;
          } else if (zxingDecode) {
            text = zxingDecode(canvas);
          }
          if (text) handle(text);
        } catch {
          /* keep scanning */
        } finally {
          busy = false;
        }
      };
      tick();
    } catch (err) {
      stopCamera();
      const msg = err instanceof Error ? err.message : String(err);
      setError(
        /permission|denied|notallowed/i.test(msg)
          ? "Camera permission was blocked — allow camera access for this site in the browser settings."
          : `Couldn't start the camera: ${msg}`
      );
    }
  }

  function stopCamera() {
    if (loopRef.current) window.clearTimeout(loopRef.current);
    loopRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
    setTorch(null);
  }

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || torch === null) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
      setTorch(!torch);
    } catch {
      setTorch(null);
    }
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
      {lastResult && (
        <div
          key={lastResult.id}
          role="status"
          className={`scan-flash mt-3 rounded border-2 px-3 py-2.5 text-center text-base font-bold ${
            lastResult.tone === "ok"
              ? "border-delivered bg-delivered-bg text-delivered"
              : lastResult.tone === "warn"
                ? "border-brass bg-paper-2 text-navy"
                : "border-cancelled bg-cancelled-bg text-cancelled"
          }`}
        >
          {lastResult.tone === "ok" ? "✓ " : lastResult.tone === "warn" ? "• " : "✕ "}
          {lastResult.text}
          <style>{`@keyframes scanflash{0%,40%,80%{opacity:1;transform:scale(1.02)}20%,60%{opacity:.25;transform:scale(1)}100%{opacity:1;transform:scale(1)}} .scan-flash{animation:scanflash 1.2s ease-in-out 1}`}</style>
        </div>
      )}
      <div className={`mt-3 overflow-hidden border border-line bg-black ${cameraOn ? "" : "hidden"}`}>
        <div className="relative">
          {/* No object-cover: the picture isn't cropped, so the guide box matches what is read. */}
          <video ref={videoRef} className="block max-h-[50vh] w-full bg-black object-contain" muted playsInline />
          {/* Guide rectangle = the area that is decoded */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative" style={{ width: "86%", height: "40%", boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)", border: "3px solid #fff", borderRadius: 6 }}>
              <div className="scan-line absolute left-2 right-2 h-0.5 bg-red-500" style={{ top: "50%", boxShadow: "0 0 6px 1px rgba(239,68,68,.9)" }} />
            </div>
          </div>
          {torch !== null && (
            <button type="button" onClick={toggleTorch} className="absolute bottom-2 right-2 rounded-full bg-white/90 px-3 py-1.5 text-sm font-bold text-navy shadow">
              {torch ? "🔦 Light off" : "🔦 Light"}
            </button>
          )}
        </div>
        <p className="bg-white px-3 py-1.5 text-xs text-ink-soft">
          Hold the label flat, fill the box with the QR code or barcode, about 10–15 cm away. It beeps when read.
        </p>
        <style>{`@keyframes scanmove{0%{top:12%}50%{top:88%}100%{top:12%}} .scan-line{animation:scanmove 1.8s ease-in-out infinite}`}</style>
      </div>
      {error && <p className="mt-2 text-sm text-cancelled">{error}</p>}
    </div>
  );
}
