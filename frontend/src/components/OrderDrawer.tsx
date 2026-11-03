"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Order, OrderStatus } from "@/types";
import { agingDays, fmtNumber, fmtDate } from "@/lib/format";
import OrderDetails from "@/components/OrderDetails";

function fmtWhen(v?: string | null) {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" });
}

interface HistoryEvent {
  at: string;
  what: string;
  by?: string | null;
  detail?: string | null;
  kind: string;
}

const KIND_TONE: Record<string, string> = {
  booking: "bg-brass",
  entry: "bg-ink-soft",
  delivered: "bg-[rgb(var(--c-delivered))]",
  cancelled: "bg-[rgb(var(--c-cancelled))]",
  transfer: "bg-[rgb(var(--c-transferred))]",
  pending: "bg-[rgb(var(--c-pending))]",
  note: "bg-[rgb(var(--c-pending))]",
  edit: "bg-navy",
  info: "bg-line",
};

const STATUS_CLASS: Record<string, string> = { PENDING: "pending", DELIVERED: "delivered", TRANSFER: "transfer", CANCELLED: "cancelled" };

/**
 * Right-hand slide-in panel with everything about one consignment: status,
 * money, who has it, customer details and a timeline built from its dates.
 * Quick actions change the status, edit or delete without leaving the table.
 */
export default function OrderDrawer({
  order,
  onClose,
  onEdit,
  onStatus,
  onDelete,
  onEditContact,
}: {
  order: Order;
  onClose: () => void;
  onEdit: (o: Order) => void;
  onEditContact?: (o: Order) => void;
  onStatus: (id: string, status: OrderStatus) => void;
  onDelete: (id: string) => void;
}) {
  const closeBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeBtn.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Full dated history (every action, who did it, transfers) from the server.
  const [history, setHistory] = useState<HistoryEvent[] | null>(null);
  useEffect(() => {
    let off = false;
    setHistory(null);
    apiFetch<{ events: HistoryEvent[] }>(`/orders/${order.id}/history`)
      .then((r) => !off && setHistory(r.events))
      .catch(() => !off && setHistory(null));
    return () => {
      off = true;
    };
  }, [order.id, order.status, order.employee?.name, order.updatedAt]);

  const days = agingDays(order.status, order.date);
  const openTail =
    order.status === "PENDING" || order.status === "TRANSFER"
      ? [{ what: days !== null ? `Still pending — ${days} day${days === 1 ? "" : "s"} out` : `Out for delivery with ${order.employee?.name ?? "driver"}`, when: "Now", tone: "bg-[rgb(var(--c-pending))]" }]
      : [];
  const fallback: { what: string; when: string | null; tone: string }[] = [
    { what: "Entered by office", when: fmtWhen(order.createdAt), tone: "bg-ink-soft" },
    ...(order.driverNote ? [{ what: `Driver note: ${order.driverNote}`, when: fmtWhen(order.driverNoteAt), tone: "bg-[rgb(var(--c-pending))]" }] : []),
    ...(order.status === "DELIVERED" || order.status === "CANCELLED"
      ? [
          {
            what: order.status === "DELIVERED" ? "Delivered" : `Cancelled${order.remarks ? ` — ${order.remarks}` : ""}`,
            when: fmtWhen(order.resolvedAt),
            tone: order.status === "DELIVERED" ? "bg-[rgb(var(--c-delivered))]" : "bg-[rgb(var(--c-cancelled))]",
          },
        ]
      : order.status === "TRANSFER"
        ? [{ what: `Transferred${order.transferredBy ? ` by ${order.transferredBy}` : ""}`, when: fmtWhen(order.updatedAt), tone: "bg-[rgb(var(--c-transferred))]" }]
        : openTail),
  ];
  const timeline: { what: string; when: string | null; tone: string; by?: string | null; detail?: string | null }[] =
    history && history.length
      ? [
          ...history.map((e) => ({ what: e.what, when: fmtWhen(e.at), tone: KIND_TONE[e.kind] ?? "bg-line", by: e.by, detail: e.detail })),
          ...openTail,
        ]
      : fallback;

  const cells: { label: string; value: React.ReactNode }[] = [
    { label: "Vendor", value: order.brandName },
    { label: "Total", value: <><b>{fmtNumber(order.total)}</b> AED · {order.payment}</> },
    { label: "DL charge", value: `${fmtNumber(order.deliveryCharge)} AED` },
    { label: "Emirate", value: order.area ? `${order.emirate} · ${order.area}` : order.emirate },
    { label: "With", value: order.employee?.name ?? "—" },
    { label: "Entry date", value: fmtDate(order.date) },
  ];

  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-[rgba(3,6,14,0.55)]" onMouseDown={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Consignment ${order.cnNo}`}
        onMouseDown={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-[440px] flex-col overflow-y-auto border-l border-line bg-white shadow-[-20px_0_50px_rgba(0,0,0,0.5)]"
        style={{ animation: "drawer-in 240ms cubic-bezier(0.2, 0.7, 0.2, 1)" }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-soft">Consignment</p>
            <p className="font-display text-[26px] font-semibold text-brass">{order.cnNo}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={`stamp ${STATUS_CLASS[order.status] ?? "pending"}`}>{order.status}</span>
              {days !== null && (
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${days >= 5 ? "border-cancelled/50 text-cancelled" : "border-pending/50 text-pending"}`}>{days} days</span>
              )}
              {order.payment === "BANK" && !order.bankPaymentConfirmed && (
                <span className="rounded-full border border-cancelled/50 px-2 py-0.5 text-[11px] font-semibold text-cancelled">Bank unconfirmed</span>
              )}
            </div>
          </div>
          <button ref={closeBtn} onClick={onClose} aria-label="Close details" className="touch-target rounded-xl border border-line text-lg text-ink-soft hover:border-brass hover:text-navy">
            ×
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-5 px-5 py-5">
          <div className="grid grid-cols-2 gap-2.5">
            {cells.map((c) => (
              <div key={c.label} className="rounded-xl bg-paper-2/60 px-3 py-2.5">
                <p className="text-[11px] text-ink-soft">{c.label}</p>
                <p className="text-[13.5px] text-navy">{c.value}</p>
              </div>
            ))}
          </div>

          {order.remarks && order.status !== "CANCELLED" && (
            <div className="rounded-xl border border-line px-3 py-2.5 text-sm">
              <p className="text-[11px] text-ink-soft">Remarks</p>
              {order.remarks}
            </div>
          )}

          {order.booking && (
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-soft">Customer</p>
              <OrderDetails riskCheck booking={order.booking} cnNo={order.cnNo} vendorName={order.brandName} total={order.total} />
            </div>
          )}

          <div>
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-soft">Timeline</p>
            <ol>
              {timeline.map((t, i) => (
                <li key={i} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span className={`mt-1 h-3 w-3 shrink-0 rounded-full ring-4 ring-paper-2 ${t.tone}`} aria-hidden />
                    {i < timeline.length - 1 && <span className="w-0.5 flex-1 bg-line" aria-hidden />}
                  </div>
                  <div className="pb-4">
                    <p className="text-[13.5px] font-semibold text-navy">{t.what}</p>
                    {t.detail && <p className="text-xs text-ink">{t.detail}</p>}
                    {(t.when || t.by) && (
                      <p className="text-xs text-ink-soft">
                        {t.when}
                        {t.by ? `${t.when ? " · " : ""}by ${t.by}` : ""}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className="sticky bottom-0 flex flex-wrap gap-2 border-t border-line bg-white px-5 py-4">
          {order.status !== "DELIVERED" && (
            <button onClick={() => onStatus(order.id, "DELIVERED")} className="touch-target flex-1 rounded-xl bg-navy px-4 text-sm font-semibold text-paper hover:bg-navy-2">
              Mark delivered
            </button>
          )}
          {order.status !== "CANCELLED" && (
            <button onClick={() => onStatus(order.id, "CANCELLED")} className="touch-target rounded-xl border border-cancelled/40 px-3.5 text-sm text-cancelled hover:bg-cancelled-bg">
              Cancel
            </button>
          )}
          <button onClick={() => onEdit(order)} className="touch-target rounded-xl border border-line px-3.5 text-sm text-navy hover:border-brass">
            Edit
          </button>
          {onEditContact && (
            <button onClick={() => onEditContact(order)} className="touch-target rounded-xl border border-line px-3.5 text-sm text-navy hover:border-brass">
              Address &amp; phone
            </button>
          )}
          <button onClick={() => onDelete(order.id)} aria-label="Delete consignment" title="Delete" className="touch-target rounded-xl border border-line px-3 text-ink-soft hover:border-cancelled/50 hover:text-cancelled">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className="mx-auto">
              <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
            </svg>
          </button>
        </div>
      </aside>
    </div>
  );
}
