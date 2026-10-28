"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

const ICON: Record<string, string> = {
  daily: "M3 5h18v16H3zM3 10h18M8 3v4M16 3v4",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5",
  new: "M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8",
  requests: "M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6H3v-6z",
  account: "M3 6h18v12H3zM3 10h18M7 15h3",
};

const TABS = [
  { href: "/vendor-portal/daily", label: "Daily", icon: "daily" },
  { href: "/vendor-portal/search", label: "Search", icon: "search" },
  { href: "/vendor-portal/consignments", label: "New consignment", icon: "new" },
  { href: "/vendor-portal", label: "Account", icon: "account" },
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
  const tabs = req.enabled ? [...TABS.slice(0, 3), { href: "/vendor-portal/requests", label: `Customer requests${req.count ? ` (${req.count})` : ""}`, icon: "requests" }, ...TABS.slice(3)] : TABS;
  return (
    <nav aria-label="Vendor portal" className="sticky top-0 z-20 flex gap-1 overflow-x-auto border-b border-[#1B2438] bg-[#0A1020]/95 px-2 py-2 backdrop-blur md:px-6">
      {tabs.map((t) => {
        const active = path === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`flex min-h-[44px] items-center gap-2 whitespace-nowrap rounded-xl px-3.5 text-[13.5px] transition ${
              active ? "bg-[#1A1F2E] font-semibold text-[#F1D9A0] shadow-[inset_0_0_0_1px_#3A3220]" : "text-[#AAB4C8] hover:bg-[#121A2B] hover:text-white"
            }`}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d={ICON[t.icon]} />
            </svg>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
