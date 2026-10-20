"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

const TABS = [
  { href: "/vendor-portal/daily", label: "📅 Daily" },
  { href: "/vendor-portal/search", label: "🔍 Search" },
  { href: "/vendor-portal/consignments", label: "📦 New consignment" },
  { href: "/vendor-portal", label: "💰 Account" },
];

/** Menu bar shown under the header on every vendor portal page. */
export default function VendorNav() {
  const path = usePathname();
  // Customer-link tab only for shops that have it (e.g. ZZAISHA), with the count of new requests.
  const [req, setReq] = useState<{ enabled: boolean; count: number }>({ enabled: false, count: 0 });
  useEffect(() => {
    const check = () =>
      apiFetch<{ enabled: boolean; requests: unknown[] }>("/vendor-portal/customer-requests", { query: { status: "PENDING" } })
        .then((r) => setReq({ enabled: r.enabled, count: r.requests.length }))
        .catch(() => {});
    check();
    const t = setInterval(check, 60000);
    return () => clearInterval(t);
  }, []);
  const tabs = req.enabled ? [...TABS.slice(0, 3), { href: "/vendor-portal/requests", label: `📥 Customer requests${req.count ? ` (${req.count})` : ""}` }, ...TABS.slice(3)] : TABS;
  return (
    <nav className="sticky top-0 z-20 flex gap-1 overflow-x-auto border-b border-line bg-white px-2 md:px-6">
      {tabs.map((t) => {
        const active = path === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`whitespace-nowrap border-b-[3px] px-3 py-3 font-mono text-[11px] uppercase tracking-wide ${
              active ? "border-brass font-bold text-navy" : "border-transparent text-ink-soft hover:text-navy"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
