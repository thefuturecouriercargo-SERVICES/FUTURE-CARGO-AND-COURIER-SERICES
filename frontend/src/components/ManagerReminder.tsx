"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { todayStr, fmtNumber } from "@/lib/format";
import { useAuth } from "@/context/AuthContext";
import { toast } from "@/components/ui/Feedback";
import { Employee } from "@/types";

export const EXPENSE_TYPES = [
  "FUEL", "SALARY", "SALIK", "DARB", "PARKING", "CAR_WASH", "WORKSHOP", "ROOM_RENT", "CAR_RENT",
  "STATIONARY", "INTERNET", "VISA", "MEDICAL", "INSURANCE", "LICENSE", "COMMISSION", "OTHER",
];
export const typeLabel = (t: string) => t.replace(/_/g, " ");

interface Mine { id: string; category: string; amount: number; employeeName: string | null; status: string; createdAt: string }

/** Dashboard "Remind" button for the manager: tells the admin about an expense to enter. */
export default function ManagerReminder({ compact }: { compact?: boolean }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayStr());
  const [driver, setDriver] = useState("");
  const [drivers, setDrivers] = useState<Employee[]>([]);
  const [mine, setMine] = useState<Mine[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDate(todayStr());
    apiFetch<Employee[]>("/employees", { query: { role: "ALL", isAgent: "false" } }).then((l) => setDrivers(l.filter((e) => e.active))).catch(() => {});
    apiFetch<Mine[]>("/reminders/mine").then(setMine).catch(() => {});
  }, [open]);

  if (user?.role !== "MANAGER") return null;

  const reset = () => {
    setType("");
    setAmount("");
    setNote("");
    setDriver("");
  };

  async function save() {
    if (!type) return toast("Pick the expense type", "error");
    if (type === "SALARY" && !driver) return toast("Pick the driver", "error");
    const n = Math.round(Number(amount));
    if (!n || n < 1) return toast("Enter the amount", "error");
    setBusy(true);
    try {
      await apiFetch("/reminders", { method: "POST", body: { date, category: type, amount: n, note: note.trim() || undefined, employeeId: type === "SALARY" ? driver : undefined } });
      toast("Reminder sent to admin");
      reset();
      setOpen(false);
    } catch (e) {
      toast("Couldn't send", "error", e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  const modal = open ? (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-3 sm:items-center" onClick={() => setOpen(false)}>
      <div
        role="dialog"
        aria-label="Remind admin"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-line bg-white p-4 shadow-2xl"
        style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="font-display text-lg font-semibold text-navy">🔔 Remind admin</div>
          <button type="button" onClick={() => setOpen(false)} className="grid h-9 w-9 place-items-center rounded-full border border-line text-lg" aria-label="Close">
            ×
          </button>
        </div>

        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-soft">Expense type</label>
        <select value={type} onChange={(e) => setType(e.target.value)} className="touch-target mb-3 w-full rounded-xl border border-line bg-white px-3 text-sm">
          <option value="">Select type…</option>
          {EXPENSE_TYPES.map((t) => (
            <option key={t} value={t}>
              {typeLabel(t)}
            </option>
          ))}
        </select>

        {type === "SALARY" && (
          <>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-soft">Driver</label>
            <select value={driver} onChange={(e) => setDriver(e.target.value)} className="touch-target mb-3 w-full rounded-xl border border-line bg-white px-3 text-sm">
              <option value="">Select driver…</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </>
        )}

        <div className="mb-3 grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-soft">Amount (AED)</label>
            <input
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
              placeholder="0"
              className="touch-target w-full rounded-xl border border-line px-3 font-mono text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-soft">Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="touch-target w-full rounded-xl border border-line px-2 text-sm" />
          </div>
        </div>

        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-soft">Note (optional)</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Fuel for Anas car" className="touch-target mb-4 w-full rounded-xl border border-line px-3 text-sm" />

        <button type="button" disabled={busy} onClick={save} className="touch-target w-full rounded-xl bg-navy text-sm font-semibold text-paper hover:bg-navy-2 disabled:opacity-60">
          {busy ? "Sending…" : "🔔 Remind"}
        </button>

        {mine.length > 0 && (
          <div className="mt-4 border-t border-line pt-3">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">My recent reminders</div>
            <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
              {mine.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">
                    {typeLabel(m.category)}
                    {m.employeeName ? ` · ${m.employeeName}` : ""} · {fmtNumber(m.amount)} AED
                  </span>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${m.status === "CONFIRMED" ? "bg-emerald-100 text-emerald-700" : m.status === "PENDING" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"}`}>
                    {m.status === "PENDING" ? "WAITING" : m.status}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={compact ? "h-9 rounded-xl border border-brass bg-white px-3 text-xs font-semibold text-navy hover:bg-brass/10" : "touch-target rounded-xl border border-brass bg-white px-4 text-sm font-semibold text-navy hover:bg-brass/10"}
      >
        🔔 Remind
      </button>
      {modal}
    </>
  );
}
