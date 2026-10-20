"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, ApiClientError } from "@/lib/api";
import { fmtNumber, todayStr, agingDays, agingBadgeClass } from "@/lib/format";
import { useSocketEvent } from "@/lib/useSocketEvent";
import { CashClosing, Employee, Order, OrderStatus, STATUSES, Vendor, Summary as SharedSummary } from "@/types";
import StatusDoughnut from "@/components/charts/StatusDoughnut";
import LiveFlowPanel from "@/components/LiveFlowPanel";
import OrderDetails from "@/components/OrderDetails";
import BarcodeScanner, { beep, pickClashChoice } from "@/components/BarcodeScanner";
import { DEFAULT_AREA_ROUTE, detectArea } from "@/lib/areas";
import PrepaidBadge, { isPrepaid } from "@/components/PrepaidBadge";

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

/** UAE number → WhatsApp format (9715XXXXXXXX). */
function waNumber(phone: string) {
  const d = phone.replace(/[^0-9]/g, "");
  if (d.startsWith("00")) return d.slice(2);
  if (d.startsWith("971")) return d;
  if (d.startsWith("0")) return "971" + d.slice(1);
  return "971" + d;
}

/** Pre-filled "delivering today" WhatsApp message for the customer. */
function customerWaLink(o: Order) {
  const b = o.booking!;
  const name = /customer\s*·|^ew customer/i.test(b.customerName) ? "" : ` ${b.customerName}`;
  const payLine = isPrepaid(o)
    ? "💵 Payment: *Already paid* — nothing to pay on delivery"
    : `💵 Amount: *AED ${o.total}*\n_Cash only — card payment is not accepted_`;
  const text = [
    `Hello${name},`,
    "",
    `This is *Future Courier*. Your order from *${o.brandName}* is out for delivery today.`,
    "",
    `📦 CN: *${o.cnNo}*`,
    payLine,
    "",
    "📍 Kindly share your location here so our driver can reach you easily.",
    "",
    "Thank you,",
    "The Future Courier Service L.L.C",
  ].join("\n");
  return `https://wa.me/${waNumber(b.customerPhone)}?text=${encodeURIComponent(text)}`;
}

/** Notes like "urgent", "deliver tomorrow must", "ASAP", "before 5pm" — the card turns red. */
const URGENT_RE =
  /\b(urgent\w*|asap|emergency|immediate(ly)?|priority|important|vip|today\s*itself|same\s*day|must|tomorrow|tmrw|tmw|before\s*\d{1,2}\s*(am|pm|:)?|by\s*\d{1,2}\s*(am|pm))\b|ضروري|عاجل/i;
const isUrgent = (o: Order) => (o.status === "PENDING" || o.status === "TRANSFER") && URGENT_RE.test(o.booking?.notes ?? "");

/** Area of a parcel: driver's choice first, otherwise guessed from the address. */
const areaOf = (o: Order) => o.area || detectArea(o.booking?.address, o.emirate);

type AreaGroup = { key: string; area: string; emirate: string; orders: Order[] };

/** Group parcels by emirate + area; the driver's saved route order wins, then biggest area first.
 *  Inside an area, parcels follow the driver's dragged order (parcelOrder), new ones at the end. */
function groupByArea(list: Order[], savedOrder: string[], parcelOrder: string[] = []): AreaGroup[] {
  const map = new Map<string, AreaGroup>();
  for (const o of list) {
    const area = areaOf(o);
    const key = `${o.emirate}|${area}`;
    const g = map.get(key) ?? { key, area, emirate: o.emirate, orders: [] };
    g.orders.push(o);
    map.set(key, g);
  }
  const rank = (k: string) => {
    const i = savedOrder.indexOf(k);
    if (i >= 0) return i;
    // By area name too, so a parcel saved with emirate "OTHER" still follows the route.
    let d = DEFAULT_AREA_ROUTE.indexOf(k);
    if (d < 0) d = DEFAULT_AREA_ROUTE.findIndex((r) => r.endsWith(`|${k.split("|")[1]}`));
    return d >= 0 ? savedOrder.length + d : Number.MAX_SAFE_INTEGER;
  };
  const pRank = (id: string) => {
    const i = parcelOrder.indexOf(id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  for (const g of map.values()) g.orders = g.orders.map((o, i) => ({ o, i })).sort((a, b) => pRank(a.o.id) - pRank(b.o.id) || a.i - b.i).map((x) => x.o);
  return Array.from(map.values()).sort(
    (a, b) => rank(a.key) - rank(b.key) || a.emirate.localeCompare(b.emirate) || b.orders.length - a.orders.length || a.area.localeCompare(b.area)
  );
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
  // "By area" search: pick an area from suggestions (no spelling mistakes) → only its parcels.
  const [areaFilter, setAreaFilter] = useState("");
  const [areaTyped, setAreaTyped] = useState("");
  const [areaSuggestOpen, setAreaSuggestOpen] = useState(false);
  const [transferOrder, setTransferOrder] = useState<Order | null>(null);
  const [statusOrder, setStatusOrder] = useState<Order | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [claimOpen, setClaimOpen] = useState(false);
  const [statusScanOpen, setStatusScanOpen] = useState(false);
  const [view, setViewState] = useState<"list" | "area">("list");
  // "By area" is its own page (#areas), so the phone's Back button returns to the list.
  useEffect(() => {
    const sync = () => setViewState(window.location.hash === "#areas" ? "area" : "list");
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  function setView(v: "list" | "area") {
    if (v === "area" && window.location.hash !== "#areas") window.history.pushState(null, "", "#areas");
    else if (v === "list" && window.location.hash === "#areas") window.history.pushState(null, "", window.location.pathname + window.location.search);
    setViewState(v);
    window.scrollTo(0, 0);
  }
  const [fromScan, setFromScan] = useState(false);
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
  const [achievement, setAchievement] = useState<{ title: string; subtitle: string; milestone: number } | null>(null);
  const prevMonthlyDeliveredRef = useRef<number | null>(null);

  function showAchievement(title: string, subtitle: string, milestone: number) {
    setAchievement({ title, subtitle, milestone });
    setTimeout(() => setAchievement(null), 8000);
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
          showAchievement("Century Club", `${m} deliveries this month`, m);
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

  // Area page: its own To deliver / Done / All switch and area search.
  const [areaTab, setAreaTab] = useState<"OPEN" | "DONE" | "ALL">("OPEN");
  const [noteOpenId, setNoteOpenId] = useState<string | null>(null);
  const areaBase = useMemo(
    () =>
      orders.filter((o) =>
        areaTab === "ALL" ? true : areaTab === "OPEN" ? o.status === "PENDING" || o.status === "TRANSFER" : o.status === "DELIVERED" || o.status === "CANCELLED"
      ),
    [orders, areaTab]
  );
  const areaFiltered = useMemo(() => (areaFilter ? areaBase.filter((o) => areaOf(o) === areaFilter) : areaBase), [areaBase, areaFilter]);

  // Area view: group the driver's parcels by emirate + area (from the address), biggest area first.
  const [areaOrder, setAreaOrder] = useState<string[]>([]);
  useEffect(() => {
    try {
      setAreaOrder(JSON.parse(localStorage.getItem("driverAreaOrder") || "[]"));
    } catch {
      /* ignore */
    }
  }, []);
  // Driver's own delivery order of parcels inside each area (drag ⠿ to change, saved on this phone).
  const [parcelOrder, setParcelOrder] = useState<string[]>([]);
  useEffect(() => {
    try {
      setParcelOrder(JSON.parse(localStorage.getItem("driverParcelOrder") || "[]"));
    } catch {
      /* ignore */
    }
  }, []);
  const areaGroups = useMemo(() => groupByArea(areaFiltered, areaOrder, parcelOrder), [areaFiltered, areaOrder, parcelOrder]);

  /** Quick "not delivered" note on a parcel (tap the same one again to clear). */
  async function setDriverNote(o: Order, note: string) {
    const next = o.driverNote === note ? "" : note;
    setOrders((prev) => prev.map((x) => (x.id === o.id ? { ...x, driverNote: next || null, driverNoteAt: next ? new Date().toISOString() : null } : x)));
    try {
      await apiFetch(`/driver/orders/${o.id}/note`, { method: "PATCH", body: { note: next } });
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not save the note", "info");
      load();
    }
  }
  const dragRef = useRef<{ id: string; group: string; ids: string[]; y: number } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  function saveParcelOrder(ids: string[]) {
    // Keep only parcels the driver still has, so the list doesn't grow forever.
    const live = new Set(orders.map((o) => o.id));
    const next = ids.filter((id) => live.has(id));
    try {
      localStorage.setItem("driverParcelOrder", JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  function startDrag(e: React.PointerEvent, g: AreaGroup, id: string) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { id, group: g.key, ids: g.orders.map((o) => o.id), y: e.clientY };
    setDraggingId(id);
  }
  function moveDrag(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    // Auto-scroll near the top/bottom edge of the screen.
    if (e.clientY < 80) window.scrollBy(0, -12);
    else if (e.clientY > window.innerHeight - 80) window.scrollBy(0, 12);
    const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-drag-group]");
    if (!hit || hit.dataset.dragGroup !== d.group || hit.dataset.id === d.id) return;
    const r = hit.getBoundingClientRect();
    const target = hit.dataset.id!;
    const ids = d.ids.filter((x) => x !== d.id);
    let at = ids.indexOf(target);
    if (e.clientY > r.top + r.height / 2) at += 1;
    ids.splice(at, 0, d.id);
    if (ids.join() === d.ids.join()) return;
    d.ids = ids;
    // Put this area's new order in front; other areas keep theirs.
    setParcelOrder((prev) => [...ids, ...prev.filter((x) => !ids.includes(x))]);
  }
  function endDrag() {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDraggingId(null);
    setParcelOrder((prev) => {
      saveParcelOrder(prev);
      return prev;
    });
  }
  const [areaEdit, setAreaEdit] = useState<Order | null>(null);

  /** Move an area up/down in the driver's route order (saved on this phone). */
  function moveArea(key: string, dir: -1 | 1) {
    const shown = areaGroups.map((g) => g.key);
    const i = shown.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= shown.length) return;
    [shown[i], shown[j]] = [shown[j], shown[i]];
    // Keep the order of areas not on screen (other tab / search) too.
    const keys = [...shown, ...areaOrder.filter((k) => !shown.includes(k))];
    setAreaOrder(keys);
    try {
      localStorage.setItem("driverAreaOrder", JSON.stringify(keys));
    } catch {
      /* ignore */
    }
  }

  async function changeArea(o: Order, area: string) {
    try {
      await apiFetch(`/driver/orders/${o.id}/area`, { method: "PATCH", body: { area } });
      setOrders((list) => list.map((x) => (x.id === o.id ? { ...x, area: area ? area.toUpperCase() : null } : x)));
      showToast(area ? `CN ${o.cnNo} moved to ${area.toUpperCase()}` : `CN ${o.cnNo} back to automatic area`, "info");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not change area", "info");
    }
  }

  const renderCard = (o: Order) => (
            <div
              key={o.id}
              className={`flex flex-wrap items-center justify-between gap-3.5 rounded border border-l-4 p-4 ${
                isUrgent(o) ? "border-cancelled bg-cancelled-bg ring-2 ring-cancelled" : `border-line bg-white ${statusBorderClass(o.status)}`
              }`}
            >
              <div>
                <div className="font-mono text-[15px] font-bold text-navy">
                  CN {o.cnNo} <span className="font-normal text-ink-soft">— {o.brandName}</span>
                </div>
                {isUrgent(o) && (
                  <div className="mt-1 rounded bg-cancelled px-2 py-1 text-sm font-bold text-white">🚨 URGENT — {o.booking?.notes}</div>
                )}
                {isPrepaid(o) && <PrepaidBadge large />}
                {o.booking && (
                  <div className="mt-1 text-sm">
                    👤 <b>{o.booking.customerName}</b> · <span className="font-mono">{o.booking.customerPhone}</span>
                  </div>
                )}
                <button
                  onClick={() => setAreaEdit(o)}
                  className="mt-1 rounded border border-navy/30 bg-paper px-2 py-0.5 font-mono text-[11px] font-bold uppercase text-navy hover:border-brass"
                  title="Change area"
                >
                  📍 {areaOf(o)} ✎
                </button>
                <div className="mt-1 text-xs text-ink-soft">
                  Total <b className="text-ink">{fmtNumber(o.total)} AED</b> · DL Charge <b className="text-ink">{fmtNumber(o.deliveryCharge)} AED</b> · <span className="font-semibold text-ink">{o.payment}</span> · {o.emirate}
                </div>
                {o.remarks && (
                  <div className="mt-1 text-xs text-cancelled">
                    Reason: {o.remarks}
                  </div>
                )}
                {o.driverNote && (o.status === "PENDING" || o.status === "TRANSFER") && (
                  <div className="mt-1 text-xs font-semibold text-pending">
                    🚚 {o.driverNote}
                    {o.driverNoteAt ? ` · ${new Date(o.driverNoteAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ""}
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
                  onClick={() => setDetailsId(detailsId === o.id ? null : o.id)}
                  className={`rounded border px-3 py-1.5 font-mono text-[10.5px] font-bold uppercase tracking-wide hover:-translate-y-px ${
                    detailsId === o.id ? "border-navy bg-navy text-paper" : "border-navy text-navy"
                  }`}
                >
                  {detailsId === o.id ? "Hide details" : "Details"}
                </button>
                <button
                  onClick={() => setStatusOrder(o)}
                  className="rounded border border-line px-3 py-1.5 font-mono text-[10.5px] font-bold uppercase tracking-wide text-ink-soft hover:-translate-y-px"
                >
                  Update Status
                </button>
              </div>
              {detailsId === o.id && (
                <div className="w-full basis-full border-t border-line pt-3">
                  <OrderDetails booking={o.booking} cnNo={o.cnNo} vendorName={o.brandName} total={o.total} compact waHref={o.booking ? customerWaLink(o) : undefined} />
                </div>
              )}
            </div>
);

  // ── Global voice assistant ──────────────────────────────────────────────────
  // Parses a full spoken command and either answers immediately (questions), or
  // stages a Confirm/Cancel step before touching any data (updates, transfers,
  // vendor payments) — reduces risk from a misheard word or number. A single
  // "undo last" reverses whichever confirmed action ran most recently.
  type ParsedCommand =
    | { kind: "update"; order: Order; status?: OrderStatus; payment?: "CASH" | "BANK"; reason?: string; description: string }
    | { kind: "transfer"; order: Order; toEmployee: Employee; description: string }
    | { kind: "vendorPayment"; vendor: Vendor; amount: number; description: string }
    | { kind: "search"; cnNo: number }
    | { kind: "needsCancelReason"; order: Order }
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

    // "<cn> delivered/pending/cancelled [reason], [cash/bank]" — or just a plain
    // number, which is treated as a search (same as the old mic-search button).
    if (!cnNo) return { kind: "unrecognized", raw: transcript };

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

    // No recognized action keyword — plain CN number, so just search for it.
    if (!status && !payment) return { kind: "search", cnNo };

    const order = orders.find((o) => o.cnNo === cnNo);
    if (!order) return { kind: "unrecognized", raw: `CN ${cnNo} not found in today's orders` };

    // Said "cancel" with no reason attached — ask for it via a follow-up listen,
    // instead of failing outright.
    if (status === "CANCELLED" && !reason) return { kind: "needsCancelReason", order };

    const parts = [`CN ${cnNo}`];
    if (status) parts.push(status + (reason ? ` (${reason})` : ""));
    if (payment) parts.push(payment);
    return { kind: "update", order, status, payment, reason, description: parts.join(" — ") };
  }

  // Undo stays available for only 5 seconds after an action, then auto-clears —
  // a brief safety window, not a persistent button sitting on screen.
  function setLastActionWithExpiry(action: { description: string; undo: () => Promise<void> }) {
    setLastAction(action);
    setTimeout(() => {
      setLastAction((curr) => (curr === action ? null : curr));
    }, 5000);
  }

  async function executeCommand(cmd: ParsedCommand, bankPaymentConfirmed?: boolean) {
    if (cmd.kind === "update") {
      const prevStatus = cmd.order.status;
      const prevPayment = cmd.order.payment;
      const prevBankConfirmed = cmd.order.bankPaymentConfirmed;
      await updateStatus(cmd.order, cmd.status ?? cmd.order.status, cmd.payment ?? cmd.order.payment, cmd.reason, bankPaymentConfirmed);
      setLastActionWithExpiry({
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
      setLastActionWithExpiry({
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
      setLastActionWithExpiry({
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
  // Awaiting a spoken reason after "cancel" was said with nothing following it.
  const [awaitingCancelReason, setAwaitingCancelReason] = useState<Order | null>(null);

  const voiceAssistant = useVoiceAssistant(async (transcript) => {
    setAssistantHeard(transcript);
    const lower = transcript.toLowerCase();

    if (awaitingCancelReason) {
      const order = awaitingCancelReason;
      setAwaitingCancelReason(null);
      const reason = transcript.trim();
      await executeCommand({ kind: "update", order, status: "CANCELLED", reason, description: `CN ${order.cnNo} — CANCELLED (${reason})` });
      setTimeout(() => setAssistantHeard(null), 2000);
      return;
    }

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
    if (cmd.kind === "search") {
      setSearch(String(cmd.cnNo));
      showToast(`Searching CN ${cmd.cnNo}`, "info");
      setTimeout(() => setAssistantHeard(null), 2000);
      return;
    }
    if (cmd.kind === "needsCancelReason") {
      setAwaitingCancelReason(cmd.order);
      speak("What's the reason?");
      setTimeout(() => voiceAssistant.start(), 1500);
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

  const OPEN_NOTES = ["No answer", "Phone off", "Wrong address", "Customer asked tomorrow", "Shop closed", "Will call back"];
  /** Google Maps directions through the parcels in order (Maps takes up to 10 stops per link). */
  const routeLinks = (list: Order[]) => {
    const stops = list
      .filter((o) => o.status === "PENDING" || o.status === "TRANSFER")
      .map((o) => (o.booking?.address ? `${o.booking.address}, ${o.emirate}, UAE` : null))
      .filter((x): x is string => !!x);
    const links: { href: string; from: number; to: number }[] = [];
    for (let i = 0; i < stops.length; i += 10) {
      const part = stops.slice(i, i + 10);
      const dest = part[part.length - 1];
      const way = part.slice(0, -1);
      links.push({
        href: `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${encodeURIComponent(dest)}${way.length ? `&waypoints=${encodeURIComponent(way.join("|"))}` : ""}`,
        from: i + 1,
        to: i + part.length,
      });
    }
    return links;
  };

  const areaPage = (
    <div>
      <div className="sticky top-0 z-30 mb-3 flex items-center gap-3 rounded bg-navy px-3 py-2.5 text-paper shadow">
        <button onClick={() => setView("list")} className="rounded border border-white/40 px-2.5 py-1 font-mono text-xs uppercase">
          ← Back
        </button>
        <span className="font-display text-lg font-semibold">📍 By area</span>
        <span className="ml-auto text-right font-mono text-[11px] uppercase text-brass-light">
          {areaFiltered.length} parcel{areaFiltered.length === 1 ? "" : "s"} · AED {fmtNumber(areaFiltered.reduce((t, o) => t + o.total, 0))}
        </span>
      </div>

      <button
        onClick={() => setStatusScanOpen(true)}
        className="mb-3 flex w-full items-center justify-center gap-2 rounded bg-brass px-4 py-3 font-mono text-sm font-bold uppercase tracking-wide text-white shadow hover:opacity-90"
      >
        📷 Scan to deliver
      </button>

      <div className="mb-3 grid grid-cols-3 gap-1 rounded border border-line bg-white p-1">
        {([
          ["OPEN", "To deliver"],
          ["DONE", "Done"],
          ["ALL", "All"],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setAreaTab(k)}
            className={`rounded py-1.5 font-mono text-[11px] font-bold uppercase ${areaTab === k ? "bg-navy text-paper" : "text-ink-soft"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {(
        <div className="relative mb-3">
          <div className="flex items-center gap-2">
            <input
              value={areaFilter || areaTyped}
              onChange={(e) => {
                setAreaFilter("");
                setAreaTyped(e.target.value);
                setAreaSuggestOpen(true);
              }}
              onFocus={() => setAreaSuggestOpen(true)}
              placeholder="🔎 Search area… (tap a suggestion)"
              className={`w-full rounded border-2 px-3 py-2 text-sm uppercase ${areaFilter ? "border-navy bg-navy/5 font-bold text-navy" : "border-line"}`}
            />
            {(areaFilter || areaTyped) && (
              <button
                onClick={() => {
                  setAreaFilter("");
                  setAreaTyped("");
                  setAreaSuggestOpen(false);
                }}
                className="shrink-0 rounded border border-line bg-white px-3 py-2 text-sm text-ink-soft"
              >
                ✕ All areas
              </button>
            )}
          </div>
          {areaSuggestOpen && !areaFilter && (() => {
            const counts = new Map<string, number>();
            for (const o of areaBase) counts.set(areaOf(o), (counts.get(areaOf(o)) ?? 0) + 1);
            const t = areaTyped.trim().toUpperCase().replace(/^AL\s+/, "");
            const list = Array.from(counts.entries())
              .filter(([a]) => !t || a.toUpperCase().includes(t))
              .sort((x, y) => (t && x[0].startsWith(t) ? -1 : 0) - (t && y[0].startsWith(t) ? -1 : 0) || x[0].localeCompare(y[0]));
            return (
              <div className="absolute left-0 right-0 z-30 mt-1 max-h-64 overflow-y-auto rounded border border-line bg-white p-2 shadow-lg">
                {list.length === 0 ? (
                  <p className="px-1 py-1 text-sm text-ink-soft">No parcels in an area like “{areaTyped}”.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {list.map(([a, n]) => (
                      <button
                        key={a}
                        onClick={() => {
                          setAreaFilter(a);
                          setAreaTyped("");
                          setAreaSuggestOpen(false);
                        }}
                        className="rounded-full border border-navy/30 bg-paper px-3 py-1.5 font-mono text-[11px] font-bold uppercase text-navy hover:border-brass"
                      >
                        📍 {a} <span className="text-ink-soft">({n})</span>
                      </button>
                    ))}
                  </div>
                )}
                <button onClick={() => setAreaSuggestOpen(false)} className="mt-2 w-full text-center text-xs text-ink-soft underline">
                  Close
                </button>
              </div>
            );
          })()}
        </div>
      )}

      {areaGroups.length === 0 ? (
        <div className="rounded border border-line bg-white py-14 text-center text-ink-soft">
          <div className="mb-1 font-display text-lg text-navy">{areaTab === "OPEN" ? "All delivered 🎉" : "Nothing here"}</div>
          {areaTab === "OPEN" ? "No parcels left to deliver." : "No parcels match."}
        </div>
      ) : (
        <div className="space-y-5">
          {areaGroups.map((g, gi) => {
            const routes = routeLinks(g.orders);
            return (
              <section key={g.key} className="space-y-2.5">
                <div className="rounded bg-white px-3 py-2 shadow-sm ring-1 ring-line">
                  <div className="flex items-center gap-2">
                    <span className="font-display text-base font-bold text-navy">
                      {gi + 1}. {g.area}
                    </span>
                    <span className="font-mono text-[10px] uppercase text-ink-soft">{g.emirate}</span>
                    <span className="ml-auto flex gap-1">
                      <button onClick={() => moveArea(g.key, -1)} disabled={gi === 0} className="rounded border border-line px-1.5 text-xs disabled:opacity-30" title="Move area up">
                        ▲
                      </button>
                      <button onClick={() => moveArea(g.key, 1)} disabled={gi === areaGroups.length - 1} className="rounded border border-line px-1.5 text-xs disabled:opacity-30" title="Move area down">
                        ▼
                      </button>
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] uppercase text-ink-soft">
                      {g.orders.length} parcel{g.orders.length === 1 ? "" : "s"} · AED {fmtNumber(g.orders.reduce((t, o) => t + o.total, 0))}
                    </span>
                    <span className="ml-auto flex flex-wrap gap-1.5">
                      {routes.map((r) => (
                        <a
                          key={r.href}
                          href={r.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded bg-delivered px-2.5 py-1 font-mono text-[10.5px] font-bold uppercase text-white"
                        >
                          🗺 Route{routes.length > 1 ? ` ${r.from}–${r.to}` : ""}
                        </a>
                      ))}
                    </span>
                  </div>
                </div>
                {g.orders.map((o, oi) => (
                  <div
                    key={o.id}
                    data-drag-group={g.key}
                    data-id={o.id}
                    className={`flex items-stretch gap-1.5 transition-shadow ${draggingId === o.id ? "relative z-20 scale-[1.01] opacity-90 shadow-xl ring-2 ring-brass" : ""}`}
                  >
                    <button
                      type="button"
                      onPointerDown={(e) => startDrag(e, g, o.id)}
                      onPointerMove={moveDrag}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                      style={{ touchAction: "none" }}
                      className="flex w-8 shrink-0 cursor-grab select-none flex-col items-center justify-center gap-1 rounded border border-line bg-paper-2 text-ink-soft active:cursor-grabbing active:bg-brass/20"
                      title="Hold and drag to change delivery order"
                      aria-label={`Drag to reorder, position ${oi + 1}`}
                    >
                      <span className="font-mono text-[11px] font-bold text-navy">{oi + 1}</span>
                      <span className="text-lg leading-none">⠿</span>
                    </button>
                    <div className="min-w-0 flex-1">
                      {renderCard(o)}
                      {(o.status === "PENDING" || o.status === "TRANSFER") && (
                        noteOpenId !== o.id ? (
                          <button
                            onClick={() => setNoteOpenId(o.id)}
                            className="w-full rounded-b border border-t-0 border-line bg-paper px-3 py-1.5 text-left font-mono text-[10.5px] uppercase text-ink-soft"
                          >
                            {o.driverNote ? "✎ Change note" : "📝 Not delivered? add a note"}
                          </button>
                        ) : (
                        <div className="flex flex-wrap items-center gap-1 rounded-b border border-t-0 border-line bg-paper px-2 py-1.5">
                          {OPEN_NOTES.map((n) => (
                            <button
                              key={n}
                              onClick={() => {
                                setDriverNote(o, n);
                                setNoteOpenId(null);
                              }}
                              className={`rounded-full border px-2 py-0.5 text-[11px] ${o.driverNote === n ? "border-pending bg-pending text-white" : "border-line bg-white text-ink-soft"}`}
                            >
                              {n}
                            </button>
                          ))}
                          <button
                            onClick={() => {
                              const t = window.prompt("Note for this parcel:", o.driverNote && !OPEN_NOTES.includes(o.driverNote) ? o.driverNote : "");
                              if (t !== null) setDriverNote({ ...o, driverNote: null }, t.trim());
                              setNoteOpenId(null);
                            }}
                            className={`rounded-full border px-2 py-0.5 text-[11px] ${
                              o.driverNote && !OPEN_NOTES.includes(o.driverNote) ? "border-pending bg-pending text-white" : "border-line bg-white text-ink-soft"
                            }`}
                          >
                            {o.driverNote && !OPEN_NOTES.includes(o.driverNote) ? `✎ ${o.driverNote}` : "✎ Other"}
                          </button>
                          <button onClick={() => setNoteOpenId(null)} className="ml-auto px-1 text-sm text-ink-soft" aria-label="Close">
                            ✕
                          </button>
                        </div>
                        )
                      )}
                    </div>
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );


  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {awaitingBankConfirm ? (
        <div className="fixed bottom-24 right-4 z-50 max-w-[220px] rounded border border-pending bg-pending-bg px-3 py-2.5 text-xs shadow-lg">
          <span className="font-semibold text-pending">Is the payment received?</span> Say &quot;yes&quot; or &quot;no&quot;.
        </div>
      ) : awaitingCancelReason ? (
        <div className="fixed bottom-24 right-4 z-50 max-w-[220px] rounded border border-cancelled bg-cancelled-bg px-3 py-2.5 text-xs shadow-lg">
          <span className="font-semibold text-cancelled">What&apos;s the reason?</span> Just say it now.
        </div>
      ) : (
        assistantHeard && (
          <div className="fixed bottom-24 right-4 z-40 max-w-[200px] rounded border border-brass bg-white px-3 py-2 text-xs shadow-lg">
            <span className="font-mono text-[10px] uppercase text-ink-soft">Heard:</span> &quot;{assistantHeard}&quot;
          </div>
        )
      )}
      {lastAction && !awaitingBankConfirm && !awaitingCancelReason && (
        <button
          onClick={() => {
            lastAction.undo();
            setLastAction(null);
          }}
          className="fixed bottom-24 right-4 z-30 rounded border border-line bg-white px-3 py-1.5 font-mono text-[10px] uppercase text-ink-soft shadow hover:border-cancelled"
          style={{ display: assistantHeard ? "none" : undefined }}
        >
          ↺ Undo: {lastAction.description}
        </button>
      )}

      {view === "area" ? (
        areaPage
      ) : (
        <>
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

      <button
        onClick={() => setClaimOpen(true)}
        className="mb-4 flex w-full items-center justify-center gap-2 rounded bg-brass px-4 py-3.5 font-mono text-sm font-bold uppercase tracking-wide text-white shadow hover:opacity-90"
      >
        📦 Assign order — scan barcode
      </button>


      <button
        onClick={() => setView("area")}
        className="mb-3 flex w-full items-center justify-between rounded border-2 border-navy bg-white px-4 py-3 font-mono text-sm font-bold uppercase tracking-wide text-navy shadow-sm hover:bg-paper-2"
      >
        <span>📍 By area — route, notes, reorder</span>
        <span className="text-lg">›</span>
      </button>
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
          <button
            onClick={() => setStatusScanOpen(true)}
            title="Scan a label to update its status"
            className="flex h-9 items-center justify-center gap-1 rounded-full bg-brass px-3 font-mono text-[11px] font-bold uppercase text-white shadow hover:opacity-90"
          >
            📷 Scan
          </button>
          {voiceAssistant.supported && (
            <button
              onClick={voiceAssistant.start}
              title="Voice assistant — say a CN number to search, or add a command like 'delivered bank'"
              className={`flex h-9 w-9 items-center justify-center rounded-full text-lg shadow transition ${
                voiceAssistant.listening ? "animate-pulse bg-cancelled text-white" : "bg-navy text-paper hover:bg-navy-2"
              }`}
            >
              🌐
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
          {filtered.map((o) => renderCard(o))}
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

      {isShowingYesterday && (
        <p className="mb-2 rounded border border-pending bg-pending-bg px-3 py-2 text-xs text-pending">
          Showing yesterday&apos;s ({cashClosingDate}) cash closing — still available until 10 AM.
        </p>
      )}
      <CashClosingPanel date={cashClosingDate} readOnly={isShowingYesterday} onSubmitted={() => showToast("Cash closing submitted", "success")} />
        </>
      )}

      {claimOpen && (
        <ClaimModal
          onClose={() => {
            setClaimOpen(false);
            load();
          }}
        />
      )}

      {areaEdit && (
        <AreaPickerModal
          order={areaEdit}
          areas={Array.from(new Set([...orders.map(areaOf), ...areaGroups.map((g) => g.area)])).sort()}
          onClose={() => setAreaEdit(null)}
          onPick={async (area) => {
            const o = areaEdit;
            setAreaEdit(null);
            await changeArea(o, area);
          }}
        />
      )}

      {statusScanOpen && (
        <StatusScanModal
          orders={orders}
          onClose={() => setStatusScanOpen(false)}
          onFound={(o) => {
            setStatusScanOpen(false);
            setFromScan(true);
            setStatusOrder(o);
          }}
          onClaim={() => {
            setStatusScanOpen(false);
            setClaimOpen(true);
          }}
        />
      )}

      {transferOrder && <TransferModal order={transferOrder} onClose={() => setTransferOrder(null)} onDone={() => { setTransferOrder(null); load(); }} />}

      {statusOrder && (
        <StatusModal
          order={statusOrder}
          onClose={() => {
            setStatusOrder(null);
            setFromScan(false);
          }}
          onTransfer={() => {
            setTransferOrder(statusOrder);
            setStatusOrder(null);
            setFromScan(false);
          }}
          onConfirm={async (status, payment, reason, bankPaymentConfirmed) => {
            await updateStatus(statusOrder, status, payment, reason, bankPaymentConfirmed);
            setStatusOrder(null);
            // Came from a scan → straight back to the scanner for the next parcel.
            if (fromScan) setStatusScanOpen(true);
            setFromScan(false);
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
            <a
              href={`https://wa.me/?text=${encodeURIComponent(
                `🏆 ${orders[0]?.employee.name ?? "A driver"} just hit ${achievement.milestone} deliveries this month with Future Courier! 🎉`
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-2 rounded border border-brass-light px-2.5 py-1.5 font-mono text-[10px] uppercase text-brass-light hover:bg-white/10"
            >
              📤 Share
            </a>
          </div>
        </div>
      )}
    </div>
  );
}


/** Driver picks (or types) the right area for a parcel; "Automatic" goes back to the guessed one. */
function AreaPickerModal({ order, areas, onClose, onPick }: { order: Order; areas: string[]; onClose: () => void; onPick: (area: string) => void }) {
  const [typed, setTyped] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-lg bg-white p-4 sm:rounded-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-navy">📍 Area for CN {order.cnNo}</h2>
          <button onClick={onClose} className="text-2xl leading-none text-ink-soft">
            ×
          </button>
        </div>
        {order.booking?.address && <p className="mb-3 text-sm text-ink-soft">{order.booking.address}</p>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (typed.trim()) onPick(typed.trim());
          }}
          className="mb-3 flex gap-2"
        >
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type new area…" className="flex-1 rounded border border-line px-3 py-2 text-sm uppercase" autoFocus />
          <button type="submit" className="rounded bg-navy px-3 py-2 font-mono text-xs uppercase text-paper">
            Set
          </button>
        </form>
        <div className="flex flex-wrap gap-1.5">
          {areas.map((a) => (
            <button key={a} onClick={() => onPick(a)} className="rounded border border-line px-2.5 py-1.5 font-mono text-[11px] font-bold uppercase hover:border-brass">
              {a}
            </button>
          ))}
        </div>
        {order.area && (
          <button onClick={() => onPick("")} className="mt-3 text-xs text-brass underline">
            Reset to automatic ({detectArea(order.booking?.address, order.emirate)})
          </button>
        )}
      </div>
    </div>
  );
}

/** Scan a label (or type the CN) → opens Update Status for that consignment. */
function StatusScanModal({
  orders,
  onClose,
  onFound,
  onClaim,
}: {
  orders: Order[];
  onClose: () => void;
  onFound: (o: Order) => void;
  onClaim: () => void;
}) {
  const [error, setError] = useState<{ text: string; id: number } | null>(null);

  function onCode(raw: string) {
    const code = raw.trim();
    if (!code) return;
    const n = Number(code);
    const o =
      orders.find((x) => Number.isFinite(n) && x.cnNo === n) ??
      orders.find((x) => x.booking?.vendorRef && x.booking.vendorRef === code);
    if (o) {
      beep(true);
      onFound(o);
    } else {
      beep(false);
      setError({ text: `${code} is not in your list.`, id: Date.now() });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-lg bg-white p-5 sm:rounded-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold text-navy">📷 Scan to update status</h2>
          <button onClick={onClose} className="text-2xl leading-none text-ink-soft">
            ×
          </button>
        </div>
        <p className="mb-3 text-sm text-ink-soft">Scan the parcel label (or type the CN). The status screen opens for that parcel.</p>
        <BarcodeScanner onCode={onCode} autoCamera lastResult={error ? { ...error, tone: "bad" } : null} />
        {error && (
          <div className="mt-3 rounded border border-cancelled bg-cancelled-bg px-3 py-2 text-sm text-cancelled">
            Not your parcel?
            <button onClick={onClaim} className="ml-2 font-bold underline">
              Assign it to me
            </button>
          </div>
        )}
      </div>
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
  const [selected, setSelected] = useState<OrderStatus | null>(order.status);
  const [payment, setPayment] = useState<"CASH" | "BANK">(order.payment);
  const [bankPaymentConfirmed, setBankPaymentConfirmed] = useState(order.bankPaymentConfirmed ?? false);
  const [reason, setReason] = useState(order.status === "CANCELLED" ? order.remarks ?? "" : "");
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
        {isPrepaid(order) && <PrepaidBadge large />}
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


// Driver scans parcels to take them. Each good scan becomes one of his Pending
// orders straight away; only the office can remove or move an order afterwards.
function ClaimModal({ onClose }: { onClose: () => void }) {
  const [log, setLog] = useState<{ ok: boolean; already?: boolean; text: string; at: Date }[]>([]);

  async function onCode(code: string, confirm = false, vendorId?: string): Promise<void> {
    try {
      const r = await apiFetch<{ result: "ACCEPTED" | "REASSIGNED" | "ALREADY"; message: string }>("/driver/scan-claim", {
        method: "POST",
        body: { code, ...(vendorId ? { vendorId } : {}), ...(confirm ? { confirm: true } : {}) },
      });
      beep(r.result !== "ALREADY");
      setLog((prev) => [{ ok: true, already: r.result === "ALREADY", text: r.message, at: new Date() }, ...prev]);
    } catch (err) {
      // Matched only by the vendor's own bill No. — show what it is and ask.
      if (!confirm && err instanceof ApiClientError && (err.details as { code?: string } | undefined)?.code === "CONFIRM_SCAN") {
        beep(true);
        if (window.confirm(err.message)) return onCode(code, true, vendorId);
        setLog((prev) => [{ ok: false, text: `Skipped — ${err.message}`, at: new Date() }, ...prev]);
        return;
      }
      // Same number is our CN and a vendor bill No. — ask which one.
      const pick = !vendorId ? pickClashChoice(err) : undefined;
      if (pick) return onCode(code, confirm, pick);
      beep(false);
      setLog((prev) => [{ ok: false, text: pick === null ? `Skipped — ${code}` : err instanceof Error ? err.message : "Failed", at: new Date() }, ...prev]);
    }
  }

  const added = log.filter((l) => l.ok && !l.already).length;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-lg bg-white p-5 sm:rounded-lg">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold text-navy">Assign orders to me</h2>
          <span className="rounded bg-delivered-bg px-2 py-1 font-mono text-xs font-bold text-delivered">{added} added</span>
        </div>
        <p className="mb-4 text-sm text-ink-soft">Scan each parcel&apos;s barcode. It is added to your Pending list straight away.</p>

        <BarcodeScanner
          onCode={(c) => onCode(c)}
          autoCamera
          lastResult={log[0] ? { text: log[0].text, tone: !log[0].ok ? "bad" : log[0].already ? "warn" : "ok", id: log[0].at.getTime() } : null}
        />

        <div className="mt-4 space-y-1.5">
          {log.map((l, i) => (
            <div
              key={i}
              className={`rounded border px-3 py-2 text-sm ${
                !l.ok ? "border-cancelled bg-cancelled-bg text-cancelled" : l.already ? "border-line bg-paper text-ink-soft" : "border-delivered bg-delivered-bg text-delivered"
              }`}
            >
              {l.ok ? (l.already ? "• " : "✓ ") : "✕ "}
              {l.text}
            </div>
          ))}
        </div>

        <button onClick={onClose} className="mt-5 w-full rounded bg-navy px-4 py-3 font-mono text-xs uppercase tracking-wide text-paper">
          Done
        </button>
      </div>
    </div>
  );
}
