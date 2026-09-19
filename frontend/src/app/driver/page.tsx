"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, ApiClientError } from "@/lib/api";
import { fmtNumber, todayStr, agingDays, agingBadgeClass } from "@/lib/format";
import { useSocketEvent } from "@/lib/useSocketEvent";
import { CashClosing, Employee, Order, OrderStatus, STATUSES, Vendor, Summary as SharedSummary } from "@/types";
import StatusDoughnut from "@/components/charts/StatusDoughnut";
import LiveFlowPanel from "@/components/LiveFlowPanel";

interface Summary {
  assigned: number;
  delivered: number;
  pending: number;
  cancelled: number;
  transferred: number;
  deliveryChargeEarned: number;
  cashCollected: number;
  bankCollected: number;
}

// Minimal typing for the Web Speech API (not in default TS lib).
interface SpeechRecognitionResultLike {
  transcript: string;
}
interface SpeechRecognitionEventLike {
  results: { [key: number]: { [key: number]: SpeechRecognitionResultLike } };
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function useVoiceSearch(onResult: (digits: string) => void) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);

  function start() {
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Recognition = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Recognition) {
      setSupported(false);
      return;
    }
    const recognition = new Recognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      const digits = transcript.replace(/\D/g, "");
      if (digits) onResult(digits);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    setListening(true);
    recognition.start();
  }

  return { listening, supported, start };
}

// Full-sentence voice assistant — "56678 delivered bank" — parses a whole spoken
// command instead of just digits. Reuses the same underlying browser API.
function useVoiceAssistant(onResult: (transcript: string) => void) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);

  function start() {
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Recognition = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Recognition) {
      setSupported(false);
      return;
    }
    const recognition = new Recognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      if (transcript) onResult(transcript);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    setListening(true);
    recognition.start();
  }

  return { listening, supported, start };
}

export default function DriverPortalPage() {
  const date = todayStr();

  // Before 10 AM, a driver may still be closing out last night's work — show
  // yesterday's Cash Closing instead of today's freshly-empty one, so it doesn't
  // become inaccessible the moment the calendar flips over at midnight.
  function effectiveCashClosingDate(): string {
    const dubaiNow = new Date(Date.now() + 4 * 60 * 60 * 1000);
    if (dubaiNow.getUTCHours() < 10) {
      const yesterday = new Date(dubaiNow);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      return yesterday.toISOString().slice(0, 10);
    }
    return dubaiNow.toISOString().slice(0, 10);
  }
  const cashClosingDate = effectiveCashClosingDate();
  const isShowingYesterday = cashClosingDate !== date;

  const [orders, setOrders] = useState<Order[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [statusTab, setStatusTab] = useState<OrderStatus | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [transferOrder, setTransferOrder] = useState<Order | null>(null);
  const [statusOrder, setStatusOrder] = useState<Order | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "info" | "milestone" | "reminder" } | null>(null);

  // Data the voice assistant needs beyond what's already loaded — fetched once.
  const [assistantEmployees, setAssistantEmployees] = useState<Employee[]>([]);
  const [assistantVendors, setAssistantVendors] = useState<Vendor[]>([]);
  useEffect(() => {
    apiFetch<Employee[]>("/employees").then(setAssistantEmployees);
    apiFetch<Vendor[]>("/vendors").then(setAssistantVendors);
  }, []);

  function speak(text: string) {
    try {
      if (!("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1;
      utterance.volume = 1;
      window.speechSynthesis.speak(utterance);
    } catch {
      // Speech synthesis unsupported/blocked — silently skip.
    }
  }

  const load = useCallback(async () => {
    const [ordersRes, summaryRes] = await Promise.all([
      apiFetch<{ date: string; orders: Order[] }>("/driver/orders", { query: { date } }),
      apiFetch<Summary>("/driver/summary", { query: { date } }),
    ]);
    setOrders(ordersRes.orders);
    setSummary(summaryRes);
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  // Own unconfirmed bank payments carried forward from previous days — a driver
  // gets a warning until they actually confirm the money landed, no matter how
  // many days pass.
  const [unconfirmedBankCarryover, setUnconfirmedBankCarryover] = useState<Order[]>([]);
  const loadUnconfirmedBank = useCallback(async () => {
    const res = await apiFetch<{ orders: Order[] }>("/orders/unconfirmed-bank-carryover", { query: { date } });
    setUnconfirmedBankCarryover(res.orders);
  }, [date]);
  useEffect(() => {
    loadUnconfirmedBank();
  }, [loadUnconfirmedBank]);

  function showToast(msg: string, type: "info" | "milestone" | "reminder" | "success" | "push" = "info") {
    setToast({ message: msg, type: type === "success" || type === "push" ? "info" : type });
    setTimeout(() => setToast(null), type === "milestone" ? 3200 : 2600);
    if (type === "reminder") playChime();
    else if (type === "milestone") playCrescendo();
    else if (type === "push") playWhoosh();
    else if (type === "success") playChaChing();
    else playPop();
  }

  // Shared low-level tone helpers — every sound below is generated live (no audio
  // files), same technique as the original cash-closing chime.
  function getAudioCtx(): AudioContext | null {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      // Mobile browsers often start AudioContext in a "suspended" state until
      // explicitly resumed — without this, oscillator tones silently produce no
      // sound at all, even though no error is thrown and speechSynthesis (a
      // different API) works fine.
      if (ctx.state === "suspended") {
        ctx.resume();
      }
      return ctx;
    } catch {
      return null;
    }
  }
  function tone(ctx: AudioContext, freq: number, startAt: number, duration: number, type: OscillatorType = "sine") {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime + startAt);
    gain.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + startAt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + startAt + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime + startAt);
    osc.stop(ctx.currentTime + startAt + duration + 0.05);
  }
  function sweepTone(ctx: AudioContext, freqFrom: number, freqTo: number, startAt: number, duration: number, type: OscillatorType = "sine") {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqFrom, ctx.currentTime + startAt);
    osc.frequency.exponentialRampToValueAtTime(freqTo, ctx.currentTime + startAt + duration);
    gain.gain.setValueAtTime(0.2, ctx.currentTime + startAt);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + startAt + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime + startAt);
    osc.stop(ctx.currentTime + startAt + duration + 0.05);
  }

  // 11:30 PM reminder — gentle two-note "ding-dong".
  function playChime() {
    const ctx = getAudioCtx();
    if (!ctx) return;
    tone(ctx, 880, 0, 0.35);
    tone(ctx, 660, 0.18, 0.4);
  }
  // New order assigned — rising whoosh.
  function playWhoosh() {
    const ctx = getAudioCtx();
    if (!ctx) return;
    sweepTone(ctx, 200, 900, 0, 0.3, "sawtooth");
  }
  // Status marked Delivered / cash closing submitted — quick "cha-ching".
  function playChaChing() {
    const ctx = getAudioCtx();
    if (!ctx) return;
    tone(ctx, 1200, 0, 0.08, "square");
    tone(ctx, 1600, 0.06, 0.15, "square");
  }
  // Milestone / achievement — three-note rising crescendo.
  function playCrescendo() {
    const ctx = getAudioCtx();
    if (!ctx) return;
    tone(ctx, 523, 0, 0.25);
    tone(ctx, 659, 0.15, 0.25);
    tone(ctx, 784, 0.3, 0.4);
  }
  // Search / minor confirmation — short soft pop.
  function playPop() {
    const ctx = getAudioCtx();
    if (!ctx) return;
    sweepTone(ctx, 300, 700, 0, 0.09);
  }

  // New order assigned — instant ping the moment admin (or a transfer) hands the
  // driver a fresh consignment, showing which one so they don't have to go hunting.
  useSocketEvent("order:assigned", (payload) => {
    const p = payload as { order?: Order };
    if (p?.order) {
      showToast(`New order assigned — CN ${p.order.cnNo}, ${p.order.brandName}`, "push");
    }
    load();
  });
  useSocketEvent("order:removed", load);
  useSocketEvent("order:changed", load);

  // Personal milestone celebration — only fires when the count actually crosses a
  // threshold during this session (never retroactively on first load), so a driver
  // who already had 15 deliveries when they opened the app won't suddenly see "10!".
  const MILESTONES = [10, 20, 25, 30];
  const prevDeliveredRef = useRef<number | null>(null);
  useEffect(() => {
    if (!summary) return;
    const prev = prevDeliveredRef.current;
    const curr = summary.delivered;
    if (prev !== null) {
      for (const m of MILESTONES) {
        if (prev < m && curr >= m) {
          showToast(`${m} delivered today!`, "milestone");
        }
      }
    }
    prevDeliveredRef.current = curr;
  }, [summary]);

  // End-of-day cash closing reminder — nudges once, the first time the clock passes
  // 11:30 PM Dubai time, if the driver still has this tab open.
  const reminderShownRef = useRef(false);
  useEffect(() => {
    function checkReminder() {
      const dubaiNow = new Date(Date.now() + 4 * 60 * 60 * 1000);
      const hours = dubaiNow.getUTCHours();
      const mins = dubaiNow.getUTCMinutes();
      if (!reminderShownRef.current && (hours > 23 || (hours === 23 && mins >= 30))) {
        reminderShownRef.current = true;
        showToast("It's getting late — don't forget to submit today's cash closing.", "reminder");
      }
    }
    checkReminder();
    const interval = setInterval(checkReminder, 60000);
    return () => clearInterval(interval);
  }, []);

  // Achievement unlock — fires at every 100, 200, 300… delivered THIS MONTH (not
  // today's count, since triple digits in a single day isn't realistic). Checked
  // every few minutes rather than tied to the daily summary, since it needs the
  // full month's total.
  const [achievement, setAchievement] = useState<{ title: string; subtitle: string } | null>(null);
  const prevMonthlyDeliveredRef = useRef<number | null>(null);

  function showAchievement(title: string, subtitle: string) {
    setAchievement({ title, subtitle });
    setTimeout(() => setAchievement(null), 4000);
    playCrescendo();
  }

  const checkMonthlyAchievement = useCallback(async () => {
    const month = date.slice(0, 7);
    const res = await apiFetch<{ days: { delivered: number }[] }>("/driver/performance", { query: { month } });
    const total = res.days.reduce((s, d) => s + d.delivered, 0);
    const prev = prevMonthlyDeliveredRef.current;
    if (prev !== null) {
      for (let m = 100; m <= 5000; m += 100) {
        if (prev < m && total >= m) {
          showAchievement("Century Club", `${m} deliveries this month`);
          break;
        }
      }
    }
    prevMonthlyDeliveredRef.current = total;
  }, [date]);

  useEffect(() => {
    checkMonthlyAchievement();
    const interval = setInterval(checkMonthlyAchievement, 5 * 60000);
    return () => clearInterval(interval);
  }, [checkMonthlyAchievement]);

  async function updateStatus(order: Order, status: OrderStatus, payment: "CASH" | "BANK", reason?: string, bankPaymentConfirmed?: boolean) {
    // Also re-hits the payment endpoint if only the confirmation checkbox changed
    // (payment method itself staying BANK), not just on an actual CASH/BANK switch.
    if (payment !== order.payment || (payment === "BANK" && bankPaymentConfirmed !== order.bankPaymentConfirmed)) {
      await apiFetch(`/orders/${order.id}/payment`, { method: "PATCH", body: { payment, bankPaymentConfirmed } });
    }
    await apiFetch(`/orders/${order.id}/status`, { method: "PATCH", body: { status, reason } });
    showToast(`CN ${order.cnNo} marked ${status}`, status === "DELIVERED" ? "success" : "info");
    await load();
  }
  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (statusTab !== "ALL" && o.status !== statusTab) return false;
      if (search && !String(o.cnNo).includes(search) && !o.brandName.toUpperCase().includes(search.toUpperCase())) return false;
      return true;
    });
  }, [orders, statusTab, search]);

  const voiceSearch = useVoiceSearch((digits) => {
    setSearch(digits);
    showToast(`Searching CN ${digits}`);
  });

  // ── Global voice assistant ──────────────────────────────────────────────────
  // Parses a full spoken command and either answers immediately (questions), or
  // stages a Confirm/Cancel step before touching any data (updates, transfers,
  // vendor payments) — reduces risk from a misheard word or number. A single
  // "undo last" reverses whichever confirmed action ran most recently.
  type ParsedCommand =
    | { kind: "update"; order: Order; status?: OrderStatus; payment?: "CASH" | "BANK"; reason?: string; description: string }
    | { kind: "transfer"; order: Order; toEmployee: Employee; description: string }
    | { kind: "vendorPayment"; vendor: Vendor; amount: number; description: string }
    | { kind: "question"; answer: string }
    | { kind: "undo" }
    | { kind: "unrecognized"; raw: string };

  const [assistantHeard, setAssistantHeard] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<{ description: string; undo: () => Promise<void> } | null>(null);

  function parseVoiceCommand(transcript: string): ParsedCommand {
    const lower = transcript.toLowerCase();

    // "undo last" — checked first, doesn't need a CN number.
    if (/\bundo\b/.test(lower)) return { kind: "undo" };

    // Questions — answered immediately via speech, nothing gets changed.
    if (/how many pending/.test(lower)) {
      const n = orders.filter((o) => o.status === "PENDING").length;
      return { kind: "question", answer: `You have ${n} pending order${n === 1 ? "" : "s"}.` };
    }
    if (/how many delivered/.test(lower)) {
      const n = orders.filter((o) => o.status === "DELIVERED").length;
      return { kind: "question", answer: `You have delivered ${n} order${n === 1 ? "" : "s"} today.` };
    }
    if (/how much cash/.test(lower)) {
      const n = summary?.cashCollected ?? 0;
      return { kind: "question", answer: `You have collected ${n} AED in cash today.` };
    }
    if (/how much bank/.test(lower)) {
      const n = summary?.bankCollected ?? 0;
      return { kind: "question", answer: `You have collected ${n} AED via bank today.` };
    }

    // "pay vendor <name> <amount>"
    const payMatch = lower.match(/pay\s+(?:vendor\s+)?(.+?)\s+(\d+)/);
    if (payMatch) {
      const spokenName = payMatch[1].trim();
      const amount = Number(payMatch[2]);
      const vendor = assistantVendors.find((v) => v.name.toLowerCase().includes(spokenName) || spokenName.includes(v.name.toLowerCase()));
      if (!vendor) return { kind: "unrecognized", raw: `Vendor "${spokenName}" not found` };
      return { kind: "vendorPayment", vendor, amount, description: `Pay ${vendor.name} ${amount} AED` };
    }

    // "<cn> transfer to <name>"
    const cnMatch = transcript.match(/\d{3,7}/);
    const cnNo = cnMatch ? Number(cnMatch[0]) : null;
    const transferMatch = lower.match(/transfer\s*(?:to)?\s+([a-z]+)/);
    if (cnNo && transferMatch) {
      const order = orders.find((o) => o.cnNo === cnNo);
      if (!order) return { kind: "unrecognized", raw: `CN ${cnNo} not found` };
      const spokenName = transferMatch[1].trim();
      const toEmployee = assistantEmployees.find((e) => e.id !== order.employeeId && e.name.toLowerCase().startsWith(spokenName));
      if (!toEmployee) return { kind: "unrecognized", raw: `Driver "${spokenName}" not found` };
      return { kind: "transfer", order, toEmployee, description: `Transfer CN ${cnNo} to ${toEmployee.name}` };
    }

    // "<cn> delivered/pending/cancelled [reason], [cash/bank]"
    if (!cnNo) return { kind: "unrecognized", raw: transcript };
    const order = orders.find((o) => o.cnNo === cnNo);
    if (!order) return { kind: "unrecognized", raw: `CN ${cnNo} not found in today's orders` };

    let status: OrderStatus | undefined;
    let reason: string | undefined;
    const cancelMatch = lower.match(/\bcancel(?:led)?\b/);
    if (cancelMatch) {
      status = "CANCELLED";
      const afterCancel = lower.slice(cancelMatch.index! + cancelMatch[0].length).trim();
      reason = afterCancel.replace(/^(reason|because|due to|for)\s*[:,]?\s*/i, "").trim();
    } else if (/delivered/.test(lower)) status = "DELIVERED";
    else if (/pending/.test(lower)) status = "PENDING";

    let payment: "CASH" | "BANK" | undefined;
    if (/\bbank\b/.test(lower)) payment = "BANK";
    else if (/\bcash\b/.test(lower)) payment = "CASH";

    if (!status && !payment) return { kind: "unrecognized", raw: `Heard CN ${cnNo} but no status or payment` };
    if (status === "CANCELLED" && !reason) return { kind: "unrecognized", raw: `Heard "cancel" for CN ${cnNo} but no reason given` };

    const parts = [`CN ${cnNo}`];
    if (status) parts.push(status + (reason ? ` (${reason})` : ""));
    if (payment) parts.push(payment);
    return { kind: "update", order, status, payment, reason, description: parts.join(" — ") };
  }

  async function executeCommand(cmd: ParsedCommand, bankPaymentConfirmed?: boolean) {
    if (cmd.kind === "update") {
      const prevStatus = cmd.order.status;
      const prevPayment = cmd.order.payment;
      const prevBankConfirmed = cmd.order.bankPaymentConfirmed;
      await updateStatus(cmd.order, cmd.status ?? cmd.order.status, cmd.payment ?? cmd.order.payment, cmd.reason, bankPaymentConfirmed);
      setLastAction({
        description: cmd.description,
        undo: async () => {
          await updateStatus(cmd.order, prevStatus, prevPayment, undefined, prevBankConfirmed);
          showToast(`Undone — CN ${cmd.order.cnNo} restored`, "info");
        },
      });
    } else if (cmd.kind === "transfer") {
      await apiFetch(`/orders/${cmd.order.id}/transfer`, { method: "POST", body: { toEmployeeId: cmd.toEmployee.id } });
      showToast(`CN ${cmd.order.cnNo} transferred to ${cmd.toEmployee.name}`, "info");
      await load();
      setLastAction({
        description: cmd.description,
        undo: async () => {
          await apiFetch(`/orders/${cmd.order.id}/transfer`, { method: "POST", body: { toEmployeeId: cmd.order.employeeId } });
          showToast(`Undone — CN ${cmd.order.cnNo} transferred back`, "info");
          await load();
        },
      });
    } else if (cmd.kind === "vendorPayment") {
      const payment = await apiFetch<{ id: string }>("/purchases", {
        method: "POST",
        body: { date: cashClosingDate, amount: cmd.amount, vendorId: cmd.vendor.id },
      });
      showToast(`Logged ${cmd.amount} AED payment to ${cmd.vendor.name}`, "success");
      setLastAction({
        description: cmd.description,
        undo: async () => {
          await apiFetch(`/purchases/${payment.id}`, { method: "DELETE" });
          showToast(`Undone — payment to ${cmd.vendor.name} removed`, "info");
        },
      });
    }
  }

  // Awaiting a spoken yes/no specifically for "was the bank payment received" —
  // separate from a general confirmation step (driver doesn't need one for
  // anything else, commands execute immediately).
  const [awaitingBankConfirm, setAwaitingBankConfirm] = useState<Extract<ParsedCommand, { kind: "update" }> | null>(null);

  const voiceAssistant = useVoiceAssistant(async (transcript) => {
    setAssistantHeard(transcript);
    const lower = transcript.toLowerCase();

    if (awaitingBankConfirm) {
      const cmd = awaitingBankConfirm;
      setAwaitingBankConfirm(null);
      const received = /\b(yes|received|got it|confirm)\b/.test(lower);
      await executeCommand(cmd, received);
      setTimeout(() => setAssistantHeard(null), 2000);
      return;
    }

    const cmd = parseVoiceCommand(transcript);

    if (cmd.kind === "question") {
      speak(cmd.answer);
      showToast(cmd.answer, "info");
      setTimeout(() => setAssistantHeard(null), 3000);
      return;
    }
    if (cmd.kind === "undo") {
      if (lastAction) {
        lastAction.undo();
        setLastAction(null);
      } else {
        showToast("Nothing to undo", "info");
      }
      setTimeout(() => setAssistantHeard(null), 3000);
      return;
    }
    if (cmd.kind === "unrecognized") {
      showToast(cmd.raw, "info");
      setTimeout(() => setAssistantHeard(null), 3000);
      return;
    }

    // Only "update" commands with BANK payment need the extra spoken check —
    // everything else (Cash, Pending, Cancel, Transfer, vendor payment) runs
    // immediately with no confirmation step at all.
    if (cmd.kind === "update" && cmd.payment === "BANK") {
      setAwaitingBankConfirm(cmd);
      speak("Is the payment received?");
      setTimeout(() => voiceAssistant.start(), 1500);
      return;
    }

    await executeCommand(cmd);
    setTimeout(() => setAssistantHeard(null), 2000);
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {voiceAssistant.supported && (
        <button
          onClick={voiceAssistant.start}
          title="Voice assistant — say something like '56678 delivered bank'"
          className={`fixed right-4 top-24 z-40 flex h-12 w-12 items-center justify-center rounded-full text-2xl shadow-lg transition ${
            voiceAssistant.listening ? "animate-pulse bg-cancelled text-white" : "bg-navy text-paper hover:bg-navy-2"
          }`}
        >
          🌐
        </button>
      )}
      {awaitingBankConfirm ? (
        <div className="fixed right-4 top-40 z-50 max-w-[220px] rounded border border-pending bg-pending-bg px-3 py-2.5 text-xs shadow-lg">
          <span className="font-semibold text-pending">Is the payment received?</span> Say &quot;yes&quot; or &quot;no&quot;.
        </div>
      ) : (
        assistantHeard && (
          <div className="fixed right-4 top-40 z-40 max-w-[200px] rounded border border-brass bg-white px-3 py-2 text-xs shadow-lg">
            <span className="font-mono text-[10px] uppercase text-ink-soft">Heard:</span> &quot;{assistantHeard}&quot;
          </div>
        )
      )}
      {lastAction && !awaitingBankConfirm && (
        <button
          onClick={() => {
            lastAction.undo();
            setLastAction(null);
          }}
          className="fixed right-4 top-40 z-30 rounded border border-line bg-white px-3 py-1.5 font-mono text-[10px] uppercase text-ink-soft shadow hover:border-cancelled"
          style={{ display: assistantHeard ? "none" : undefined }}
        >
          ↺ Undo: {lastAction.description}
        </button>
      )}

      <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-brass">{date}</p>
      <h1 className="mb-6 font-display text-2xl font-semibold text-navy">Today&apos;s Deliveries</h1>

      {unconfirmedBankCarryover.length > 0 && (
        <div className="mb-6 border border-pending bg-pending-bg p-4">
          <h2 className="mb-1 font-display text-base font-semibold text-pending">
            ⚠ {unconfirmedBankCarryover.length} bank payment{unconfirmedBankCarryover.length === 1 ? "" : "s"} still unconfirmed
          </h2>
          <p className="mb-3 text-xs text-pending">
            From previous days — admin or manager will confirm these once the money is verified received.
          </p>
          <div className="space-y-2">
            {unconfirmedBankCarryover.map((o) => (
              <div key={o.id} className="rounded border border-pending bg-white px-3 py-2 text-xs">
                <span className="font-mono font-semibold">CN {o.cnNo}</span> · {o.brandName} · {fmtNumber(o.total)} AED
                <span className="ml-1 text-ink-soft">({o.date.slice(0, 10)})</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {orders.length > 0 && (
        <LiveFlowPanel
          pending={orders.filter((o) => o.status === "PENDING").length}
          transferred={orders.filter((o) => o.status === "TRANSFER").length}
          delivered={orders.filter((o) => o.status === "DELIVERED").length}
          cancelled={orders.filter((o) => o.status === "CANCELLED").length}
          totalConsignments={orders.length}
        />
      )}

      {summary && (
        <div className="mb-7 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-6">
          <Kpi label="Assigned" value={summary.assigned} />
          <Kpi label="Delivered" value={summary.delivered} />
          <Kpi label="Pending" value={orders.filter((o) => o.status === "PENDING" || o.status === "TRANSFER").length} />
          <Kpi label="DL Charge (AED)" value={fmtNumber(summary.deliveryChargeEarned)} />
          <Kpi label="Bank Deliveries" value={orders.filter((o) => o.status === "DELIVERED" && o.payment === "BANK").length} />
          <Kpi label="Cash Deliveries" value={orders.filter((o) => o.status === "DELIVERED" && o.payment === "CASH").length} />
        </div>
      )}

      {summary && summary.assigned > 0 && (
        <div className="mb-7 border border-line bg-white p-4">
          <h2 className="mb-3 font-mono text-[11px] uppercase tracking-wide text-ink-soft">Today&apos;s Breakdown</h2>
          <div className="mx-auto max-w-xs">
            <StatusDoughnut
              summary={
                {
                  delivered: summary.delivered,
                  pending: orders.filter((o) => o.status === "PENDING").length,
                  transferred: orders.filter((o) => o.status === "TRANSFER").length,
                  cancelled: summary.cancelled,
                } as unknown as SharedSummary
              }
            />
          </div>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(["ALL", ...STATUSES] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusTab(s)}
            className={`rounded-full border px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-wide ${
              statusTab === s ? "border-navy bg-navy text-paper" : "border-line bg-white text-ink-soft hover:border-brass"
            }`}
          >
            {s === "ALL" ? "All" : s}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1.5">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search CN No…"
            className="rounded border border-line px-3 py-1.5 text-sm"
          />
          {voiceSearch.supported && (
            <button
              onClick={voiceSearch.start}
              title="Search by voice"
              className={`rounded border px-2.5 py-1.5 text-sm ${
                voiceSearch.listening ? "border-cancelled bg-cancelled text-white animate-pulse" : "border-line bg-white text-ink-soft hover:border-brass"
              }`}
            >
              🎤
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded border border-line bg-white py-16 text-center text-ink-soft">
          <div className="mb-1.5 font-display text-lg text-navy">No consignments here</div>
          Nothing matches this filter right now.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((o) => (
            <div key={o.id} className={`flex flex-wrap items-center justify-between gap-3.5 rounded border border-line border-l-4 bg-white p-4 ${statusBorderClass(o.status)}`}>
              <div>
                <div className="font-mono text-[15px] font-bold text-navy">
                  CN {o.cnNo} <span className="font-normal text-ink-soft">— {o.brandName}</span>
                </div>
                <div className="mt-1 text-xs text-ink-soft">
                  Total <b className="text-ink">{fmtNumber(o.total)} AED</b> · DL Charge <b className="text-ink">{fmtNumber(o.deliveryCharge)} AED</b> · <span className="font-semibold text-ink">{o.payment}</span> · {o.emirate}
                </div>
                {o.remarks && (
                  <div className="mt-1 text-xs text-cancelled">
                    Reason: {o.remarks}
                  </div>
                )}
                {o.status === "TRANSFER" && o.transferredBy && (
                  <div className="mt-1 text-xs text-transferred">
                    Transferred by {o.transferredBy}
                  </div>
                )}
                {o.vendor.phone && (
                  <div className="mt-2 flex gap-2">
                    <a
                      href={`tel:${o.vendor.phone}`}
                      className="rounded border border-delivered px-2.5 py-1 font-mono text-[10.5px] font-bold uppercase tracking-wide text-delivered hover:bg-delivered-bg"
                    >
                      📞 Call Vendor
                    </a>
                    <a
                      href={`https://wa.me/${o.vendor.phone.replace(/\D/g, "")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded border border-delivered px-2.5 py-1 font-mono text-[10.5px] font-bold uppercase tracking-wide text-delivered hover:bg-delivered-bg"
                    >
                      💬 WhatsApp
                    </a>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <span className={`rounded border px-3 py-1.5 font-mono text-[10.5px] font-bold uppercase tracking-wide ${statusSelectedClass(o.status)}`}>
                  {o.status}
                </span>
                {agingDays(o.status, o.date) !== null && (
                  <span
                    className={`rounded px-2 py-1.5 font-mono text-[10.5px] font-bold uppercase tracking-wide ${agingBadgeClass(agingDays(o.status, o.date)!)}`}
                    title={`Pending ${agingDays(o.status, o.date)} days`}
                  >
                    {agingDays(o.status, o.date)}d old
                  </span>
                )}
                <button
                  onClick={() => setStatusOrder(o)}
                  className="rounded border border-line px-3 py-1.5 font-mono text-[10.5px] font-bold uppercase tracking-wide text-ink-soft hover:-translate-y-px"
                >
                  Update Status
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {isShowingYesterday && (
        <p className="mb-2 rounded border border-pending bg-pending-bg px-3 py-2 text-xs text-pending">
          Showing yesterday&apos;s ({cashClosingDate}) cash closing — still available until 10 AM.
        </p>
      )}
      <CashClosingPanel date={cashClosingDate} readOnly={isShowingYesterday} onSubmitted={() => showToast("Cash closing submitted", "success")} />

      {transferOrder && <TransferModal order={transferOrder} onClose={() => setTransferOrder(null)} onDone={() => { setTransferOrder(null); load(); }} />}

      {statusOrder && (
        <StatusModal
          order={statusOrder}
          onClose={() => setStatusOrder(null)}
          onTransfer={() => {
            setTransferOrder(statusOrder);
            setStatusOrder(null);
          }}
          onConfirm={async (status, payment, reason, bankPaymentConfirmed) => {
            await updateStatus(statusOrder, status, payment, reason, bankPaymentConfirmed);
            setStatusOrder(null);
          }}
        />
      )}

      {toast && (
        <div
          className={`fixed bottom-6 right-6 max-w-xs border-l-2 px-5 py-3 font-mono text-xs shadow-lg ${
            toast.type === "milestone"
              ? "border-brass bg-brass text-navy"
              : toast.type === "reminder"
              ? "border-pending bg-white text-ink"
              : "border-brass bg-navy text-paper"
          }`}
        >
          {toast.type === "milestone" && <span className="mr-1">★</span>}
          {toast.message}
        </div>
      )}

      {achievement && (
        <div className="fixed inset-x-0 top-16 z-50 flex justify-center px-4">
          <div className="flex animate-[achievement-pop_0.5s_cubic-bezier(0.34,1.56,0.64,1)_forwards] items-center gap-3 bg-navy px-5 py-3.5 text-paper shadow-xl">
            <span className="text-2xl">🏆</span>
            <div>
              <div className="text-sm font-semibold">{achievement.title}</div>
              <div className="font-mono text-[10px] uppercase tracking-wide text-brass-light">{achievement.subtitle}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white p-4">
      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-soft">{label}</div>
      <div className="font-display text-xl font-semibold text-navy">{value}</div>
    </div>
  );
}

function statusBorderClass(status: OrderStatus) {
  switch (status) {
    case "DELIVERED":
      return "border-l-delivered";
    case "PENDING":
      return "border-l-pending";
    case "CANCELLED":
      return "border-l-cancelled";
    default:
      return "border-l-transferred";
  }
}

function statusSelectedClass(status: OrderStatus) {
  switch (status) {
    case "DELIVERED":
      return "border-delivered bg-delivered text-white";
    case "PENDING":
      return "border-pending bg-pending text-white";
    case "CANCELLED":
      return "border-cancelled bg-cancelled text-white";
    default:
      return "border-transferred bg-transferred text-white";
  }
}

function TransferModal({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => void }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [toId, setToId] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<Employee[]>("/employees").then((list) => setEmployees(list.filter((e) => e.id !== order.employeeId)));
  }, [order.employeeId]);

  async function submit() {
    if (!toId) {
      setError("Pick a driver to transfer to.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/orders/${order.id}/transfer`, { method: "POST", body: { toEmployeeId: toId, note } });
      onDone();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Transfer failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm rounded border border-line bg-white p-6">
        <h3 className="mb-1 font-display text-lg font-semibold text-navy">Transfer CN {order.cnNo}</h3>
        <p className="mb-4 text-xs text-ink-soft">Pick another driver to hand this consignment to.</p>
        <select value={toId} onChange={(e) => setToId(e.target.value)} className="mb-3 w-full rounded border border-line px-3 py-2 text-sm">
          <option value="">Select driver…</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (optional)" className="mb-3 w-full rounded border border-line px-3 py-2 text-sm" />
        {error && <p className="mb-3 text-xs text-cancelled">{error}</p>}
        <div className="flex gap-2">
          <button onClick={submit} disabled={busy} className="flex-1 rounded bg-navy py-2 font-mono text-xs uppercase tracking-wide text-paper hover:bg-navy-2 disabled:opacity-60">
            {busy ? "Transferring…" : "Confirm transfer"}
          </button>
          <button onClick={onClose} className="rounded border border-line px-4 py-2 font-mono text-xs uppercase tracking-wide text-ink-soft hover:border-brass">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusModal({
  order,
  onClose,
  onConfirm,
  onTransfer,
}: {
  order: Order;
  onClose: () => void;
  onConfirm: (status: OrderStatus, payment: "CASH" | "BANK", reason?: string, bankPaymentConfirmed?: boolean) => Promise<void>;
  onTransfer: () => void;
}) {
  const [selected, setSelected] = useState<OrderStatus | null>(null);
  const [payment, setPayment] = useState<"CASH" | "BANK">(order.payment);
  const [bankPaymentConfirmed, setBankPaymentConfirmed] = useState(order.bankPaymentConfirmed ?? false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Speaks the payment method out loud so the driver can confirm by ear without
  // needing to look at the screen — uses the browser's built-in text-to-speech.
  function speak(text: string) {
    try {
      if (!("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1;
      utterance.volume = 1;
      window.speechSynthesis.speak(utterance);
    } catch {
      // Speech synthesis unsupported/blocked — silently skip.
    }
  }

  async function confirm() {
    if (!selected) {
      setError("Choose a status.");
      return;
    }
    if (selected === "CANCELLED" && !reason.trim()) {
      setError("Enter a reason for cancelling.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirm(selected, payment, selected === "CANCELLED" ? reason.trim() : undefined, payment === "BANK" ? bankPaymentConfirmed : undefined);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to update status");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm rounded border border-line bg-white p-6">
        <h3 className="mb-1 font-display text-lg font-semibold text-navy">Update CN {order.cnNo}</h3>
        <p className="mb-1 text-xs text-ink-soft">
          Total <b className="text-ink">{fmtNumber(order.total)} AED</b> · {order.brandName}
        </p>
        <p className="mb-4 text-xs text-ink-soft">
          Currently <b>{order.status}</b>. Pick the new status below.
        </p>
        <div className="mb-3 grid grid-cols-2 gap-2">
          {STATUSES.filter((s) => s !== "TRANSFER").map((s) => (
            <button
              key={s}
              onClick={() => setSelected(s)}
              className={`rounded border px-3 py-2.5 font-mono text-xs font-bold uppercase tracking-wide ${
                selected === s ? statusSelectedClass(s) : "border-line text-ink-soft hover:border-brass"
              }`}
            >
              {s}
            </button>
          ))}
          <button
            onClick={onTransfer}
            className="rounded border px-3 py-2.5 font-mono text-xs font-bold uppercase tracking-wide border-transferred text-transferred hover:bg-transferred-bg"
          >
            TRANSFER
          </button>
        </div>

        <div className="mb-3">
          <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Payment</label>
          <div className="grid grid-cols-2 gap-2">
            {(["CASH", "BANK"] as const).map((p) => (
              <button
                key={p}
                onClick={() => {
                  setPayment(p);
                  speak(p === "CASH" ? "Cash" : "Bank");
                }}
                className={`rounded border px-3 py-2.5 font-mono text-xs font-bold uppercase tracking-wide ${
                  payment === p ? "border-navy bg-navy text-paper" : "border-line text-ink-soft hover:border-brass"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          {payment === "BANK" && (
            <label className="mt-2 flex items-center gap-2 rounded border border-pending bg-pending-bg px-3 py-2 text-xs">
              <input type="checkbox" checked={bankPaymentConfirmed} onChange={(e) => setBankPaymentConfirmed(e.target.checked)} className="h-4 w-4" />
              <span className={bankPaymentConfirmed ? "text-ink" : "font-semibold text-pending"}>
                {bankPaymentConfirmed ? "✓ Payment received" : "Payment not yet confirmed received"}
              </span>
            </label>
          )}
        </div>

        {selected === "CANCELLED" && (
          <div className="mb-3">
            <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Reason for cancelling</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="w-full rounded border border-line px-3 py-2 text-sm"
              placeholder="e.g. customer refused, wrong address…"
            />
          </div>
        )}
        {error && <p className="mb-3 text-xs text-cancelled">{error}</p>}
        <div className="flex gap-2">
          <button
            onClick={confirm}
            disabled={busy || !selected}
            className="flex-1 rounded bg-navy py-2 font-mono text-xs uppercase tracking-wide text-paper hover:bg-navy-2 disabled:opacity-60"
          >
            {busy ? "Saving…" : "Confirm"}
          </button>
          <button onClick={onClose} className="rounded border border-line px-4 py-2 font-mono text-xs uppercase tracking-wide text-ink-soft hover:border-brass">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function CashClosingPanel({ date, readOnly, onSubmitted }: { date: string; readOnly?: boolean; onSubmitted: () => void }) {
  interface PurchaseEntry {
    id: string;
    amount: number;
    note?: string | null;
    vendor?: { id: string; name: string } | null;
  }
  const [preview, setPreview] = useState<{
    totalDelivered: number;
    totalDeliveryCharge: number;
    cashPayments: number;
    onlinePayments: number;
    expenses: { id: string; category: string; amount: number }[];
    totalExpenses: number;
    purchases: PurchaseEntry[];
    totalPurchases: number;
  } | null>(null);
  const [existing, setExisting] = useState<CashClosing | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [payVendorId, setPayVendorId] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payNote, setPayNote] = useState("");
  const [payError, setPayError] = useState<string | null>(null);
  const [payBusy, setPayBusy] = useState(false);

  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [p, closings] = await Promise.all([
      apiFetch<typeof preview>("/cash-closings/preview", { query: { date } }),
      apiFetch<CashClosing[]>("/cash-closings", { query: { date } }),
    ]);
    setPreview(p);
    setExisting(closings[0] ?? null);
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    apiFetch<Vendor[]>("/vendors").then(setVendors);
  }, []);

  useSocketEvent("order:changed", load);
  useSocketEvent("purchase:changed", load);

  const balance = preview ? preview.cashPayments - preview.totalExpenses - preview.totalPurchases : 0;

  async function submit() {
    setBusy(true);
    try {
   const closing = await apiFetch<CashClosing>("/cash-closings", {
          method: "POST",
          body: { date },
        });
      setExisting(closing);
      onSubmitted();
    } finally {
      setBusy(false);
    }
  }

  async function payVendor() {
    const amount = Number(payAmount);
    if (!payVendorId) {
      setPayError("Select a vendor.");
      return;
    }
    if (!amount || amount <= 0) {
      setPayError("Enter an amount.");
      return;
    }
    setPayError(null);
    setPayBusy(true);
    try {
      await apiFetch("/purchases", {
        method: "POST",
        body: { date, amount, vendorId: payVendorId, note: payNote || undefined },
      });
      setPayVendorId("");
      setPayAmount("");
      setPayNote("");
      await load();
    } catch (err) {
      setPayError(err instanceof ApiClientError ? err.message : "Failed to log payment");
    } finally {
      setPayBusy(false);
    }
  }

  async function removePurchase(id: string) {
    if (!confirm("Remove this deduction?")) return;
    await apiFetch(`/purchases/${id}`, { method: "DELETE" });
    await load();
  }

  if (!preview) return null;

  return (
    <div className={`mt-10 border p-6 ${readOnly ? "border-pending bg-pending-bg" : "border-line bg-white"}`}>
      <h2 className="mb-1 font-display text-lg font-semibold text-navy">Day-End Cash Closing</h2>
      {readOnly && (
        <p className="mb-3 inline-block rounded border border-pending bg-white px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-pending">
          🔒 Read-only — yesterday&apos;s closing, locked
        </p>
      )}
      <p className="mb-5 text-xs text-ink-soft">
        Totals below are computed automatically from your delivered consignments for {date}. Enter today&apos;s expenses to
        calculate your balance cash.
      </p>

      <div className="mb-5 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4">
        <Kpi label="Delivered" value={preview.totalDelivered} />
        <Kpi label="DL Charges" value={fmtNumber(preview.totalDeliveryCharge)} />
        <Kpi label="Cash Payments" value={fmtNumber(preview.cashPayments)} />
        <Kpi label="Online Payments" value={fmtNumber(preview.onlinePayments)} />
      </div>

    <div className="mb-4">
          <label className="mb-2 block font-mono text-[10px] uppercase text-ink-soft">Today&apos;s Expenses (entered by admin)</label>
          {preview.expenses.length === 0 ? (
            <p className="text-xs text-ink-soft">No expenses entered for you today.</p>
          ) : (
            preview.expenses.map((exp) => (
              <div key={exp.id} className="mb-2 flex items-center justify-between rounded border border-line px-3 py-2 text-sm">
                <span>{exp.category}</span>
                <span className="font-mono">{fmtNumber(exp.amount)} AED</span>
              </div>
            ))
          )}
        </div>

      <div className="mb-4">
        <label className="mb-2 block font-mono text-[10px] uppercase text-ink-soft">
          Cash Paid Out to Vendors
        </label>
        <p className="mb-2 text-xs text-ink-soft">
          If you personally handed over collected cash to a vendor today, log it here. It reduces your
          balance cash and counts toward that vendor&apos;s balance.
        </p>
        {preview.purchases.length > 0 && (
          <div className="mb-3 space-y-2">
            {preview.purchases.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between rounded border border-line px-3 py-2 text-sm">
                <span>
                  {entry.vendor ? entry.vendor.name : "General deduction"}
                  {entry.note && <span className="text-ink-soft"> — {entry.note}</span>}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-mono">{fmtNumber(entry.amount)} AED</span>
                  {!readOnly && (
                    <button
                      onClick={() => removePurchase(entry.id)}
                      className="text-xs text-cancelled hover:underline"
                    >
                      Remove
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <select
            value={payVendorId}
            onChange={(e) => setPayVendorId(e.target.value)}
            disabled={readOnly}
            className="rounded border border-line px-2.5 py-2 text-sm disabled:bg-paper-2 disabled:opacity-60"
          >
            <option value="">Select vendor…</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <input
            type="number"
            placeholder="Amount"
            value={payAmount}
            onChange={(e) => setPayAmount(e.target.value)}
            disabled={readOnly}
            className="rounded border border-line px-2.5 py-2 text-sm disabled:bg-paper-2 disabled:opacity-60"
          />
          <input
            placeholder="Note (optional)"
            value={payNote}
            onChange={(e) => setPayNote(e.target.value)}
            disabled={readOnly}
            className="rounded border border-line px-2.5 py-2 text-sm disabled:bg-paper-2 disabled:opacity-60"
          />
          <button
            onClick={payVendor}
            disabled={payBusy || readOnly}
            className="rounded bg-navy px-4 py-2 font-mono text-xs uppercase tracking-wide text-paper hover:bg-navy-2 disabled:opacity-60"
          >
            {payBusy ? "Saving…" : "Log Payment"}
          </button>
        </div>
        {payError && <p className="mt-2 text-xs text-cancelled">{payError}</p>}
      </div>

      <div className="mb-5 flex items-center justify-between rounded border border-brass/40 bg-paper-2 px-4 py-3">
        <span className="font-mono text-xs uppercase tracking-wide text-ink-soft">Balance Cash</span>
        <span className="font-display text-xl font-semibold text-navy">{fmtNumber(balance)} AED</span>
      </div>

      {!readOnly && (
        <>
          <button onClick={submit} disabled={busy} className="rounded bg-navy px-5 py-2.5 font-mono text-xs uppercase tracking-wide text-paper hover:bg-navy-2 disabled:opacity-60">
            {busy ? "Submitting…" : existing ? "Re-submit cash closing" : "Submit cash closing"}
          </button>
          {existing && (
            <span className="ml-3 text-xs text-ink-soft">
              Last submitted {new Date(existing.submittedAt).toLocaleTimeString()} · status {existing.status}
            </span>
          )}
        </>
      )}
      {readOnly && existing && (
        <p className="text-xs text-ink-soft">
          Submitted {new Date(existing.submittedAt).toLocaleTimeString()} · status {existing.status}
        </p>
      )}
    </div>
  );
}
