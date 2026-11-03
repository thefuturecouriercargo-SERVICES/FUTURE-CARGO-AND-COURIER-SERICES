"use client";

import { isTouchDevice } from "@/components/BarcodeScanner";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { revealEditForm } from "@/lib/editForm";
import { fmtNumber, todayStr, fmtDateLong, fmtDate } from "@/lib/format";
import { useSocketEvent } from "@/lib/useSocketEvent";
import { useAuth } from "@/context/AuthContext";
import BookingForm from "@/components/BookingForm";
import CustomerRiskBadge from "@/components/CustomerRiskBadge";
import PhotoBulkEntry from "@/components/PhotoBulkEntry";
import BookingStatusBadge from "@/components/BookingStatusBadge";
import { WebsiteSyncPanels } from "@/components/InspiredSyncPanel";
import { Booking, BookingInput, EMIRATES, Employee, Vendor } from "@/types";

import { confirmDialog } from "@/components/ui/Feedback";
import EmptyState from "@/components/ui/EmptyState";
import RowActions from "@/components/ui/RowActions";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
type Filter = "AWAITING_PICKUP" | "ACCEPTED" | "REJECTED" | "";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "AWAITING_PICKUP", label: "Awaiting" },
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
const sumCod = (list: Booking[]) => list.reduce((s, b) => s + b.codAmount, 0);
/** "3:05 PM" in Dubai time. */
const fmtTime = (v: string) =>
  new Date(v).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Dubai" });

// One grid for the header line and every consignment row.
const ROW_GRID =
  "grid grid-cols-[20px_28px_minmax(170px,1.1fr)_minmax(150px,1fr)_72px_72px_36px_32px] items-center gap-3";

type Fx = "flash" | "dup";

export default function AwaitingPickupPage() {
  const { user } = useAuth();
  const canEdit = user?.role === "SUPER_ADMIN";
  const router = useRouter();

  const [bookings, setBookings] = useState<Booking[]>([]);
  // Phones (last 9 digits) that refused parcels before → { cancelled, delivered, level }.
  const [risky, setRisky] = useState<Record<string, { cancelled: number; delivered: number; level: string }>>({});
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

  // Animation state
  const [fx, setFx] = useState<Record<string, Fx>>({});
  const [leaving, setLeaving] = useState<Record<string, "out" | "rej">>({});
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [shake, setShake] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [toast, setToast] = useState("");
  const knownIds = useRef<Set<string> | null>(null);
  const loadedKey = useRef("");

  const phoneList = useMemo(() => bookings.filter((b) => b.status === "AWAITING_PICKUP").map((b) => b.customerPhone).sort().join("|"), [bookings]);
  useEffect(() => {
    if (!phoneList) return setRisky({});
    apiFetch<Record<string, { cancelled: number; delivered: number; level: string }>>("/customer-risk/batch", {
      method: "POST",
      body: { phones: phoneList.split("|") },
    })
      .then(setRisky)
      .catch(() => {});
  }, [phoneList]);
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
    // Orders that arrive while you watch the same day (website sync, vendor
    // portal, live refresh) slide in with a NEW tag for a few seconds.
    const key = `${viewDay}|${q}`;
    if (knownIds.current && loadedKey.current === key) {
      const fresh = res.bookings.filter((b) => !knownIds.current!.has(b.id)).map((b) => b.id);
      if (fresh.length) {
        setNewIds((prev) => new Set([...Array.from(prev), ...fresh]));
        window.setTimeout(() => setNewIds((prev) => {
          const next = new Set(prev);
          fresh.forEach((id) => next.delete(id));
          return next;
        }), 4500);
      }
    }
    knownIds.current = new Set(res.bookings.map((b) => b.id));
    loadedKey.current = key;
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
  useLiveRefresh(load, { socket: false });

  function flashRow(id: string, kind: Fx) {
    setFx((p) => {
      const n = { ...p };
      delete n[id];
      return n;
    });
    window.setTimeout(() => setFx((p) => ({ ...p, [id]: kind })), 20);
    window.setTimeout(() => setFx((p) => {
      const n = { ...p };
      delete n[id];
      return n;
    }), 1000);
    window.setTimeout(() => document.getElementById(`ap-row-${id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 40);
  }
  function showToast(text: string) {
    setToast(text);
    window.setTimeout(() => setToast((t) => (t === text ? "" : t)), 2800);
  }
  function shakeScan() {
    setShake(false);
    window.setTimeout(() => setShake(true), 20);
    window.setTimeout(() => setShake(false), 420);
  }

  // Day list for the chosen status (all vendors, both sources) — drives the totals.
  const statusList = useMemo(
    () => bookings.filter((b) => !filter || b.status === filter).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)),
    [bookings, filter]
  );
  const statusCount = (f: Filter) => bookings.filter((b) => (!f || b.status === f) && (!vendorFilter || b.vendorId === vendorFilter)).length;

  const vendorList = useMemo(() => statusList.filter((b) => !vendorFilter || b.vendorId === vendorFilter), [statusList, vendorFilter]);

  const shown = useMemo(
    () =>
      vendorList.filter((b) => {
        if (source === "WEBSITE" && !isWebsite(b)) return false;
        if (source === "MANUAL" && isWebsite(b)) return false;
        return true;
      }),
    [vendorList, source]
  );

  // Every vendor as a box: most orders first, vendors with none kept at zero.
  const vendorBoxes = useMemo(() => {
    const map = new Map<string, { id: string; name: string; web: Booking[]; manual: Booking[] }>();
    for (const v of vendors) if (v.active) map.set(v.id, { id: v.id, name: v.name, web: [], manual: [] });
    for (const b of statusList) {
      const row = map.get(b.vendorId) ?? { id: b.vendorId, name: b.vendor.name, web: [], manual: [] };
      (isWebsite(b) ? row.web : row.manual).push(b);
      map.set(b.vendorId, row);
    }
    return Array.from(map.values()).sort(
      (a, b) => b.web.length + b.manual.length - (a.web.length + a.manual.length) || a.name.localeCompare(b.name)
    );
  }, [statusList, vendors]);

  const webAll = vendorList.filter(isWebsite);
  const manualAll = vendorList.filter((b) => !isWebsite(b));
    const olderAwaiting = viewDay && !q ? awaitingDays.filter((d) => d.day < viewDay) : [];
  const olderCount = olderAwaiting.reduce((s2, d) => s2 + d.count, 0);
  const selectedVendorName = vendorFilter ? vendorBoxes.find((v) => v.id === vendorFilter)?.name ?? "Vendor" : "All vendors";

  const selectedAwaiting = Array.from(selected).filter((id) => bookings.find((b) => b.id === id)?.status === "AWAITING_PICKUP");
  const selectedCod = sumCod(bookings.filter((b) => selected.has(b.id)));

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
            shakeScan();
            setMsg({ ok: false, text: `CN ${found.cnNo} (${found.customerName}) is already ${found.status === "ACCEPTED" ? "accepted" : "rejected"}.` });
            return;
          }
          const d = new Date(new Date(found.createdAt).getTime() + 4 * 3600 * 1000).toISOString().slice(0, 10);
          setSearch("");
          setViewDay(d);
          setFilter("AWAITING_PICKUP");
          setSelected((prev) => new Set(prev).add(found.id));
          setMsg({ ok: true, text: `✓ CN ${found.cnNo} — ${found.vendor.name}, ${found.customerName} selected (entered ${fmtDate(d)}).` });
          window.setTimeout(() => flashRow(found.id, "flash"), 600);
        })
        .catch(() => {
          shakeScan();
          setMsg({ ok: false, text: `${code} is not a vendor booking (checked CN and vendor order No.).` });
        });
    } else if (b.status !== "AWAITING_PICKUP") {
      shakeScan();
      setMsg({ ok: false, text: `CN ${b.cnNo} (${b.customerName}) is already ${b.status === "ACCEPTED" ? "accepted" : "rejected"}.` });
    } else if (selected.has(b.id)) {
      setMsg({ ok: true, text: `CN ${b.cnNo} is already ticked.` });
      if (vendorFilter && vendorFilter !== b.vendorId) setVendorFilter("");
      flashRow(b.id, "dup");
    } else {
      setFilter("AWAITING_PICKUP");
      if (vendorFilter && vendorFilter !== b.vendorId) setVendorFilter("");
      if (source && (source === "WEBSITE") !== isWebsite(b)) setSource("");
      setSelected((prev) => new Set(prev).add(b.id));
      setMsg({ ok: true, text: `✓ CN ${b.cnNo} — ${b.vendor.name}, ${b.customerName} selected.` });
      flashRow(b.id, "flash");
    }
    if (!isTouchDevice()) scanRef.current?.focus();
  }

  async function accept() {
    if (selectedAwaiting.length === 0) return setMsg({ ok: false, text: "Tick the orders to accept first." });
    if (!driverId) return setMsg({ ok: false, text: "Choose a driver first." });
    setAccepting(true);
    setMsg(null);
    try {
      const r = await apiFetch<{ accepted: { id: string; cnNo: number }[]; failed: { id: string; error: string }[] }>("/bookings/accept", {
        method: "POST",
        body: { ids: selectedAwaiting, employeeId: driverId, emirate: emirate || undefined, date },
      });
      const driver = drivers.find((d) => d.id === driverId)?.name ?? "driver";
      // Accepted rows slide out before the list refreshes.
      setLeaving((p) => ({ ...p, ...Object.fromEntries(r.accepted.map((a) => [a.id, "out" as const])) }));
      if (r.failed.length) setMsg({ ok: false, text: `${r.failed.length} failed: ${r.failed.map((f) => f.error).join("; ")}` });
      showToast(`${r.accepted.length} order${r.accepted.length === 1 ? "" : "s"} moved to Daily Entry for ${driver} · Pending`);
      setSelected(new Set());
      window.setTimeout(async () => {
        await load();
        setLeaving({});
      }, 380);
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
      setLeaving((p) => ({ ...p, [b.id]: "rej" }));
      setSelected((prev) => {
        const n = new Set(prev);
        n.delete(b.id);
        return n;
      });
      showToast(`CN ${b.cnNo} rejected`);
      window.setTimeout(async () => {
        await load();
        setLeaving((p) => {
          const n = { ...p };
          delete n[b.id];
          return n;
        });
      }, 480);
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
    const text = b.labelPrintedAt
      ? `CN ${b.cnNo} (${b.customerName}) — label already printed. It will be marked Cancelled (kept in search), not erased. Continue?`
      : `Delete booking CN ${b.cnNo} (${b.customerName})? This can't be undone.`;
    if (!(await confirmDialog(text))) return;
    try {
      const r = await apiFetch<{ cancelled?: boolean }>(`/bookings/${b.id}`, { method: "DELETE" });
      if (r?.cancelled) setMsg({ ok: true, text: `CN ${b.cnNo} marked Cancelled (label was printed).` });
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

  // A label drops out of the printer icon, then the print page opens.
  function printLabels(ids: string[]) {
    if (!ids.length || printing) return;
    setPrinting(true);
    window.setTimeout(() => {
      setPrinting(false);
      router.push(`/print-labels?ids=${ids.join(",")}`);
    }, 650);
  }

  // On a laptop/desktop the page fits the screen exactly: no page scroll,
  // only the vendor list and the CN list scroll. Forms/photos open → normal scroll.
  const rootRef = useRef<HTMLDivElement>(null);
  const [fitH, setFitH] = useState<number | null>(null);
  useEffect(() => {
    function fit() {
      const el = rootRef.current;
      if (!el || window.innerWidth < 1024) return setFitH(null);
      const top = el.getBoundingClientRect().top + window.scrollY;
      setFitH(Math.max(460, Math.floor(window.innerHeight - top - 14)));
    }
    fit();
    // Measure again after the page's entry animation settles.
    const t = window.setTimeout(fit, 500);
    window.addEventListener("resize", fit);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("resize", fit);
    };
  }, []);
  const fixed = fitH !== null && !showForm && !showPhotos && !editing;
  useEffect(() => {
    if (!fixed) return;
    // Hide the outer page scrollbar while the page fits the screen.
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    window.scrollTo(0, 0);
    return () => {
      html.style.overflow = prev;
    };
  }, [fixed]);

  const allShownSelected = shown.length > 0 && shown.every((b) => selected.has(b.id));
  const unprinted = shown.filter((b) => !b.labelPrintedAt);

  const box = "rounded-2xl border border-line bg-white";
  const inner = "rounded-[10px] border border-line bg-paper-2/40";
  const segOn = "bg-brass/15 text-brass font-semibold";
  const segOff = "text-ink-soft hover:text-navy";

  const printerIcon = (
    <span className={`relative inline-block h-[18px] w-[18px] ${printing ? "ap-printing" : ""}`} aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M6 9V3h12v6M6 18H4v-7h16v7h-2" />
      </svg>
      <svg className="ap-label absolute left-0 top-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#d4af5a" strokeWidth="2">
        <path d="M7 14h10v7H7z" />
      </svg>
    </span>
  );

  return (
    <div ref={rootRef} className={`flex flex-col ${fixed ? "gap-3 overflow-hidden" : "gap-5"}`} style={fixed ? { height: fitH! } : undefined}>
      {/* Header: title, website chips, date, buttons */}
      <div className={`${box} flex flex-none flex-wrap items-center gap-x-4 gap-y-2.5 px-5 py-3`}>
        <div className="flex items-baseline gap-3">
          <h1 className="font-display text-[22px] font-semibold tracking-tight text-navy">Awaiting Pickup</h1>
          <span className="whitespace-nowrap text-sm text-ink-soft">
            <span key={`dc-${statusList.length}`} className="ap-bump inline-block">{statusList.length}</span> orders · AED {fmtNumber(sumCod(statusList))}
            {q ? ` · search “${q}” (all days)` : ""}
          </span>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button aria-label="Previous day" onClick={() => setViewDay(addDays(viewDay || todayStr(), -1))} className="h-10 w-10 rounded-lg border border-line text-lg hover:border-brass">
            ‹
          </button>
          <label className="relative flex h-10 items-center gap-2 rounded-lg border border-line px-3 text-sm hover:border-brass">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#d4af5a" strokeWidth="2" aria-hidden="true">
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M3 10h18M8 3v4M16 3v4" />
            </svg>
            <span className="font-medium">{viewDay ? fmtDateLong(viewDay) : "All days"}</span>
            <input
              type="date"
              aria-label="Pick a day"
              value={viewDay}
              onChange={(e) => e.target.value && setViewDay(e.target.value)}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
          <button aria-label="Next day" onClick={() => setViewDay(addDays(viewDay || todayStr(), 1))} className="h-10 w-10 rounded-lg border border-line text-lg hover:border-brass">
            ›
          </button>
          {viewDay !== todayStr() && (
            <button onClick={() => setViewDay(todayStr())} className="h-10 rounded-lg px-2.5 text-sm font-medium text-brass hover:underline">
              Today
            </button>
          )}
          <button
            onClick={() => setViewDay("")}
            className={`h-10 rounded-lg px-2.5 text-sm font-medium ${viewDay === "" ? "bg-brass/15 text-brass" : "text-brass hover:underline"}`}
            title="Every day (latest 500)"
          >
            All days
          </button>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setShowPhotos(!showPhotos)}
              className={`h-10 rounded-lg border px-3.5 text-sm font-medium ${showPhotos ? "border-brass text-brass" : "border-line text-navy hover:border-brass"}`}
            >
              {showPhotos ? "✕ Close photos" : "Read order photos"}
            </button>
            <button
              onClick={() => {
                setEditing(null);
                setShowForm(!showForm);
              }}
              className={`h-10 rounded-lg px-3.5 text-sm font-semibold ${showForm && !editing ? "border border-brass text-brass" : "bg-navy text-paper hover:bg-navy-2"}`}
            >
              {showForm && !editing ? "✕ Close form" : "+ Enter order"}
            </button>
          </div>
        )}
      </div>

      {justSaved && (
        <div className={`${box} flex flex-none flex-wrap items-center justify-between gap-4 border-delivered p-4`}>
          <div>
            <div className="text-sm text-delivered">
              ✓ Saved for <b>{justSaved.vendor.name}</b> — {justSaved.customerName}
            </div>
            <div className="mt-1 font-mono text-[11px] uppercase tracking-widest text-ink-soft">CN</div>
            <div className="font-mono text-4xl font-bold tracking-wider text-navy">{justSaved.cnNo}</div>
          </div>
          <span className="flex gap-2">
            <button onClick={() => printLabels([justSaved.id])} className="flex h-10 items-center gap-2 rounded-lg bg-navy px-3 text-sm font-semibold text-paper hover:bg-navy-2">
              {printerIcon} Print label
            </button>
            <button onClick={() => setJustSaved(null)} className="h-10 rounded-lg border border-line px-3 text-sm">
              Close
            </button>
          </span>
        </div>
      )}

      {showPhotos && canEdit && (
        <div className={`${box} p-4`}>
          <PhotoBulkEntry mode="admin" vendors={vendors} onSaved={load} onPrint={printLabels} />
        </div>
      )}

      {(showForm || editing) && canEdit && (
        <div id="booking-form" className="max-w-2xl rounded-xl">
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

      <div className={`flex gap-4 ${fixed ? "min-h-0 flex-1 flex-nowrap items-stretch" : "flex-wrap items-start"}`}>
        {/* Vendor boxes */}
        <nav aria-label="Vendors" className={`${box} flex w-full flex-col gap-2 overflow-y-auto p-3 lg:w-[250px] lg:flex-none ${fixed ? "min-h-0" : "max-h-[45vh] lg:max-h-[calc(100vh-210px)]"}`}>
          <span className="px-1 pb-0.5 text-xs text-ink-soft">Vendors · most orders first</span>
          {[{ id: "", name: "All vendors", web: statusList.filter(isWebsite), manual: statusList.filter((b) => !isWebsite(b)) }, ...vendorBoxes].map((v) => {
            const count = v.web.length + v.manual.length;
            const on = vendorFilter === v.id;
            const zero = count === 0;
            return (
              <button
                key={v.id || "all"}
                onClick={() => {
                  setVendorFilter(v.id);
                  setSelected(new Set());
                }}
                className={`ap-vbox flex flex-none flex-col gap-0.5 rounded-[10px] border px-3.5 py-2 text-left transition ${
                  on ? "border-brass bg-brass/10" : zero ? "border-line bg-transparent text-ink-soft" : "border-line bg-paper-2/40 hover:border-brass/60"
                }`}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className={`truncate ${on ? "font-semibold" : "font-medium"}`}>{v.name}</span>
                  <span key={`${v.id}-${count}`} className={`ap-bump inline-block font-semibold ${on ? "text-brass" : ""}`}>
                    {count}
                  </span>
                </span>
                <span className="truncate text-[11px] text-ink-soft">
                  {zero
                    ? "AED 0"
                    : [v.web.length ? `${v.web.length} website` : "", v.manual.length ? `${v.manual.length} manual` : "", `AED ${fmtNumber(sumCod([...v.web, ...v.manual]))}`]
                        .filter(Boolean)
                        .join(" · ")}
                </span>
              </button>
            );
          })}
        </nav>

        <div className={`flex min-w-0 flex-[999_1_560px] flex-col ${fixed ? "min-h-0 gap-3" : "gap-4"}`}>
          {/* Website / Manual / Total + scan, one compact row */}
          <div className={`${box} flex flex-none flex-col gap-2.5 p-3`}>
            <div className="grid gap-2.5 sm:grid-cols-3 xl:grid-cols-[repeat(3,minmax(0,1fr))_minmax(280px,1.5fr)]">
              {([
                { key: "WEBSITE" as Source, label: "Website", list: webAll },
                { key: "MANUAL" as Source, label: "Manual", list: manualAll },
                { key: "" as Source, label: "Total", list: vendorList },
              ]).map((t) => {
                const on = source === t.key;
                const gold = t.key === "";
                return (
                  <button
                    key={t.label}
                    onClick={() => {
                      setSource(t.key);
                      setSelected(new Set());
                    }}
                    className={`flex h-12 items-center gap-2 rounded-[10px] border px-3.5 text-left transition ${
                      on ? "border-brass bg-brass/10" : "border-line bg-paper-2/40 hover:border-brass/60"
                    }`}
                  >
                    <span className={`text-xs ${gold || on ? "text-brass" : "text-ink-soft"}`}>{t.label}</span>
                    <span key={`${t.label}-${t.list.length}`} className={`ap-bump inline-block font-display text-xl font-semibold ${gold ? "text-brass" : "text-navy"}`}>
                      {t.list.length}
                    </span>
                    <span className={`ml-auto whitespace-nowrap text-xs ${gold ? "text-brass" : "text-ink-soft"}`}>AED {fmtNumber(sumCod(t.list))}</span>
                  </button>
                );
              })}
              <form onSubmit={onScan} className={`flex h-12 gap-2 rounded-[10px] border border-line bg-paper p-1 sm:col-span-3 xl:col-span-1 ${shake ? "ap-shake" : ""}`}>
                <input
                  ref={scanRef}
                  value={scan}
                  onChange={(e) => setScan(e.target.value)}
                  inputMode="numeric"
                  aria-label="Scan or type CN"
                  placeholder="Scan or type CN…"
                  className="min-w-0 flex-1 !border-0 !bg-transparent px-3 font-mono text-[15px] !shadow-none"
                />
                <button type="submit" className="rounded-lg bg-navy px-4 text-sm font-semibold text-paper hover:bg-navy-2">
                  Find
                </button>
              </form>
            </div>
            {msg && <p className={`px-1 text-sm ${msg.ok ? "text-brass" : "text-cancelled"}`}>{msg.text}</p>}
            {olderCount > 0 && filter === "AWAITING_PICKUP" && (
              <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-pending bg-pending-bg px-3 py-2 text-sm text-pending">
                <b>⚠ {olderCount} older order{olderCount === 1 ? "" : "s"} still awaiting pickup:</b>
                {olderAwaiting.map((d) => (
                  <button key={d.day} onClick={() => setViewDay(d.day)} className="rounded-md border border-pending px-2 py-0.5 font-mono text-xs hover:bg-pending/10">
                    {fmtDate(d.day)} ({d.count})
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Orders */}
          <div className={`${box} flex flex-col gap-2.5 p-3 ${fixed ? "min-h-0 flex-1" : ""}`}>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="mr-1 font-display text-lg font-semibold text-navy">{selectedVendorName}</h2>
              <div className="flex flex-wrap gap-1 rounded-[10px] bg-paper p-1">
                {FILTERS.map((f) => (
                  <button
                    key={f.label}
                    onClick={() => {
                      setFilter(f.value);
                      setSelected(new Set());
                    }}
                    className={`h-9 rounded-lg px-3.5 text-[13px] ${filter === f.value ? segOn : segOff}`}
                  >
                    {f.label} {statusCount(f.value)}
                  </button>
                ))}
              </div>
              <div className="ml-auto flex flex-wrap gap-1 rounded-[10px] bg-paper p-1">
                <span className={`flex h-9 items-center gap-2 rounded-lg pl-3 text-[13px] ${source === "" ? segOn : segOff}`}>
                  <input
                    type="checkbox"
                    aria-label="Select all shown orders"
                    title="Select all shown orders"
                    checked={allShownSelected}
                    onChange={() => setSelected(allShownSelected ? new Set() : new Set(shown.map((b) => b.id)))}
                  />
                  <button onClick={() => { setSource(""); setSelected(new Set()); }} className="h-9 pr-3.5">
                    All {vendorList.length}
                  </button>
                </span>
                <button onClick={() => { setSource("WEBSITE"); setSelected(new Set()); }} className={`h-9 rounded-lg px-3.5 text-[13px] ${source === "WEBSITE" ? segOn : segOff}`}>
                  Website {webAll.length}
                </button>
                <button onClick={() => { setSource("MANUAL"); setSelected(new Set()); }} className={`h-9 rounded-lg px-3.5 text-[13px] ${source === "MANUAL" ? segOn : segOff}`}>
                  Manual {manualAll.length}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                placeholder="Search CN, customer, phone…"
                aria-label="Search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-10 min-w-[220px] flex-1 rounded-lg border border-line px-3 text-sm"
              />
              {shown.length > 0 && (
                <button onClick={() => printLabels(shown.map((b) => b.id))} className="flex h-10 items-center gap-2 rounded-lg border border-line px-3 text-sm hover:border-brass">
                  {printerIcon} Print all ({shown.length})
                </button>
              )}
              {unprinted.length > 0 && (
                <button onClick={() => printLabels(unprinted.map((b) => b.id))} className="flex h-10 items-center gap-2 rounded-lg border border-brass px-3 text-sm text-brass">
                  {printerIcon} Print new only ({unprinted.length})
                </button>
              )}
            </div>

            <div className={`overflow-auto rounded-[10px] ${fixed ? "min-h-0 flex-1" : "max-h-[calc(100vh-330px)] min-h-[300px]"}`}>
              <div className="flex min-w-[760px] flex-col gap-1.5">
                <div className={`${ROW_GRID} sticky top-0 z-10 bg-[rgb(var(--c-surface))] px-3 py-1.5 text-[11px] uppercase tracking-[0.06em] text-ink-soft`}>
                  <span />
                  <span>SL</span>
                  <span>CN No · Type · Emirate</span>
                  <span>Name / Phone</span>
                  <span className="text-right">Amount</span>
                  <span>Entered</span>
                  <span className="text-center">Act</span>
                  <span className="text-center">Label</span>
                </div>

                {shown.length === 0 ? (
                  <div className={inner}>
                    {filter === "AWAITING_PICKUP" ? (
                      <EmptyState compact icon="check" tone="green" title="All caught up" hint={`Nothing waiting for pickup here${totalAwaiting ? ` — ${totalAwaiting} awaiting in total` : ""}.`} />
                    ) : (
                      <EmptyState compact icon="inbox" title="No bookings here" />
                    )}
                  </div>
                ) : (
                  shown.map((b, idx) => {
                    const d = b.customerPhone.replace(/[^0-9]/g, "");
                    const r = d.length >= 9 ? risky[d.slice(-9)] : undefined;
                    const cls = [
                      "ap-row",
                      fx[b.id] ? `ap-${fx[b.id]}` : "",
                      leaving[b.id] ? `ap-${leaving[b.id]}` : "",
                      newIds.has(b.id) ? "ap-in" : "",
                      selected.has(b.id) ? "border-brass/50 bg-brass/[0.07]" : "border-line bg-paper-2/40",
                    ].join(" ");
                    return (
                      <div key={b.id} id={`ap-row-${b.id}`} className={`${cls} rounded-[10px] border`}>
                        <div className={`${ROW_GRID} px-3 py-2`}>
                          <input type="checkbox" checked={selected.has(b.id)} onChange={() => toggle(b.id)} aria-label={`Select CN ${b.cnNo}`} />
                          <span className="text-sm text-ink-soft">{idx + 1}</span>
                          <span className="flex min-w-0 flex-col">
                            <span className="flex items-center gap-1.5">
                              <span className="font-mono font-semibold text-navy">{b.cnNo}</span>
                              {newIds.has(b.id) && <span className="ap-newtag rounded bg-brass px-1 text-[10px] font-bold text-[#14100a]">NEW</span>}
                              {b.status !== "AWAITING_PICKUP" && <BookingStatusBadge booking={b} />}
                            </span>
                            <span className="truncate text-[11px] text-ink-soft" title={b.vendorRef ? `Website order #${b.vendorRef}` : undefined}>
                              <span className={isWebsite(b) ? "text-brass" : ""}>
                                {isWebsite(b) ? `Website${b.vendorRef ? ` #${b.vendorRef}` : ""}` : b.createdBy === "ADMIN" ? "Manual · office" : "Manual"}
                              </span>
                              {" · "}
                              <span className="uppercase text-navy/80">{b.emirate}</span>
                              {!vendorFilter && ` · ${b.vendor.name}`}
                              {b.status === "ACCEPTED" && b.order ? ` · ${b.order.employee.name}` : ""}
                            </span>
                          </span>
                          <button onClick={() => setExpanded(expanded === b.id ? null : b.id)} className="min-w-0 text-left hover:underline">
                            <div className="truncate font-medium">{b.customerName}</div>
                            <div className="text-[11px] text-ink-soft">{b.customerPhone}</div>
                            {r && b.status === "AWAITING_PICKUP" && (
                              <div
                                className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${r.level === "high" ? "bg-cancelled-bg text-cancelled" : "bg-pending-bg text-pending"}`}
                                title="This customer refused parcels before (any vendor). Call to confirm before dispatch."
                              >
                                ⚠ Refused {r.cancelled}× before{r.delivered ? ` · ${r.delivered} delivered` : ""}
                              </div>
                            )}
                          </button>
                          <span className="text-right font-mono font-semibold">{fmtNumber(b.codAmount)}</span>
                          <span className="text-xs text-ink-soft">
                            {(!viewDay || q) && <span className="block text-[11px]">{fmtDate(b.createdAt)}</span>}
                            {fmtTime(b.createdAt)}
                          </span>
                          <span>
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
                          </span>
                          <span className="grid place-items-center">
                            {b.labelPrintedAt ? (
                              <span
                                role="img"
                                aria-label="Label printed"
                                title={`Label printed${b.labelPrintedAt ? ` · ${fmtDate(b.labelPrintedAt)} ${fmtTime(b.labelPrintedAt)}` : ""}`}
                                className="grid h-[26px] w-[26px] place-items-center rounded-full bg-delivered-bg text-delivered"
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                                  <path d="M5 12.5l4 4L19 7" />
                                </svg>
                              </span>
                            ) : (
                              <span
                                role="img"
                                aria-label="Label not printed"
                                title="Label not printed"
                                className="grid h-[26px] w-[26px] place-items-center rounded-full border-[1.5px] border-dashed border-cancelled text-cancelled"
                              >
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                                  <path d="M6 6l12 12M18 6L6 18" />
                                </svg>
                              </span>
                            )}
                          </span>
                        </div>
                        {expanded === b.id && (
                          <div className="grid gap-x-6 gap-y-1 border-t border-line px-3 py-2.5 pl-[72px] text-sm sm:grid-cols-2">
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
                            <CustomerRiskBadge phone={b.customerPhone} excludeCn={b.cnNo} />
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
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Action bar — stays at the bottom; website connections on the left */}
      <div className={`${box} ${fixed ? "flex-none" : "sticky bottom-2"} z-20 flex flex-wrap items-center gap-2.5 px-4 py-2.5 shadow-[0_-8px_24px_rgba(0,0,0,0.35)] lg:pr-20 ${selected.size ? "border-brass/60" : ""}`}>
        <div className="flex flex-wrap items-center gap-2">
          <WebsiteSyncPanels compact up onSynced={load} />
        </div>
        <span className="hidden h-7 w-px bg-line sm:block" aria-hidden="true" />
        <span className="mr-auto text-sm">
          <span key={`sel-${selected.size}`} className="ap-bump inline-block font-semibold">{selected.size}</span> selected
          <span className="text-ink-soft"> · AED {fmtNumber(selectedCod)}</span>
          {selected.size > 0 && (
            <button onClick={() => setSelected(new Set())} className="ml-3 text-xs text-ink-soft hover:underline">
              Clear
            </button>
          )}
        </span>
        <button
          onClick={() => printLabels(Array.from(selected))}
          disabled={selected.size === 0}
          className="flex h-10 items-center gap-2 rounded-lg border border-line px-3.5 text-sm hover:border-brass disabled:opacity-40"
        >
          {printerIcon} {printing ? "Printing…" : "Print labels"}
        </button>
        {canEdit && (
          <>
            <select value={driverId} onChange={(e) => setDriverId(e.target.value)} aria-label="Driver" className="h-10 rounded-lg border border-line px-3 text-sm">
              <option value="">Driver…</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.isAgent ? " (agent)" : ""}
                </option>
              ))}
            </select>
            <select value={emirate} onChange={(e) => setEmirate(e.target.value)} aria-label="Emirate" className="h-10 rounded-lg border border-line px-3 text-sm" title="Leave as-is to keep each booking's emirate">
              <option value="">Keep emirate</option>
              {EMIRATES.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
            <input type="date" value={date} aria-label="Daily Entry date" onChange={(e) => setDate(e.target.value)} className="h-10 rounded-lg border border-line px-3 text-sm" />
            <button
              onClick={accept}
              disabled={accepting || selectedAwaiting.length === 0}
              className="h-10 rounded-lg bg-navy px-5 text-sm font-semibold text-paper hover:bg-navy-2 disabled:opacity-40"
            >
              {accepting ? "Adding…" : `Accept${selectedAwaiting.length ? ` ${selectedAwaiting.length}` : ""}`}
            </button>
          </>
        )}
      </div>

      {toast && (
        <div role="status" className="ap-toast fixed bottom-24 left-1/2 z-[90] flex items-center gap-2.5 rounded-xl bg-[#d4af5a] px-5 py-3.5 font-semibold text-[#14100a] shadow-[0_10px_30px_rgba(0,0,0,0.45)]">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <path d="M5 12.5l4 4L19 7" />
          </svg>
          {toast}
        </div>
      )}
    </div>
  );
}
