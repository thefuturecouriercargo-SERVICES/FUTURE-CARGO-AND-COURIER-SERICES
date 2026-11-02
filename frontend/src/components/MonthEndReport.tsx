"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { fmtNumber } from "@/lib/format";
import { detectArea } from "@/lib/areas";
import { toast } from "@/components/ui/Feedback";

/**
 * Month-end TEAM report — shared with the whole team on WhatsApp, so there are
 * no money figures at all: consignment movement, RTO, driver achievements,
 * problems, tasks and wishes. The four note sections are prefilled from the
 * numbers and can be edited before the PDF is made (kept per month in this
 * browser).
 */

interface Stats {
  orders: number;
  delivered: number;
  cancelled: number;
  pending: number;
  rtoPct: number;
}
interface Summary extends Stats {
  agentOrders: number;
  agentDelivered: number;
  agentCancelled: number;
  vendorCount: number;
  activeDays: number;
}
type Driver = { name: string; days: number } & Stats;
interface MonthEnd {
  month: string;
  prevMonth: string;
  current: Summary;
  previous: Summary;
  vendors: ({ name: string } & Stats)[];
  drivers: Driver[];
  prevDrivers: { name: string; delivered: number; rtoPct: number }[];
  days: ({ date: string } & Stats)[];
  emirates: ({ name: string } & Stats)[];
  areaRows: [string, string, string, string][];
}
type AreaStat = { name: string; orders: number; delivered: number; cancelled: number; rtoPct: number };
type Notes = { achievements: string; problems: string; tasks: string; wishes: string };

const NOTE_SECTIONS: { key: keyof Notes; title: string; hint: string }[] = [
  { key: "achievements", title: "Achievements", hint: "One per line" },
  { key: "problems", title: "Problems & issues", hint: "One per line" },
  { key: "tasks", title: "Tasks for next month", hint: "One per line" },
  { key: "wishes", title: "Wishes & message to the team", hint: "Free text" },
];

function monthName(m: string) {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}
function nextMonthName(m: string) {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo, 1)).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
}
function dayLabel(d: string) {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}
const success = (s: Stats) => {
  const f = s.delivered + s.cancelled;
  return f ? Math.round((s.delivered / f) * 1000) / 10 : 0;
};
const pctChange = (now: number, before: number) => (before ? Math.round(((now - before) / Math.abs(before)) * 100) : null);
const titleCase = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
/** jsPDF's built-in font only knows Latin text — keep names printable. */
const pdfSafe = (s: string) => s.replace(/[^\x20-\x7E -ÿ—–]/g, "").trim() || "-";

function areaStats(rows: MonthEnd["areaRows"]): AreaStat[] {
  const m = new Map<string, AreaStat>();
  for (const [chosen, address, emirate, st] of rows) {
    const name = chosen || detectArea(address, emirate);
    const a = m.get(name) ?? { name, orders: 0, delivered: 0, cancelled: 0, rtoPct: 0 };
    a.orders++;
    if (st === "D") a.delivered++;
    if (st === "C") a.cancelled++;
    m.set(name, a);
  }
  for (const a of m.values()) {
    const f = a.delivered + a.cancelled;
    a.rtoPct = f ? Math.round((a.cancelled / f) * 1000) / 10 : 0;
  }
  return [...m.values()].filter((a) => a.name !== "NO ADDRESS" && a.name !== "OTHER AREA").sort((a, b) => b.orders - a.orders);
}

/** Highlights worked out from the numbers. */
function highlights(d: MonthEnd, areas: AreaStat[]) {
  const c = d.current;
  const p = d.previous;
  const active = d.drivers.filter((x) => x.delivered > 0);
  const top = active[0] ?? null;
  const avgFinished = active.length ? active.reduce((s, x) => s + x.delivered + x.cancelled, 0) / active.length : 0;
  const minFinished = Math.max(20, Math.round(avgFinished * 0.5));
  const sharpest =
    [...active].filter((x) => x.name !== top?.name && x.delivered + x.cancelled >= minFinished).sort((a, b) => success(b) - success(a) || b.delivered - a.delivered)[0] ?? null;
  const prevBy = new Map(d.prevDrivers.map((x) => [x.name, x]));
  const improved =
    active
      .filter((x) => x.name !== top?.name && x.name !== sharpest?.name && prevBy.has(x.name))
      .map((x) => ({ ...x, gain: x.delivered - (prevBy.get(x.name)?.delivered ?? 0) }))
      .filter((x) => x.gain > 0)
      .sort((a, b) => b.gain - a.gain)[0] ?? null;
  const busiest = [...d.days].sort((a, b) => b.orders - a.orders)[0] ?? null;
  const bestDelivery = [...d.days].sort((a, b) => b.delivered - a.delivered)[0] ?? null;
  const finished = (s: { delivered: number; cancelled: number }) => s.delivered + s.cancelled;
  const vendorWatch = d.vendors.filter((v) => finished(v) >= 20 && v.rtoPct >= 20).sort((a, b) => b.rtoPct - a.rtoPct).slice(0, 3);
  const hotspots = areas.filter((a) => finished(a) >= 10 && a.rtoPct > 0).sort((a, b) => b.rtoPct - a.rtoPct).slice(0, 5);
  const totalMoved = c.orders + c.agentOrders;
  const prevMoved = p.orders + p.agentOrders;
  return { top, sharpest, improved, busiest, bestDelivery, vendorWatch, hotspots, totalMoved, prevMoved, areasServed: areas.length };
}

function defaultNotes(d: MonthEnd, h: ReturnType<typeof highlights>): Notes {
  const c = d.current;
  const p = d.previous;
  const monthOnly = monthName(d.month).split(" ")[0];
  const next = nextMonthName(d.month);
  const ach: string[] = [];
  if (h.top) ach.push(`Driver of the Month: ${h.top.name} — ${fmtNumber(h.top.delivered)} parcels delivered with a ${success(h.top)}% success rate.`);
  if (h.sharpest) ach.push(`Cleanest record: ${h.sharpest.name} — ${success(h.sharpest)}% of finished parcels delivered.`);
  if (h.improved) ach.push(`Most improved: ${h.improved.name} — ${fmtNumber(h.improved.gain)} more deliveries than last month.`);
  const growth = pctChange(h.totalMoved, h.prevMoved);
  ach.push(`The team moved ${fmtNumber(h.totalMoved)} consignments${growth !== null && growth > 0 ? ` — up ${growth}% on last month` : ""}.`);
  if (p.rtoPct && c.rtoPct < p.rtoPct) ach.push(`RTO came down from ${p.rtoPct}% to ${c.rtoPct}%. Great work!`);
  if (h.bestDelivery && h.bestDelivery.delivered > 0) ach.push(`Best delivery day: ${dayLabel(h.bestDelivery.date)} with ${fmtNumber(h.bestDelivery.delivered)} delivered.`);
  ach.push(`We served ${fmtNumber(c.vendorCount)} vendors across ${fmtNumber(h.areasServed)} areas.`);

  const prob: string[] = [];
  if (p.rtoPct && c.rtoPct > p.rtoPct) prob.push(`RTO went up from ${p.rtoPct}% to ${c.rtoPct}% — ${fmtNumber(c.cancelled)} parcels came back.`);
  else if (c.cancelled) prob.push(`${fmtNumber(c.cancelled)} parcels came back as RTO (${c.rtoPct}%).`);
  if (c.pending) prob.push(`${fmtNumber(c.pending)} parcels from ${monthOnly} are still pending.`);
  if (h.hotspots.length) prob.push(`Most returns in: ${h.hotspots.slice(0, 3).map((a) => `${a.name} (${a.rtoPct}%)`).join(", ")}.`);
  if (h.vendorWatch.length) prob.push(`High RTO from vendors: ${h.vendorWatch.map((v) => `${v.name} (${v.rtoPct}%)`).join(", ")}.`);

  const tasks: string[] = [];
  if (c.pending) tasks.push(`Close all ${fmtNumber(c.pending)} pending parcels from ${monthOnly} this week.`);
  if (h.hotspots.length) tasks.push(`Call customers before going out in ${h.hotspots.slice(0, 3).map((a) => a.name).join(", ")}.`);
  if (h.vendorWatch.length) tasks.push(`Speak with ${h.vendorWatch.map((v) => v.name).join(", ")} about confirming orders before booking.`);
  tasks.push(`Bring RTO below ${Math.max(5, Math.floor(c.rtoPct) - 2)}% in ${next}.`);
  tasks.push("Scan every consignment at pickup and at delivery — no skipped scans.");
  tasks.push("Update every status the same day, with a clear reason for each RTO.");

  const wishes =
    `Thank you, team! Together we moved ${fmtNumber(h.totalMoved)} consignments in ${monthOnly} — every delivery counts and every one of you made it happen.` +
    (h.top ? ` A special congratulations to ${h.top.name}, our Driver of the Month!` : "") +
    ` Let's make ${next} even better — drive safe, call ahead, and deliver with a smile.`;

  return { achievements: ach.join("\n"), problems: prob.join("\n"), tasks: tasks.join("\n"), wishes };
}

const notesKey = (m: string) => `monthEndTeamNotes:${m}`;
function loadNotes(m: string): Notes | null {
  try {
    const raw = window.localStorage.getItem(notesKey(m));
    return raw ? (JSON.parse(raw) as Notes) : null;
  } catch {
    return null;
  }
}
function saveNotes(m: string, n: Notes) {
  try {
    window.localStorage.setItem(notesKey(m), JSON.stringify(n));
  } catch {
    /* storage unavailable — notes just won't be remembered */
  }
}

async function loadLogo(): Promise<string | null> {
  try {
    const blob = await (await fetch("/fc-icon-512.png")).blob();
    return await new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(typeof r.result === "string" ? r.result : null);
      r.onerror = () => res(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- PDF ---- */

type RGB = [number, number, number];
const NAVY: RGB = [10, 16, 32];
const NAVY2: RGB = [24, 34, 60];
const GOLD: RGB = [212, 175, 90];
const GOLD_SOFT: RGB = [248, 241, 222];
const GREEN: RGB = [22, 128, 61];
const RED: RGB = [190, 45, 45];
const AMBER: RGB = [205, 135, 25];
const GREY: RGB = [110, 112, 125];
const PAPER: RGB = [248, 247, 243];

async function buildPdf(d: MonthEnd, areas: AreaStat[], h: ReturnType<typeof highlights>, notes: Notes) {
  const [{ jsPDF }, autoTableMod, logo] = await Promise.all([import("jspdf"), import("jspdf-autotable"), loadLogo()]);
  const autoTable = autoTableMod.default;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const c = d.current;
  const p = d.previous;
  const mn = monthName(d.month);
  const L = 14;
  const W = 182;
  const BOTTOM = 280;
  let y = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lastY = () => ((doc as any).lastAutoTable?.finalY ?? y) as number;
  const ensure = (need: number) => {
    if (y + need > BOTTOM) {
      doc.addPage();
      y = 22;
    }
  };
  const lines = (text: string) =>
    text
      .split("\n")
      .map((s) => pdfSafe(s.replace(/^[-•*\s]+/, "")))
      .filter((s) => s && s !== "-");

  const star = (cx: number, cy: number, r: number, color: RGB) => {
    const pts: [number, number][] = [];
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 ? r * 0.45 : r;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      pts.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]);
    }
    const segs = pts.slice(1).map((pt, i) => [pt[0] - pts[i][0], pt[1] - pts[i][1]]);
    doc.setFillColor(...color);
    doc.lines(segs, pts[0][0], pts[0][1], [1, 1], "F", true);
  };

  // Leave room for the heading plus a few rows, so a heading is never stranded at a page bottom.
  const sectionTitle = (title: string, sub?: string) => {
    ensure(34);
    doc.setFillColor(...GOLD);
    doc.rect(L, y, 3, 7, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(...NAVY);
    doc.text(title, L + 6, y + 5.6);
    if (sub) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...GREY);
      doc.text(sub, L + W, y + 5.6, { align: "right" });
    }
    y += 11;
  };

  const table = (head: string[], body: (string | number)[][], highlightFirst = false, redCol?: number, leftCols = 1) => {
    autoTable(doc, {
      startY: y,
      margin: { left: L, right: L, top: 20, bottom: 18 },
      head: [head],
      body,
      theme: "plain",
      headStyles: { fillColor: NAVY, textColor: GOLD, fontStyle: "bold", fontSize: 8.5 },
      styles: { fontSize: 8.5, cellPadding: 2, textColor: [30, 30, 40], lineColor: [230, 228, 220], lineWidth: { bottom: 0.2 } },
      alternateRowStyles: { fillColor: PAPER },
      columnStyles: Object.fromEntries(head.map((_, i) => [i, { halign: i < leftCols ? "left" : "right" }])),
      didParseCell: (cell) => {
        if (cell.section !== "body") return;
        if (highlightFirst && cell.row.index === 0) {
          cell.cell.styles.fillColor = GOLD_SOFT;
          cell.cell.styles.fontStyle = "bold";
        }
        if (redCol !== undefined && cell.column.index === redCol && parseFloat(String(cell.cell.raw)) >= 20) cell.cell.styles.textColor = RED;
      },
    });
    y = lastY() + 9;
  };

  const bulletBox = (title: string, items: string[], tone: { bg: RGB; bar: RGB; marker: "dot" | "box" | "star" | "num" }) => {
    sectionTitle(title);
    if (!items.length) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(9);
      doc.setTextColor(...GREY);
      doc.text("Nothing to note.", L + 4, y + 2);
      y += 9;
      return;
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    items.forEach((item, i) => {
      const wrapped = doc.splitTextToSize(item, W - 16) as string[];
      const h = wrapped.length * 4.6 + 4;
      ensure(h + 1);
      doc.setFillColor(...tone.bg);
      doc.rect(L, y, W, h, "F");
      doc.setFillColor(...tone.bar);
      doc.rect(L, y, 1.2, h, "F");
      const my = y + 4.6;
      if (tone.marker === "dot") {
        doc.setFillColor(...tone.bar);
        doc.circle(L + 6, my - 1.2, 1.1, "F");
      } else if (tone.marker === "box") {
        doc.setDrawColor(...tone.bar);
        doc.setLineWidth(0.4);
        doc.rect(L + 4.6, my - 3, 3, 3, "S");
      } else if (tone.marker === "star") {
        star(L + 6, my - 1.3, 2, tone.bar);
      } else {
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...tone.bar);
        doc.text(`${i + 1}`, L + 6, my, { align: "center" });
        doc.setFont("helvetica", "normal");
      }
      doc.setTextColor(30, 30, 40);
      doc.text(wrapped, L + 11, my);
      y += h + 1.5;
    });
    y += 6;
  };

  /* ---- Page 1: cover header ---- */
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, 210, 52, "F");
  doc.setFillColor(...GOLD);
  doc.rect(0, 52, 210, 1.2, "F");
  if (logo) {
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(L, 10, 30, 30, 4, 4, "F");
    doc.addImage(logo, "PNG", L + 1.5, 11.5, 27, 27);
  }
  const tx = logo ? L + 37 : L;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...GOLD);
  doc.text("THE FUTURE COURIER SERVICE L.L.C", tx, 16);
  doc.setFontSize(23);
  doc.setTextColor(255, 255, 255);
  doc.text("Team Monthly Report", tx, 27);
  doc.setFontSize(15);
  doc.setTextColor(...GOLD);
  doc.text(mn.toUpperCase(), tx, 36);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(200, 205, 220);
  doc.text(`Consignment movement, RTO, achievements & goals  ·  compared with ${monthName(d.prevMonth)}`, tx, 43);
  y = 62;

  /* ---- Headline cards ---- */
  sectionTitle("The month in numbers", "Company drivers · agent parcels shown separately");
  type Card = { label: string; value: string; note: string; tone: RGB; accent?: RGB };
  const change = (now: number, before: number, invert = false): { note: string; tone: RGB } => {
    const v = pctChange(now, before);
    if (v === null) return { note: "new this month", tone: GREY };
    if (v === 0) return { note: "same as last month", tone: GREY };
    const good = invert ? v < 0 : v > 0;
    return { note: `${v > 0 ? "+" : ""}${v}% vs last month`, tone: good ? GREEN : RED };
  };
  const pts = (now: number, before: number, invert = false): { note: string; tone: RGB } => {
    const v = Math.round((now - before) * 10) / 10;
    if (!before && !now) return { note: "", tone: GREY };
    if (v === 0) return { note: "same as last month", tone: GREY };
    const good = invert ? v < 0 : v > 0;
    return { note: `${v > 0 ? "+" : ""}${v} pts vs last month`, tone: good ? GREEN : RED };
  };
  const cards: Card[] = [
    { label: "CONSIGNMENTS", value: fmtNumber(c.orders), ...change(c.orders, p.orders), accent: GOLD },
    { label: "DELIVERED", value: fmtNumber(c.delivered), ...change(c.delivered, p.delivered), accent: GREEN },
    { label: "SUCCESS RATE", value: `${success(c)}%`, ...pts(success(c), success(p)), accent: GREEN },
    { label: "RTO (RETURNED)", value: fmtNumber(c.cancelled), ...change(c.cancelled, p.cancelled, true), accent: RED },
    { label: "RTO %", value: `${c.rtoPct}%`, ...pts(c.rtoPct, p.rtoPct, true), accent: RED },
    { label: "STILL PENDING", value: fmtNumber(c.pending), note: "to close this week", tone: GREY, accent: AMBER },
  ];
  const cw = (W - 8) / 3;
  const ch = 22;
  cards.forEach((k, i) => {
    const x = L + (i % 3) * (cw + 4);
    const cy = y + Math.floor(i / 3) * (ch + 4);
    doc.setFillColor(...PAPER);
    doc.roundedRect(x, cy, cw, ch, 2, 2, "F");
    doc.setFillColor(...(k.accent ?? GOLD));
    doc.rect(x, cy + 3, 1.2, ch - 6, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...GREY);
    doc.text(k.label, x + 5, cy + 6);
    doc.setFontSize(17);
    doc.setTextColor(...NAVY);
    doc.text(k.value, x + 5, cy + 14.5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...k.tone);
    doc.text(k.note, x + 5, cy + 19.3);
  });
  y += 2 * ch + 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...GREY);
  const extra = [
    `Sent with agent: ${fmtNumber(c.agentOrders)} (${fmtNumber(c.agentDelivered)} delivered, ${fmtNumber(c.agentCancelled)} RTO)`,
    `Total moved: ${fmtNumber(h.totalMoved)}`,
    `Vendors: ${fmtNumber(c.vendorCount)}`,
    `Working days: ${fmtNumber(c.activeDays)}`,
  ].join("   ·   ");
  doc.text(extra, L, y);
  y += 9;

  /* ---- Daily movement chart ---- */
  const [yy, mm] = d.month.split("-").map(Number);
  const nDays = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const byDate = new Map(d.days.map((x) => [x.date, x]));
  const series = Array.from({ length: nDays }, (_, i) => {
    const key = `${d.month}-${String(i + 1).padStart(2, "0")}`;
    return byDate.get(key) ?? { date: key, orders: 0, delivered: 0, cancelled: 0, pending: 0, rtoPct: 0 };
  });
  sectionTitle("Daily consignment movement", h.busiest ? `Busiest day: ${dayLabel(h.busiest.date)} · ${fmtNumber(h.busiest.orders)} parcels` : undefined);
  const chartH = 46;
  ensure(chartH + 16);
  const max = Math.max(1, ...series.map((s) => s.orders));
  const step = W / nDays;
  const bw = step * 0.68;
  const base = y + chartH;
  doc.setDrawColor(225, 222, 212);
  doc.setLineWidth(0.15);
  for (let g = 0; g <= 4; g++) {
    const gy = base - (chartH * g) / 4;
    doc.line(L, gy, L + W, gy);
    doc.setFontSize(5.5);
    doc.setTextColor(...GREY);
    if (g) doc.text(fmtNumber((max * g) / 4), L - 1, gy + 1, { align: "right" });
  }
  series.forEach((s, i) => {
    const x = L + i * step + (step - bw) / 2;
    let top = base;
    for (const [v, col] of [
      [s.delivered, GREEN],
      [s.cancelled, RED],
      [s.pending, AMBER],
    ] as [number, RGB][]) {
      if (!v) continue;
      const hh = (v / max) * chartH;
      doc.setFillColor(...col);
      doc.rect(x, top - hh, bw, hh, "F");
      top -= hh;
    }
    if (h.busiest && s.date === h.busiest.date) star(x + bw / 2, top - 3, 1.8, GOLD);
    doc.setFontSize(5.5);
    doc.setTextColor(...GREY);
    doc.text(String(i + 1), x + bw / 2, base + 3.5, { align: "center" });
  });
  y = base + 7;
  doc.setFontSize(7.5);
  let lx = L;
  for (const [label, col] of [
    ["Delivered", GREEN],
    ["RTO", RED],
    ["Pending", AMBER],
  ] as [string, RGB][]) {
    doc.setFillColor(...col);
    doc.rect(lx, y - 2.4, 3, 3, "F");
    doc.setTextColor(60, 60, 70);
    doc.text(label, lx + 4.5, y);
    lx += doc.getTextWidth(label) + 12;
  }
  y += 10;

  /* ---- Driver of the month ---- */
  if (h.top) {
    ensure(46);
    const by = y;
    doc.setFillColor(...NAVY);
    doc.roundedRect(L, by, W, 40, 3, 3, "F");
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(0.6);
    doc.roundedRect(L + 2, by + 2, W - 4, 36, 2, 2, "S");
    star(L + 22, by + 20, 11, GOLD);
    star(L + 22, by + 20, 5, NAVY2);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...GOLD);
    doc.text("DRIVER OF THE MONTH", L + 40, by + 11);
    doc.setFontSize(22);
    doc.setTextColor(255, 255, 255);
    doc.text(pdfSafe(h.top.name).toUpperCase(), L + 40, by + 22);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(220, 222, 232);
    doc.text(
      `${fmtNumber(h.top.delivered)} parcels delivered  ·  ${success(h.top)}% success  ·  ${fmtNumber(h.top.days)} working days`,
      L + 40,
      by + 29
    );
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...GOLD);
    doc.text("Congratulations and thank you for your outstanding work!", L + 40, by + 35);
    y = by + 48;
  }

  /* ---- Podium + achievements ---- */
  const podium = d.drivers.filter((x) => x.delivered > 0).slice(0, 3);
  if (podium.length >= 2) {
    ensure(64);
    sectionTitle("Top drivers", "By parcels delivered");
    const order = [podium[1], podium[0], podium[2]].filter(Boolean) as Driver[];
    const heights: Record<string, number> = { "1": 30, "2": 22, "3": 15 };
    const medals: Record<string, RGB> = { "1": GOLD, "2": [175, 180, 192], "3": [196, 128, 70] };
    const colW = 44;
    const startX = L + (W - order.length * (colW + 6)) / 2;
    const ground = y + 44;
    order.forEach((drv, i) => {
      const rank = String(podium.indexOf(drv) + 1);
      const x = startX + i * (colW + 6);
      const hh = heights[rank];
      doc.setFillColor(...medals[rank]);
      doc.rect(x, ground - hh, colW, hh, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.setTextColor(255, 255, 255);
      doc.text(rank, x + colW / 2, ground - hh + 9, { align: "center" });
      doc.setFontSize(9.5);
      doc.setTextColor(...NAVY);
      doc.text(pdfSafe(drv.name), x + colW / 2, ground - hh - 7, { align: "center", maxWidth: colW + 4 });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...GREY);
      doc.text(`${fmtNumber(drv.delivered)} delivered · ${success(drv)}%`, x + colW / 2, ground - hh - 2.5, { align: "center" });
    });
    doc.setDrawColor(...NAVY);
    doc.setLineWidth(0.5);
    doc.line(L + 20, ground, L + W - 20, ground);
    y = ground + 10;
  }

  bulletBox("Achievements", lines(notes.achievements), { bg: GOLD_SOFT, bar: GOLD, marker: "star" });

  /* ---- Tables ---- */
  sectionTitle("Driver performance", "Company drivers · success = delivered out of finished parcels");
  table(
    ["#", "Driver", "Days", "Parcels", "Delivered", "RTO", "Pending", "Success %"],
    d.drivers.map((x, i) => [
      i + 1,
      pdfSafe(x.name),
      fmtNumber(x.days),
      fmtNumber(x.orders),
      fmtNumber(x.delivered),
      fmtNumber(x.cancelled),
      fmtNumber(x.pending),
      x.delivered + x.cancelled ? `${success(x)}%` : "-",
    ]),
    true,
    undefined,
    2
  );

  sectionTitle("Vendors", "All parcels each vendor gave us · RTO % of finished parcels");
  table(
    ["Vendor", "Parcels", "Delivered", "RTO", "Pending", "RTO %"],
    d.vendors.map((v) => [pdfSafe(v.name), fmtNumber(v.orders), fmtNumber(v.delivered), fmtNumber(v.cancelled), fmtNumber(v.pending), `${v.rtoPct}%`]),
    false,
    5
  );

  sectionTitle("Top areas", "Where most of our parcels went");
  table(
    ["Area", "Parcels", "Delivered", "RTO", "RTO %"],
    areas.slice(0, 15).map((a) => [pdfSafe(a.name), fmtNumber(a.orders), fmtNumber(a.delivered), fmtNumber(a.cancelled), `${a.rtoPct}%`]),
    false,
    4
  );

  if (h.hotspots.length) {
    sectionTitle("RTO hotspots", "Areas with 10+ finished parcels, most returns first");
    table(
      ["Area", "Finished", "Returned", "RTO %"],
      h.hotspots.map((a) => [pdfSafe(a.name), fmtNumber(a.delivered + a.cancelled), fmtNumber(a.cancelled), `${a.rtoPct}%`]),
      false,
      3
    );
  }

  sectionTitle("By emirate");
  table(
    ["Emirate", "Parcels", "Delivered", "RTO", "RTO %"],
    d.emirates.map((e) => [titleCase(e.name), fmtNumber(e.orders), fmtNumber(e.delivered), fmtNumber(e.cancelled), `${e.rtoPct}%`]),
    false,
    4
  );

  /* ---- Problems, tasks, wishes ---- */
  bulletBox("Problems & issues", lines(notes.problems), { bg: [252, 238, 236], bar: RED, marker: "dot" });
  bulletBox(`Tasks for ${nextMonthName(d.month)}`, lines(notes.tasks), { bg: [236, 244, 239], bar: GREEN, marker: "box" });

  const wish = pdfSafe(notes.wishes.replace(/\s*\n\s*/g, " "));
  if (wish && wish !== "-") {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(10.5);
    const wrapped = doc.splitTextToSize(wish, W - 24) as string[];
    const bh = wrapped.length * 5.4 + 24;
    ensure(bh + 4);
    doc.setFillColor(...NAVY);
    doc.roundedRect(L, y, W, bh, 3, 3, "F");
    doc.setFillColor(...GOLD);
    doc.rect(L, y, W, 1.4, "F");
    star(L + W / 2 - 8, y + 9, 2.4, GOLD);
    star(L + W / 2, y + 8, 3.2, GOLD);
    star(L + W / 2 + 8, y + 9, 2.4, GOLD);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...GOLD);
    doc.text("WISHES FROM THE MANAGEMENT", L + W / 2, y + 17, { align: "center" });
    doc.setFont("helvetica", "italic");
    doc.setFontSize(10.5);
    doc.setTextColor(240, 240, 248);
    doc.text(wrapped, L + W / 2, y + 24, { align: "center" });
    y += bh + 6;
  }

  /* ---- Page chrome ---- */
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    if (i > 1) {
      doc.setFillColor(...NAVY);
      doc.rect(0, 0, 210, 12, "F");
      doc.setFillColor(...GOLD);
      doc.rect(0, 12, 210, 0.6, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(...GOLD);
      doc.text("THE FUTURE COURIER SERVICE", L, 7.8);
      doc.setTextColor(255, 255, 255);
      doc.text(`Team Monthly Report · ${mn}`, 196, 7.8, { align: "right" });
    }
    doc.setDrawColor(225, 222, 212);
    doc.setLineWidth(0.2);
    doc.line(L, 286, 196, 286);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...GREY);
    doc.text("Together we deliver.", L, 290.5);
    doc.text(`Page ${i} of ${pages}`, 196, 290.5, { align: "right" });
  }

  const name = `Future-Courier-Team-Report-${mn.replace(" ", "-")}.pdf`;
  return { blob: doc.output("blob") as Blob, name };
}

/* --------------------------------------------------------------- Page ---- */

function Change({ now, before, points, invert }: { now: number; before: number; points?: boolean; invert?: boolean }) {
  if (points) {
    const d = Math.round((now - before) * 10) / 10;
    if (!before && !now) return null;
    const good = invert ? d < 0 : d > 0;
    return <span className={`text-xs ${d === 0 ? "text-ink-soft" : good ? "text-delivered" : "text-cancelled"}`}>{d > 0 ? "▲" : d < 0 ? "▼" : "•"} {Math.abs(d)} pts</span>;
  }
  const pct = pctChange(now, before);
  if (pct === null) return <span className="text-xs text-ink-soft">new</span>;
  const good = invert ? pct < 0 : pct > 0;
  return <span className={`text-xs ${pct === 0 ? "text-ink-soft" : good ? "text-delivered" : "text-cancelled"}`}>{pct > 0 ? "▲" : pct < 0 ? "▼" : "•"} {Math.abs(pct)}%</span>;
}

export default function MonthEndReport({ month }: { month: string }) {
  const [data, setData] = useState<MonthEnd | null>(null);
  const [err, setErr] = useState("");
  const [notes, setNotes] = useState<Notes | null>(null);
  const [busy, setBusy] = useState(false);
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    setData(null);
    setNotes(null);
    setErr("");
    apiFetch<MonthEnd>("/month-end", { query: { month } })
      .then((r) => setData({ ...r, drivers: [...r.drivers].sort((a, b) => b.delivered - a.delivered || success(b) - success(a)) }))
      .catch((e) => setErr(e instanceof Error ? e.message : "Could not load"));
  }, [month]);

  useEffect(() => {
    try {
      const probe = new File([""], "x.pdf", { type: "application/pdf" });
      setCanShare(typeof navigator !== "undefined" && !!navigator.canShare?.({ files: [probe] }));
    } catch {
      setCanShare(false);
    }
  }, []);

  const areas = useMemo(() => (data ? areaStats(data.areaRows) : []), [data]);
  const h = useMemo(() => (data ? highlights(data, areas) : null), [data, areas]);
  const suggested = useMemo(() => (data && h ? defaultNotes(data, h) : null), [data, h]);

  useEffect(() => {
    if (data && suggested && !notes) setNotes(loadNotes(data.month) ?? suggested);
  }, [data, suggested, notes]);

  function editNote(key: keyof Notes, value: string) {
    if (!notes || !data) return;
    const next = { ...notes, [key]: value };
    setNotes(next);
    saveNotes(data.month, next);
  }
  function resetNotes() {
    if (!data || !suggested) return;
    setNotes(suggested);
    saveNotes(data.month, suggested);
    toast("Notes reset to the suggested text", "success");
  }

  async function makePdf(mode: "download" | "share") {
    if (!data || !h || !notes) return;
    setBusy(true);
    try {
      const { blob, name } = await buildPdf(data, areas, h, notes);
      if (mode === "share") {
        const file = new File([blob], name, { type: "application/pdf" });
        try {
          await navigator.share({ files: [file], title: `Team report · ${monthName(data.month)}` });
          return;
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") return;
          // fall through to a download
        }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      toast("Could not make the PDF", "error", e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  const box = "border border-line bg-white p-5";
  const h2 = "mb-3 border-b border-line pb-2.5 font-display text-[18px] font-semibold text-navy";

  if (err) return <div className={`${box} mb-5 text-sm text-cancelled`}>Month-end report: {err}</div>;
  if (!data || !h) return <div className={`${box} mb-5 h-40 animate-pulse`} />;

  const c = data.current;
  const p = data.previous;
  const cards: { label: string; value: string; change: JSX.Element | null; tone?: string }[] = [
    { label: "Consignments", value: fmtNumber(c.orders), change: <Change now={c.orders} before={p.orders} /> },
    { label: "Delivered", value: fmtNumber(c.delivered), change: <Change now={c.delivered} before={p.delivered} /> },
    { label: "Success rate", value: `${success(c)}%`, change: <Change now={success(c)} before={success(p)} points />, tone: "text-delivered" },
    { label: "RTO", value: fmtNumber(c.cancelled), change: <Change now={c.cancelled} before={p.cancelled} invert /> },
    { label: "RTO %", value: `${c.rtoPct}%`, change: <Change now={c.rtoPct} before={p.rtoPct} points invert />, tone: c.rtoPct >= 15 ? "text-cancelled" : undefined },
    { label: "Still pending", value: fmtNumber(c.pending), change: <span className="text-xs text-ink-soft">to close</span>, tone: c.pending ? "text-pending" : undefined },
  ];
  const maxVendor = Math.max(1, ...data.vendors.map((v) => v.orders));
  const maxDay = Math.max(1, ...data.days.map((x) => x.orders));
  const btn = "rounded px-4 py-2 font-mono text-xs font-semibold uppercase tracking-wide disabled:opacity-50";

  return (
    <div className={`${box} mb-5`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <div>
          <h2 className="font-display text-[18px] font-semibold text-navy">Team report — {monthName(data.month)}</h2>
          <p className="text-xs text-ink-soft">For the whole team · no money figures · compared with {monthName(data.prevMonth)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canShare && (
            <button disabled={busy || !notes} onClick={() => makePdf("share")} className={`${btn} border border-brass text-navy hover:bg-paper-2`}>
              ➤ Share to WhatsApp
            </button>
          )}
          <button disabled={busy || !notes} onClick={() => makePdf("download")} className={`${btn} bg-brass text-[#0A1020] hover:opacity-90`}>
            {busy ? "Making PDF…" : "⬇ Team report PDF"}
          </button>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((k) => (
          <div key={k.label} className="rounded-lg bg-paper-2 p-3">
            <p className="text-[11px] uppercase tracking-wider text-ink-soft">{k.label}</p>
            <p className={`font-display text-[20px] font-semibold ${k.tone ?? "text-navy"}`}>{k.value}</p>
            {k.change}
          </div>
        ))}
      </div>
      <p className="mb-5 text-xs text-ink-soft">
        Sent with agent: <b>{fmtNumber(c.agentOrders)}</b> ({fmtNumber(c.agentDelivered)} delivered, {fmtNumber(c.agentCancelled)} RTO) · Total moved: <b>{fmtNumber(h.totalMoved)}</b> · Vendors:{" "}
        <b>{fmtNumber(c.vendorCount)}</b> · Working days: <b>{fmtNumber(c.activeDays)}</b>
      </p>

      {h.top && (
        <div className="mb-6 flex flex-wrap items-center gap-4 rounded-lg bg-navy p-4 text-white">
          <span className="text-4xl text-brass">★</span>
          <div className="flex-1">
            <p className="font-mono text-[11px] uppercase tracking-widest text-brass">Driver of the month</p>
            <p className="font-display text-[22px] font-semibold">{h.top.name}</p>
            <p className="text-xs opacity-80">
              {fmtNumber(h.top.delivered)} delivered · {success(h.top)}% success · {h.top.days} working days
            </p>
          </div>
          <div className="text-xs opacity-90">
            {h.sharpest && (
              <p>
                Cleanest record: <b>{h.sharpest.name}</b> ({success(h.sharpest)}%)
              </p>
            )}
            {h.improved && (
              <p>
                Most improved: <b>{h.improved.name}</b> (+{fmtNumber(h.improved.gain)})
              </p>
            )}
          </div>
        </div>
      )}

      <div className="mb-6">
        <h3 className={h2}>Daily movement</h3>
        <div className="flex h-28 items-end gap-[2px]">
          {data.days.map((x) => (
            <div key={x.date} className="flex flex-1 flex-col-reverse" style={{ height: `${(x.orders / maxDay) * 100}%` }} title={`${dayLabel(x.date)}: ${x.orders} parcels · ${x.delivered} delivered · ${x.cancelled} RTO`}>
              <div className="bg-delivered" style={{ flexGrow: x.delivered }} />
              <div className="bg-cancelled" style={{ flexGrow: x.cancelled }} />
              <div className="bg-pending" style={{ flexGrow: x.pending }} />
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-soft">
          <span className="text-delivered">■</span> Delivered <span className="ml-2 text-cancelled">■</span> RTO <span className="ml-2 text-pending">■</span> Pending
          {h.busiest && <span className="ml-3">Busiest: {dayLabel(h.busiest.date)} ({fmtNumber(h.busiest.orders)})</span>}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className={h2}>Drivers</h3>
          <div className="table-wrap">
            <table className="data-table text-sm">
              <thead>
                <tr>
                  <th>Driver</th>
                  <th className="text-right">Delivered</th>
                  <th className="text-right">RTO</th>
                  <th className="text-right">Success</th>
                </tr>
              </thead>
              <tbody>
                {data.drivers.map((d, i) => (
                  <tr key={d.name} className={i === 0 && d.delivered ? "font-semibold" : ""}>
                    <td>
                      {i < 3 && d.delivered ? ["🥇", "🥈", "🥉"][i] + " " : ""}
                      {d.name}
                    </td>
                    <td className="text-right font-mono">{fmtNumber(d.delivered)}</td>
                    <td className="text-right font-mono">{fmtNumber(d.cancelled)}</td>
                    <td className="text-right font-mono">{d.delivered + d.cancelled ? `${success(d)}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3 className={h2}>Vendors</h3>
          <div className="space-y-2">
            {data.vendors.slice(0, 10).map((v) => (
              <div key={v.name}>
                <div className="flex justify-between text-sm">
                  <span className="font-medium">{v.name}</span>
                  <span className="font-mono text-xs">
                    {fmtNumber(v.orders)} parcels · <span className={v.rtoPct >= 20 ? "text-cancelled" : v.rtoPct >= 10 ? "text-pending" : "text-delivered"}>RTO {v.rtoPct}%</span>
                  </span>
                </div>
                <div className="mt-1 h-1.5 rounded bg-paper-2">
                  <div className="h-1.5 rounded bg-brass" style={{ width: `${(v.orders / maxVendor) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className={h2}>Top areas</h3>
          <div className="table-wrap">
            <table className="data-table text-sm">
              <thead>
                <tr>
                  <th>Area</th>
                  <th className="text-right">Parcels</th>
                  <th className="text-right">RTO %</th>
                </tr>
              </thead>
              <tbody>
                {areas.slice(0, 10).map((a) => (
                  <tr key={a.name}>
                    <td>{a.name}</td>
                    <td className="text-right font-mono">{fmtNumber(a.orders)}</td>
                    <td className={`text-right font-mono ${a.rtoPct >= 20 ? "text-cancelled" : ""}`}>{a.rtoPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3 className={h2}>RTO hotspots</h3>
          {h.hotspots.length === 0 ? (
            <p className="text-sm text-ink-soft">No area has 10+ finished parcels with returns this month.</p>
          ) : (
            <div className="space-y-2">
              {h.hotspots.map((a) => (
                <div key={a.name} className="flex items-center justify-between rounded-lg bg-cancelled-bg px-3 py-2 text-sm">
                  <span className="font-medium">{a.name}</span>
                  <span className="font-mono text-xs text-cancelled">
                    {a.cancelled} of {a.delivered + a.cancelled} returned · {a.rtoPct}%
                  </span>
                </div>
              ))}
            </div>
          )}
          <h3 className={`${h2} mt-5`}>By emirate</h3>
          <div className="flex flex-wrap gap-2">
            {data.emirates.map((e) => (
              <span key={e.name} className="rounded-full border border-line px-3 py-1 text-xs">
                {e.name.replace(/_/g, " ")} · <b>{fmtNumber(e.orders)}</b> · RTO {e.rtoPct}%
              </span>
            ))}
          </div>
        </div>
      </div>

      {notes && (
        <div className="mt-6 border-t border-line pt-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-[18px] font-semibold text-navy">Notes for the team PDF</h3>
              <p className="text-xs text-ink-soft">Filled in from the numbers — edit anything before making the PDF. Saved for this month on this device.</p>
            </div>
            <button onClick={resetNotes} className="text-xs text-ink-soft underline hover:text-navy">
              Reset to suggested
            </button>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {NOTE_SECTIONS.map((s) => (
              <label key={s.key} className="block">
                <span className="mb-1 flex justify-between text-sm font-semibold text-navy">
                  {s.title} <span className="text-[11px] font-normal text-ink-soft">{s.hint}</span>
                </span>
                <textarea
                  value={notes[s.key]}
                  onChange={(e) => editNote(s.key, e.target.value)}
                  rows={6}
                  className="w-full rounded border border-line bg-paper p-2 text-sm leading-relaxed focus:border-brass focus:outline-none"
                />
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
