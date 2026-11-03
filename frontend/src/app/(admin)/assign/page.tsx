"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiClientError } from "@/lib/api";
import { fmtNumber } from "@/lib/format";
import BarcodeScanner, { beep, pickClashChoice } from "@/components/BarcodeScanner";
import ScanHistory, { DriverScanExport } from "@/components/ScanHistory";
import ScanProgressPanel from "@/components/ScanProgressPanel";
import { Employee } from "@/types";

import { confirmDialog } from "@/components/ui/Feedback";
interface ScanLog {
  at: Date;
  code: string;
  ok: boolean;
  kind: "ACCEPTED" | "REASSIGNED" | "ALREADY" | "ERROR";
  message: string;
  driver: string;
  vendor?: string;
  total?: number;
  customer?: string;
}

const DRIVER_KEY = "assignDriverId";
type Tab = "scan" | "drivers" | "history";

export default function AssignPage() {
  const [drivers, setDrivers] = useState<Employee[]>([]);
  const [driverId, setDriverId] = useState("");
  const [log, setLog] = useState<ScanLog[]>([]);
  const [tab, setTab] = useState<Tab>("scan");

  useEffect(() => {
    apiFetch<Employee[]>("/employees")
      .then((list) => {
        const active = list.filter((e) => e.active && (e.role ?? "DRIVER") === "DRIVER");
        setDrivers(active);
        try {
          const saved = localStorage.getItem(DRIVER_KEY);
          if (saved && active.some((d) => d.id === saved)) setDriverId(saved);
        } catch {
          /* ignore */
        }
      })
      .catch(() => {});
  }, []);

  function chooseDriver(id: string) {
    setDriverId(id);
    try {
      localStorage.setItem(DRIVER_KEY, id);
    } catch {
      /* ignore */
    }
  }

  const driverName = drivers.find((d) => d.id === driverId)?.name ?? "";

  async function onCode(code: string, confirm = false, vendorId?: string): Promise<void> {
    if (!driverId) return;
    try {
      const r = await apiFetch<{
        result: "ACCEPTED" | "REASSIGNED" | "ALREADY";
        message: string;
        order: { cnNo: number; total: number; vendor: { name: string }; booking?: { customerName: string } | null };
      }>("/bookings/scan-assign", { method: "POST", body: { code, employeeId: driverId, ...(vendorId ? { vendorId } : {}), ...(confirm ? { confirm: true } : {}) } });
      beep(r.result !== "ALREADY");
      setLog((prev) => [
        {
          at: new Date(),
          code,
          ok: true,
          kind: r.result,
          message: r.message,
          driver: driverName,
          vendor: r.order.vendor.name,
          total: r.order.total,
        },
        ...prev,
      ]);
    } catch (err) {
      // A match by vendor bill No., or moving a parcel from another driver: ask first.
      if (!confirm && err instanceof ApiClientError && (err.details as { code?: string } | undefined)?.code === "CONFIRM_SCAN") {
        beep(true);
        if (await confirmDialog(err.message)) return onCode(code, true, vendorId);
        setLog((prev) => [{ at: new Date(), code, ok: false, kind: "ERROR", message: `Skipped — ${err.message}`, driver: driverName }, ...prev]);
        return;
      }
      // Same number is our CN and a vendor bill No. — ask which one.
      const pick = !vendorId ? pickClashChoice(err) : undefined;
      if (pick) return onCode(code, confirm, pick);
      beep(false);
      setLog((prev) => [
        { at: new Date(), code, ok: false, kind: "ERROR", message: pick === null ? `Skipped — ${code}` : err instanceof Error ? err.message : "Failed", driver: driverName },
        ...prev,
      ]);
    }
  }

  const added = log.filter((l) => l.kind === "ACCEPTED").length;
  const moved = log.filter((l) => l.kind === "REASSIGNED").length;
  const errors = log.filter((l) => l.kind === "ERROR").length;
  const totalAed = log.filter((l) => l.kind === "ACCEPTED" || l.kind === "REASSIGNED").reduce((s, l) => s + (l.total ?? 0), 0);

  const tone: Record<ScanLog["kind"], { box: string; tag: string; dot: string; head: string }> = {
    ACCEPTED: { box: "border-delivered bg-delivered-bg", tag: "bg-delivered-bg text-delivered", dot: "bg-delivered", head: "text-delivered" },
    REASSIGNED: { box: "border-pending bg-pending-bg", tag: "bg-pending-bg text-pending", dot: "bg-pending", head: "text-pending" },
    ALREADY: { box: "border-line bg-paper-2", tag: "bg-paper-2 text-ink-soft", dot: "bg-ink-soft", head: "text-ink-soft" },
    ERROR: { box: "border-cancelled bg-cancelled-bg", tag: "bg-cancelled-bg text-cancelled", dot: "bg-cancelled", head: "text-cancelled" },
  };
  const kindLabel: Record<ScanLog["kind"], string> = { ACCEPTED: "Assigned", REASSIGNED: "Moved", ALREADY: "Already", ERROR: "Failed" };
  const headLine = (l: ScanLog) =>
    l.kind === "ACCEPTED" ? `Assigned to ${l.driver}` : l.kind === "REASSIGNED" ? `Moved to ${l.driver}` : l.kind === "ALREADY" ? `Already with ${l.driver}` : "Not assigned";
  const last = log[0];

  const tabBtn = (t: Tab, label: string) => (
    <button
      key={t}
      onClick={() => setTab(t)}
      className={`rounded-md px-3.5 py-2 text-[13px] font-semibold ${tab === t ? "bg-navy text-paper" : "text-ink-soft hover:text-ink"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
      {/* Header: title · today's export · tabs — ends where the camera button ends */}
      <div className="flex min-w-0 flex-wrap items-end justify-between gap-3 lg:col-start-1">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-brass">Dispatch</p>
            <h1 className="font-display text-[26px] font-semibold tracking-tight text-navy md:text-[30px]">Scan &amp; Assign</h1>
          </div>
          <DriverScanExport driverName={driverName} refreshKey={log.length} variant="header" />
        </div>
        <div className="flex gap-1 rounded-lg border border-line bg-white p-1">
          {tabBtn("scan", "Scan")}
          {tabBtn("drivers", "Today by driver")}
          {tabBtn("history", "Scan history")}
        </div>
      </div>
      <div className="hidden lg:block" aria-hidden="true" />

      {/* Driver + scan box + camera on one line */}
      <div className="min-w-0 lg:col-start-1">
        <BarcodeScanner
          big
          onCode={(c) => onCode(c)}
          disabled={!driverId}
          placeholder={driverId ? "Scan barcode or type CN, then Enter" : "Choose a driver first"}
          leading={
            <select
              value={driverId}
              onChange={(e) => chooseDriver(e.target.value)}
              aria-label="Driver"
              className={`min-h-[64px] w-44 shrink-0 rounded-xl border-2 bg-paper-2 px-3 text-lg font-bold sm:w-56 ${driverId ? "border-brass text-navy" : "border-cancelled text-ink-soft"}`}
            >
              <option value="">Choose driver…</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.isAgent ? " (agent)" : ""}
                </option>
              ))}
            </select>
          }
        />
      </div>
      <div className="hidden lg:block" aria-hidden="true" />

      {tab === "scan" ? (
        <>
          <div className="flex min-w-0 flex-col gap-4 lg:col-start-1">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              {/* Latest result */}
              {last ? (
                <div key={last.at.getTime()} role="status" className={`scan-flash rounded-xl border-2 p-4 ${tone[last.kind].box}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`font-mono text-[11px] font-bold uppercase tracking-[0.12em] ${tone[last.kind].head}`}>{headLine(last)}</span>
                    <span className="font-mono text-[11px] text-ink-soft">{last.at.toLocaleTimeString("en-GB")}</span>
                  </div>
                  <div className="mt-1 font-mono text-2xl font-bold text-ink">{last.code}</div>
                  <div className="mt-1 text-sm text-ink">
                    {[last.vendor, last.total != null ? `AED ${fmtNumber(last.total)} COD` : ""].filter(Boolean).join(" · ")}
                  </div>
                  <div className="mt-1 text-xs text-ink-soft">{last.message}</div>
                </div>
              ) : (
                <div className="flex items-center rounded-xl border border-dashed border-line bg-white p-4 text-sm text-ink-soft">
                  {driverId ? "Scan a parcel — the result shows here." : "Choose a driver, then scan."}
                </div>
              )}

              {/* This session */}
              <div className="rounded-xl border border-line bg-white p-4">
                <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-soft">This session</div>
                <div className="font-display text-3xl font-semibold text-navy">{added + moved}</div>
                <div className="text-sm text-ink-soft">
                  parcels · <span className="font-semibold text-brass">AED {fmtNumber(totalAed)}</span>
                </div>
                <div className="text-xs text-ink-soft">
                  {added} new · {moved} moved · {errors} failed
                </div>
                <DriverScanExport driverName={driverName} refreshKey={log.length} />
              </div>
            </div>

            {/* Last scans */}
            <div className="flex min-h-[260px] flex-1 flex-col rounded-xl border border-line bg-white">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <span className="font-display text-[17px] font-semibold text-navy">Last scans</span>
                <div className="flex items-center gap-3 text-xs">
                  {log.length > 0 && (
                    <button onClick={() => setLog([])} className="text-ink-soft hover:underline">
                      Clear list
                    </button>
                  )}
                  <button onClick={() => setTab("history")} className="font-semibold text-brass hover:underline">
                    Open full history
                  </button>
                </div>
              </div>
              {log.length === 0 ? (
                <p className="p-4 text-sm text-ink-soft">No scans yet in this session.</p>
              ) : (
                <div className="divide-y divide-line">
                  {log.map((l, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${tone[l.kind].dot}`} />
                      <span className="w-24 shrink-0 font-mono font-semibold">{l.code}</span>
                      <span className="min-w-0 flex-1 truncate" title={l.message}>
                        <span className="font-semibold">{l.vendor ?? ""}</span>
                        <span className="text-ink-soft"> {l.vendor ? "· " : ""}{l.message}</span>
                      </span>
                      <span className="w-16 shrink-0 text-right font-mono">{l.total != null ? fmtNumber(l.total) : ""}</span>
                      <span className={`shrink-0 rounded px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${tone[l.kind].tag}`}>{kindLabel[l.kind]}</span>
                      <span className="w-16 shrink-0 text-right font-mono text-[11px] text-ink-soft">{l.at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <aside className="min-w-0">
            <ScanProgressPanel refreshKey={log.length} />
          </aside>
        </>
      ) : (
        <div className="min-w-0 lg:col-span-2">
          <ScanHistory view={tab === "drivers" ? "drivers" : "list"} inTab />
        </div>
      )}
    </div>
  );
}
