"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * After a successful sign-in: full-screen welcome.
 * The FC logo drives in as a convoy (white tile → navy F → gold C) with a
 * car zoom-by sound, a gold sparkle burst when the C lands, then
 * "WELCOME BACK, <NAME>". The app navigates underneath and the welcome fades
 * out on the new page.
 *
 * `unlockWelcomeSound()` must be called inside the tap on SIGN IN (before any
 * await) so phones allow the sound to play.
 */

let ctx: AudioContext | null = null;
export function unlockWelcomeSound() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!ctx) ctx = new AC();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    /* no sound */
  }
}

export function closeGoldDoors(name: string) {
  window.dispatchEvent(new CustomEvent("fc-doors-close", { detail: { name } }));
  return new Promise<void>((r) => setTimeout(r, 1700));
}

function playSound() {
  const a = ctx;
  if (!a) return;
  try {
    const t0 = a.currentTime + 0.05;
    // "Sports car pass": higher, sharper engine sweeping left → right.
    const car = (t: number, v: number) => {
      const d = 0.5;
      const o = a.createOscillator();
      const o2 = a.createOscillator();
      const f = a.createBiquadFilter();
      const g = a.createGain();
      let dst: AudioNode = a.destination;
      if (a.createStereoPanner) {
        const p = a.createStereoPanner();
        p.pan.setValueAtTime(-0.9, t);
        p.pan.linearRampToValueAtTime(0.9, t + d);
        p.connect(a.destination);
        dst = p;
      }
      o.type = "sawtooth";
      o2.type = "square";
      [o, o2].forEach((x, i) => {
        const k = i ? 0.5 : 1;
        x.frequency.setValueAtTime(140 * k, t);
        x.frequency.linearRampToValueAtTime(330 * k, t + d * 0.5);
        x.frequency.linearRampToValueAtTime(180 * k, t + d);
      });
      f.type = "lowpass";
      f.frequency.setValueAtTime(400, t);
      f.frequency.linearRampToValueAtTime(2600, t + d * 0.5);
      f.frequency.linearRampToValueAtTime(500, t + d);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(v, t + d * 0.48);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(f);
      o2.connect(f);
      f.connect(g).connect(dst);
      o.start(t);
      o2.start(t);
      o.stop(t + d + 0.05);
      o2.stop(t + d + 0.05);
    };
    [0, 0.2, 0.4].forEach((d) => car(t0 + d, 0.16));
    // landing thud + gold shimmer
    const th = a.createOscillator();
    const tg = a.createGain();
    th.frequency.setValueAtTime(100, t0 + 0.84);
    th.frequency.exponentialRampToValueAtTime(40, t0 + 1.04);
    tg.gain.setValueAtTime(0.0001, t0 + 0.84);
    tg.gain.exponentialRampToValueAtTime(0.35, t0 + 0.845);
    tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.09);
    th.connect(tg).connect(a.destination);
    th.start(t0 + 0.84);
    th.stop(t0 + 1.15);
    [2093, 2637, 3136, 4186].forEach((fq, i) => {
      const o = a.createOscillator();
      const g = a.createGain();
      const t = t0 + 0.86 + i * 0.04;
      o.frequency.value = fq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      o.connect(g).connect(a.destination);
      o.start(t);
      o.stop(t + 0.7);
    });
  } catch {
    /* ignore */
  }
}

function sparkle(canvas: HTMLCanvasElement, cx: number, cy: number) {
  const x = canvas.getContext("2d");
  if (!x) return;
  const dpr = 2;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  type P = { x: number; y: number; vx: number; vy: number; r: number; l: number; d: number };
  const ps: P[] = [];
  for (let i = 0; i < 70; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 2 + Math.random() * 11;
    ps.push({ x: cx * dpr, y: cy * dpr, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: 1.5 + Math.random() * 3, l: 1, d: 0.014 + Math.random() * 0.014 });
  }
  const step = () => {
    x.clearRect(0, 0, canvas.width, canvas.height);
    x.globalCompositeOperation = "lighter";
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.vy += 0.08;
      p.x += p.vx;
      p.y += p.vy;
      p.l -= p.d;
      if (p.l <= 0) {
        ps.splice(i, 1);
        continue;
      }
      const r = p.r * (0.5 + p.l * 0.5) * 3;
      const g = x.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      g.addColorStop(0, `rgba(255,250,220,${p.l})`);
      g.addColorStop(0.3, `rgba(244,200,90,${p.l * 0.8})`);
      g.addColorStop(1, "rgba(200,140,40,0)");
      x.fillStyle = g;
      x.beginPath();
      x.arc(p.x, p.y, r, 0, Math.PI * 2);
      x.fill();
    }
    if (ps.length) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function greetName(n: string) {
  return (n.trim().split(/\s+/)[0] ?? "").toUpperCase();
}

export default function GoldDoors() {
  const [phase, setPhase] = useState<"idle" | "play" | "out">("idle");
  const [name, setName] = useState("");
  const pathname = usePathname();
  const startPath = useRef<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const logo = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const onStart = (e: Event) => {
      setName(greetName((e as CustomEvent<{ name?: string }>).detail?.name ?? ""));
      startPath.current = window.location.pathname;
      setPhase("play");
    };
    window.addEventListener("fc-doors-close", onStart);
    return () => window.removeEventListener("fc-doors-close", onStart);
  }, []);

  // Run the convoy + sparkle once the overlay is on screen.
  useEffect(() => {
    if (phase !== "play") return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    playSound();
    if (reduce) return;
    const L = logo.current;
    if (!L) return;
    const parts = Array.from(L.children) as HTMLElement[];
    parts.forEach((p, i) =>
      p.animate(
        [
          { transform: "translateX(-110vw) skewX(-18deg)" },
          { transform: "translateX(8px) skewX(4deg)", offset: 0.8 },
          { transform: "none" },
        ],
        { duration: 550, delay: i * 200, easing: "ease-out", fill: "both" }
      )
    );
    const t = window.setTimeout(() => {
      const r = L.getBoundingClientRect();
      if (canvas.current) sparkle(canvas.current, r.left + r.width * 0.68, r.top + r.height * 0.55);
      L.animate(
        [
          { transform: "scale(1)", filter: "drop-shadow(0 0 0 #D4AF37)" },
          { transform: "scale(1.06)", filter: "drop-shadow(0 0 18px #F3D58E)" },
          { transform: "scale(1)", filter: "drop-shadow(0 0 0 #D4AF37)" },
        ],
        { duration: 500, easing: "ease-out" }
      );
      root.current?.animate([{ transform: "none" }, { transform: "translate(2px,-2px)" }, { transform: "translate(-2px,2px)" }, { transform: "none" }], { duration: 220 });
    }, 840);
    return () => window.clearTimeout(t);
  }, [phase]);

  // Fade out once the new page is showing (or after 5 s whatever happens).
  useEffect(() => {
    if (phase !== "play") return;
    const moved = startPath.current !== null && pathname !== startPath.current;
    const t = window.setTimeout(() => setPhase("out"), moved ? 500 : 5000);
    return () => window.clearTimeout(t);
  }, [phase, pathname]);

  useEffect(() => {
    if (phase !== "out") return;
    const t = window.setTimeout(() => setPhase("idle"), 500);
    return () => window.clearTimeout(t);
  }, [phase]);

  if (phase === "idle") return null;
  return (
    <div
      ref={root}
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center overflow-hidden"
      style={{ background: "#0A1020", opacity: phase === "out" ? 0 : 1, transition: "opacity .45s ease" }}
      aria-hidden
    >
      <div ref={logo} className="relative h-28 w-28">
        <div className="absolute inset-0 rounded-[26px]" style={{ background: "#ffffff" }} />
        <img src="/fc-logo-f.png" alt="" className="absolute inset-0 h-full w-full" />
        <img src="/fc-logo-c.png" alt="" className="absolute inset-0 h-full w-full" />
      </div>
      <div className="fc-welcome mt-7 text-center font-mono uppercase">
        <div className="text-[11px] font-bold tracking-[0.35em] text-[#D4AF5A]">Welcome back</div>
        <div className="mt-1.5 font-display text-3xl font-extrabold tracking-wide text-white">{name}</div>
      </div>
      <canvas ref={canvas} className="pointer-events-none absolute inset-0 h-full w-full" />
      <style>{`.fc-welcome{animation:fcWelcome .5s 1s cubic-bezier(.2,.8,.2,1) both}
@keyframes fcWelcome{0%{opacity:0;transform:translateY(12px)}100%{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.fc-welcome{animation:none}}`}</style>
    </div>
  );
}
