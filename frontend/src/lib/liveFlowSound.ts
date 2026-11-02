"use client";

/**
 * Live Flow sound: "rising glide + crystal ring", timed to the panel animation —
 * a smooth rising note for each line segment the light travels, then a bright
 * double ring when the circle ripples twice. Generated in the browser (no audio
 * files). Pitch tells you what happened: Delivered bright, Transfer middle,
 * Cancelled low, New order ring only.
 */
export type FlowTone = "pending" | "transferred" | "delivered" | "cancelled";

const STEP = 0.45; // must match ZAP_STEP in LiveFlowPanel
const RIPPLE_GAP = 0.25; // must match the second ripple's delay in LiveFlowPanel
const PITCH: Record<FlowTone, number> = { pending: 1, transferred: 1.12, delivered: 1.33, cancelled: 0.75 };
const STORAGE_KEY = "fc.liveFlowSound";

let ctx: AudioContext | null = null;
let lastPlayed = 0;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

/** Browsers only allow sound after the person has touched the page once. */
export function unlockLiveFlowSound() {
  audio()?.resume().catch(() => undefined);
}

export function isLiveFlowSoundOn(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setLiveFlowSoundOn(on: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    /* sound still toggles for this visit */
  }
}

function tone(c: AudioContext, f: number, start: number, dur: number, vol: number, glideTo?: number, attack = 0.005) {
  const t = c.currentTime + start;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(f, t);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

/** Plays the sound for one Live Flow action. `segments` = how many lines the light travels. */
export function playLiveFlowSound(target: FlowTone, segments: number) {
  if (!isLiveFlowSoundOn()) return;
  const c = audio();
  if (!c || c.state !== "running") return; // not unlocked yet — stay silent rather than queue sounds
  const now = Date.now();
  if (now - lastPlayed < 1200) return; // a burst of changes = one sound
  lastPlayed = now;

  const p = PITCH[target];
  for (let i = 0; i < segments; i++) {
    const base = 392 * p * Math.pow(1.26, i);
    tone(c, base, i * STEP, STEP + 0.05, 0.12, base * 1.26, 0.04);
  }
  const land = segments * STEP;
  [0, RIPPLE_GAP].forEach((extra, j) => {
    const v = j ? 0.07 : 0.13;
    tone(c, 1047 * p, land + extra, 1.4, v);
    tone(c, 2093 * p, land + extra, 0.8, v * 0.45);
    tone(c, 3140 * p, land + extra, 0.4, v * 0.2);
  });
}
