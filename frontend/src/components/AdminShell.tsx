"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/monthly", label: "Monthly" },
  { href: "/orders", label: "Daily Entry" },
  { href: "/employees", label: "Employees" },
  { href: "/vendors", label: "Vendors" },
  { href: "/expenses", label: "Expenses" },
  { href: "/reports", label: "Reports" },
  { href: "/reports/pnl", label: "P&L Report" },
  { href: "/audit-log", label: "Audit Log" },
  { href: "/settings", label: "Settings" },
];

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-paper">
      <div className="flex h-16 items-center justify-between border-b-[3px] border-brass bg-navy px-6 text-paper">
        <div className="flex items-baseline gap-2.5">
          <span className="font-display text-xl font-bold">Future Courier</span>
          <span className="font-mono text-[10px] uppercase tracking-widest text-brass-light">Operations</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="font-mono text-xs text-line">
            {user?.name} · <span className="text-brass-light">Super Admin</span>
          </span>
          <button
            onClick={logout}
            className="rounded border border-white/25 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-line hover:border-brass-light hover:text-white"
          >
            Sign out
          </button>
        </div>
      </div>

      <div className="flex">
        <nav className="min-h-[calc(100vh-4rem)] w-52 shrink-0 border-r border-line bg-white p-3">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`mb-1 block rounded px-3 py-2 font-mono text-[11px] uppercase tracking-wide ${
                  active ? "bg-navy text-paper" : "text-ink-soft hover:bg-paper-2 hover:text-navy"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <main className="min-w-0 flex-1 p-8">{children}</main>
      </div>
    </div>
  );
}
