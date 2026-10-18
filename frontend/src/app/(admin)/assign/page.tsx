"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiClientError } from "@/lib/api";
import { fmtNumber } from "@/lib/format";
import BarcodeScanner, { beep } from "@/components/BarcodeScanner";
import BillTypeSelect from "@/components/BillTypeSelect";
import ScanHistory from "@/components/ScanHistory";
import { Employee } from "@/types";

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

export default function AssignPage() {
  const [drivers, setDrivers] = useState<Employee[]>([]);
  const [driverId, setDriverId] = useState("");
  const [log, setLog] = useState<ScanLog[]>([]);
  const [billVendorId, setBillVendorId] = useState("");

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

  async function onCode(code: string, confirm = false): Promise<void> {
    if (!driverId) return;
    try {
      const r = await apiFetch<{
        result: "ACCEPTED" | "REASSIGNED" | "ALREADY";
        message: string;
        order: { cnNo: number; total: number; vendor: { name: string }; booking?: { customerName: string } | null };
      }>("/bookings/scan-assign", { method: "POST", body: { code, employeeId: driverId, ...(billVendorId ? { vendorId: billVendorId } : {}), ...(confirm ? { confirm: true } : {}) } });
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
        if (window.confirm(err.message)) return onCode(code, true);
        setLog((prev) => [{ at: new Date(), code, ok: false, kind: "ERROR", message: `Skipped — ${err.message}`, driver: driverName }, ...prev]);
        return;
      }
      beep(false);
      setLog((prev) => [
        { at: new Date(), code, ok: false, kind: "ERROR", message: err instanceof Error ? err.message : "Failed", driver: driverName },
        ...prev,
      ]);
    }
  }

  const added = log.filter((l) => l.kind === "ACCEPTED").length;
  const moved = log.filter((l) => l.kind === "REASSIGNED").length;
  const errors = log.filter((l) => l.kind === "ERROR").length;
  const totalAed = log.filter((l) => l.kind === "ACCEPTED" || l.kind === "REASSIGNED").reduce((s, l) => s + (l.total ?? 0), 0);

  const kindStyle: Record<ScanLog["kind"], string> = {
    ACCEPTED: "border-delivered bg-delivered-bg text-delivered",
    REASSIGNED: "border-transferred bg-transferred-bg text-transferred",
    ALREADY: "border-line bg-paper text-ink-soft",
    ERROR: "border-cancelled bg-cancelled-bg text-cancelled",
  };
  const kindLabel: Record<ScanLog["kind"], string> = { ACCEPTED: "Added", REASSIGNED: "Moved", ALREADY: "Already", ERROR: "Error" };

  return (
    <div className="max-w-2xl">
      <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-brass">Dispatch</p>
      <h1 className="mb-2 font-display text-3xl font-semibold text-navy">Scan &amp; Assign</h1>
      <p className="mb-5 text-sm text-ink-soft">
        Choose the driver, then scan each parcel. Vendor orders waiting for pickup go into Daily Entry for that driver as
        Pending (Cash). A pending order of another driver is moved to this driver.
      </p>

      <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">1. Driver</label>
      <select
        value={driverId}
        onChange={(e) => chooseDriver(e.target.value)}
        className={`mb-4 w-full rounded border px-3 py-3 text-base ${driverId ? "border-line" : "border-2 border-brass"}`}
      >
        <option value="">Choose driver…</option>
        {drivers.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
            {d.isAgent ? " (agent)" : ""}
          </option>
        ))}
      </select>

      <BillTypeSelect source="/bookings/scan-vendors" value={billVendorId} onChange={setBillVendorId} />

      <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">2. Scan parcels{driverName ? ` for ${driverName}` : ""}</label>
      <BarcodeScanner onCode={onCode} disabled={!driverId} placeholder={driverId ? "Scan barcode or type CN, then Enter" : "Choose a driver first"} />

      {log.length > 0 && (
        <>
          <div className="mt-5 grid grid-cols-4 gap-px border border-line bg-line text-center">
            <div className="bg-white p-3">
              <div className="font-mono text-[10px] uppercase text-ink-soft">Added</div>
              <div className="font-display text-2xl font-semibold text-delivered">{added}</div>
            </div>
            <div className="bg-white p-3">
              <div className="font-mono text-[10px] uppercase text-ink-soft">Moved</div>
              <div className="font-display text-2xl font-semibold text-transferred">{moved}</div>
            </div>
            <div className="bg-white p-3">
              <div className="font-mono text-[10px] uppercase text-ink-soft">Errors</div>
              <div className="font-display text-2xl font-semibold text-cancelled">{errors}</div>
            </div>
            <div className="bg-white p-3">
              <div className="font-mono text-[10px] uppercase text-ink-soft">AED</div>
              <div className="font-display text-2xl font-semibold text-navy">{fmtNumber(totalAed)}</div>
            </div>
          </div>

          <div className="mt-3 space-y-1.5">
            {log.map((l, i) => (
              <div key={i} className={`flex items-start justify-between gap-3 rounded border px-3 py-2 text-sm ${kindStyle[l.kind]}`}>
                <div>
                  <span className="mr-2 font-mono text-[10px] font-bold uppercase">{kindLabel[l.kind]}</span>
                  {l.message}
                  <div className="text-[11px] opacity-80">→ {l.driver}</div>
                </div>
                <span className="shrink-0 font-mono text-[11px] opacity-70">{l.at.toLocaleTimeString("en-GB")}</span>
              </div>
            ))}
          </div>
          <button onClick={() => setLog([])} className="mt-3 text-xs text-ink-soft hover:underline">
            Clear this list
          </button>
        </>
      )}

      <ScanHistory />
    </div>
  );
}
