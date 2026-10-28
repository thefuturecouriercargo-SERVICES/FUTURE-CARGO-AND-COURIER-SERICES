"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { fmtNumber } from "@/lib/format";
import { VendorAuthProvider, useVendorAuth } from "@/context/VendorAuthContext";
import VendorShell from "@/components/VendorShell";
import VendorOrderStatus from "@/components/VendorOrderStatus";
import OrderDetails from "@/components/OrderDetails";
import { OrderBookingDetails } from "@/types";
import { detectArea } from "@/lib/areas";

interface Hit {
  key: string;
  cnNo: number;
  date: string;
  status: string;
  amount: number;
  emirate: string;
  note?: string | null;
  area?: string;
  booking?: OrderBookingDetails | null;
}

interface SearchResponse {
  orders: {
    id: string;
    cnNo: number;
    date: string;
    status: string;
    total: number;
    emirate: string;
    remarks?: string | null;
    area?: string | null;
    booking?: OrderBookingDetails | null;
  }[];
  bookings: (OrderBookingDetails & { id: string; cnNo: number; status: string; createdAt: string; rejectReason?: string | null })[];
}

function Search() {
  const { vendor } = useVendorAuth();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits(null);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await apiFetch<SearchResponse>("/vendor-portal/search", { query: { q: term } });
        const list: Hit[] = [
          ...r.orders.map((o) => ({
            key: `o-${o.id}`,
            cnNo: o.cnNo,
            date: o.date,
            status: o.status,
            amount: o.total,
            emirate: o.emirate,
            note: o.remarks,
            area: o.area || detectArea(o.booking?.address, o.emirate),
            booking: o.booking,
          })),
        ];
        setHits(list);
        if (list.length === 1) setOpenKey(list[0].key);
      } catch {
        setHits([]);
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-brass">Search</p>
      <h1 className="mb-1 font-display text-[26px] font-semibold tracking-tight text-navy md:text-[32px]">Find any consignment</h1>
      <p className="mb-4 text-sm text-ink-soft">Searches consignments already picked up into Daily Entry.</p>
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="CN number, customer name, phone or area…"
        className="mb-5 w-full rounded border-2 border-brass px-4 py-3 text-base"
      />

      {loading && <p className="text-sm text-ink-soft">Searching…</p>}
      {!loading && hits && hits.length === 0 && <p className="text-sm text-ink-soft">Nothing found for “{q.trim()}”.</p>}

      <div className="space-y-2">
        {hits?.map((h) => (
          <div key={h.key} className="border border-line bg-white">
            <button onClick={() => setOpenKey(openKey === h.key ? null : h.key)} className="flex w-full flex-wrap items-center justify-between gap-2 p-3 text-left hover:bg-paper">
              <span>
                <b className="font-mono text-base text-navy">CN {h.cnNo}</b>
                {h.booking && <span className="ml-2">{h.booking.customerName}</span>}
                <span className="ml-2 text-xs text-ink-soft">
                  {new Date(h.date).toLocaleDateString("en-GB")} · {h.area ? `${h.area} · ` : ""}{h.emirate} · {h.amount === 0 && h.booking ? "Prepaid" : `AED ${fmtNumber(h.amount)}`}
                </span>
              </span>
              <VendorOrderStatus status={h.status} />
            </button>
            {openKey === h.key && (
              <div className="border-t border-line bg-paper p-3">
                {h.note && <p className="mb-2 text-sm text-cancelled">{h.note}</p>}
                <OrderDetails booking={h.booking} cnNo={h.cnNo} vendorName={vendor?.name} total={h.amount} />
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

export default function VendorSearchPage() {
  return (
    <VendorAuthProvider>
      <VendorShell>
        <Search />
      </VendorShell>
    </VendorAuthProvider>
  );
}
