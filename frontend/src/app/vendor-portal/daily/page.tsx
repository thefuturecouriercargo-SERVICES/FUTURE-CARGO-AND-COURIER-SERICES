"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { fmtNumber } from "@/lib/format";
import { VendorAuthProvider, useVendorAuth } from "@/context/VendorAuthContext";
import VendorShell from "@/components/VendorShell";
import VendorOrderStatus from "@/components/VendorOrderStatus";
import OrderDetails from "@/components/OrderDetails";
import { OrderBookingDetails } from "@/types";

interface DayOrder {
  id: string;
  cnNo: number;
  total: number;
  deliveryCharge: number;
  status: string;
  emirate: string;
  remarks?: string | null;
  booking?: OrderBookingDetails | null;
}

interface WaitingBooking extends OrderBookingDetails {
  id: string;
  cnNo: number;
  status: string;
  rejectReason?: string | null;
  createdAt: string;
}

interface DailyData {
  date: string;
  orders: DayOrder[];
  waiting: WaitingBooking[];
  summary: {
    total: number;
    delivered: number;
    pending: number;
    cancelled: number;
    awaitingPickup: number;
    codTotal: number;
    deliveredAmount: number;
    deliveryCharge: number;
  };
}

const today = () => new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString().slice(0, 10);
function addDays(d: string, n: number) {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

function Daily() {
  const { vendor } = useVendorAuth();
  const [date, setDate] = useState(today());
  const [data, setData] = useState<DailyData | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setData(await apiFetch<DailyData>("/vendor-portal/daily", { query: { date } }));
  }, [date]);

  useEffect(() => {
    if (vendor) load();
  }, [vendor, load]);

  const s = data?.summary;
  const tiles = s
    ? [
        { label: "Consignments", value: s.total, cls: "text-navy" },
        { label: "Delivered", value: s.delivered, cls: "text-delivered" },
        { label: "Out for delivery", value: s.pending, cls: "text-pending" },
        { label: "Cancelled", value: s.cancelled, cls: "text-cancelled" },
        { label: "Awaiting pickup", value: s.awaitingPickup, cls: "text-pending" },
        { label: "COD total (AED)", value: fmtNumber(s.codTotal), cls: "text-navy" },
        { label: "Delivered (AED)", value: fmtNumber(s.deliveredAmount), cls: "text-delivered" },
        { label: "Delivery charge", value: fmtNumber(s.deliveryCharge), cls: "text-navy" },
      ]
    : [];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-brass">Daily</p>
          <h1 className="font-display text-3xl font-semibold text-navy">
            {new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setDate(addDays(date, -1))} className="rounded border border-line bg-white px-3 py-2 text-sm hover:border-brass">
            ◀
          </button>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="rounded border border-line px-2.5 py-2 text-sm" />
          <button onClick={() => setDate(addDays(date, 1))} className="rounded border border-line bg-white px-3 py-2 text-sm hover:border-brass">
            ▶
          </button>
          {date !== today() && (
            <button onClick={() => setDate(today())} className="rounded bg-navy px-3 py-2 font-mono text-xs uppercase text-paper">
              Today
            </button>
          )}
        </div>
      </div>

      {!data ? (
        <p className="text-ink-soft">Loading…</p>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4">
            {tiles.map((t) => (
              <div key={t.label} className="bg-white p-3.5">
                <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-ink-soft">{t.label}</div>
                <div className={`font-display text-2xl font-semibold ${t.cls}`}>{t.value}</div>
              </div>
            ))}
          </div>

          <div className="mb-6 border border-line bg-white p-4">
            <h2 className="mb-3 font-display text-[17px] font-semibold text-navy">Consignments</h2>
            {data.orders.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-soft">No consignments on this day.</p>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>CN No.</th>
                      <th>Customer</th>
                      <th>Emirate</th>
                      <th className="text-right">COD</th>
                      <th className="text-right">DL Chg</th>
                      <th>Status</th>
                      <th>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.orders.map((o) => (
                      <Fragment key={o.id}>
                        <tr className={openId === o.id ? "bg-paper-2" : ""}>
                          <td className="font-mono">
                            <button onClick={() => setOpenId(openId === o.id ? null : o.id)} className="whitespace-nowrap hover:text-brass">
                              {openId === o.id ? "▾" : "▸"} <b>{o.cnNo}</b>
                            </button>
                          </td>
                          <td>{o.booking?.customerName ?? <span className="text-ink-soft">—</span>}</td>
                          <td>{o.emirate}</td>
                          <td className="text-right font-mono">{o.total === 0 && o.booking ? "Prepaid" : fmtNumber(o.total)}</td>
                          <td className="text-right font-mono">{fmtNumber(o.deliveryCharge)}</td>
                          <td>
                            <VendorOrderStatus status={o.status} />
                          </td>
                          <td className="max-w-[180px] truncate text-xs text-ink-soft" title={o.remarks ?? ""}>
                            {o.remarks || "—"}
                          </td>
                        </tr>
                        {openId === o.id && (
                          <tr className="bg-paper">
                            <td colSpan={7} className="py-3">
                              <div className="max-w-[calc(100vw-4rem)] whitespace-normal md:max-w-none"><OrderDetails booking={o.booking} cnNo={o.cnNo} vendorName={vendor?.name} total={o.total} /></div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {data.waiting.length > 0 && (
            <div className="border border-line bg-white p-4">
              <h2 className="mb-1 font-display text-[17px] font-semibold text-navy">Entered this day — not picked up yet</h2>
              <p className="mb-3 text-xs text-ink-soft">These move to the list above once our driver picks them up.</p>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>CN No.</th>
                      <th>Customer</th>
                      <th>Emirate</th>
                      <th className="text-right">COD</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.waiting.map((b) => (
                      <Fragment key={b.id}>
                        <tr className={openId === b.id ? "bg-paper-2" : ""}>
                          <td className="font-mono">
                            <button onClick={() => setOpenId(openId === b.id ? null : b.id)} className="whitespace-nowrap hover:text-brass">
                              {openId === b.id ? "▾" : "▸"} <b>{b.cnNo}</b>
                            </button>
                          </td>
                          <td>{b.customerName}</td>
                          <td>{b.emirate}</td>
                          <td className="text-right font-mono">{b.codAmount === 0 ? "Prepaid" : fmtNumber(b.codAmount)}</td>
                          <td>
                            <VendorOrderStatus status={b.status} />
                            {b.rejectReason && <div className="mt-0.5 text-xs text-cancelled">{b.rejectReason}</div>}
                          </td>
                        </tr>
                        {openId === b.id && (
                          <tr className="bg-paper">
                            <td colSpan={5} className="py-3">
                              <div className="max-w-[calc(100vw-4rem)] whitespace-normal md:max-w-none"><OrderDetails booking={b} cnNo={b.cnNo} vendorName={vendor?.name} /></div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

export default function VendorDailyPage() {
  return (
    <VendorAuthProvider>
      <VendorShell>
        <Daily />
      </VendorShell>
    </VendorAuthProvider>
  );
}
