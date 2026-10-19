"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

const KEY = "scanBillType2";

/**
 * "Which barcode is on the parcel?" — Auto (default) recognises our CN and the
 * Inspired / Escalo bills by itself; a vendor button forces that vendor's bill
 * (only needed when one number matches two vendors).
 */
export default function BillTypeSelect({
  source,
  value,
  onChange,
}: {
  source: "/bookings/scan-vendors" | "/driver/scan-vendors";
  value: string;
  onChange: (vendorId: string) => void;
}) {
  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    apiFetch<{ id: string; name: string }[]>(source)
      .then((list) => {
        setVendors(list);
        try {
          const saved = localStorage.getItem(KEY) ?? "";
          if (saved && list.some((v) => v.id === saved)) onChange(saved);
        } catch {
          /* ignore */
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  function pick(v: string) {
    onChange(v);
    try {
      localStorage.setItem(KEY, v);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="mb-3">
      <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Barcode on the parcel</label>
      <div className="flex flex-wrap gap-2">
        {[{ id: "", name: "Auto (any barcode)" }, ...vendors.map((v) => ({ id: v.id, name: `${v.name} bill` }))].map((o) => (
          <button
            key={o.id || "own"}
            type="button"
            onClick={() => pick(o.id)}
            className={`rounded border px-3 py-2 font-mono text-xs font-bold uppercase tracking-wide ${
              value === o.id ? "border-navy bg-navy text-paper" : "border-line bg-white text-ink-soft hover:border-brass"
            }`}
          >
            {o.name}
          </button>
        ))}
      </div>
    </div>
  );
}
