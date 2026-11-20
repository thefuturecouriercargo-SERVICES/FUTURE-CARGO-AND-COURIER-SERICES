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
  /** Reading looks wrong (unusual length, End below Start…) — kept out of totals until corrected. */
  check?: boolean;
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
  checkDays?: number;
  days: Day[];
  fuel: Fuel[];
}

// Fallback if the server doesn't mark it: no delivery car does more than this in a day.
const MAX_DAY_KM = 600;

const thisMonth = () => new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 7);
const n = (v: number | null | undefined, d = 0) =>
  v == null || Number.isNaN(v) ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
const shiftMonth = (m: string, by: number) => {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + by, 1));
  return d.toISOString().slice(0, 7);
};
const monthLabel = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][mo - 1]} ${y}`;
};
const CODES: Record<string, string> = { ANAS: "AN", MASOOD: "MS", NIYAS: "NS", NOUSHAD: "ND", SAVAD: "SV", FARIS: "FS" };
const codeOf = (name: string) => CODES[name.trim().toUpperCase()] ?? name.trim().slice(0, 2).toUpperCase();
const badDay = (d: Day) => d.check ?? (d.km != null && (d.km < 0 || d.km > MAX_DAY_KM));

function PhotoLink({ id, label }: { id: string | null; label: string }) {
  if (!id) return null;
  return (
    <a
      href={`/api/km/photo/${id}`}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="ml-2 inline-flex h-7 w-7 items-center justify-center rounded-lg border border-line text-brass hover:border-brass"
      title={`${label} photo (kept 7 days)`}
    >
      <Icon name="camera" size={14} />
    </a>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "bad" | "good" }) {
  return (
    <div className="rounded-2xl border border-line bg-white px-5 py-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">{label}</div>
      <div className={`mt-1.5 text-[26px] font-bold leading-none tabular-nums ${tone === "bad" ? "text-cancelled" : tone === "good" ? "text-delivered" : "text-navy"}`}>
        {value}
      </div>
      {sub && <div className="mt-1.5 text-xs uppercase text-ink-soft">{sub}</div>}
    </div>
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
  const [editing, setEditing] = useState<{ day: Day; driver: string; start: string; end: string } | null>(null);
  const [saving, setSaving] = useState(false);

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

  async function saveEdit() {
    if (!editing) return;
    setSaving(true);
    try {
      await apiFetch(`/km/logs/${editing.day.id}`, {
        method: "PATCH",
        body: { startKm: Number(editing.start) || undefined, endKm: editing.end.trim() ? Number(editing.end) : null },
      });
      setEditing(null);
      load();
    } catch (e) {
      alertless(e);
    } finally {
      setSaving(false);
    }
  }
  function alertless(e: unknown) {
    setError(e instanceof Error ? e.message : "Could not save");
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

  // Team totals for the summary cards.
  const t = (rows ?? []).reduce(
    (s, r) => ({
      km: s.km + r.totalKm,
      del: s.del + r.deliveries,
      fuel: s.fuel + r.fuelAmount,
      litres: s.litres + r.fuelLitres,
      missed: s.missed + r.missedEnds,
      parked: s.parked + r.gapKm,
      check: s.check + r.days.filter(badDay).length,
    }),
    { km: 0, del: 0, fuel: 0, litres: 0, missed: 0, parked: 0, check: 0 }
  );

  const th = "px-4 py-3.5 text-right text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-soft whitespace-nowrap";
  const td = "px-4 py-4 text-right text-[15px] tabular-nums whitespace-nowrap";
  const dim = (v: number | null | undefined, d = 0) => (v == null || v === 0 ? <span className="text-ink-soft/60">—</span> : n(v, d));

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 uppercase md:px-8">
      {/* Toolbar */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="flex items-center rounded-xl border border-line bg-white">
          <button onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month" className="flex h-11 w-11 items-center justify-center text-ink-soft hover:text-brass">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 6l-6 6 6 6" /></svg>
          </button>
          <label className="relative min-w-[130px] cursor-pointer text-center text-[15px] font-semibold text-brass">
            {monthLabel(month)}
            <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Pick month" className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
          </label>
          <button onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month" className="flex h-11 w-11 items-center justify-center text-ink-soft hover:text-brass">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
          </button>
        </div>
        <button onClick={exportCsv} className="flex h-11 items-center gap-2 rounded-xl border border-line bg-white px-4 text-[13px] font-semibold text-navy hover:border-brass">
          <Icon name="download" size={15} />
          Excel
        </button>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="mr-1 text-[11px] font-semibold tracking-[0.14em] text-ink-soft">KM tracking</span>
          {drivers.map((d) => (
            <button
              key={d.id}
              disabled={!isAdmin}
              onClick={() => toggle(d.id, !d.kmTracking)}
              className={`h-9 rounded-full px-4 text-[12px] font-semibold transition ${
                d.kmTracking ? "bg-brass text-[#0E1A33]" : "border border-line text-ink-soft hover:border-brass"
              } disabled:cursor-default`}
              title={isAdmin ? (d.kmTracking ? "Tap to switch off" : "Tap to switch on") : undefined}
            >
              {d.name}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="mb-4 rounded-xl border border-cancelled/40 bg-cancelled-bg px-4 py-3 text-sm text-cancelled">{error}</p>}

      {/* Summary */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Stat label="Total KM" value={n(t.km)} sub={t.check ? `${t.check} reading${t.check > 1 ? "s" : ""} to check` : `${monthLabel(month)}`} tone={t.check ? "bad" : undefined} />
        <Stat label="Deliveries" value={n(t.del)} sub={t.del && t.km ? `${n(t.km / t.del, 1)} KM per delivery` : undefined} />
        <Stat label="Fuel" value={`AED ${n(t.fuel)}`} sub={t.litres ? `${n(t.litres, 1)} litres` : undefined} />
        <Stat label="KM per litre" value={t.litres ? n(t.km / t.litres, 1) : "—"} sub={t.km && t.fuel ? `AED ${n(t.fuel / t.km, 2)} per KM` : undefined} />
        <Stat label="End KM missed" value={n(t.missed)} sub={t.parked ? `${n(t.parked)} KM used while parked` : "No parked use"} tone={t.missed ? "bad" : "good"} />
      </div>

      {/* Drivers */}
      <div className="overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="w-full min-w-[980px]">
          <thead className="border-b border-line">
            <tr>
              <th className={`${th} text-left`}>Driver</th>
              <th className={th}>KM</th>
              <th className={th}>Deliveries</th>
              <th className={th}>KM / delivery</th>
              <th className={th}>Fuel AED</th>
              <th className={th}>Litres</th>
              <th className={th}>KM / L</th>
              <th className={th}>AED / KM</th>
              <th className={th}>Parked KM</th>
              <th className={`${th} pr-6`}>End missed</th>
            </tr>
          </thead>
          <tbody>
            {rows === null && (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center text-sm text-ink-soft">Loading…</td>
              </tr>
            )}
            {rows?.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center text-sm text-ink-soft">No KM entries this month yet</td>
              </tr>
            )}
            {rows?.map((r) => {
              const isOpen = open === r.id;
              const checks = r.days.filter(badDay).length;
              return (
                <Fragment key={r.id}>
                  <tr
                    className={`cursor-pointer border-b border-line transition-colors hover:bg-paper ${isOpen ? "bg-paper" : ""}`}
                    onClick={() => setOpen(isOpen ? null : r.id)}
                  >
                    <td className="px-4 py-3 text-left">
                      <div className="flex items-center gap-3">
                        <svg
                          width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden
                          className={`shrink-0 text-ink-soft transition-transform ${isOpen ? "rotate-90 text-brass" : ""}`}
                        >
                          <path d="M9 6l6 6-6 6" />
                        </svg>
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-brass/50 text-[12px] font-bold text-brass">{codeOf(r.name)}</span>
                        <span className="text-[15px] font-semibold text-navy">{r.name}</span>
                      </div>
                    </td>
                    <td className={`${td} font-bold text-navy`}>
                      {checks > 0 && (
                        <span className="mr-2 inline-flex align-[-2px] text-cancelled" title={`${checks} day reading${checks > 1 ? "s" : ""} look wrong — check Start/End KM`}>
                          <Icon name="alert" size={15} />
                        </span>
                      )}
                      {dim(r.totalKm)}
                    </td>
                    <td className={td}>{dim(r.deliveries)}</td>
                    <td className={td}>{dim(r.kmPerDelivery, 1)}</td>
                    <td className={td}>{dim(r.fuelAmount, 2)}</td>
                    <td className={td}>{dim(r.fuelLitres, 1)}</td>
                    <td className={td}>{dim(r.kmPerLitre, 1)}</td>
                    <td className={td}>{dim(r.aedPerKm, 2)}</td>
                    <td className={`${td} ${r.gapKm ? "font-bold text-cancelled" : ""}`}>{dim(r.gapKm)}</td>
                    <td className={`${td} pr-6`}>
                      {r.missedEnds ? (
                        <span className="inline-flex min-w-[28px] justify-center rounded-full bg-cancelled-bg px-2 py-0.5 text-[13px] font-bold text-cancelled">{r.missedEnds}</span>
                      ) : (
                        <span className="text-ink-soft/60">—</span>
                      )}
                    </td>
                  </tr>

                  {isOpen && (
                    <tr className="border-b border-line bg-paper">
                      <td colSpan={10} className="px-4 pb-5 pt-1 md:px-6">
                        <div className="overflow-hidden rounded-xl border border-line border-l-[3px] border-l-brass bg-white">
                          <table className="w-full">
                            <thead className="border-b border-line">
                              <tr>
                                <th className={`${th} text-left`}>Date</th>
                                <th className={th}>Start KM</th>
                                <th className={th}>End KM</th>
                                <th className={th}>KM</th>
                                <th className={th}>Deliveries</th>
                                <th className={th}>KM / del.</th>
                                <th className={th}>Fuel</th>
                                <th className={`${th} text-center`}>Status</th>
                                {isAdmin && <th className={`${th} w-14`} />}
                              </tr>
                            </thead>
                            <tbody>
                              {r.days.map((d) => {
                                const bad = badDay(d);
                                const flags = d.flags;
                                return (
                                  <tr key={d.id} className={`border-b border-line last:border-0 ${bad ? "bg-cancelled-bg/40" : ""}`}>
                                    <td className={`${td} py-3 text-left font-semibold text-navy`}>{fmtDate(d.date)}</td>
                                    <td className={`${td} py-3`} title={fmtDateTime(d.startAt)}>
                                      {n(d.startKm)}
                                      <PhotoLink id={d.startPhotoId} label="Start" />
                                    </td>
                                    <td className={`${td} py-3`} title={d.endAt ? fmtDateTime(d.endAt) : ""}>
                                      {d.endKm != null ? n(d.endKm) : <span className="font-semibold text-pending">Open</span>}
                                      <PhotoLink id={d.endPhotoId} label="End" />
                                    </td>
                                    <td className={`${td} py-3 font-bold ${bad ? "text-cancelled" : "text-navy"}`}>{n(d.km)}</td>
                                    <td className={`${td} py-3`}>{dim(d.deliveries)}</td>
                                    <td className={`${td} py-3`}>{bad ? <span className="text-ink-soft/60">—</span> : dim(d.kmPerDelivery, 1)}</td>
                                    <td className={`${td} py-3`}>{d.fuelAmount ? `AED ${n(d.fuelAmount, 2)}` : <span className="text-ink-soft/60">—</span>}</td>
                                    <td className="px-4 py-3 text-center">
                                      {flags.length ? (
                                        <div className="flex flex-wrap justify-center gap-1.5">
                                          {flags.map((f) => (
                                            <span key={f} className="rounded-full bg-cancelled-bg px-2.5 py-1 text-[11px] font-bold text-cancelled">{f}</span>
                                          ))}
                                        </div>
                                      ) : d.endKm == null ? (
                                        <span className="rounded-full bg-pending-bg px-2.5 py-1 text-[11px] font-bold text-pending">On road</span>
                                      ) : (
                                        <span className="rounded-full bg-delivered-bg px-2.5 py-1 text-[11px] font-bold text-delivered">OK</span>
                                      )}
                                    </td>
                                    {isAdmin && (
                                      <td className="px-3 py-3 text-center">
                                        <button
                                          onClick={() => setEditing({ day: d, driver: r.name, start: String(d.startKm), end: d.endKm != null ? String(d.endKm) : "" })}
                                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line text-ink-soft hover:border-brass hover:text-brass"
                                          aria-label="Edit KM"
                                        >
                                          <Icon name="pen" size={14} />
                                        </button>
                                      </td>
                                    )}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>

                        {r.fuel.length > 0 && (
                          <div className="mt-4 overflow-hidden rounded-xl border border-line bg-white">
                            <div className="border-b border-line px-4 py-3 text-[11px] font-semibold tracking-[0.14em] text-ink-soft">Fuel fills</div>
                            <table className="w-full">
                              <thead className="border-b border-line">
                                <tr>
                                  <th className={`${th} text-left`}>Date & time</th>
                                  <th className={th}>Amount</th>
                                  <th className={th}>Litres</th>
                                  <th className={th}>Price / L</th>
                                  <th className={th}>Odometer</th>
                                  <th className={`${th} text-left`}>Station</th>
                                </tr>
                              </thead>
                              <tbody>
                                {r.fuel.map((f) => (
                                  <tr key={f.id} className="border-b border-line last:border-0">
                                    <td className={`${td} py-3 text-left`}>{fmtDateTime(f.createdAt)}</td>
                                    <td className={`${td} py-3 font-bold text-navy`}>AED {n(f.amount, 2)}</td>
                                    <td className={`${td} py-3`}>{f.litres ? `${n(f.litres, 2)} L` : "—"}</td>
                                    <td className={`${td} py-3`}>{f.pricePerLitre ? n(f.pricePerLitre, 2) : "—"}</td>
                                    <td className={`${td} py-3`}>{f.odometer ? `${n(f.odometer)} KM` : "—"}</td>
                                    <td className={`${td} py-3 text-left`}>
                                      {f.station ?? "—"}
                                      {f.receiptAt ? <span className="text-ink-soft"> · {f.receiptAt}</span> : null}
                                      <PhotoLink id={f.photoId} label="Receipt" />
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>


      {/* Edit KM */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !saving && setEditing(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-line bg-white p-6" onClick={(e) => e.stopPropagation()}>
            <div className="text-[11px] font-semibold tracking-[0.14em] text-ink-soft">Edit KM</div>
            <div className="mt-1 text-lg font-bold text-navy">
              {editing.driver} · {fmtDate(editing.day.date)}
            </div>
            <label className="mt-5 block text-[11px] font-semibold tracking-[0.12em] text-ink-soft">Start KM</label>
            <input
              inputMode="numeric"
              value={editing.start}
              onChange={(e) => setEditing({ ...editing, start: e.target.value.replace(/[^\d]/g, "") })}
              className="mt-1.5 h-12 w-full rounded-xl border border-line bg-paper px-4 text-lg tabular-nums text-navy outline-none focus:border-brass"
            />
            <label className="mt-4 block text-[11px] font-semibold tracking-[0.12em] text-ink-soft">End KM (empty = not ended)</label>
            <input
              inputMode="numeric"
              value={editing.end}
              onChange={(e) => setEditing({ ...editing, end: e.target.value.replace(/[^\d]/g, "") })}
              className="mt-1.5 h-12 w-full rounded-xl border border-line bg-paper px-4 text-lg tabular-nums text-navy outline-none focus:border-brass"
            />
            {editing.start && editing.end && Number(editing.end) >= Number(editing.start) && (
              <div className="mt-3 text-sm text-ink-soft">
                = <span className="font-bold text-navy">{n(Number(editing.end) - Number(editing.start))} KM</span>
              </div>
            )}
            <div className="mt-6 flex gap-3">
              <button onClick={() => setEditing(null)} disabled={saving} className="h-11 flex-1 rounded-xl border border-line text-sm font-semibold text-ink-soft hover:border-brass">
                Cancel
              </button>
              <button onClick={saveEdit} disabled={saving || !editing.start} className="h-11 flex-1 rounded-xl bg-brass text-sm font-bold text-[#0E1A33] disabled:opacity-50">
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
