"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { EMIRATES, Employee, Order, OrderStatus, Vendor } from "@/types";

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

// Edit distance between two strings — used to catch phonetic mishearings from
// speech-to-text (e.g. "Anas" transcribed as "Anus") that plain substring
// matching would never catch, since neither word contains the other.
function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

/** Finds the best-matching item by name for a spoken word. Tries an exact
 * substring match first (fast, safe); if nothing matches, falls back to
 * whichever name is phonetically closest by edit distance — catching
 * mishearings like "Anas" -> "Anus" that substring matching misses entirely,
 * while a distance threshold keeps it from matching something wildly different. */
function fuzzyFindByName<T>(items: T[], spoken: string, getName: (item: T) => string): T | undefined {
  const spokenLower = spoken.toLowerCase().trim();
  if (!spokenLower) return undefined;

  const exact = items.find((item) => {
    const name = getName(item).toLowerCase();
    return name.includes(spokenLower) || spokenLower.includes(name);
  });
  if (exact) return exact;

  let best: T | undefined;
  let bestDist = Infinity;
  for (const item of items) {
    const name = getName(item).toLowerCase();
    // Compare against just the first word of the name (e.g. "Anas" not
    // "Anas Khan"), since that's usually all that's spoken.
    const firstWord = name.split(" ")[0];
    const dist = levenshtein(firstWord, spokenLower);
    if (dist < bestDist) {
      bestDist = dist;
      best = item;
    }
  }
  const threshold = Math.max(2, Math.floor(Math.min(spokenLower.length, 6) * 0.4));
  return bestDist <= threshold ? best : undefined;
}

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

interface DashboardSummary {
  summary: { pending: number; delivered: number; transferred: number; cancelled: number; cashCollected: number; bankCollected: number; totalOrders: number };
  employeeBreakdown: { employee: { id: string; name: string }; cashBalance: number; delivered: number; pending: number }[];
  agentBreakdown: { employee: { id: string; name: string }; cashBalance: number }[];
}
interface PendingCarryoverOrder {
  employeeId: string;
}

type ParsedCommand =
  | { kind: "update"; order: Order; status?: OrderStatus; payment?: "CASH" | "BANK"; reason?: string; description: string }
  | { kind: "transfer"; order: Order; toEmployee: Employee; description: string }
  | { kind: "vendorPayment"; vendor: Vendor; amount: number; description: string }
  | { kind: "expense"; category: string; amount: number; employee?: Employee; description: string }
  | { kind: "amountEdit"; order: Order; newAmount: number; description: string }
  | {
      kind: "addItem";
      cnNo: number;
      vendor: Vendor;
      total: number;
      payment: "CASH" | "BANK";
      emirate: string;
      employee: Employee;
      description: string;
    }
  | { kind: "question"; answer: string }
  | { kind: "undo" }
  | { kind: "unrecognized"; raw: string };

/** Global voice assistant for admin/manager — available on every page via
 * AdminShell. Same shape as the driver portal's assistant, but scoped to admin's
 * broader access: any order (not just one driver's own), any driver for transfer,
 * and company-wide questions instead of one person's daily totals. */
export default function AdminVoiceAssistant() {
  const [assistantHeard, setAssistantHeard] = useState<string | null>(null);
  const [pendingCommand, setPendingCommand] = useState<ParsedCommand | null>(null);
  const [lastAction, setLastAction] = useState<{ description: string; undo: () => Promise<void> } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // "Add new item" as a step-by-step conversation instead of one long sentence —
  // whatever's said at each step fills in the next missing field, in order:
  // CN number → vendor → amount → payment → (emirate → driver, only if not locked
  // on the Daily Entry page).
  type AddItemDraft = {
    cnNo?: number;
    vendor?: Vendor;
    total?: number;
    payment?: "CASH" | "BANK";
    emirate?: string;
    employee?: Employee;
  };
  type AddItemStep = "cn" | "vendor" | "amount" | "payment" | "emirate" | "driver";
  const [addItemDraft, setAddItemDraft] = useState<AddItemDraft | null>(null);
  const [addItemStep, setAddItemStep] = useState<AddItemStep | null>(null);

  function nextMissingStep(draft: AddItemDraft, locked: boolean): AddItemStep | null {
    if (!draft.cnNo) return "cn";
    if (!draft.vendor) return "vendor";
    if (draft.total === undefined) return "amount";
    if (!draft.payment) return "payment";
    if (!locked) {
      if (!draft.emirate) return "emirate";
      if (!draft.employee) return "driver";
    }
    return null;
  }

  const STEP_PROMPTS: Record<AddItemStep, string> = {
    cn: "What's the CN number?",
    vendor: "Which vendor?",
    amount: "What's the amount?",
    payment: "Cash or bank?",
    emirate: "Which emirate?",
    driver: "Which driver?",
  };

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  function speak(text: string) {
    try {
      if (!("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1;
      utterance.volume = 1;
      window.speechSynthesis.speak(utterance);
    } catch {
      // unsupported/blocked — silently skip
    }
  }

  function getAudioCtx(): AudioContext | null {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      if (ctx.state === "suspended") ctx.resume();
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
  function playChaChing() {
    const ctx = getAudioCtx();
    if (!ctx) return;
    tone(ctx, 1200, 0, 0.08, "square");
    tone(ctx, 1600, 0.06, 0.15, "square");
  }
  function playPop() {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(300, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(700, ctx.currentTime + 0.09);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.09);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.14);
  }

  async function parseVoiceCommand(transcript: string): Promise<ParsedCommand> {
    const lower = transcript.toLowerCase();

    if (/\bundo\b/.test(lower)) return { kind: "undo" };

    // "balance of <name>" / "final balance of <name>" / "cash closing of <name>" —
    // checked before the general question block since it needs a name, not just a
    // keyword. Checks drivers first, then agents.
    const balanceMatch = lower.match(/(?:final\s+)?(?:balance|cash closing)\s+of\s+([a-z]+)/);
    if (balanceMatch) {
      const spokenName = balanceMatch[1].trim();
      const res = await apiFetch<DashboardSummary>("/dashboard/daily");
      const driverRow = fuzzyFindByName(res.employeeBreakdown, spokenName, (r) => r.employee.name);
      if (driverRow) return { kind: "question", answer: `${driverRow.employee.name}'s cash closing balance is ${driverRow.cashBalance} AED.` };
      const agentRow = fuzzyFindByName(res.agentBreakdown, spokenName, (r) => r.employee.name);
      if (agentRow) return { kind: "question", answer: `${agentRow.employee.name}'s balance is ${agentRow.cashBalance} AED.` };
      return { kind: "unrecognized", raw: `No driver or agent found matching "${spokenName}"` };
    }

    // "new entries of <agent>" / "agent balance of <agent>" — today's new
    // consignments for that specific agent.
    const agentEntryMatch = lower.match(/(?:new entr(?:y|ies)|agent)\s+(?:of|for)?\s*([a-z]+)/);
    if (agentEntryMatch && /agent|new entr/.test(lower)) {
      const spokenName = agentEntryMatch[1].trim();
      const today = new Date().toISOString().slice(0, 10);
      const res = await apiFetch<{ rows: { agentName: string; count: number; totalAmount: number }[] }>("/agent-credit/new-entries", { query: { date: today } });
      const row = fuzzyFindByName(res.rows, spokenName, (r) => r.agentName);
      if (!row) return { kind: "question", answer: `No new entries for ${spokenName} today.` };
      return { kind: "question", answer: `${row.agentName} has ${row.count} new entries today, totaling ${row.totalAmount} AED.` };
    }

    if (
      /how many pending/.test(lower) ||
      /how many delivered/.test(lower) ||
      /how many transferred/.test(lower) ||
      /how many cancelled/.test(lower) ||
      /how much cash/.test(lower) ||
      /how much bank/.test(lower) ||
      /how many consignment/.test(lower)
    ) {
      const res = await apiFetch<DashboardSummary>("/dashboard/daily");
      if (/pending/.test(lower)) {
        // Matches exactly what's shown on screen: summary.pending PLUS carried-over
        // backlog from previous days, excluding agents (same rule the Dashboard
        // itself uses) — a plain summary.pending alone undercounts what's visible.
        const carryover = await apiFetch<{ orders: PendingCarryoverOrder[] }>("/orders/pending-carryover");
        const agentIds = new Set(res.agentBreakdown.map((r) => r.employee.id));
        const nonAgentCarryover = carryover.orders.filter((o) => !agentIds.has(o.employeeId));
        const total = res.summary.pending + nonAgentCarryover.length;
        return { kind: "question", answer: `There are ${total} pending orders today.` };
      }
      if (/delivered/.test(lower)) return { kind: "question", answer: `${res.summary.delivered} orders delivered today.` };
      if (/transferred/.test(lower)) return { kind: "question", answer: `${res.summary.transferred} orders transferred today.` };
      if (/cancelled/.test(lower)) return { kind: "question", answer: `${res.summary.cancelled} orders cancelled today.` };
      if (/cash/.test(lower)) return { kind: "question", answer: `${res.summary.cashCollected} AED collected in cash today.` };
      if (/bank/.test(lower)) return { kind: "question", answer: `${res.summary.bankCollected} AED collected via bank today.` };
      return { kind: "question", answer: `${res.summary.totalOrders} total consignments today.` };
    }

    // Vendor name captured non-greedily up to the first digit, then everything from
    // there onward is treated as the amount and stripped to digits — same fix as
    // above, for numbers speech-to-text splits apart (e.g. "200" -> "2 00").
    const payMatch = lower.match(/pay\s+(?:vendor\s+)?(.+?)\s+(\d.*)/);
    if (payMatch) {
      const spokenName = payMatch[1].trim();
      const amountDigits3 = payMatch[2].replace(/[^\d]/g, "");
      if (!amountDigits3) return { kind: "unrecognized", raw: `Heard "pay ${spokenName}" but no amount` };
      const amount = Number(amountDigits3);
      const vendors = await apiFetch<Vendor[]>("/vendors");
      const vendor = fuzzyFindByName(vendors, spokenName, (v) => v.name);
      if (!vendor) return { kind: "unrecognized", raw: `Vendor "${spokenName}" not found` };
      return { kind: "vendorPayment", vendor, amount, description: `Pay ${vendor.name} ${amount} AED` };
    }

    // "log expense <category> <amount> [for <driver name>]"
    if (/\b(log|add)\s+expense\b/.test(lower)) {
      const CATEGORY_WORDS: { spoken: string; value: string }[] = [
        { spoken: "fuel", value: "FUEL" },
        { spoken: "insurance", value: "INSURANCE" },
        { spoken: "salary", value: "SALARY" },
        { spoken: "workshop", value: "WORKSHOP" },
        { spoken: "car wash", value: "CAR_WASH" },
        { spoken: "room rent", value: "ROOM_RENT" },
        { spoken: "car rent", value: "CAR_RENT" },
        { spoken: "stationary", value: "STATIONARY" },
        { spoken: "parking", value: "PARKING" },
        { spoken: "visa", value: "VISA" },
        { spoken: "medical", value: "MEDICAL" },
        { spoken: "commission", value: "COMMISSION" },
        { spoken: "darb", value: "DARB" },
        { spoken: "salik", value: "SALIK" },
        { spoken: "internet", value: "INTERNET" },
        { spoken: "license", value: "LICENSE" },
        { spoken: "other", value: "OTHER" },
      ];
      const category = CATEGORY_WORDS.find((c) => lower.includes(c.spoken))?.value;
      if (!category) return { kind: "unrecognized", raw: `Heard "expense" but no known category — try fuel, salary, parking, etc.` };
      // Capture everything after the category word up to "for" (or end), then strip
      // to just digits — handles split/garbled numbers from speech-to-text.
      const categoryWord = CATEGORY_WORDS.find((c) => lower.includes(c.spoken))!.spoken;
      const afterCategory = lower.slice(lower.indexOf(categoryWord) + categoryWord.length);
      const amountSection = afterCategory.split(/\s+for\s+/)[0];
      const amountDigits2 = amountSection.replace(/[^\d]/g, "");
      if (!amountDigits2) return { kind: "unrecognized", raw: `Heard "${category}" expense but no amount` };
      const amount = Number(amountDigits2);

      let employee: Employee | undefined;
      const driverMatch2 = lower.match(/for\s+(?:driver\s+)?([a-z]+)/);
      if (driverMatch2) {
        const spokenDriver = driverMatch2[1].trim();
        const employees = await apiFetch<Employee[]>("/employees");
        employee = fuzzyFindByName(employees, spokenDriver, (e) => e.name);
        // Silently dropping a driver name that didn't match would log the expense
        // with no attribution at all — tell the admin exactly what went wrong instead.
        if (!employee) return { kind: "unrecognized", raw: `Heard "for ${spokenDriver}" but no matching driver found` };
      }

      return {
        kind: "expense",
        category,
        amount,
        employee,
        description: `Expense — ${category.replace("_", " ")}, ${amount} AED${employee ? `, ${employee.name}` : ""}`,
      };
    }

    // "change <cn> to <amount>"
    // Everything after "to" is captured raw, then stripped down to just its digits
    // — handles speech-to-text quirks like "change 66774 to becomes 2 500" (a stray
    // word and a split-up number), correctly reading it as amount 2500.
    // Very loose matching between the key words — tolerates filler like "the",
    // "please", etc. that speech-to-text often inserts (e.g. "change the amount to").
    const changeMatch = lower.match(/(\d{3,7}).*?change.*?amount.*?to\s+(.+)/);
    if (changeMatch) {
      const cnNo = Number(changeMatch[1]);
      const amountDigits = changeMatch[2].replace(/[^\d]/g, "");
      if (!amountDigits) return { kind: "unrecognized", raw: `Heard "change amount" for CN ${cnNo} but no amount number` };
      const newAmount = Number(amountDigits);
      const orderRes = await apiFetch<{ orders: Order[] }>("/orders", { query: { cn: cnNo } });
      const order = orderRes.orders[0];
      if (!order) return { kind: "unrecognized", raw: `CN ${cnNo} not found` };
      return { kind: "amountEdit", order, newAmount, description: `Change CN ${cnNo} amount to ${newAmount} AED` };
    }

    // "add new item" is handled separately as a multi-step conversation (see
    // addItemDraft state below) rather than parsed here as a single sentence.

    const cnMatch = transcript.match(/\d{3,7}/);
    const cnNo = cnMatch ? Number(cnMatch[0]) : null;
    if (!cnNo) return { kind: "unrecognized", raw: transcript };

    const orderRes = await apiFetch<{ orders: Order[] }>("/orders", { query: { cn: cnNo } });
    const order = orderRes.orders[0];
    if (!order) return { kind: "unrecognized", raw: `CN ${cnNo} not found` };

    const transferMatch = lower.match(/transfer\s*(?:to)?\s+([a-z]+)/);
    if (transferMatch) {
      const spokenName = transferMatch[1].trim();
      const employees = await apiFetch<Employee[]>("/employees");
      const toEmployee = fuzzyFindByName(employees.filter((e) => e.id !== order.employeeId), spokenName, (e) => e.name);
      if (!toEmployee) return { kind: "unrecognized", raw: `Driver "${spokenName}" not found` };
      return { kind: "transfer", order, toEmployee, description: `Transfer CN ${cnNo} to ${toEmployee.name}` };
    }

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

  async function executeCommand(cmd: ParsedCommand) {
    if (cmd.kind === "update") {
      const prevStatus = cmd.order.status;
      const prevPayment = cmd.order.payment;
      if ((cmd.payment ?? cmd.order.payment) !== cmd.order.payment) {
        await apiFetch(`/orders/${cmd.order.id}/payment`, { method: "PATCH", body: { payment: cmd.payment } });
      }
      await apiFetch(`/orders/${cmd.order.id}/status`, { method: "PATCH", body: { status: cmd.status ?? cmd.order.status, reason: cmd.reason } });
      showToast(cmd.description);
      if (cmd.status === "DELIVERED") playChaChing();
      else playPop();
      setLastAction({
        description: cmd.description,
        undo: async () => {
          if (prevPayment !== cmd.order.payment) await apiFetch(`/orders/${cmd.order.id}/payment`, { method: "PATCH", body: { payment: prevPayment } });
          await apiFetch(`/orders/${cmd.order.id}/status`, { method: "PATCH", body: { status: prevStatus } });
          showToast(`Undone — CN ${cmd.order.cnNo} restored`);
        },
      });
    } else if (cmd.kind === "transfer") {
      await apiFetch(`/orders/${cmd.order.id}/transfer`, { method: "POST", body: { toEmployeeId: cmd.toEmployee.id } });
      showToast(cmd.description);
      playPop();
      setLastAction({
        description: cmd.description,
        undo: async () => {
          await apiFetch(`/orders/${cmd.order.id}/transfer`, { method: "POST", body: { toEmployeeId: cmd.order.employeeId } });
          showToast(`Undone — CN ${cmd.order.cnNo} transferred back`);
        },
      });
    } else if (cmd.kind === "vendorPayment") {
      const today = new Date().toISOString().slice(0, 10);
      const payment = await apiFetch<{ id: string }>(`/vendor-credit/${cmd.vendor.id}/payments`, {
        method: "POST",
        body: { date: today, amount: cmd.amount },
      });
      showToast(`Logged ${cmd.amount} AED payment to ${cmd.vendor.name}`);
      playChaChing();
      setLastAction({
        description: cmd.description,
        undo: async () => {
          await apiFetch(`/vendor-credit/payments/${payment.id}`, { method: "DELETE" });
          showToast(`Undone — payment to ${cmd.vendor.name} removed`);
        },
      });
    } else if (cmd.kind === "expense") {
      const today = new Date().toISOString().slice(0, 10);
      const entry = await apiFetch<{ id: string }>("/expenses", {
        method: "POST",
        body: { date: today, category: cmd.category, amount: cmd.amount, employeeId: cmd.employee?.id },
      });
      showToast(cmd.description);
      playChaChing();
      setLastAction({
        description: cmd.description,
        undo: async () => {
          await apiFetch(`/expenses/${entry.id}`, { method: "DELETE" });
          showToast(`Undone — expense removed`);
        },
      });
    } else if (cmd.kind === "amountEdit") {
      const prevTotal = cmd.order.total;
      await apiFetch(`/orders/${cmd.order.id}`, { method: "PUT", body: { total: cmd.newAmount } });
      showToast(cmd.description);
      playPop();
      setLastAction({
        description: cmd.description,
        undo: async () => {
          await apiFetch(`/orders/${cmd.order.id}`, { method: "PUT", body: { total: prevTotal } });
          showToast(`Undone — CN ${cmd.order.cnNo} amount restored to ${prevTotal}`);
        },
      });
    } else if (cmd.kind === "addItem") {
      const today = new Date().toISOString().slice(0, 10);
      const order = await apiFetch<Order>("/orders", {
        method: "POST",
        body: {
          date: today,
          cnNo: cmd.cnNo,
          vendorId: cmd.vendor.id,
          payment: cmd.payment,
          emirate: cmd.emirate,
          employeeId: cmd.employee.id,
          total: cmd.total,
        },
      });
      showToast(cmd.description);
      playChaChing();
      setLastAction({
        description: cmd.description,
        undo: async () => {
          await apiFetch(`/orders/${order.id}`, { method: "DELETE" });
          showToast(`Undone — CN ${cmd.cnNo} removed`);
        },
      });
    }
  }

  async function confirmPendingCommand() {
    if (!pendingCommand || pendingCommand.kind === "question" || pendingCommand.kind === "undo" || pendingCommand.kind === "unrecognized") return;
    await executeCommand(pendingCommand);
    setPendingCommand(null);
    setAssistantHeard(null);
  }

  function cancelPendingCommand() {
    setPendingCommand(null);
    setAssistantHeard(null);
    showToast("Cancelled");
  }

  const voiceAssistant = useVoiceAssistant(async (transcript) => {
    setAssistantHeard(transcript);
    const lower = transcript.toLowerCase();

    // Shared by both the initial trigger and every follow-up step: apply the
    // Daily Entry lock (if any), figure out what's still missing, and either ask
    // for the next field or finalize into a Confirm card once everything's filled.
    async function advanceAddItem(draft: AddItemDraft) {
      let locked = false;
      try {
        const lockRaw = localStorage.getItem("dailyEntryLock");
        const lock = lockRaw ? JSON.parse(lockRaw) : null;
        if (lock?.locked) {
          locked = true;
          if (!draft.emirate) draft.emirate = lock.emirate;
          if (!draft.employee) {
            const employees = await apiFetch<Employee[]>("/employees");
            draft.employee = employees.find((e) => e.id === lock.employeeId);
          }
        }
      } catch {
        // no lock available — fall through, will ask for emirate/driver directly
      }

      const next = nextMissingStep(draft, locked);
      if (next) {
        setAddItemDraft(draft);
        setAddItemStep(next);
        speak(STEP_PROMPTS[next]);
        setTimeout(() => voiceAssistant.start(), 1500);
        return;
      }

      setAddItemDraft(null);
      setAddItemStep(null);
      const finalCmd: ParsedCommand = {
        kind: "addItem",
        cnNo: draft.cnNo!,
        vendor: draft.vendor!,
        total: draft.total!,
        payment: draft.payment!,
        emirate: draft.emirate!,
        employee: draft.employee!,
        description: `New item — CN ${draft.cnNo}, ${draft.vendor!.name}, ${draft.total} AED, ${draft.payment}, ${draft.emirate}, ${draft.employee!.name}`,
      };
      setPendingCommand(finalCmd);
      speak(`${finalCmd.description}. Confirm?`);
      setTimeout(() => voiceAssistant.start(), 1800);
    }

    // Mid-conversation: this utterance answers whichever field we just asked for.
    if (addItemDraft && addItemStep) {
      const draft = { ...addItemDraft };
      if (addItemStep === "cn") {
        const m = transcript.match(/\d{3,7}/);
        if (!m) {
          showToast("Didn't catch a CN number — try again");
          setTimeout(() => voiceAssistant.start(), 1200);
          return;
        }
        draft.cnNo = Number(m[0]);
      } else if (addItemStep === "vendor") {
        const spoken = lower.trim();
        const vendors = await apiFetch<Vendor[]>("/vendors");
        const vendor = fuzzyFindByName(vendors, spoken, (v) => v.name);
        if (!vendor) {
          showToast(`Vendor "${transcript}" not found — try again`);
          setTimeout(() => voiceAssistant.start(), 1200);
          return;
        }
        draft.vendor = vendor;
      } else if (addItemStep === "amount") {
        const digits = transcript.replace(/[^\d]/g, "");
        if (!digits) {
          showToast("Didn't catch an amount — try again");
          setTimeout(() => voiceAssistant.start(), 1200);
          return;
        }
        draft.total = Number(digits);
      } else if (addItemStep === "payment") {
        if (/\bbank\b/.test(lower)) draft.payment = "BANK";
        else if (/\bcash\b/.test(lower)) draft.payment = "CASH";
        else {
          showToast('Say "cash" or "bank"');
          setTimeout(() => voiceAssistant.start(), 1200);
          return;
        }
      } else if (addItemStep === "emirate") {
        const match = EMIRATES.find((em) => lower.includes(em.toLowerCase()));
        if (!match) {
          showToast(`Emirate "${transcript}" not recognized — try again`);
          setTimeout(() => voiceAssistant.start(), 1200);
          return;
        }
        draft.emirate = match;
      } else if (addItemStep === "driver") {
        const spoken = lower.trim();
        const employees = await apiFetch<Employee[]>("/employees");
        const employee = fuzzyFindByName(employees, spoken, (e) => e.name);
        if (!employee) {
          showToast(`Driver "${transcript}" not found — try again`);
          setTimeout(() => voiceAssistant.start(), 1200);
          return;
        }
        draft.employee = employee;
      }
      await advanceAddItem(draft);
      return;
    }

    // First utterance of a new "add new item" — grab whatever's already said in
    // this same sentence (e.g. "add new item 56999 vendor Inspired"), then ask
    // for only what's still missing, one field at a time from here on. Checked
    // after pendingCommand so an in-progress yes/no confirmation always wins.
    if (!pendingCommand && /\b(add new item|add order|new order|new item)\b/.test(lower)) {
      const draft: AddItemDraft = {};
      const cnMatch2 = transcript.match(/\d{3,7}/);
      if (cnMatch2) draft.cnNo = Number(cnMatch2[0]);
      const vendorMatch = lower.match(/vendor\s+([a-z0-9 ]+?)(?:\s+amount|\s+cash|\s+bank|\s+emirate|\s+driver|\s+for|$)/);
      if (vendorMatch) {
        const vendors = await apiFetch<Vendor[]>("/vendors");
        const spoken = vendorMatch[1].trim();
        draft.vendor = fuzzyFindByName(vendors, spoken, (v) => v.name);
      }
      const amountMatch = lower.match(/amount\s+(.+?)(?:\s+cash|\s+bank|\s+emirate|\s+driver|\s+for|$)/);
      const amountDigits = amountMatch?.[1]?.replace(/[^\d]/g, "");
      if (amountDigits) draft.total = Number(amountDigits);
      if (/\bbank\b/.test(lower)) draft.payment = "BANK";
      else if (/\bcash\b/.test(lower)) draft.payment = "CASH";

      await advanceAddItem(draft);
      return;
    }

    if (pendingCommand) {
      if (/\b(yes|confirm|correct|do it)\b/.test(lower)) {
        confirmPendingCommand();
      } else if (/\b(no|cancel|stop)\b/.test(lower)) {
        cancelPendingCommand();
      } else {
        showToast(`Didn't catch a yes or no — tap Confirm or Cancel instead`);
      }
      return;
    }

    const cmd = await parseVoiceCommand(transcript);

    if (cmd.kind === "question") {
      speak(cmd.answer);
      showToast(cmd.answer);
      setTimeout(() => setAssistantHeard(null), 3000);
      return;
    }
    if (cmd.kind === "undo") {
      if (lastAction) {
        lastAction.undo();
        setLastAction(null);
      } else {
        showToast("Nothing to undo");
      }
      setTimeout(() => setAssistantHeard(null), 3000);
      return;
    }
    if (cmd.kind === "unrecognized") {
      showToast(cmd.raw);
      setTimeout(() => setAssistantHeard(null), 3000);
      return;
    }

    setPendingCommand(cmd);
    speak(`${cmd.description}. Confirm?`);
    setTimeout(() => voiceAssistant.start(), 1800);
  });

  // If the current page has an #assistant-anchor element (right now, only the
  // Dashboard page does, next to its "Operations Dashboard" heading), render the
  // button there via a portal instead of the floating corner position. Re-checked
  // on every route change since the anchor only exists on some pages.
  const pathname = usePathname();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setAnchorEl(document.getElementById("assistant-anchor"));
  }, [pathname]);

  if (!voiceAssistant.supported) return null;

  const triggerButton = (
    <button
      onClick={voiceAssistant.start}
      title='Voice assistant — say something like "56678 delivered bank" or "how many pending"'
      className={`flex items-center justify-center rounded-full text-2xl shadow-lg transition ${
        anchorEl ? "h-9 w-9 text-xl" : "fixed right-4 top-20 z-40 h-12 w-12"
      } ${voiceAssistant.listening ? "animate-pulse bg-cancelled text-white" : "bg-navy text-paper hover:bg-navy-2"}`}
    >
      🌐
    </button>
  );

  return (
    <>
      {anchorEl ? createPortal(triggerButton, anchorEl) : triggerButton}

      {/* Live listening / heard panel — separate from the confirm card, always in
          the same spot so it's easy to glance at. Animates a "waveform" while
          actively listening, then fades into showing the transcript once heard. */}
      {(voiceAssistant.listening || assistantHeard) && !pendingCommand && (
        <div className="fixed left-1/2 top-4 z-50 w-72 -translate-x-1/2 rounded-lg border-2 border-brass bg-navy px-4 py-3 text-paper shadow-2xl">
          {voiceAssistant.listening ? (
            <div className="flex items-center gap-3">
              <div className="flex items-end gap-0.5 h-5">
                {[0, 1, 2, 3, 4].map((i) => (
                  <span
                    key={i}
                    className="w-1 rounded-full bg-brass"
                    style={{
                      animation: `voice-wave 0.9s ease-in-out infinite`,
                      animationDelay: `${i * 0.12}s`,
                    }}
                  />
                ))}
              </div>
              <span className="font-mono text-xs uppercase tracking-wide text-brass-light">Listening…</span>
            </div>
          ) : (
            assistantHeard && (
              <div style={{ animation: "assistant-reveal 0.35s ease-out" }}>
                <p className="mb-0.5 font-mono text-[9px] uppercase tracking-wide text-brass-light">Heard</p>
                <p className="text-sm">&quot;{assistantHeard}&quot;</p>
              </div>
            )
          )}
        </div>
      )}

      {pendingCommand && (
        <div className="fixed left-1/2 top-4 z-50 w-72 -translate-x-1/2 rounded border border-brass bg-white p-4 shadow-xl">
          <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-ink-soft">Confirm action</p>
          <p className="mb-3 text-sm font-semibold text-navy">
            {pendingCommand.kind === "update" ||
            pendingCommand.kind === "transfer" ||
            pendingCommand.kind === "vendorPayment" ||
            pendingCommand.kind === "expense" ||
            pendingCommand.kind === "amountEdit" ||
            pendingCommand.kind === "addItem"
              ? pendingCommand.description
              : ""}
          </p>
          <div className="flex gap-2">
            <button onClick={confirmPendingCommand} className="flex-1 rounded bg-delivered px-3 py-2 font-mono text-[10px] uppercase text-white hover:opacity-90">
              ✓ Confirm
            </button>
            <button onClick={cancelPendingCommand} className="flex-1 rounded border border-line px-3 py-2 font-mono text-[10px] uppercase text-ink-soft hover:border-cancelled">
              ✗ Cancel
            </button>
          </div>
          <p className="mt-2 text-[10px] text-ink-soft">Or just say &quot;yes&quot; or &quot;confirm&quot;</p>
        </div>
      )}

      {addItemStep && (
        <div className="fixed left-1/2 top-4 z-50 w-72 -translate-x-1/2 rounded border border-brass bg-navy p-4 text-paper shadow-xl">
          <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-brass-light">New Item — Step by Step</p>
          <p className="mb-2 text-sm font-semibold">{STEP_PROMPTS[addItemStep]}</p>
          <div className="space-y-0.5 font-mono text-[10px] text-line">
            {addItemDraft?.cnNo && <p>CN: {addItemDraft.cnNo}</p>}
            {addItemDraft?.vendor && <p>Vendor: {addItemDraft.vendor.name}</p>}
            {addItemDraft?.total !== undefined && <p>Amount: {addItemDraft.total} AED</p>}
            {addItemDraft?.payment && <p>Payment: {addItemDraft.payment}</p>}
            {addItemDraft?.emirate && <p>Emirate: {addItemDraft.emirate}</p>}
            {addItemDraft?.employee && <p>Driver: {addItemDraft.employee.name}</p>}
          </div>
          <button
            onClick={() => {
              setAddItemDraft(null);
              setAddItemStep(null);
              showToast("New item cancelled");
            }}
            className="mt-3 w-full rounded border border-white/25 px-3 py-1.5 font-mono text-[10px] uppercase text-line hover:border-brass-light hover:text-white"
          >
            ✗ Cancel
          </button>
        </div>
      )}

      {lastAction && !pendingCommand && !assistantHeard && (
        <button
          onClick={() => {
            lastAction.undo();
            setLastAction(null);
          }}
          className="fixed right-4 top-36 z-30 rounded border border-line bg-white px-3 py-1.5 font-mono text-[10px] uppercase text-ink-soft shadow hover:border-cancelled"
        >
          ↺ Undo: {lastAction.description}
        </button>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 max-w-xs rounded border-l-2 border-brass bg-navy px-5 py-3 font-mono text-xs text-paper shadow-lg">
          {toast}
        </div>
      )}
    </>
  );
}
