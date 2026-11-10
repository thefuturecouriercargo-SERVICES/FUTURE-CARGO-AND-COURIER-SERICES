"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { apiFetch } from "@/lib/api";
import { PRAYER_NAMES, PRAYER_QUOTES, type PrayerQuote } from "@/lib/prayerQuotes";

type PrayerInfo = {
  emirate: string;
  emirateLabel: string;
  date: string;
  prayers: { name: string; at: string }[];
  nextFajr: string;
};

// The popup still shows if the driver opens the app up to 20 min after the Azan time…
const SHOW_WINDOW_MS = 20 * 60_000;
// …but the Azan SOUND only plays close to the real time. iPhones freeze the page in the
// background and wake it late, and old notifications get tapped hours later — after this
// the popup shows silently with a "listen" button instead.
const SOUND_WINDOW_MS = 4 * 60_000;
const dubaiDay = () => new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10);
const QUOTE_KEY = "fc-prayer-quote-idx";
const shownKey = (date: string, name: string) => `fc-prayer-shown-${date}-${name}`;

function safeGet(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode etc. */
  }
}

function nextQuote(): PrayerQuote {
  const i = (Number(safeGet(QUOTE_KEY)) || 0) % PRAYER_QUOTES.length;
  safeSet(QUOTE_KEY, String(i + 1));
  return PRAYER_QUOTES[i];
}

const timeFmt = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" });

/** Soft three-note chime, used only if /azan.mp3 is missing or can't play. */
function playChime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [523.25, 659.25, 783.99].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.connect(g);
      g.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.6;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.3, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
      o.start(t);
      o.stop(t + 1.5);
    });
  } catch {
    /* no audio available */
  }
}

/**
 * Azan reminder for drivers: at each prayer time (for the emirate where the
 * driver has most consignments today) it plays the opening of the Azan and
 * shows a big Malayalam reminder that changes every time.
 */
export default function PrayerReminder() {
  const [info, setInfo] = useState<PrayerInfo | null>(null);
  const [active, setActive] = useState<{ name: string; at: string; quote: PrayerQuote } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [push, setPush] = useState<"unsupported" | "off" | "on" | "denied">("unsupported");

  const load = useCallback(async () => {
    try {
      setInfo(await apiFetch<PrayerInfo>("/driver/prayer"));
    } catch {
      /* keep the last times we had */
    }
  }, []);

  // Fetch now, every 30 min (emirate can change as parcels are assigned) and when the app comes back to front.
  useEffect(() => {
    load();
    const t = setInterval(load, 30 * 60_000);
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  // Phones block sound until the user touches the page once — unlock it on the first tap.
  // The clip stays MUTED unless fire()/replay() deliberately starts it, and any playback
  // we didn't start (iPhone resuming the audio after a call / unlock) is stopped at once.
  const allowed = useRef(false);
  useEffect(() => {
    const a = new Audio("/azan.mp3");
    a.preload = "auto";
    a.muted = true;
    audioRef.current = a;
    const onPlaying = () => {
      if (!allowed.current) {
        a.pause();
        a.muted = true;
      }
    };
    const onEnded = () => {
      allowed.current = false;
      a.muted = true;
    };
    a.addEventListener("playing", onPlaying);
    a.addEventListener("ended", onEnded);
    const unlock = () => {
      window.removeEventListener("pointerdown", unlock);
      if (allowed.current) return;
      a.muted = true;
      const p = a.play();
      a.pause(); // stop straight away — the tap only "unlocks" sound for later
      p?.catch(() => undefined);
    };
    window.addEventListener("pointerdown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      a.removeEventListener("playing", onPlaying);
      a.removeEventListener("ended", onEnded);
      a.pause();
    };
  }, []);

  const startAudio = useCallback(() => {
    const a = audioRef.current;
    if (!a) return Promise.reject(new Error("no audio"));
    allowed.current = true;
    a.muted = false;
    a.currentTime = 0;
    return a.play().catch((e) => {
      allowed.current = false;
      a.muted = true;
      throw e;
    });
  }, []);

  const fire = useCallback((name: string, at: string) => {
    setActive({ name, at, quote: nextQuote() });
    // Late (phone was asleep, old notification tapped) → popup only, no Azan sound.
    if (Date.now() - new Date(at).getTime() > SOUND_WINDOW_MS) {
      setAudioBlocked(true);
      return;
    }
    startAudio()
      .then(() => setAudioBlocked(false))
      .catch(() => {
        setAudioBlocked(true);
        playChime();
      });
    try {
      navigator.vibrate?.([400, 200, 400]);
    } catch {
      /* not supported */
    }
  }, [startAudio]);

  // Check every 15 s whether a prayer time has arrived.
  useEffect(() => {
    if (!info) return;
    const check = () => {
      // Times from yesterday (app left open overnight) never fire — wait for today's.
      if (info.date !== dubaiDay()) return;
      const now = Date.now();
      for (const p of info.prayers) {
        const at = new Date(p.at).getTime();
        if (now >= at && now - at < SHOW_WINDOW_MS && !safeGet(shownKey(info.date, p.name))) {
          safeSet(shownKey(info.date, p.name), "1");
          fire(p.name, p.at);
          break;
        }
      }
    };
    check();
    const t = setInterval(check, 15_000);
    return () => clearInterval(t);
  }, [info, fire]);

  // Opened from an Azan notification (/driver?prayer=asr) — show the popup and Azan straight away.
  useEffect(() => {
    if (!info) return;
    const params = new URLSearchParams(window.location.search);
    const name = params.get("prayer");
    if (!name) return;
    params.delete("prayer");
    const qs = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
    const p = info.prayers.find((x) => x.name === name);
    if (!p || info.date !== dubaiDay()) return;
    // An old notification (earlier prayer, or tapped long after) must not start the Azan.
    const late = Date.now() - new Date(p.at).getTime();
    if (late < -60_000 || late > SHOW_WINDOW_MS || safeGet(shownKey(info.date, p.name))) return;
    safeSet(shownKey(info.date, p.name), "1");
    fire(p.name, p.at);
  }, [info, fire]);

  // Push notifications: register the service worker, and re-subscribe quietly if already allowed.
  const subscribe = useCallback(async (ask: boolean) => {
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setPush("unsupported");
        return;
      }
      const { key } = await apiFetch<{ key: string | null }>("/driver/push/key");
      if (!key) {
        setPush("unsupported");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      let perm = Notification.permission;
      if (perm === "default" && ask) perm = await Notification.requestPermission();
      if (perm === "denied") return setPush("denied");
      if (perm !== "granted") return setPush("off");
      const raw = atob(key.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (key.length % 4)) % 4));
      const appKey = Uint8Array.from(raw, (c) => c.charCodeAt(0));
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey }));
      await apiFetch("/driver/push/subscribe", { method: "POST", body: sub.toJSON() });
      setPush("on");
    } catch {
      setPush((s) => (s === "on" ? s : "off"));
    }
  }, []);

  useEffect(() => {
    void subscribe(false);
  }, [subscribe]);

  const replay = () => {
    startAudio().then(() => setAudioBlocked(false)).catch(() => undefined);
  };

  const close = () => {
    const a = audioRef.current;
    allowed.current = false;
    if (a) {
      a.pause();
      a.muted = true;
      a.currentTime = 0;
    }
    setActive(null);
  };

  // Small "next prayer" line for the top bar.
  const now = Date.now();
  const upcoming = info
    ? [...info.prayers, { name: "fajr", at: info.nextFajr }].find((p) => new Date(p.at).getTime() > now)
    : undefined;

  return (
    <>
      {upcoming && info && (
        <span className="flex w-full items-center justify-center gap-1 rounded-full border border-navy/50 px-3 py-1 font-mono text-[11px] font-bold text-navy" title={`Next azan · ${info.emirateLabel}`}>
          🕌 {timeFmt(upcoming.at)}
        </span>
      )}

      {push === "off" && (
        <button
          onClick={() => void subscribe(true)}
          className="w-full animate-pulse rounded-full border border-navy px-2 py-1 font-mono text-[10px] font-bold text-navy"
        >
          🔔 Azan ON
        </button>
      )}
      {push === "denied" && (
        <span className="w-full text-center font-mono text-[10px] font-bold text-cancelled" title="Allow notifications in phone settings">🔕 Blocked</span>
      )}

      {active && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center whitespace-normal break-words bg-black/80 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md overflow-hidden rounded-xl border-2 border-brass bg-navy text-paper shadow-2xl">
            <div className="border-b border-brass/40 bg-navy-2 px-5 py-4 text-center">
              <div className="text-3xl">🕌</div>
              <div className="mt-1 font-display text-2xl font-bold text-brass-light">
                {PRAYER_NAMES[active.name]?.ml} നിസ്കാര സമയം
              </div>
              <div className="mt-1 font-mono text-xs uppercase tracking-widest text-line">
                {PRAYER_NAMES[active.name]?.en} · {timeFmt(active.at)} · {info?.emirateLabel}
              </div>
            </div>

            <div className="px-5 py-5 text-center">
              <p className="text-base font-semibold text-brass-light" dir="rtl" lang="ar">
                اللّٰهُ أَكْبَرُ اللّٰهُ أَكْبَرُ
              </p>
              {audioBlocked && (
                <button onClick={replay} className="mt-3 rounded-full border border-brass-light px-4 py-1.5 text-sm font-semibold text-brass-light" lang="ml">
                  ▶ ബാങ്ക് കേൾക്കുക
                </button>
              )}
              <p className="mt-4 text-xl font-semibold leading-relaxed" lang="ml">
                “{active.quote.text}”
              </p>
              {active.quote.ref && <p className="mt-2 font-mono text-xs text-brass-light">— {active.quote.ref}</p>}
              <p className="mt-5 rounded border border-white/15 px-3 py-2 text-xs text-line" lang="ml">
                🚗 വണ്ടി ഓടിക്കുകയാണെങ്കിൽ സുരക്ഷിതമായി ഒതുക്കിയ ശേഷം മാത്രം ഫോൺ നോക്കുക.
              </p>
            </div>

            <div className="px-5 pb-5">
              <button
                onClick={close}
                className="w-full rounded-lg bg-brass px-4 py-3.5 text-lg font-bold leading-snug text-navy hover:bg-brass-light"
                lang="ml"
              >
                ശരി, നിസ്കരിക്കാൻ പോകുന്നു 🤲
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
