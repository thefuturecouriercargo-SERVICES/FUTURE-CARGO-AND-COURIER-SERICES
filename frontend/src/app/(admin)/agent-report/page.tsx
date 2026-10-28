"use client";

import { useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { fmtNumber } from "@/lib/format";
import { readAgentReport, ReportRow } from "@/lib/agentReport";

type Action = "change" | "already" | "conflict" | "pending" | "notFound" | "awaiting";

interface Item {
  tracking: string;
  reportStatus: string;
  target: "DELIVERED" | "CANCELLED" | "PENDING";
  cod: number | null;
  emirate: string | null;
  sheet: string | null;
  action: Action;
  matchedBy: "cn" | "sender" | null;
  selected: boolean;
  warnings: string[];
  order: {
    id: string;
    cnNo: number;
    date: string;
    status: string;
    total: number;
    vendor: string;
    holder: string | null;
    customer: string | null;
  } | null;
}

interface Summary {
  rows: number;
  unique: number;
  toDeliver: number;
  toCancel: number;
  already: number;
  conflict: number;
  pending: number;
  notFound: number;
}

const TABS: { key: string; label: string; match: (i: Item) => boolean }[] = [
  { key: "change", label: "Will update", match: (i) => i.action === "change" },
  { key: "conflict", label: "Conflicts", match: (i) => i.action === "conflict" },
  { key: "pending", label: "Still pending", match: (i) => i.action === "pending" },
  { key: "already", label: "Already done", match: (i) => i.action === "already" },
  { key: "notFound", label: "Not found", match: (i) => i.action === "notFound" || i.action === "awaiting" },
];

const ST_CLS: Record<string, string> = {
  DELIVERED: "bg-delivered-bg text-delivered",
  CANCELLED: "bg-cancelled-bg text-cancelled",
  PENDING: "bg-pending-bg text-pending",
  TRANSFER: "bg-transferred-bg text-transferred",
};

function Pill({ s, label }: { s: string; label?: string }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase ${ST_CLS[s] ?? "bg-paper-2 text-ink-soft"}`}>
      {label ?? s}
    </span>
  );
}

export default function AgentReportPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState<"" | "reading" | "applying">("");
  const [error, setError] = useState("");
  const [items, setItems] = useState<Item[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [tab, setTab] = useState("change");
  const [result, setResult] = useState("");

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError("");
    setResult("");
    setItems(null);
    setSummary(null);
    setBusy("reading");
    try {
      const rows: ReportRow[] = [];
      for (const f of Array.from(files)) rows.push(...(await readAgentReport(f)));
      setFileName(Array.from(files).map((f) => f.name).join(", "));
      if (rows.length === 0) throw new Error("No consignment rows found in this file. Is it the agent's status report?");
      const r = await apiFetch<{ items: Item[]; summary: Summary }>("/agent-report/preview", { method: "POST", body: { rows } });
      setItems(r.items);
      setSummary(r.summary);
      setTab(r.summary.toDeliver + r.summary.toCancel > 0 ? "change" : r.summary.conflict ? "conflict" : "notFound");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the file");
    } finally {
      setBusy("");
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const visible = useMemo(() => {
    const t = TABS.find((x) => x.key === tab)!;
    return (items ?? []).filter(t.match);
  }, [items, tab]);

  const chosen = (items ?? []).filter((i) => i.selected && i.order && i.target !== "PENDING" && (i.action === "change" || i.action === "conflict"));
  const chosenDeliver = chosen.filter((i) => i.target === "DELIVERED").length;
  const chosenCancel = chosen.length - chosenDeliver;

  function toggle(tracking: string) {
    setItems((list) => list?.map((i) => (i.tracking === tracking ? { ...i, selected: !i.selected } : i)) ?? null);
  }
  function setAllVisible(on: boolean) {
    const keys = new Set(visible.filter((i) => i.order && i.target !== "PENDING").map((i) => i.tracking));
    setItems((list) => list?.map((i) => (keys.has(i.tracking) ? { ...i, selected: on } : i)) ?? null);
  }

  async function apply() {
    if (chosen.length === 0) return;
    const msg = `Mark ${chosenDeliver} as DELIVERED and ${chosenCancel} as CANCELLED (RTO)?\n\nOlder orders move to today's sheet, same as marking by hand.`;
    if (!window.confirm(msg)) return;
    setBusy("applying");
    setError("");
    try {
      const r = await apiFetch<{ updated: number; skipped: { orderId: string; reason: string }[] }>("/agent-report/apply", {
        method: "POST",
        body: {
          fileName,
          updates: chosen.map((i) => ({ orderId: i.order!.id, status: i.target, tracking: i.tracking })),
        },
      });
      setResult(`✓ Updated ${r.updated} order${r.updated === 1 ? "" : "s"}${r.skipped.length ? ` · ${r.skipped.length} skipped` : ""}.`);
      // Reflect the change on screen.
      const doneIds = new Set(chosen.map((i) => i.order!.id));
      setItems(
        (list) =>
          list?.map((i) =>
            i.order && doneIds.has(i.order.id) ? { ...i, action: "already" as Action, selected: false, order: { ...i.order, status: i.target } } : i
          ) ?? null
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="max-w-6xl">
      <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-brass">Agents</p>
      <h1 className="mb-1 font-display text-3xl font-semibold text-navy">Agent report upload</h1>
      <p className="mb-5 max-w-2xl text-sm text-ink-soft">
        Upload the agent&apos;s Excel status sheet or PDF cash-return report. Tracking number = our CN.
        <b> Delivered</b> → Delivered, <b>RTO</b> → Cancelled — the report always wins, even over what we marked before. Anything else stays Pending. Nothing changes until you press Update.
      </p>

      <label
        className={`mb-5 flex cursor-pointer flex-col items-center justify-center rounded border-2 border-dashed border-brass bg-white px-4 py-8 text-center hover:bg-paper ${busy ? "pointer-events-none opacity-60" : ""}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          onFiles(e.dataTransfer.files);
        }}
      >
        <span className="text-2xl">📄</span>
        <span className="mt-1 font-semibold text-navy">{busy === "reading" ? "Reading report…" : "Choose or drop Excel / PDF report"}</span>
        <span className="text-xs text-ink-soft">.xlsx or .pdf · you can pick several at once</span>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".xlsx,.xlsm,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => onFiles(e.target.files)}
        />
      </label>

      {error && <p className="mb-4 rounded border border-cancelled bg-cancelled-bg p-3 text-sm text-cancelled">{error}</p>}
      {result && <p className="mb-4 rounded border border-delivered bg-delivered-bg p-3 text-sm font-semibold text-delivered">{result}</p>}

      {summary && items && (
        <>
          <p className="mb-3 text-xs text-ink-soft">
            {fileName} · {summary.rows} rows · {summary.unique} unique CNs
          </p>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ["To Delivered", summary.toDeliver, "text-delivered"],
              ["To Cancelled (RTO)", summary.toCancel, "text-cancelled"],
              ["Conflicts", summary.conflict, "text-pending"],
              ["Still pending", summary.pending, "text-ink-soft"],
              ["Already done", summary.already, "text-ink-soft"],
              ["Not found", summary.notFound, "text-cancelled"],
            ].map(([l, n, c]) => (
              <div key={l as string} className="border border-line bg-white p-3">
                <p className="font-mono text-[10px] uppercase tracking-wide text-ink-soft">{l}</p>
                <p className={`font-display text-2xl font-semibold ${c}`}>{n as number}</p>
              </div>
            ))}
          </div>

          <div className="sticky top-14 z-20 mb-3 flex flex-wrap items-center justify-between gap-2 border border-line bg-white p-3 md:top-0">
            <span className="text-sm">
              Selected: <b className="text-delivered">{chosenDeliver} delivered</b> · <b className="text-cancelled">{chosenCancel} cancelled</b>
            </span>
            <button
              onClick={apply}
              disabled={chosen.length === 0 || busy !== ""}
              className="rounded bg-navy px-4 py-2 font-mono text-xs font-bold uppercase tracking-wide text-paper disabled:opacity-40"
            >
              {busy === "applying" ? "Updating…" : `Update ${chosen.length} order${chosen.length === 1 ? "" : "s"}`}
            </button>
          </div>

          <div className="mb-2 flex flex-wrap gap-1">
            {TABS.map((t) => {
              const n = items.filter(t.match).length;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`rounded px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide ${tab === t.key ? "bg-navy text-paper" : "border border-line bg-white text-ink-soft"}`}
                >
                  {t.label} ({n})
                </button>
              );
            })}
          </div>

          {tab === "conflict" && visible.length > 0 && (
            <p className="mb-2 text-xs text-pending">
              Report says Delivered but ours is Cancelled. Not ticked — tick only if the report is right.
            </p>
          )}
          {tab === "notFound" && visible.length > 0 && (
            <p className="mb-2 text-xs text-ink-soft">
              No order with this CN in Daily Entry. Long numbers like 1111xxxxx are the agent&apos;s own AWB, not our CN.
            </p>
          )}

          {(tab === "change" || tab === "conflict") && visible.length > 0 && (
            <div className="mb-2 flex gap-3 text-xs">
              <button className="text-navy underline" onClick={() => setAllVisible(true)}>Tick all</button>
              <button className="text-navy underline" onClick={() => setAllVisible(false)}>Untick all</button>
            </div>
          )}

          <div className="overflow-x-auto border border-line bg-white">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-paper font-mono text-[10px] uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className="w-8 p-2"></th>
                  <th className="p-2 text-left">CN / Tracking</th>
                  <th className="p-2 text-left">Report says</th>
                  <th className="p-2 text-left">Ours now</th>
                  <th className="p-2 text-left">Customer / Vendor</th>
                  <th className="p-2 text-left">With</th>
                  <th className="p-2 text-right">COD</th>
                  <th className="p-2 text-left">Notes</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-4 text-center text-ink-soft">Nothing here.</td>
                  </tr>
                )}
                {visible.map((i) => {
                  const canTick = !!i.order && i.target !== "PENDING" && (i.action === "change" || i.action === "conflict");
                  return (
                    <tr key={i.tracking} className="border-t border-line align-top">
                      <td className="p-2">
                        {canTick && <input type="checkbox" checked={i.selected} onChange={() => toggle(i.tracking)} className="h-4 w-4" />}
                      </td>
                      <td className="p-2 font-mono">
                        <b className="text-navy">{i.order ? i.order.cnNo : i.tracking}</b>
                        {i.order && String(i.order.cnNo) !== i.tracking.replace(/\D/g, "") && (
                          <span className="block text-[10px] text-ink-soft">AWB {i.tracking}</span>
                        )}
                        {i.sheet && <span className="block text-[10px] text-ink-soft">{i.sheet}</span>}
                      </td>
                      <td className="p-2">
                        <span className="block text-xs">{i.reportStatus}</span>
                        {i.target !== "PENDING" && <span className="text-[10px] text-ink-soft">→ <Pill s={i.target} /></span>}
                      </td>
                      <td className="p-2">
                        {i.order ? <Pill s={i.order.status} /> : <span className="text-xs text-cancelled">{i.action === "awaiting" ? "Still in Awaiting Pickup" : "Not found"}</span>}
                        {i.order && <span className="block text-[10px] text-ink-soft">{new Date(i.order.date).toLocaleDateString("en-GB")}</span>}
                      </td>
                      <td className="p-2">
                        {i.order?.customer && <span className="block">{i.order.customer}</span>}
                        <span className="text-xs text-ink-soft">{i.order?.vendor ?? i.emirate ?? ""}</span>
                      </td>
                      <td className="p-2 text-xs">{i.order?.holder ?? ""}</td>
                      <td className="p-2 text-right font-mono text-xs">
                        {i.cod != null ? fmtNumber(i.cod) : "—"}
                        {i.order && i.cod != null && i.cod !== i.order.total && (
                          <span className="block text-pending">ours {fmtNumber(i.order.total)}</span>
                        )}
                      </td>
                      <td className="p-2 text-[11px] text-pending">{i.warnings.filter((w) => !w.startsWith("Amount")).join(" · ")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
