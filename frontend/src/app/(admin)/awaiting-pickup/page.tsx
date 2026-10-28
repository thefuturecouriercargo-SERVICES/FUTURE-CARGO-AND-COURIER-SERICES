"use client";

import { isTouchDevice } from "@/components/BarcodeScanner";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { revealEditForm } from "@/lib/editForm";
import { fmtNumber, todayStr } from "@/lib/format";
import { useSocketEvent } from "@/lib/useSocketEvent";
import { useAuth } from "@/context/AuthContext";
import BookingForm from "@/components/BookingForm";
import PhotoBulkEntry from "@/components/PhotoBulkEntry";
import BookingStatusBadge from "@/components/BookingStatusBadge";
import { WebsiteSyncPanels } from "@/components/InspiredSyncPanel";
import { Booking, BookingInput, EMIRATES, Employee, Vendor } from "@/types";

import { confirmDialog } from "@/components/ui/Feedback";
import EmptyState from "@/components/ui/EmptyState";
import RowActions from "@/components/ui/RowActions";
type Filter = "AWAITING_PICKUP" | "ACCEPTED" | "REJECTED" | "";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "AWAITING_PICKUP", label: "Awaiting pickup" },
  { value: "ACCEPTED", label: "Accepted" },
  { value: "REJECTED", label: "Rejected" },
  { value: "", label: "All" },
];

type Source = "" | "WEBSITE" | "MANUAL";
const isWebsite = (b: Booking) => b.createdBy === "WEBSITE";
function addDays(d: string, n: number) {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
const niceDay = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const sumCod = (list: Booking[]) => list.reduce((s, b) => s + b.codAmount, 0);

export default function AwaitingPickupPage() {
  const { user } = useAuth();
  const canEdit = user?.role === "SUPER_ADMIN";
  const router = useRouter();

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [drivers, setDrivers] = useState<Employee[]>([]);
  const [filter, setFilter] = useState<Filter>("AWAITING_PICKUP");
  const [vendorFilter, setVendorFilter] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState(""); // debounced search (looks across all days)
  const [viewDay, setViewDay] = useState(todayStr()); // "" = all days
  const [source, setSource] = useState<Source>("");
  const [awaitingDays, setAwaitingDays] = useState<{ day: string; count: number }[]>([]);
  const [totalAwaiting, setTotalAwaiting] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showPhotos, setShowPhotos] = useState(false);
  const [justSaved, setJustSaved] = useState<Booking | null>(null);
  const [editing, setEditing] = useState<Booking | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Accept bar
  const [driverId, setDriverId] = useState("");
  const [emirate, setEmirate] = useState("");
  const [date, setDate] = useState(todayStr());
  const [accepting, setAccepting] = useState(false);

  // Scan / type a CN to find and select it
  const [scan, setScan] = useState("");
  const scanRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    const res = await apiFetch<{ bookings: Booking[]; awaitingCount: number; awaitingDays?: { day: string; count: number }[] }>("/bookings", {
      query: { day: q ? undefined : viewDay || undefined, q: q || undefined },
    });
    setBookings(res.bookings);
    setTotalAwaiting(res.awaitingCount);
    setAwaitingDays(res.awaitingDays ?? []);
  }, [viewDay, q]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    apiFetch<Vendor[]>("/vendors").then(setVendors).catch(() => {});
    apiFetch<Employee[]>("/employees")
      .then((list) => setDrivers(list.filter((e) => e.active && (e.role ?? "DRIVER") === "DRIVER")))
      .catch(() => {});
  }, []);

  useSocketEvent("booking:changed", () => load());

  // Day list for the chosen status (all vendors, both sources) — drives the totals.
  const statusList = useMemo(
    () => bookings.filter((b) => !filter || b.status === filter).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)),
    [bookings, filter]
  );
  const statusCount = (f: Filter) => bookings.filter((b) => !f || b.status === f).length;

  const shown = useMemo(
    () =>
      statusList.filter((b) => {
        if (vendorFilter && b.vendorId !== vendorFilter) return false;
        if (source === "WEBSITE" && !isWebsite(b)) return false;
        if (source === "MANUAL" && isWebsite(b)) return false;
        return true;
      }),
    [statusList, vendorFilter, source]
  );

  // Vendor-wise totals for the day (respecting the status filter).
  const vendorRows = useMemo(() => {
    const map = new Map<string, { id: string; name: string; web: Booking[]; manual: Booking[] }>();
    for (const b of statusList) {
      const row = map.get(b.vendorId) ?? { id: b.vendorId, name: b.vendor.name, web: [], manual: [] };
      (isWebsite(b) ? row.web : row.manual).push(b);
      map.set(b.vendorId, row);
    }
    return Array.from(map.values()).sort((a, b) => b.web.length + b.manual.length - (a.web.length + a.manual.length));
  }, [statusList]);

  const webAll = statusList.filter(isWebsite);
  const manualAll = statusList.filter((b) => !isWebsite(b));
  const olderAwaiting = viewDay && !q ? awaitingDays.filter((d) => d.day < viewDay) : [];
  const olderCount = olderAwaiting.reduce((s2, d) => s2 + d.count, 0);

  const selectedAwaiting = Array.from(selected).filter((id) => bookings.find((b) => b.id === id)?.status === "AWAITING_PICKUP");

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function onScan(e: FormEvent) {
    e.preventDefault();
    const code = scan.trim();
    setScan("");
    if (!code) return;
    const cn = Number(code);
    const b = bookings.find((x) => x.cnNo === cn) ?? bookings.find((x) => x.vendorRef === code);
    if (!b) {
      // Not on this day — look it up anywhere and jump to its day.
      apiFetch<Booking>(`/bookings/by-cn/${encodeURIComponent(code)}`)
        .then((found) => {
          if (found.status !== "AWAITING_PICKUP") {
            setMsg({ ok: false, text: `CN ${found.cnNo} (${found.customerName}) is already ${found.status === "ACCEPTED" ? "accepted" : "rejected"}.` });
            return;
          }
          const d = new Date(new Date(found.createdAt).getTime() + 4 * 3600 * 1000).toISOString().slice(0, 10);
          setSearch("");
          setViewDay(d);
          setFilter("AWAITING_PICKUP");
          setSelected((prev) => new Set(prev).add(found.id));
          setMsg({ ok: true, text: `✓ CN ${found.cnNo} — ${found.vendor.name}, ${found.customerName} selected (entered ${d}).` });
        })
        .catch(() => setMsg({ ok: false, text: `${code} is not a vendor booking (checked CN and vendor order No.).` }));
    } else if (b.status !== "AWAITING_PICKUP") {
      setMsg({ ok: false, text: `CN ${b.cnNo} (${b.customerName}) is already ${b.status === "ACCEPTED" ? "accepted" : "rejected"}.` });
    } else {
      setFilter("AWAITING_PICKUP");
      setSelected((prev) => new Set(prev).add(b.id));
      setMsg({ ok: true, text: `✓ CN ${b.cnNo} — ${b.vendor.name}, ${b.customerName} selected.` });
    }
    if (!isTouchDevice()) scanRef.current?.focus();
  }

  async function accept() {
    if (!driverId) return setMsg({ ok: false, text: "Choose a driver first." });
    if (selectedAwaiting.length === 0) return;
    setAccepting(true);
    setMsg(null);
    try {
      const r = await apiFetch<{ accepted: { id: string; cnNo: number }[]; failed: { id: string; error: string }[] }>("/bookings/accept", {
        method: "POST",
        body: { ids: selectedAwaiting, employeeId: driverId, emirate: emirate || undefined, date },
      });
      const driver = drivers.find((d) => d.id === driverId)?.name ?? "driver";
      const parts = [`${r.accepted.length} added to Daily Entry for ${driver}.`];
      if (r.failed.length) parts.push(`${r.failed.length} failed: ${r.failed.map((f) => f.error).join("; ")}`);
      setMsg({ ok: r.failed.length === 0, text: parts.join(" ") });
      setSelected(new Set());
      await load();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Accept failed" });
    } finally {
      setAccepting(false);
    }
  }

  async function reject(b: Booking) {
    const reason = prompt(`Reject CN ${b.cnNo} (${b.customerName})? The vendor will see this reason:`);
    if (!reason?.trim()) return;
    try {
      await apiFetch(`/bookings/${b.id}/reject`, { method: "POST", body: { reason: reason.trim() } });
      await load();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Reject failed" });
    }
  }

  async function reopen(b: Booking) {
    try {
      await apiFetch(`/bookings/${b.id}/reopen`, { method: "POST" });
      await load();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Reopen failed" });
    }
  }

  async function remove(b: Booking) {
    if (!(await confirmDialog(`Delete booking CN ${b.cnNo} (${b.customerName})? This can't be undone.`))) return;
    try {
      await apiFetch(`/bookings/${b.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Delete failed" });
    }
  }

  async function save(input: BookingInput, vendorId?: string) {
    if (editing) {
      await apiFetch(`/bookings/${editing.id}`, { method: "PUT", body: input });
      setEditing(null);
      setShowForm(false);
      setMsg({ ok: true, text: `✓ CN ${editing.cnNo} updated.` });
    } else {
      const b = await apiFetch<Booking>("/bookings", { method: "POST", body: { ...input, vendorId } });
      setJustSaved(b);
      setMsg(null);
    }
    await load();
  }

  function printLabels(ids: string[]) {
    if (ids.length) router.push(`/print-labels?ids=${ids.join(",")}`);
  }

  const allShownSelected = shown.length > 0 && shown.every((b) => selected.has(b.id));

  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-brass">Vendor bookings</p>
      <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-[26px] font-semibold tracking-tight text-navy md:text-[32px]">Awaiting Pickup</h1>
        {canEdit && (
          <span className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowPhotos(!showPhotos)}
            className={`rounded px-5 py-3 font-mono text-sm font-bold uppercase tracking-wide ${
              showPhotos ? "border border-navy bg-white text-navy" : "bg-navy text-paper hover:bg-navy-2"
            }`}
          >
            {showPhotos ? "✕ Close photos" : "📷 Read order photos"}
          </button>
          <button
            onClick={() => {
              setEditing(null);
              setShowForm(!showForm);
            }}
            className={`rounded px-5 py-3 font-mono text-sm font-bold uppercase tracking-wide ${
              showForm && !editing ? "border border-navy bg-white text-navy" : "bg-brass text-white hover:opacity-90"
            }`}
          >
            {showForm && !editing ? "✕ Close form" : "➕ Enter order for a vendor"}
          </button>
          </span>
        )}
      </div>
      <p className="mb-5 max-w-3xl text-sm text-ink-soft">
        Orders vendors entered in their portal, plus orders the office enters for small vendors. Print the labels, then
        tick, pick a driver and accept — they then appear in Daily Entry as Pending, payment Cash. Scan or type a CN to select it.
      </p>

      <WebsiteSyncPanels onSynced={load} />

      {justSaved && (
        <div className="mb-4 flex max-w-2xl flex-wrap items-center justify-between gap-4 border-2 border-delivered bg-delivered-bg p-4">
          <div>
            <div className="text-sm text-delivered">
              ✓ Saved for <b>{justSaved.vendor.name}</b> — {justSaved.customerName}
            </div>
            <div className="mt-1 font-mono text-[11px] uppercase tracking-widest text-ink-soft">CN</div>
            <div className="font-mono text-4xl font-bold tracking-wider text-navy">{justSaved.cnNo}</div>
          </div>
          <span className="flex gap-2">
            <button
              onClick={() => printLabels([justSaved.id])}
              className="rounded bg-navy px-3 py-2 font-mono text-[11px] uppercase text-paper hover:bg-navy-2"
            >
              🖨 Print label
            </button>
            <button onClick={() => setJustSaved(null)} className="rounded border border-line bg-white px-3 py-2 font-mono text-[11px] uppercase">
              Close
            </button>
          </span>
        </div>
      )}

      {showPhotos && canEdit && (
        <div className="mb-6">
          <PhotoBulkEntry mode="admin" vendors={vendors} onSaved={load} onPrint={printLabels} />
        </div>
      )}

      {(showForm || editing) && canEdit && (
        <div id="booking-form" className="mb-6 max-w-2xl rounded-xl">
          <BookingForm
            editing={editing}
            vendors={vendors}
            onSubmit={save}
            onCancelEdit={() => {
              setEditing(null);
              setShowForm(false);
            }}
          />
        </div>
      )}

      <form onSubmit={onScan} className="mb-4 flex max-w-md gap-2">
        <input
          ref={scanRef}
          value={scan}
          onChange={(e) => setScan(e.target.value)}
          inputMode="numeric"
          placeholder="Scan or type CN…"
          className="w-full rounded border-2 border-brass px-3 py-2 font-mono text-sm"
        />
        <button type="submit" className="rounded border border-line bg-white px-3 py-2 font-mono text-xs uppercase hover:border-brass">
          Find
        </button>
      </form>

      {msg && <p className={`mb-4 text-sm ${msg.ok ? "text-delivered" : "text-cancelled"}`}>{msg.text}</p>}

      <div className="border border-line bg-white p-5">
        {/* Date */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-2xl font-semibold text-navy">{q ? `Search: “${q}” (all days)` : viewDay ? niceDay(viewDay) : "All days"}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setViewDay(addDays(viewDay || todayStr(), -1))} className="rounded border border-line bg-white px-3 py-2 text-sm hover:border-brass">
              ◀
            </button>
            <input type="date" value={viewDay} onChange={(e) => e.target.value && setViewDay(e.target.value)} className="rounded border border-line px-2.5 py-2 text-sm" />
            <button onClick={() => setViewDay(addDays(viewDay || todayStr(), 1))} className="rounded border border-line bg-white px-3 py-2 text-sm hover:border-brass">
              ▶
            </button>
            {viewDay !== todayStr() && (
              <button onClick={() => setViewDay(todayStr())} className="rounded bg-navy px-3 py-2 font-mono text-xs uppercase text-paper">
                Today
              </button>
            )}
            <button
              onClick={() => setViewDay("")}
              className={`rounded px-3 py-2 font-mono text-xs uppercase ${viewDay === "" ? "bg-navy text-paper" : "border border-line hover:border-brass"}`}
              title="Every day (latest 500)"
            >
              All days
            </button>
          </div>
        </div>

        {olderCount > 0 && filter === "AWAITING_PICKUP" && (
          <div className="mb-4 flex flex-wrap items-center gap-2 border border-pending bg-pending-bg px-3 py-2 text-sm text-pending">
            <b>⚠ {olderCount} older order{olderCount === 1 ? "" : "s"} still awaiting pickup:</b>
            {olderAwaiting.map((d) => (
              <button key={d.day} onClick={() => setViewDay(d.day)} className="rounded border border-pending bg-white px-2 py-0.5 font-mono text-xs hover:bg-pending-bg">
                {d.day.slice(8)}/{d.day.slice(5, 7)} ({d.count})
              </button>
            ))}
          </div>
        )}

        {/* Website / Manual / Day total — click to filter */}
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          {([
            { key: "WEBSITE" as Source, label: "🌐 From website", list: webAll },
            { key: "MANUAL" as Source, label: "✍ Manual (portal + office)", list: manualAll },
            { key: "" as Source, label: "Day total", list: statusList },
          ]).map((t) => (
            <button
              key={t.label}
              onClick={() => {
                setSource(t.key);
                setSelected(new Set());
              }}
              className={`border-2 p-3 text-left transition ${source === t.key ? "border-navy bg-navy text-paper" : "border-line bg-white text-navy hover:border-brass"}`}
            >
              <div className="font-mono text-[11px] font-bold uppercase tracking-wide">{t.label}</div>
              <div className="mt-1 flex items-baseline justify-between gap-2">
                <span className="font-display text-2xl font-bold">{t.list.length}</span>
                <span className="font-mono text-sm font-bold">AED {fmtNumber(sumCod(t.list))}</span>
              </div>
            </button>
          ))}
        </div>

        {/* Vendor-wise totals */}
        {vendorRows.length > 0 && (
          <div className="table-scroll mb-5">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th className="text-right">Website</th>
                  <th className="text-right">Web COD</th>
                  <th className="text-right">Manual</th>
                  <th className="text-right">Manual COD</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">Total COD</th>
                </tr>
              </thead>
              <tbody>
                {vendorRows.map((v) => (
                  <tr
                    key={v.id}
                    onClick={() => setVendorFilter(vendorFilter === v.id ? "" : v.id)}
                    className={`cursor-pointer ${vendorFilter === v.id ? "bg-paper-2 font-bold" : "hover:bg-paper"}`}
                    title="Click to show only this vendor"
                  >
                    <td>
                      {vendorFilter === v.id ? "▸ " : ""}
                      {v.name}
                    </td>
                    <td className="text-right font-mono">{v.web.length || "—"}</td>
                    <td className="text-right font-mono">{v.web.length ? fmtNumber(sumCod(v.web)) : "—"}</td>
                    <td className="text-right font-mono">{v.manual.length || "—"}</td>
                    <td className="text-right font-mono">{v.manual.length ? fmtNumber(sumCod(v.manual)) : "—"}</td>
                    <td className="text-right font-mono font-bold">{v.web.length + v.manual.length}</td>
                    <td className="text-right font-mono font-bold">{fmtNumber(sumCod([...v.web, ...v.manual]))}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-navy font-bold">
                  <td>All vendors</td>
                  <td className="text-right font-mono">{webAll.length}</td>
                  <td className="text-right font-mono">{fmtNumber(sumCod(webAll))}</td>
                  <td className="text-right font-mono">{manualAll.length}</td>
                  <td className="text-right font-mono">{fmtNumber(sumCod(manualAll))}</td>
                  <td className="text-right font-mono">{statusList.length}</td>
                  <td className="text-right font-mono">{fmtNumber(sumCod(statusList))}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        <div className="mb-3 flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.label}
              onClick={() => {
                setFilter(f.value);
                setSelected(new Set());
              }}
              className={`rounded px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide ${
                filter === f.value ? "bg-navy text-paper" : "border border-line text-ink-soft hover:border-brass"
              }`}
            >
              {f.label}
              {` (${statusCount(f.value)})`}
            </button>
          ))}
          <select value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)} className="rounded border border-line px-2.5 py-1.5 text-sm">
            <option value="">All vendors</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <input
            placeholder="Search CN, customer, phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="ml-auto rounded border border-line px-2.5 py-1.5 text-sm"
          />
        </div>

        {shown.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            <button
              onClick={() => printLabels(shown.map((b) => b.id))}
              className="rounded bg-navy px-3 py-2 font-mono text-[11px] uppercase tracking-wide text-paper hover:bg-navy-2"
            >
              🖨 Print all ({shown.length})
            </button>
            {shown.some((b) => !b.labelPrintedAt) && (
              <button
                onClick={() => printLabels(shown.filter((b) => !b.labelPrintedAt).map((b) => b.id))}
                className="rounded border border-navy bg-white px-3 py-2 font-mono text-[11px] uppercase tracking-wide text-navy hover:bg-paper-2"
              >
                🖨 Print new only ({shown.filter((b) => !b.labelPrintedAt).length})
              </button>
            )}
          </div>
        )}

        {selected.size > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 border border-brass bg-paper-2 px-3 py-2.5 text-sm">
            <span className="font-medium">{selected.size} selected</span>
            <button onClick={() => printLabels(Array.from(selected))} className="rounded border border-navy bg-white px-3 py-1.5 font-mono text-[11px] uppercase text-navy">
              🖨 Print labels
            </button>
            {canEdit && selectedAwaiting.length > 0 && (
              <>
                <span className="mx-1 text-ink-soft">|</span>
                <select value={driverId} onChange={(e) => setDriverId(e.target.value)} className="rounded border border-line px-2 py-1.5 text-sm">
                  <option value="">Driver…</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                      {d.isAgent ? " (agent)" : ""}
                    </option>
                  ))}
                </select>
                <select value={emirate} onChange={(e) => setEmirate(e.target.value)} className="rounded border border-line px-2 py-1.5 text-sm" title="Leave as-is to keep each booking's emirate">
                  <option value="">Keep emirate</option>
                  {EMIRATES.map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </select>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded border border-line px-2 py-1.5 text-sm" />
                <button
                  onClick={accept}
                  disabled={accepting}
                  className="rounded bg-delivered px-3 py-1.5 font-mono text-[11px] uppercase text-white disabled:opacity-50"
                >
                  {accepting ? "Adding…" : `✓ Accept ${selectedAwaiting.length} → Daily Entry`}
                </button>
              </>
            )}
            <button onClick={() => setSelected(new Set())} className="ml-auto text-xs text-ink-soft hover:underline">
              Clear
            </button>
          </div>
        )}

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={allShownSelected}
                    onChange={() => setSelected(allShownSelected ? new Set() : new Set(shown.map((b) => b.id)))}
                  />
                </th>
                <th className="text-right">#</th>
                <th>CN No.</th>
                <th>Vendor</th>
                <th>Customer</th>
                <th>Emirate</th>
                <th className="text-right">COD</th>
                <th>Status</th>
                <th>Entered</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={10} className="!static !shadow-none">
                    {filter === "AWAITING_PICKUP" ? (
                      <EmptyState compact icon="check" tone="green" title="All caught up" hint={`Nothing waiting for pickup on this day${totalAwaiting ? ` — ${totalAwaiting} awaiting in total` : ""}.`} />
                    ) : (
                      <EmptyState compact icon="inbox" title="No bookings here" />
                    )}
                  </td>
                </tr>
              ) : (
                shown.flatMap((b, idx) => {
                  const rows = [
                    <tr key={b.id} className={selected.has(b.id) ? "bg-paper-2" : ""}>
                      <td>
                        <input type="checkbox" checked={selected.has(b.id)} onChange={() => toggle(b.id)} />
                      </td>
                      <td className="text-right font-mono text-sm font-bold text-ink-soft">{idx + 1}</td>
                      <td className="font-mono">
                        <b>{b.cnNo}</b>
                      </td>
                      <td>{b.vendor.name}</td>
                      <td>
                        <button onClick={() => setExpanded(expanded === b.id ? null : b.id)} className="text-left hover:underline">
                          <div className="font-medium">{b.customerName}</div>
                          <div className="text-xs text-ink-soft">{b.customerPhone}</div>
                        </button>
                      </td>
                      <td>{b.emirate}</td>
                      <td className="text-right font-mono">{fmtNumber(b.codAmount)}</td>
                      <td>
                        <BookingStatusBadge booking={b} />
                        {b.status === "ACCEPTED" && b.order && <div className="mt-0.5 text-xs text-ink-soft">{b.order.employee.name}</div>}
                      </td>
                      <td className="whitespace-nowrap font-mono text-xs text-ink-soft">
                        {new Date(b.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        {b.createdBy === "ADMIN" && <div className="text-[9px] uppercase">by office</div>}
                        {b.createdBy === "WEBSITE" && (
                          <div className="text-[9px] font-bold uppercase text-transferred" title={b.vendorRef ? `Website order #${b.vendorRef}` : "Website order"}>
                            web{b.vendorRef ? ` #${b.vendorRef}` : ""}
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-right">
                        <RowActions
                          label={`Actions for CN ${b.cnNo}`}
                          actions={[
                            { label: "Print label", onClick: () => printLabels([b.id]) },
                            ...(b.hasPhoto ? [{ label: "View slip photo", onClick: () => window.open(`/api/bookings/${b.id}/photo`, "_blank", "noopener,noreferrer") }] : []),
                            ...(canEdit && b.status !== "ACCEPTED"
                              ? [
                                  {
                                    label: "Edit",
                                    onClick: () => {
                                      setEditing(b);
                                      setShowForm(true);
                                      revealEditForm("booking-form");
                                    },
                                  },
                                ]
                              : []),
                            ...(canEdit && b.status === "REJECTED" ? [{ label: "Reopen", onClick: () => reopen(b) }] : []),
                            ...(canEdit && b.status === "AWAITING_PICKUP" ? [{ label: "Reject", onClick: () => reject(b), danger: true }] : []),
                            ...(canEdit && b.status === "REJECTED" ? [{ label: "Delete", onClick: () => remove(b), danger: true }] : []),
                          ]}
                        />
                      </td>
                    </tr>,
                  ];
                  if (expanded === b.id) {
                    rows.push(
                      <tr key={`${b.id}-details`} className="bg-paper">
                        <td />
                        <td />
                        <td colSpan={8} className="py-3 text-sm">
                          <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                            <div>
                              <span className="font-mono text-[10px] uppercase text-ink-soft">Address </span>
                              <span className="whitespace-pre-wrap">{b.address}</span>
                            </div>
                            <div>
                              <span className="font-mono text-[10px] uppercase text-ink-soft">Items </span>
                              {b.items || "—"}
                            </div>
                            <div>
                              <span className="font-mono text-[10px] uppercase text-ink-soft">Notes </span>
                              {b.notes || "—"}
                            </div>
                            {b.rejectReason && (
                              <div className="text-cancelled">
                                <span className="font-mono text-[10px] uppercase">Rejected </span>
                                {b.rejectReason}
                              </div>
                            )}
                            <div className="flex gap-3">
                              <a href={`tel:${b.customerPhone.replace(/[^0-9+]/g, "")}`} className="text-brass hover:underline">
                                📞 Call
                              </a>
                              <a
                                href={`https://wa.me/${b.customerPhone.replace(/[^0-9]/g, "").replace(/^0/, "971")}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-brass hover:underline"
                              >
                                WhatsApp
                              </a>
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  }
                  return rows;
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
