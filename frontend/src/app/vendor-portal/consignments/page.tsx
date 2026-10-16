"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { fmtNumber } from "@/lib/format";
import { VendorAuthProvider, useVendorAuth } from "@/context/VendorAuthContext";
import VendorNav from "@/components/VendorNav";
import BookingForm from "@/components/BookingForm";
import BookingStatusBadge from "@/components/BookingStatusBadge";
import OrderDetails from "@/components/OrderDetails";
import { Booking, BookingInput } from "@/types";

type Filter = "AWAITING_PICKUP" | "ACCEPTED" | "REJECTED" | "";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "AWAITING_PICKUP", label: "Awaiting pickup" },
  { value: "ACCEPTED", label: "Picked up" },
  { value: "REJECTED", label: "Rejected" },
  { value: "", label: "All" },
];

function dayLabel(day: string) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });
  const y = new Date(Date.now() - 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });
  const nice = new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
  return day === today ? `Today · ${nice}` : day === y ? `Yesterday · ${nice}` : nice;
}

function ConsignmentsContent() {
  const { vendor, loading, logout } = useVendorAuth();
  const router = useRouter();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [filter, setFilter] = useState<Filter>("AWAITING_PICKUP");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Booking | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState<Booking | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await apiFetch<{ bookings: Booking[] }>("/vendor-portal/bookings");
    setBookings(res.bookings);
  }, []);

  useEffect(() => {
    if (!loading && !vendor) router.push("/vendor-login");
  }, [loading, vendor, router]);

  useEffect(() => {
    if (vendor) load();
  }, [vendor, load]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bookings.filter((b) => {
      if (filter && b.status !== filter) return false;
      if (q && !`${b.cnNo} ${b.vendorRef ?? ""} ${b.customerName} ${b.customerPhone}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [bookings, filter, search]);

  // Group by day (Dubai time), newest day first; inside a day: website orders, then manual, oldest first (serial 1 = first entered).
  const days = useMemo(() => {
    const key = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });
    const map = new Map<string, Booking[]>();
    for (const b of shown) {
      const k = key(b.createdAt);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(b);
    }
    return Array.from(map.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([day, list]) => {
        const asc = [...list].sort((x, y) => (x.createdAt < y.createdAt ? -1 : 1));
        return {
          day,
          all: asc,
          sections: [
            { label: "🌐 From website", rows: asc.filter((b) => b.createdBy === "WEBSITE") },
            { label: "✍ Manual entry", rows: asc.filter((b) => b.createdBy !== "WEBSITE") },
          ].filter((sec) => sec.rows.length > 0),
        };
      });
  }, [shown]);

  if (loading || !vendor) {
    return <div className="flex min-h-screen items-center justify-center text-ink-soft">Loading…</div>;
  }

  async function save(input: BookingInput) {
    if (editing) {
      const updated = await apiFetch<Booking>(`/vendor-portal/bookings/${editing.id}`, { method: "PUT", body: input });
      setEditing(null);
      setJustSaved(updated);
    } else {
      const created = await apiFetch<Booking>("/vendor-portal/bookings", { method: "POST", body: input });
      setJustSaved(created);
    }
    await load();
  }

  async function remove(b: Booking) {
    if (!confirm(`Delete consignment CN ${b.cnNo} for ${b.customerName}?`)) return;
    setError("");
    try {
      await apiFetch(`/vendor-portal/bookings/${b.id}`, { method: "DELETE" });
      if (editing?.id === b.id) setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
    }
  }

  function printLabels(ids: string[]) {
    if (ids.length) router.push(`/vendor-portal/labels?ids=${ids.join(",")}`);
  }

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  const allShownSelected = shown.length > 0 && shown.every((b) => selected.has(b.id));

  return (
    <div className="min-h-screen bg-paper">
      <div className="flex h-16 items-center justify-between border-b-[3px] border-brass bg-navy px-4 text-paper md:px-6">
        <div className="flex items-baseline gap-2.5">
          <span className="font-display text-lg font-bold md:text-xl">{vendor.name}</span>
          <span className="hidden font-mono text-[10px] uppercase tracking-widest text-brass-light sm:inline">Vendor Portal</span>
        </div>
        <button
          onClick={logout}
          className="rounded border border-white/25 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wide text-line hover:border-brass-light hover:text-white"
        >
          Sign out
        </button>
      </div>
      <VendorNav />

      <div className="mx-auto max-w-5xl p-4 md:p-8">
        <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-brass">Send a consignment</p>
        <h1 className="mb-2 font-display text-3xl font-semibold text-navy">New Consignments &amp; Labels</h1>
        <p className="mb-6 max-w-2xl text-sm text-ink-soft">
          Enter each order here instead of writing a paper bill. Print the label and stick it on the parcel — Future
          Courier scans it at pickup. You can edit or delete a consignment until it&apos;s picked up.
        </p>

        {justSaved && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4 border-2 border-delivered bg-delivered-bg p-4">
            <div>
              <div className="text-sm text-delivered">✓ Saved — {justSaved.customerName}</div>
              <div className="mt-1 font-mono text-[11px] uppercase tracking-widest text-ink-soft">Write this CN on the parcel</div>
              <div className="font-mono text-4xl font-bold tracking-wider text-navy">{justSaved.cnNo}</div>
            </div>
            <span className="flex gap-2">
              <button onClick={() => printLabels([justSaved.id])} className="rounded bg-navy px-3 py-1.5 font-mono text-[11px] uppercase text-paper hover:bg-navy-2">
                🖨 Print label
              </button>
              <button onClick={() => setJustSaved(null)} className="rounded border border-line bg-white px-3 py-1.5 font-mono text-[11px] uppercase">
                Close
              </button>
            </span>
          </div>
        )}

        <div className="mb-8">
          <BookingForm editing={editing} onSubmit={save} onCancelEdit={() => setEditing(null)} />
        </div>

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
                {f.value === "AWAITING_PICKUP" && ` (${bookings.filter((b) => b.status === "AWAITING_PICKUP").length})`}
              </button>
            ))}
            <input
              placeholder="Search CN, name, phone…"
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
            <div className="mb-3 flex items-center gap-3 bg-paper-2 px-3 py-2 text-sm">
              <span>{selected.size} selected</span>
              <button onClick={() => printLabels(Array.from(selected))} className="rounded bg-navy px-3 py-1.5 font-mono text-[11px] uppercase text-paper hover:bg-navy-2">
                🖨 Print labels
              </button>
              <button onClick={() => setSelected(new Set())} className="text-xs text-ink-soft hover:underline">
                Clear
              </button>
            </div>
          )}

          {error && <p className="mb-3 text-sm text-cancelled">{error}</p>}

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
                  <th>Customer</th>
                  <th>Emirate</th>
                  <th className="text-right">COD</th>
                  <th>Status</th>
                  <th>Label</th>
                  <th>Entered</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-8 text-center text-ink-soft">
                      No consignments here.
                    </td>
                  </tr>
                ) : (
                  days.map((d) => (
                    <Fragment key={d.day}>
                      <tr>
                        <td colSpan={10} className="py-2" style={{ background: "#141F33", color: "#fff" }}>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                            <b className="font-display text-base">{dayLabel(d.day)}</b>
                            <span className="font-mono text-[11px] uppercase tracking-wide text-brass-light">
                              Day total: <b className="text-paper">{d.all.length}</b> order{d.all.length === 1 ? "" : "s"}
                              {" "}({d.all.filter((b) => b.createdBy === "WEBSITE").length} website · {d.all.filter((b) => b.createdBy !== "WEBSITE").length} manual)
                              {" "}· COD <b className="text-paper">AED {fmtNumber(d.all.reduce((s2, b) => s2 + b.codAmount, 0))}</b>
                            </span>
                            <span className="ml-auto flex gap-2">
                              <button onClick={() => printLabels(d.all.map((b) => b.id))} className="rounded border border-white/30 px-2 py-1 font-mono text-[10px] uppercase hover:border-brass-light">
                                🖨 Print day ({d.all.length})
                              </button>
                              {d.all.some((b) => !b.labelPrintedAt) && (
                                <button
                                  onClick={() => printLabels(d.all.filter((b) => !b.labelPrintedAt).map((b) => b.id))}
                                  className="rounded bg-brass px-2 py-1 font-mono text-[10px] uppercase text-navy hover:bg-brass-light"
                                >
                                  New only ({d.all.filter((b) => !b.labelPrintedAt).length})
                                </button>
                              )}
                            </span>
                          </div>
                        </td>
                      </tr>
                      {d.sections.map((sec) => (
                        <Fragment key={sec.label}>
                          <tr>
                            <td colSpan={10} className="bg-paper-2 py-1.5" style={{ background: "#ECE7D8" }}>
                              <span className="font-mono text-[11px] font-bold uppercase tracking-wide text-navy">
                                {sec.label} ({sec.rows.length})
                              </span>
                              <span className="ml-3 font-mono text-[11px] text-ink-soft">COD AED {fmtNumber(sec.rows.reduce((s2, b) => s2 + b.codAmount, 0))}</span>
                              <button onClick={() => printLabels(sec.rows.map((b) => b.id))} className="ml-3 text-xs text-brass hover:underline">
                                Print these
                              </button>
                            </td>
                          </tr>
                          {sec.rows.map((b, idx) => (
                    <Fragment key={b.id}>
                    <tr className={openId === b.id ? "bg-paper-2" : ""}>
                      <td>
                        <input type="checkbox" checked={selected.has(b.id)} onChange={() => toggle(b.id)} />
                      </td>
                      <td className="text-right font-mono text-sm font-bold text-ink-soft">{idx + 1}</td>
                      <td className="font-mono">
                        <button onClick={() => setOpenId(openId === b.id ? null : b.id)} className="whitespace-nowrap text-left hover:text-brass">
                          {openId === b.id ? "▾" : "▸"} <b className="text-base">{b.cnNo}</b>
                        </button>
                      </td>
                      <td>
                        <div className="font-medium">{b.customerName}</div>
                        <div className="text-xs text-ink-soft">{b.customerPhone}</div>
                      </td>
                      <td>{b.emirate}</td>
                      <td className="text-right font-mono">{fmtNumber(b.codAmount)}</td>
                      <td>
                        <BookingStatusBadge booking={b} />
                        {b.status === "REJECTED" && b.rejectReason && <div className="mt-0.5 max-w-[180px] text-xs text-cancelled">{b.rejectReason}</div>}
                      </td>
                      <td className="text-xs text-ink-soft">{b.labelPrintedAt ? "Printed" : "—"}</td>
                      <td className="whitespace-nowrap font-mono text-xs text-ink-soft">
                        {new Date(b.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })}
                      </td>
                      <td className="whitespace-nowrap">
                        <button onClick={() => printLabels([b.id])} className="mr-2 text-xs text-brass hover:underline">
                          Label
                        </button>
                        {b.status === "AWAITING_PICKUP" && (
                          <>
                            <button
                              onClick={() => {
                                setEditing(b);
                                window.scrollTo({ top: 0, behavior: "smooth" });
                              }}
                              className="mr-2 text-xs text-brass hover:underline"
                            >
                              Edit
                            </button>
                            <button onClick={() => remove(b)} className="text-xs text-cancelled hover:underline">
                              Delete
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                    {openId === b.id && (
                      <tr className="bg-paper">
                        <td />
                        <td />
                        <td colSpan={8} className="py-3">
                          <OrderDetails booking={b} cnNo={b.cnNo} vendorName={b.vendor.name} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                          ))}
                        </Fragment>
                      ))}
                    </Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function VendorConsignmentsPage() {
  return (
    <VendorAuthProvider>
      <ConsignmentsContent />
    </VendorAuthProvider>
  );
}
