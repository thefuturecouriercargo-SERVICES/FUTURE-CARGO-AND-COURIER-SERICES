"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ApiClientError } from "@/lib/api";
import { fmtNumber, fmtDate, fmtDateTime } from "@/lib/format";
import { shrink } from "@/components/DriverKm";
import { confirmDialog } from "@/components/ui/Feedback";
import EmptyState from "@/components/ui/EmptyState";
import Icon from "@/components/Icon";

interface Receipt {
  id: string;
  orderId: string;
  cnNo: number;
  employeeName: string;
  amount: number;
  mime: string;
  readAmount: number | null;
  readDate: string | null;
  readRef: string | null;
  readFrom: string | null;
  readNote: string | null;
  readDone: boolean;
  status: "WAITING" | "RECEIVED" | "NOT_RECEIVED";
  matchLine: string | null;
  checkedAt: string | null;
  createdAt: string;
  hasFile: boolean;
  vendor: string | null;
  customer: string | null;
  orderStatus: string | null;
  payment: string | null;
}
interface Missing {
  orderId: string;
  cnNo: number;
  total: number;
  on: string | null;
  driver: string;
  vendor: string;
  customer: string | null;
  confirmed: boolean;
}
interface Statement {
  fileName: string;
  toDate: string | null;
  at: string;
  credits: number;
  state: "READING" | "DONE" | "FAILED";
  result: string | null;
}

type TileKey = "NOT_RECEIVED" | "WAITING" | "RECEIVED" | "MISSING";
const TILES: { key: TileKey; label: string; icon: "ban" | "hourglass" | "checkCircle" | "alert"; cls: string }[] = [
  { key: "NOT_RECEIVED", label: "NOT RECEIVED", icon: "ban", cls: "text-cancelled" },
  { key: "WAITING", label: "WAITING", icon: "hourglass", cls: "text-pending" },
  { key: "RECEIVED", label: "RECEIVED", icon: "checkCircle", cls: "text-delivered" },
  { key: "MISSING", label: "NO RECEIPT", icon: "alert", cls: "text-cancelled" },
];
const PILL: Record<Receipt["status"], string> = {
  RECEIVED: "bg-delivered-bg text-delivered",
  NOT_RECEIVED: "bg-cancelled-bg text-cancelled",
  WAITING: "bg-pending-bg text-pending",
};
const LABEL: Record<Receipt["status"], string> = { RECEIVED: "RECEIVED", NOT_RECEIVED: "NOT RECEIVED YET", WAITING: "WAITING FOR STATEMENT" };

/** Excel/CSV statement → plain rows of text for the reader. */
async function sheetToText(file: File): Promise<string> {
  if (/\.csv$/i.test(file.name) || file.type === "text/csv") return (await file.text()).slice(0, 380_000);
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const lines: string[] = [];
  wb.eachSheet((ws) => {
    ws.eachRow((row) => {
      const vals = (row.values as unknown[]).slice(1).map((v) => {
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        if (v && typeof v === "object" && "result" in (v as object)) return String((v as { result: unknown }).result ?? "");
        if (v && typeof v === "object" && "text" in (v as object)) return String((v as { text: unknown }).text ?? "");
        return v == null ? "" : String(v);
      });
      lines.push(vals.join(" | "));
    });
  });
  return lines.join("\n").slice(0, 380_000);
}

function fileToDataUrl(file: File, mime: string): Promise<string> {
  return new Promise((ok, bad) => {
    const fr = new FileReader();
    fr.onload = () => ok(String(fr.result).replace(/^data:[^;]*;/, `data:${mime};`));
    fr.onerror = () => bad(fr.error);
    fr.readAsDataURL(file);
  });
}

export default function BankReceiptsPage() {
  const [receipts, setReceipts] = useState<Receipt[] | null>(null);
  const [missing, setMissing] = useState<Missing[]>([]);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [open, setOpen] = useState<TileKey | "">("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const r = await apiFetch<{ receipts: Receipt[]; missing: Missing[]; lastStatement: Statement | null }>("/bank-receipts");
    setReceipts(r.receipts);
    setMissing(r.missing);
    setStatement(r.lastStatement);
    return r;
  }, []);
  useEffect(() => {
    load().catch(() => setReceipts([]));
  }, [load]);

  // While a statement is being read, check every 5 s.
  useEffect(() => {
    if (statement?.state !== "READING") return;
    const t = setInterval(() => {
      load()
        .then((r) => {
          if (r.lastStatement?.state === "DONE") setMsg({ ok: true, text: r.lastStatement.result ?? "STATEMENT CHECKED" });
          if (r.lastStatement?.state === "FAILED") setMsg({ ok: false, text: r.lastStatement.result ?? "COULD NOT READ THE STATEMENT" });
        })
        .catch(() => undefined);
    }, 5000);
    return () => clearInterval(t);
  }, [statement?.state, load]);

  async function uploadStatement(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      const isSheet = /\.(xlsx|xlsm|csv)$/i.test(file.name);
      let body: { fileName: string; dataUrl?: string; text?: string };
      if (isSheet) body = { fileName: file.name, text: await sheetToText(file) };
      else if (isPdf) {
        if (file.size > 7_000_000) throw new ApiClientError(413, "PDF IS TOO BIG (MAX 7 MB)");
        body = { fileName: file.name, dataUrl: await fileToDataUrl(file, "application/pdf") };
      } else body = { fileName: file.name, dataUrl: await shrink(file, 2400, 0.85) };
      await apiFetch("/bank-receipts/statement", { method: "POST", body });
      setMsg({ ok: true, text: "READING THE STATEMENT…" });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiClientError ? e.message : "UPLOAD FAILED" });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function mark(r: Receipt, status: Receipt["status"]) {
    if (!(await confirmDialog(`MARK CN ${r.cnNo} AS ${LABEL[status]}?`))) return;
    await apiFetch(`/bank-receipts/${r.id}/mark`, { method: "POST", body: { status } });
    await load();
  }

  const count = (k: TileKey) => (k === "MISSING" ? missing.length : (receipts ?? []).filter((r) => r.status === k).length);
  const list = (receipts ?? []).filter((r) => r.status === open);
  const reading = statement?.state === "READING";

  return (
    <div className="max-w-6xl">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-brass">Finance</p>
      <h1 className="mb-4 font-display text-[26px] font-semibold tracking-tight text-navy md:text-[32px]">Bank receipts</h1>

      <label
        className={`mb-2 flex cursor-pointer flex-col items-center justify-center rounded border-2 border-dashed border-brass bg-white px-4 py-6 text-center hover:bg-paper ${busy || reading ? "pointer-events-none opacity-60" : ""}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          uploadStatement(e.dataTransfer.files?.[0]);
        }}
      >
        <span className="text-2xl"><Icon name="file" /></span>
        <span className="mt-1 font-semibold text-navy">{busy ? "UPLOADING…" : reading ? "READING STATEMENT…" : "UPLOAD BANK STATEMENT"}</span>
        <span className="text-xs text-ink-soft">PDF · EXCEL · CSV · PHOTO</span>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.xlsx,.xlsm,.csv,image/*,application/pdf"
          className="hidden"
          onChange={(e) => uploadStatement(e.target.files?.[0])}
        />
      </label>
      {statement && (
        <p className="mb-4 text-xs text-ink-soft">
          LAST STATEMENT: <b className="text-navy">{statement.fileName}</b> · {fmtDateTime(statement.at)}
          {statement.toDate ? ` · UP TO ${fmtDate(statement.toDate)}` : ""}
          {statement.state === "DONE" && statement.result ? ` · ${statement.result}` : ""}
        </p>
      )}
      {msg && (
        <p className={`mb-4 rounded border p-3 text-sm font-semibold ${msg.ok ? "border-delivered bg-delivered-bg text-delivered" : "border-cancelled bg-cancelled-bg text-cancelled"}`}>{msg.text}</p>
      )}

      <div className="mb-3 grid grid-cols-4 gap-2">
        {TILES.map((t) => {
          const n = receipts ? count(t.key) : null;
          return (
            <button
              key={t.key}
              onClick={() => setOpen((o) => (o === t.key ? "" : t.key))}
              className={`flex flex-col items-center rounded-lg border p-3 text-center transition ${open === t.key ? "border-2 border-brass bg-paper" : "border-line bg-white"}`}
            >
              <Icon name={t.icon} size={18} className="text-brass" />
              <span className="mt-1 font-mono text-[11px] font-semibold uppercase tracking-wide text-navy">{t.label}</span>
              <span className={`font-display text-xl font-semibold ${n ? t.cls : "text-ink-soft"}`}>{n ?? "—"}</span>
            </button>
          );
        })}
      </div>

      {open && open !== "MISSING" && (
        <div className="mb-6 overflow-x-auto rounded-lg border border-brass bg-white p-3">
          <table className="data-table min-w-[820px]">
            <thead className="bg-paper font-mono text-[10px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="p-2 text-left">CN</th>
                <th className="p-2 text-left">Added</th>
                <th className="p-2 text-left">Driver</th>
                <th className="p-2 text-left">Vendor / Customer</th>
                <th className="p-2 text-right">CN amount</th>
                <th className="p-2 text-left">Receipt</th>
                <th className="p-2 text-left">Status</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && (
                <tr>
                  <td colSpan={8} className="!static !shadow-none"><EmptyState compact icon="inbox" title="NOTHING HERE" /></td>
                </tr>
              )}
              {list.map((r) => {
                const diff = r.readAmount != null && Math.abs(r.readAmount - r.amount) >= 0.5;
                return (
                  <tr key={r.id} className="border-t border-line align-top">
                    <td className="p-2 font-mono font-bold text-navy">{r.cnNo}</td>
                    <td className="p-2 text-xs">{fmtDateTime(r.createdAt)}</td>
                    <td className="p-2 text-xs">{r.employeeName}</td>
                    <td className="p-2 text-xs">
                      {r.vendor}
                      {r.customer && <span className="block text-ink-soft">{r.customer}</span>}
                    </td>
                    <td className="p-2 text-right font-mono text-xs">{fmtNumber(r.amount)}</td>
                    <td className="p-2 text-xs">
                      {!r.readDone ? (
                        <span className="text-ink-soft">READING…</span>
                      ) : (
                        <>
                          <span className={diff ? "font-semibold text-cancelled" : ""}>{r.readAmount != null ? `AED ${fmtNumber(r.readAmount)}` : "AMOUNT NOT READ"}</span>
                          {r.readDate && <span className="block text-ink-soft">{fmtDate(r.readDate)}</span>}
                          {r.readRef && <span className="block font-mono text-[10px] text-ink-soft">REF {r.readRef}</span>}
                          {r.readNote && <span className="block text-pending">{r.readNote}</span>}
                        </>
                      )}
                      {r.hasFile ? (
                        <a href={`/api/bank-receipts/${r.id}/file`} target="_blank" rel="noreferrer" className="mt-1 inline-block font-semibold text-navy underline">
                          VIEW {r.mime === "application/pdf" ? "PDF" : "PHOTO"}
                        </a>
                      ) : (
                        <span className="mt-1 block text-[10px] text-ink-soft">FILE REMOVED (7 DAYS)</span>
                      )}
                    </td>
                    <td className="p-2 text-xs">
                      <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${PILL[r.status]}`}>{LABEL[r.status]}</span>
                      {r.matchLine && <span className="mt-1 block text-[10px] text-ink-soft">{r.matchLine}</span>}
                    </td>
                    <td className="p-2 text-right">
                      {r.status !== "RECEIVED" ? (
                        <button onClick={() => mark(r, "RECEIVED")} className="rounded border border-delivered px-2 py-1 font-mono text-[10px] font-bold uppercase text-delivered">
                          Received
                        </button>
                      ) : (
                        <button onClick={() => mark(r, "WAITING")} className="rounded border border-line px-2 py-1 font-mono text-[10px] font-bold uppercase text-ink-soft">
                          Undo
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {open === "MISSING" && (
        <div className="mb-6 overflow-x-auto rounded-lg border border-brass bg-white p-3">
          <table className="data-table min-w-[640px]">
            <thead className="bg-paper font-mono text-[10px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="p-2 text-left">CN</th>
                <th className="p-2 text-left">Delivered</th>
                <th className="p-2 text-left">Driver</th>
                <th className="p-2 text-left">Vendor / Customer</th>
                <th className="p-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {missing.length === 0 && (
                <tr>
                  <td colSpan={5} className="!static !shadow-none"><EmptyState compact icon="inbox" title="EVERY BANK CN HAS A RECEIPT" /></td>
                </tr>
              )}
              {missing.map((m) => (
                <tr key={m.orderId} className="border-t border-line">
                  <td className="p-2 font-mono font-bold text-navy">{m.cnNo}</td>
                  <td className="p-2 text-xs">{m.on ? fmtDateTime(m.on) : ""}</td>
                  <td className="p-2 text-xs">{m.driver}</td>
                  <td className="p-2 text-xs">
                    {m.vendor}
                    {m.customer && <span className="block text-ink-soft">{m.customer}</span>}
                  </td>
                  <td className="p-2 text-right font-mono text-xs">{fmtNumber(m.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
