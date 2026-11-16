"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useSocketEvent } from "@/lib/useSocketEvent";
import { useAuth } from "@/context/AuthContext";
import Icon from "@/components/Icon";

interface Day {
  id: string;
  date: string;
  startKm: number;
  endKm: number | null;
  km: number | null;
  gapKm: number;
  deliveries: number;
  kmPerDelivery: number | null;
  fuelAmount: number;
  fuelLitres: number;
  startAt: string;
  endAt: string | null;
  startPhotoId: string | null;
  endPhotoId: string | null;
  flags: string[];
}
interface Fuel {
  id: string;
  date: string;
  amount: number;
  litres: number | null;
  pricePerLitre: number | null;
  odometer: number | null;
  station: string | null;
  receiptAt: string | null;
  photoId: string | null;
  createdAt: string;
}
interface DriverRow {
  id: string;
  name: string;
  kmTracking: boolean;
  totalKm: number;
  gapKm: number;
  deliveries: number;
  fuelAmount: number;
  fuelLitres: number;
  kmPerLitre: number | null;
  aedPerKm: number | null;
  kmPerDelivery: number | null;
  missedEnds: number;
  days: Day[];
  fuel: Fuel[];
}

const thisMonth = () => new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 7);
const n = (v: number | null | undefined, d = 0) => (v == null ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d }));

function PhotoLink({ id, label }: { id: string | null; label: string }) {
  if (!id) return null;
  return (
    <a href={`/api/km/photo/${id}`} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center rounded border border-line px-1 py-0.5 text-[9px] text-brass hover:border-brass" title={`${label} photo (kept 7 days)`}>
      <Icon name="camera" size={11} />
    </a>
  );
}

export default function KmFuelPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "SUPER_ADMIN";
  const [month, setMonth] = useState(thisMonth());
  const [rows, setRows] = useState<DriverRow[] | null>(null);
  const [drivers, setDrivers] = useState<{ id: string; name: string; kmTracking: boolean }[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [r, d] = await Promise.all([apiFetch<{ drivers: DriverRow[] }>("/km/report", { query: { month } }), apiFetch<typeof drivers>("/km/drivers")]);
      setRows(r.drivers);
      setDrivers(d);
      setError("");
      if (r.drivers.length === 1) setOpen((o) => o ?? r.drivers[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    }
  }, [month]);
  useEffect(() => {
    load();
  }, [load]);
  useSocketEvent("km:changed", load);

  async function toggle(id: string, enabled: boolean) {
    await apiFetch(`/km/drivers/${id}`, { method: "PATCH", body: { enabled } });
    load();
  }

  async function edit(day: Day) {
    const s = prompt(`Start KM for ${fmtDate(day.date)}`, String(day.startKm));
    if (s === null) return;
    const e = prompt(`End KM for ${fmtDate(day.date)} (empty = not ended)`, day.endKm != null ? String(day.endKm) : "");
    if (e === null) return;
    await apiFetch(`/km/logs/${day.id}`, { method: "PATCH", body: { startKm: Number(s) || undefined, endKm: e.trim() ? Number(e) : null } });
    load();
  }

  function exportCsv() {
    if (!rows) return;
    const head = ["Driver", "Date", "Start KM", "End KM", "KM", "Used while parked", "Deliveries", "KM per delivery", "Fuel AED", "Fuel L", "Flags"];
    const lines = rows.flatMap((r) =>
      r.days.map((d) => [r.name, fmtDate(d.date), d.startKm, d.endKm ?? "", d.km ?? "", d.gapKm || "", d.deliveries, d.kmPerDelivery ?? "", d.fuelAmount || "", d.fuelLitres || "", d.flags.join(" / ")])
    );
    const csv = [head, ...lines].map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `km-fuel-${month}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const th = "px-2 py-2 text-center font-mono text-[10px] font-bold uppercase tracking-wide text-brass";
  const td = "px-2 py-2 text-center font-mono text-xs";

  return (
    <div className="mx-auto max-w-6xl px-3 py-4 md:px-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded border border-line bg-paper px-2 py-1.5 font-mono text-sm uppercase text-navy" />
        <button onClick={exportCsv} className="rounded border border-line bg-white px-3 py-1.5 font-mono text-[11px] font-bold uppercase text-navy">
          <Icon name="download" size={12} className="mr-1 inline-block align-[-2px]" />Excel (CSV)
        </button>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[10px] uppercase text-ink-soft">KM tracking on</span>
          {drivers.map((d) => (
            <button
              key={d.id}
              disabled={!isAdmin}
              onClick={() => toggle(d.id, !d.kmTracking)}
              className={`rounded-full px-2.5 py-1 font-mono text-[10px] font-bold uppercase ${d.kmTracking ? "bg-brass text-[#0E1A33]" : "border border-line text-ink-soft"} disabled:cursor-default`}
              title={isAdmin ? (d.kmTracking ? "Tap to switch off" : "Tap to switch on") : undefined}
            >
              {d.name}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="mb-3 text-sm text-cancelled">{error}</p>}

      <div className="overflow-x-auto border border-line bg-white">
        <table className="w-full min-w-[760px] uppercase">
          <thead className="border-b border-line">
            <tr>
              <th className={`${th} text-left`}>Driver</th>
              <th className={th}>KM</th>
              <th className={th}>Used while parked</th>
              <th className={th}>Deliveries</th>
              <th className={th}>KM / delivery</th>
              <th className={th}>Fuel AED</th>
              <th className={th}>Litres</th>
              <th className={th}>KM / L</th>
              <th className={th}>AED / KM</th>
              <th className={th}>End missed</th>
            </tr>
          </thead>
          <tbody>
            {rows?.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center font-mono text-xs text-ink-soft">No KM entries this month yet</td>
              </tr>
            )}
            {rows?.map((r) => (
              <Fragment key={r.id}>
                <tr className="cursor-pointer border-b border-line hover:bg-paper" onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <td className={`${td} text-left font-bold text-navy`}>
                    <span className="mr-1 text-ink-soft">{open === r.id ? "▾" : "▸"}</span>
                    {r.name}
                  </td>
                  <td className={`${td} font-bold`}>{n(r.totalKm)}</td>
                  <td className={`${td} ${r.gapKm ? "font-bold text-cancelled" : ""}`}>{r.gapKm ? n(r.gapKm) : "0"}</td>
                  <td className={td}>{n(r.deliveries)}</td>
                  <td className={td}>{n(r.kmPerDelivery, 1)}</td>
                  <td className={td}>{n(r.fuelAmount, 2)}</td>
                  <td className={td}>{n(r.fuelLitres, 1)}</td>
                  <td className={td}>{n(r.kmPerLitre, 1)}</td>
                  <td className={td}>{n(r.aedPerKm, 2)}</td>
                  <td className={`${td} ${r.missedEnds ? "font-bold text-cancelled" : ""}`}>{r.missedEnds}</td>
                </tr>
                {open === r.id && (
                  <tr className="border-b border-line bg-paper">
                    <td colSpan={10} className="p-2 md:p-3">
                      <table className="w-full uppercase">
                        <thead>
                          <tr className="border-b border-line">
                            <th className={`${th} text-left`}>Date</th>
                            <th className={th}>Start</th>
                            <th className={th}>End</th>
                            <th className={th}>KM</th>
                            <th className={th}>Deliveries</th>
                            <th className={th}>KM / del.</th>
                            <th className={th}>Fuel</th>
                            <th className={`${th} text-left`}>Flags</th>
                            {isAdmin && <th className={th} />}
                          </tr>
                        </thead>
                        <tbody>
                          {r.days.map((d) => (
                            <tr key={d.id} className="border-b border-line last:border-0">
                              <td className={`${td} text-left`}>{fmtDate(d.date)}</td>
                              <td className={td} title={fmtDateTime(d.startAt)}>
                                {n(d.startKm)}
                                <PhotoLink id={d.startPhotoId} label="Start" />
                              </td>
                              <td className={td} title={d.endAt ? fmtDateTime(d.endAt) : ""}>
                                {d.endKm != null ? n(d.endKm) : <span className="text-brass">Open</span>}
                                <PhotoLink id={d.endPhotoId} label="End" />
                              </td>
                              <td className={`${td} font-bold`}>{n(d.km)}</td>
                              <td className={td}>{d.deliveries}</td>
                              <td className={td}>{n(d.kmPerDelivery, 1)}</td>
                              <td className={td}>{d.fuelAmount ? `AED ${n(d.fuelAmount, 2)}` : "—"}</td>
                              <td className={`${td} text-left`}>
                                {d.flags.length ? (
                                  d.flags.map((f) => (
                                    <span key={f} className="mr-1 inline-block rounded bg-cancelled-bg px-1.5 py-0.5 text-[10px] font-bold text-cancelled">
                                      {f}
                                    </span>
                                  ))
                                ) : (
                                  <span className="text-delivered">OK</span>
                                )}
                              </td>
                              {isAdmin && (
                                <td className={td}>
                                  <button onClick={() => edit(d)} className="text-[10px] text-ink-soft hover:text-navy" aria-label="Edit KM">
                                    <Icon name="pen" size={12} />
                                  </button>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      {r.fuel.length > 0 && (
                        <>
                          <div className="mb-1 mt-4 font-mono text-[10px] font-bold uppercase text-ink-soft">Fuel fills</div>
                          <table className="w-full uppercase">
                            <tbody>
                              {r.fuel.map((f) => (
                                <tr key={f.id} className="border-b border-line last:border-0">
                                  <td className={`${td} text-left`}>{fmtDateTime(f.createdAt)}</td>
                                  <td className={`${td} font-bold`}>AED {n(f.amount, 2)}</td>
                                  <td className={td}>{f.litres ? `${n(f.litres, 2)} L` : "—"}</td>
                                  <td className={td}>{f.pricePerLitre ? `${n(f.pricePerLitre, 2)} / L` : "—"}</td>
                                  <td className={td}>{f.odometer ? `${n(f.odometer)} KM` : "—"}</td>
                                  <td className={`${td} text-left`}>
                                    {f.station ?? ""}
                                    {f.receiptAt ? <span className="text-ink-soft"> · {f.receiptAt}</span> : null}
                                    <PhotoLink id={f.photoId} label="Receipt" />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 font-mono text-[10px] uppercase text-ink-soft">
        Used while parked = Start KM higher than last End KM (car stays at the office overnight). Photos are kept 7 days.
      </p>
    </div>
  );
}
