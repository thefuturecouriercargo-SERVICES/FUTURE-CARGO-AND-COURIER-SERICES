"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { fmtNumber, fmtDate, fmtDateTime } from "@/lib/format";
import { readAgentReport, ReportRow } from "@/lib/agentReport";
import AgentReportHistory from "@/components/AgentReportHistory";

import { confirmDialog } from "@/components/ui/Feedback";
import EmptyState from "@/components/ui/EmptyState";
type Action = "change" | "already" | "conflict" | "pending" | "notFound" | "awaiting" | "driver" | "waitPdf";

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
  driver: number;
  waitPdf: number;
}

const TABS: { key: string; label: string; match: (i: Item) => boolean }[] = [
  { key: "change", label: "Will update", match: (i) => i.action === "change" },
  { key: "conflict", label: "Conflicts", match: (i) => i.action === "conflict" },
  { key: "waitPdf", label: "Delivered — waits for PDF", match: (i) => i.action === "waitPdf" },
  { key: "pending", label: "Still pending", match: (i) => i.action === "pending" },
  { key: "already", label: "Already done", match: (i) => i.action === "already" },
  { key: "notFound", label: "Not found", match: (i) => i.action === "notFound" || i.action === "awaiting" },
  { key: "driver", label: "With our drivers", match: (i) => i.action === "driver" },
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
  const [historyKey, setHistoryKey] = useState(0);
  const [unpaidKey, setUnpaidKey] = useState(0);
  const [pickupKey, setPickupKey] = useState(0);

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
      // Keep a record for the payment check (Excel Delivered vs payment PDF).
      await apiFetch("/agent-report/record", {
        method: "POST",
        body: { rows: rows.map((x) => ({ tracking: x.tracking, status: x.status, cod: x.cod, source: x.source, reportDate: x.reportDate, file: x.file })) },
      });
      setUnpaidKey((k) => k + 1);
      setPickupKey((k) => k + 1);
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
    if (!(await confirmDialog(msg))) return;
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
      setHistoryKey((k) => k + 1);
      setPickupKey((k) => k + 1);
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
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-brass">Agents</p>
      <h1 className="mb-1 font-display text-[26px] font-semibold tracking-tight text-navy md:text-[32px]">Agent report upload</h1>
      <p className="mb-5 max-w-2xl text-sm text-ink-soft">
        Upload the agent&apos;s Excel status sheet or PDF cash-return report. Tracking number = our CN.
        <b> Payment PDF</b> → Delivered. <b>Excel</b> → only <b>RTO</b> is used (→ Cancelled); Excel &quot;Delivered&quot; waits for the payment PDF, so missing payments stay visible. Anything else stays Pending. Nothing changes until you press Update.
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

      <UnpaidTable refreshKey={unpaidKey} />
      <PickupTable refreshKey={pickupKey} />

      {error && <p className="mb-4 rounded border border-cancelled bg-cancelled-bg p-3 text-sm text-cancelled">{error}</p>}
      {result && <p className="mb-4 rounded border border-delivered bg-delivered-bg p-3 text-sm font-semibold text-delivered">{result}</p>}

      {summary && items && (
        <>
          <p className="mb-3 text-xs text-ink-soft">
            {fileName} · {summary.rows} rows · {summary.unique} unique CNs
          </p>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            {[
              ["To Delivered", summary.toDeliver, "text-delivered"],
              ["To Cancelled (RTO)", summary.toCancel, "text-cancelled"],
              ["Conflicts", summary.conflict, "text-pending"],
              ["Delivered — waits for PDF", summary.waitPdf ?? 0, "text-pending"],
              ["Still pending", summary.pending, "text-ink-soft"],
              ["Already done", summary.already, "text-ink-soft"],
              ["Not found", summary.notFound, "text-cancelled"],
              ["With drivers (skipped)", summary.driver, "text-ink-soft"],
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
          {tab === "waitPdf" && visible.length > 0 && (
            <p className="mb-2 text-xs text-ink-soft">
              Excel says Delivered — not marked from the Excel any more. Upload the agent&apos;s payment PDF to mark these Delivered; any not on a PDF show in &quot;Delivered but not paid&quot;.
            </p>
          )}
          {tab === "driver" && visible.length > 0 && (
            <p className="mb-2 text-xs text-ink-soft">These CNs are with our own drivers, not the agent — the upload never changes them.</p>
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
            <table className="data-table min-w-[760px]">
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
                    <td colSpan={8} className="!static !shadow-none"><EmptyState compact icon="inbox" title="Nothing here" /></td>
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
                        {i.order && <span className="block text-[10px] text-ink-soft">{fmtDate(i.order.date)}</span>}
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
          <AmountDiffTable items={items} fileName={fileName} />
        </>
      )}

      <AgentReportHistory refreshKey={historyKey} />
    </div>
  );
}

/**
 * Every CN where the agent's COD amount is not the same as ours — kept in its own
 * table (not only as a note on each row) so the money gaps can be checked in one go.
 * Difference = agent − ours: positive = agent shows more, negative = agent shows less.
 */
function AmountDiffTable({ items, fileName }: { items: Item[]; fileName: string }) {
  const rows = items
    .filter((i) => i.order && i.cod != null && i.cod !== i.order.total)
    .map((i) => ({ i, diff: (i.cod as number) - i.order!.total }))
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  const sumAgent = rows.reduce((s, r) => s + (r.i.cod as number), 0);
  const sumOurs = rows.reduce((s, r) => s + r.i.order!.total, 0);
  const sumDiff = sumAgent - sumOurs;

  function downloadCsv() {
    const head = ["CN", "Date", "Vendor", "Customer", "With", "Report status", "Our status", "Agent amount", "Our amount", "Difference"];
    const lines = rows.map(({ i, diff }) =>
      [i.order!.cnNo, fmtDate(i.order!.date), i.order!.vendor, i.order!.customer ?? "", i.order!.holder ?? "", i.reportStatus, i.order!.status, i.cod, i.order!.total, diff]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",")
    );
    lines.push(["", "", "", "", "", "", "TOTAL", sumAgent, sumOurs, sumDiff].map((v) => `"${v}"`).join(","));
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `amount-differences-${(fileName || "agent-report").replace(/\.[^.]+$/, "")}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <section className="mt-6">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display text-lg font-semibold text-navy">Amount differences — agent vs ours ({rows.length})</h2>
          <p className="text-xs text-ink-soft">CNs where the agent&apos;s COD is not the same as the amount in our Daily Entry. Difference = agent − ours.</p>
        </div>
        {rows.length > 0 && (
          <button onClick={downloadCsv} className="rounded border border-line bg-white px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-navy">
            ⬇ Download CSV
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="border border-line bg-white p-3 text-sm text-delivered">✓ Every matched CN has the same amount as ours.</p>
      ) : (
        <div className="table-wrap border border-line bg-white">
          <table className="data-table min-w-[720px]">
            <thead>
              <tr>
                <th>CN</th>
                <th>Date</th>
                <th>Vendor / Customer</th>
                <th>Report / Ours</th>
                <th className="text-right">Agent amount</th>
                <th className="text-right">Our amount</th>
                <th className="text-right">Difference</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ i, diff }) => (
                <tr key={i.tracking}>
                  <td className="font-mono font-bold text-navy">{i.order!.cnNo}</td>
                  <td className="font-mono text-xs">{fmtDate(i.order!.date)}</td>
                  <td>
                    <span className="block">{i.order!.vendor}</span>
                    {i.order!.customer && <span className="text-xs text-ink-soft">{i.order!.customer}</span>}
                  </td>
                  <td className="text-xs">
                    {i.reportStatus} · <Pill s={i.order!.status} />
                  </td>
                  <td className="text-right font-mono">{fmtNumber(i.cod as number)}</td>
                  <td className="text-right font-mono">{fmtNumber(i.order!.total)}</td>
                  <td className={`text-right font-mono font-bold ${diff > 0 ? "text-delivered" : "text-cancelled"}`}>
                    {diff > 0 ? "+" : ""}
                    {fmtNumber(diff)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>Total ({rows.length} CNs)</td>
                <td className="text-right font-mono">{fmtNumber(sumAgent)}</td>
                <td className="text-right font-mono">{fmtNumber(sumOurs)}</td>
                <td className={`text-right font-mono ${sumDiff >= 0 ? "text-delivered" : "text-cancelled"}`}>
                  {sumDiff > 0 ? "+" : ""}
                  {fmtNumber(sumDiff)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

interface UnpaidRow {
  cn: string;
  deliveredOn: string;
  cod: number | null;
  file: string | null;
  order: { date: string; status: string; total: number; vendor: string; customer: string | null; holder: string | null } | null;
}
interface UnpaidData {
  start: string;
  cutoff: string | null;
  lastPdfFile: string | null;
  lastExcelFile: string | null;
  rows: UnpaidRow[];
  total: number;
}

const dmy = (d: string) => fmtDate(d);

/**
 * Delivered but not paid: CNs the agent's Excel shows Delivered (on or before the latest
 * payment PDF's date) that are on no payment PDF. Counts from the start date only.
 */
function UnpaidTable({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<UnpaidData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch<UnpaidData>("/agent-report/unpaid")
      .then((r) => {
        setData(r);
        setError("");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load payment check"));
  }, [refreshKey]);

  function downloadCsv() {
    if (!data) return;
    const head = ["CN", "Delivered on", "Vendor", "Customer", "With", "Our status", "Amount", "From Excel"];
    const lines = data.rows.map((r) =>
      [r.cn, dmy(r.deliveredOn), r.order?.vendor ?? "", r.order?.customer ?? "", r.order?.holder ?? "", r.order?.status ?? "Not found", r.cod ?? "", r.file ?? ""]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",")
    );
    lines.push(["", "", "", "", "", "TOTAL", data.total, ""].map((v) => `"${v}"`).join(","));
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `delivered-not-paid-till-${data.cutoff ?? "na"}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <section className="mb-6 border border-brass bg-white p-3 md:p-4">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display text-lg font-semibold text-navy">
            Delivered but not paid{data && data.cutoff ? ` — till ${dmy(data.cutoff)}` : ""} ({data?.rows.length ?? 0})
          </h2>
          <p className="text-xs text-ink-soft">
            Excel says Delivered, but the CN is on no payment PDF — up to the latest PDF&apos;s date. Counting from {data ? dmy(data.start) : "…"}; earlier deliveries are ignored.
            {data?.lastPdfFile && <> Latest PDF: <b>{data.lastPdfFile}</b>.</>}
          </p>
        </div>
        {data && data.rows.length > 0 && (
          <button onClick={downloadCsv} className="rounded border border-line bg-white px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-navy">
            ⬇ Download CSV
          </button>
        )}
      </div>

      {error && <p className="text-sm text-cancelled">{error}</p>}
      {data && !data.cutoff && (
        <p className="border border-line bg-paper p-3 text-sm text-ink-soft">Upload the agent&apos;s payment PDF to check it against the Excel.</p>
      )}
      {data && data.cutoff && data.rows.length === 0 && (
        <p className="border border-line bg-paper p-3 text-sm text-delivered">✓ Every delivered CN till {dmy(data.cutoff)} is on a payment PDF.</p>
      )}
      {data && data.rows.length > 0 && (
        <div className="table-wrap border border-line">
          <table className="data-table min-w-[720px]">
            <thead>
              <tr>
                <th>CN</th>
                <th>Delivered on</th>
                <th>Vendor / Customer</th>
                <th>With</th>
                <th>Ours now</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.cn}>
                  <td className="font-mono font-bold text-navy">{r.cn}</td>
                  <td className="font-mono text-xs">{dmy(r.deliveredOn)}</td>
                  <td>
                    <span className="block">{r.order?.vendor ?? "—"}</span>
                    {r.order?.customer && <span className="text-xs text-ink-soft">{r.order.customer}</span>}
                  </td>
                  <td className="text-xs">{r.order?.holder ?? ""}</td>
                  <td>{r.order ? <Pill s={r.order.status} /> : <span className="text-xs text-cancelled">Not found</span>}</td>
                  <td className="text-right font-mono">{r.cod != null ? fmtNumber(r.cod) : "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5}>Total not paid ({data.rows.length} CNs)</td>
                <td className="text-right font-mono text-cancelled">{fmtNumber(data.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

interface PickupOrder {
  date: string;
  status: string;
  total: number;
  vendor: string;
  customer: string | null;
  holder: string | null;
}
type PickupType = "CANCEL" | "PICKUP";
interface PickupPending {
  cn: string;
  on: string;
  order: PickupOrder;
}
interface PickupReceived extends PickupPending {
  receivedAt: string;
  by: string | null;
}
interface PickupList {
  pending: PickupPending[];
  received: PickupReceived[];
}
interface PickupData {
  start: string;
  cancel: PickupList;
  pickup: PickupList;
}

const PICK_INFO: Record<PickupType, { title: string; on: string; note: string }> = {
  CANCEL: { title: "Cancelled (RTO)", on: "RTO on", note: "RTO in the agent's Excel and cancelled in Daily Entry." },
  PICKUP: { title: "Pickup delivery", on: "Picked up", note: "Label says PICKUP — the agent collected it from the customer (Excel or PDF shows done)." },
};

/**
 * Parcels to collect back from the agent. One scan bar — the server decides whether the CN
 * is a Cancelled (RTO) parcel or a Pickup delivery, and it lands in that box as Received back.
 */
function PickupTable({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<PickupData | null>(null);
  const [error, setError] = useState("");
  const [scan, setScan] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function load() {
    apiFetch<PickupData>("/agent-report/pickup")
      .then((r) => {
        setData(r);
        setError("");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load pickup list"));
  }
  useEffect(load, [refreshKey]);

  async function receive(raw: string) {
    const cn = raw.replace(/\D/g, "");
    setScan("");
    if (!cn || busy) return;
    setBusy(true);
    try {
      const r = await apiFetch<{ cn: string; type: PickupType; order: PickupOrder | null }>("/agent-report/pickup/receive", { method: "POST", body: { cn } });
      setMsg({
        ok: true,
        text: `✓ CN ${r.cn} received back — ${r.type === "CANCEL" ? "CANCELLED" : "PICKUP"}${r.order ? ` · ${r.order.vendor}${r.order.customer ? " · " + r.order.customer : ""}` : ""}`,
      });
      load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not mark received" });
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  async function undo(cn: string, type: PickupType) {
    if (!(await confirmDialog(`Undo "received back" for CN ${cn}? It goes back on the list to receive.`))) return;
    try {
      await apiFetch("/agent-report/pickup/undo", { method: "POST", body: { cn, type } });
      setMsg({ ok: true, text: `CN ${cn} back on the list to receive` });
      load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Undo failed" });
    }
  }

  const nCancel = data?.cancel.pending.length ?? 0;
  const nPickup = data?.pickup.pending.length ?? 0;

  return (
    <section className="mb-6 border border-brass bg-white p-3 md:p-4">
      <div className="mb-3">
        <h2 className="font-display text-lg font-semibold text-navy">Collect from agent — pending to receive ({nCancel + nPickup})</h2>
        <p className="text-xs text-ink-soft">
          Scan the CN when the parcel is back — it goes to <b>Cancelled</b> or <b>Pickup</b> on its own. Counting from {data ? fmtDate(data.start) : "…"}.
        </p>
      </div>

      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          receive(scan);
        }}
      >
        <input
          ref={inputRef}
          value={scan}
          onChange={(e) => setScan(e.target.value)}
          inputMode="numeric"
          placeholder="Scan or type CN — received back"
          className="min-w-0 flex-1 rounded border border-line bg-paper px-3 py-2 font-mono text-sm text-navy"
        />
        <button type="submit" disabled={busy || !scan.trim()} className="rounded bg-navy px-4 py-2 font-mono text-xs font-bold uppercase tracking-wide text-paper disabled:opacity-40">
          {busy ? "…" : "Received"}
        </button>
      </form>
      {msg && (
        <p className={`mb-3 rounded border p-2 text-sm ${msg.ok ? "border-delivered bg-delivered-bg text-delivered" : "border-cancelled bg-cancelled-bg text-cancelled"}`}>{msg.text}</p>
      )}
      {error && <p className="mb-2 text-sm text-cancelled">{error}</p>}

      <div className="grid gap-3 xl:grid-cols-2">
        <PickupBox type="CANCEL" list={data?.cancel} onUndo={undo} />
        <PickupBox type="PICKUP" list={data?.pickup} onUndo={undo} />
      </div>
    </section>
  );
}

function PickupBox({ type, list, onUndo }: { type: PickupType; list?: PickupList; onUndo: (cn: string, type: PickupType) => void }) {
  const [view, setView] = useState<"pending" | "received">("pending");
  const info = PICK_INFO[type];
  const pending = list?.pending ?? [];
  const received = list?.received ?? [];
  const total = pending.reduce((s, r) => s + r.order.total, 0);

  function downloadCsv() {
    const head = ["CN", info.on, "Order date", "Vendor", "Customer", "With", "Amount"];
    const lines = pending.map((r) =>
      [r.cn, fmtDate(r.on), fmtDate(r.order.date), r.order.vendor, r.order.customer ?? "", r.order.holder ?? "", r.order.total]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",")
    );
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${type === "CANCEL" ? "cancelled" : "pickup"}-to-receive-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="border border-line p-3">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className={`font-display text-base font-semibold ${type === "CANCEL" ? "text-cancelled" : "text-navy"}`}>
            {type === "PICKUP" ? "⇄ " : ""}
            {info.title}
          </h3>
          <p className="text-[11px] text-ink-soft">{info.note}</p>
        </div>
        {view === "pending" && pending.length > 0 && (
          <button onClick={downloadCsv} className="rounded border border-line bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-navy">
            ⬇ CSV
          </button>
        )}
      </div>
      <div className="mb-2 flex flex-wrap gap-1">
        {(
          [
            ["pending", `Pending to receive (${pending.length})`],
            ["received", `Received back (${received.length})`],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setView(k)}
            className={`rounded px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide ${view === k ? "bg-navy text-paper" : "border border-line bg-white text-ink-soft"}`}
          >
            {l}
          </button>
        ))}
      </div>

      {view === "pending" &&
        (pending.length === 0 ? (
          <p className="border border-line bg-paper p-3 text-sm text-delivered">✓ Nothing pending to receive.</p>
        ) : (
          <div className="table-wrap border border-line">
            <table className="data-table min-w-[560px]">
              <thead>
                <tr>
                  <th>CN</th>
                  <th>{info.on}</th>
                  <th>Vendor / Customer</th>
                  <th>With</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((r) => (
                  <tr key={r.cn}>
                    <td className="font-mono font-bold text-navy">
                      {r.cn}
                      <span className="block text-[10px] font-normal text-ink-soft">{fmtDate(r.order.date)}</span>
                    </td>
                    <td className="font-mono text-xs">{fmtDate(r.on)}</td>
                    <td>
                      <span className="block">{r.order.vendor}</span>
                      {r.order.customer && <span className="text-xs text-ink-soft">{r.order.customer}</span>}
                    </td>
                    <td className="text-xs">{r.order.holder ?? ""}</td>
                    <td className="text-right font-mono">{fmtNumber(r.order.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>Pending to receive ({pending.length})</td>
                  <td className="text-right font-mono">{fmtNumber(total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ))}

      {view === "received" &&
        (received.length === 0 ? (
          <p className="border border-line bg-paper p-3 text-sm text-ink-soft">Nothing received back yet.</p>
        ) : (
          <div className="table-wrap border border-line">
            <table className="data-table min-w-[560px]">
              <thead>
                <tr>
                  <th>CN</th>
                  <th>Received back</th>
                  <th>Vendor / Customer</th>
                  <th>By</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {received.map((r) => (
                  <tr key={r.cn}>
                    <td className="font-mono font-bold text-navy">
                      {r.cn}
                      <span className="block text-[10px] font-normal text-ink-soft">
                        {info.on} {fmtDate(r.on)}
                      </span>
                    </td>
                    <td className="font-mono text-xs">{fmtDateTime(r.receivedAt)}</td>
                    <td>
                      <span className="block">{r.order.vendor}</span>
                      {r.order.customer && <span className="text-xs text-ink-soft">{r.order.customer}</span>}
                    </td>
                    <td className="text-xs">{r.by ?? ""}</td>
                    <td className="text-right">
                      <button onClick={() => onUndo(r.cn, type)} className="font-mono text-[11px] uppercase text-cancelled underline">
                        Undo
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
}
