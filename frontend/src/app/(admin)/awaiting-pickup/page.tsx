"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { fmtNumber, todayStr } from "@/lib/format";
import { useSocketEvent } from "@/lib/useSocketEvent";
import { useAuth } from "@/context/AuthContext";
import BookingForm from "@/components/BookingForm";
import BookingStatusBadge from "@/components/BookingStatusBadge";
import { Booking, BookingInput, EMIRATES, Employee, Vendor } from "@/types";

type Filter = "AWAITING_PICKUP" | "ACCEPTED" | "REJECTED" | "";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "AWAITING_PICKUP", label: "Awaiting pickup" },
  { value: "ACCEPTED", label: "Accepted" },
  { value: "REJECTED", label: "Rejected" },
  { value: "", label: "All" },
];

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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
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

  const load = useCallback(async () => {
    const res = await apiFetch<{ bookings: Booking[] }>("/bookings");
    setBookings(res.bookings);
  }, []);

  useEffect(() => {
    load();
    apiFetch<Vendor[]>("/vendors").then(setVendors).catch(() => {});
    apiFetch<Employee[]>("/employees")
      .then((list) => setDrivers(list.filter((e) => e.active && (e.role ?? "DRIVER") === "DRIVER")))
      .catch(() => {});
  }, [load]);

  useSocketEvent("booking:changed", () => load());

  const awaitingCount = bookings.filter((b) => b.status === "AWAITING_PICKUP").length;

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bookings
      .filter((b) => {
        if (filter && b.status !== filter) return false;
        if (vendorFilter && b.vendorId !== vendorFilter) return false;
        if (q && !`${b.cnNo} ${b.vendorRef ?? ""} ${b.customerName} ${b.customerPhone} ${b.vendor.name}`.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) =>
        filter === "AWAITING_PICKUP"
          ? new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
  }, [bookings, filter, vendorFilter, search]);

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
      setMsg({ ok: false, text: `${code} is not a vendor booking (checked CN and vendor order No.).` });
    } else if (b.status !== "AWAITING_PICKUP") {
      setMsg({ ok: false, text: `CN ${b.cnNo} (${b.customerName}) is already ${b.status === "ACCEPTED" ? "accepted" : "rejected"}.` });
    } else {
      setFilter("AWAITING_PICKUP");
      setSelected((prev) => new Set(prev).add(b.id));
      setMsg({ ok: true, text: `✓ CN ${b.cnNo} — ${b.vendor.name}, ${b.customerName} selected.` });
    }
    scanRef.current?.focus();
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
    if (!confirm(`Delete booking CN ${b.cnNo} (${b.customerName})? This can't be undone.`)) return;
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
      setMsg({ ok: true, text: `✓ Booked CN ${b.cnNo} for ${b.vendor.name} — ${b.customerName}.` });
    }
    await load();
  }

  function printLabels(ids: string[]) {
    if (ids.length) router.push(`/print-labels?ids=${ids.join(",")}`);
  }

  const allShownSelected = shown.length > 0 && shown.every((b) => selected.has(b.id));

  return (
    <div>
      <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-brass">Vendor bookings</p>
      <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-3xl font-semibold text-navy">Awaiting Pickup</h1>
        {canEdit && (
          <button
            onClick={() => {
              setEditing(null);
              setShowForm(!showForm);
            }}
            className="rounded bg-navy px-4 py-2 font-mono text-xs uppercase tracking-wide text-paper hover:bg-navy-2"
          >
            {showForm && !editing ? "Close form" : "+ New for a vendor"}
          </button>
        )}
      </div>
      <p className="mb-5 max-w-3xl text-sm text-ink-soft">
        Consignments vendors entered in their portal. Check them, pick a driver, and accept — they then appear in Daily
        Entry as Pending, payment Cash. Scan or type a label&apos;s CN to select it.
      </p>

      {(showForm || editing) && canEdit && (
        <div className="mb-6 max-w-2xl">
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
          placeholder="Scan or type CN / vendor order No…"
          className="w-full rounded border-2 border-brass px-3 py-2 font-mono text-sm"
        />
        <button type="submit" className="rounded border border-line bg-white px-3 py-2 font-mono text-xs uppercase hover:border-brass">
          Find
        </button>
      </form>

      {msg && <p className={`mb-4 text-sm ${msg.ok ? "text-delivered" : "text-cancelled"}`}>{msg.text}</p>}

      <div className="border border-line bg-white p-5">
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
              {f.value === "AWAITING_PICKUP" && ` (${awaitingCount})`}
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
                <th>CN No.</th>
                <th>Vendor</th>
                <th>Customer</th>
                <th>Emirate</th>
                <th className="text-right">COD</th>
                <th>Status</th>
                <th>Entered</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-ink-soft">
                    {filter === "AWAITING_PICKUP" ? "Nothing waiting — all vendor bookings are picked up." : "No bookings here."}
                  </td>
                </tr>
              ) : (
                shown.flatMap((b) => {
                  const rows = [
                    <tr key={b.id} className={selected.has(b.id) ? "bg-paper-2" : ""}>
                      <td>
                        <input type="checkbox" checked={selected.has(b.id)} onChange={() => toggle(b.id)} />
                      </td>
                      <td className="font-mono">
                        <b>{b.cnNo}</b>
                        {b.vendorRef && (
                          <div className="text-[10px] text-ink-soft" title="Vendor's own order / bill No.">
                            Ref {b.vendorRef}
                          </div>
                        )}
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
                      </td>
                      <td className="whitespace-nowrap">
                        <button onClick={() => printLabels([b.id])} className="mr-2 text-xs text-brass hover:underline">
                          Label
                        </button>
                        {canEdit && b.status !== "ACCEPTED" && (
                          <button
                            onClick={() => {
                              setEditing(b);
                              setShowForm(true);
                              window.scrollTo({ top: 0, behavior: "smooth" });
                            }}
                            className="mr-2 text-xs text-brass hover:underline"
                          >
                            Edit
                          </button>
                        )}
                        {canEdit && b.status === "AWAITING_PICKUP" && (
                          <button onClick={() => reject(b)} className="mr-2 text-xs text-cancelled hover:underline">
                            Reject
                          </button>
                        )}
                        {canEdit && b.status === "REJECTED" && (
                          <>
                            <button onClick={() => reopen(b)} className="mr-2 text-xs text-brass hover:underline">
                              Reopen
                            </button>
                            <button onClick={() => remove(b)} className="text-xs text-cancelled hover:underline">
                              Delete
                            </button>
                          </>
                        )}
                      </td>
                    </tr>,
                  ];
                  if (expanded === b.id) {
                    rows.push(
                      <tr key={`${b.id}-details`} className="bg-paper">
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
