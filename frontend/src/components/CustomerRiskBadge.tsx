"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

type Risk = {
  cancelled: number;
  delivered: number;
  level: "none" | "caution" | "high";
  orders?: { cnNo: number; status: string; date: string; vendor: string; reason: string | null }[];
};

// One request per phone per page visit, shared by every badge showing it.
const cache = new Map<string, Promise<Risk | null>>();

function phoneKey(phone: string) {
  const d = phone.replace(/[^0-9]/g, "");
  return d.length >= 9 ? d.slice(-9) : null;
}

function fetchRisk(phone: string, vendor: boolean, excludeCn?: number): Promise<Risk | null> {
  const key = phoneKey(phone);
  if (!key) return Promise.resolve(null);
  const id = `${vendor ? "v" : "s"}|${key}|${excludeCn ?? ""}`;
  if (!cache.has(id)) {
    cache.set(
      id,
      apiFetch<Risk>(vendor ? "/vendor-portal/customer-risk" : "/customer-risk", { query: { phone, excludeCn } }).catch(() => {
        cache.delete(id);
        return null;
      })
    );
  }
  return cache.get(id)!;
}

/**
 * Warns when a customer phone has refused (RTO / cancelled) parcels before —
 * from any vendor. Shows nothing for new or good customers.
 *   mode "staff"  → admin/driver: counts, plus the past CNs on tap
 *   mode "vendor" → vendor portal: counts only
 */
export default function CustomerRiskBadge({
  phone,
  mode = "staff",
  excludeCn,
  className = "",
}: {
  phone: string | null | undefined;
  mode?: "staff" | "vendor";
  excludeCn?: number;
  className?: string;
}) {
  const [risk, setRisk] = useState<Risk | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    setRisk(null);
    const p = (phone ?? "").trim();
    if (!phoneKey(p)) return;
    // Small wait so typing a phone doesn't fire a request per digit.
    const t = setTimeout(() => {
      fetchRisk(p, mode === "vendor", excludeCn).then((r) => alive && setRisk(r));
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [phone, mode, excludeCn]);

  if (!risk || risk.level === "none") return null;

  const high = risk.level === "high";
  const tone = high ? "border-cancelled/50 bg-cancelled-bg text-cancelled" : "border-pending/50 bg-pending-bg text-pending";
  const text = `Refused ${risk.cancelled} parcel${risk.cancelled === 1 ? "" : "s"} before${risk.delivered ? ` · ${risk.delivered} delivered` : ""}`;
  const list = risk.orders?.filter((o) => o.status === "CANCELLED") ?? [];

  return (
    <div className={`rounded-lg border px-3 py-2 text-xs ${tone} ${className}`} role="alert">
      <div className="flex items-start gap-2">
        <span aria-hidden>⚠</span>
        <div className="flex-1">
          <b className="font-semibold">{high ? "High-risk customer" : "Check before sending"}</b> — {text}.{" "}
          {mode === "vendor" ? "Please confirm with the customer before booking." : "Call to confirm before dispatch."}
          {list.length > 0 && (
            <button type="button" onClick={() => setOpen(!open)} className="ml-1 underline underline-offset-2">
              {open ? "Hide" : "See"}
            </button>
          )}
        </div>
      </div>
      {open && list.length > 0 && (
        <ul className="mt-2 space-y-0.5 border-t border-current/20 pt-2 font-mono text-[11px]">
          {list.slice(0, 8).map((o) => (
            <li key={o.cnNo}>
              CN {o.cnNo} · {o.vendor} · {o.date}
              {o.reason ? ` · ${o.reason}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
