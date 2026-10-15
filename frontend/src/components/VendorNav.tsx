"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/vendor-portal/daily", label: "📅 Daily" },
  { href: "/vendor-portal/search", label: "🔍 Search" },
  { href: "/vendor-portal/consignments", label: "📦 New consignment" },
  { href: "/vendor-portal", label: "💰 Account" },
];

/** Menu bar shown under the header on every vendor portal page. */
export default function VendorNav() {
  const path = usePathname();
  return (
    <nav className="sticky top-0 z-20 flex gap-1 overflow-x-auto border-b border-line bg-white px-2 md:px-6">
      {TABS.map((t) => {
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
