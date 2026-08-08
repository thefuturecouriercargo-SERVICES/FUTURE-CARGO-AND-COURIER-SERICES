"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

const NAV = [
  { href: "/dashboard", label: "Dashboard", short: "Home", roles: ["SUPER_ADMIN", "MANAGER"] },
  { href: "/dashboard/monthly", label: "Monthly", short: "Monthly", roles: ["SUPER_ADMIN", "MANAGER"] },
  { href: "/orders", label: "Daily Entry", short: "Orders", roles: ["SUPER_ADMIN"] },
  { href: "/employees", label: "Employees", short: "Staff", roles: ["SUPER_ADMIN"] },
  { href: "/payroll", label: "Payroll", short: "Payroll", roles: ["SUPER_ADMIN"] },
  { href: "/vendors", label: "Vendors", short: "Vendors", roles: ["SUPER_ADMIN"] },
  { href: "/expenses", label: "Expenses", short: "Expenses", roles: ["SUPER_ADMIN"] },
  { href: "/reports", label: "Reports", short: "Reports", roles: ["SUPER_ADMIN", "MANAGER"] },
  { href: "/reports/pnl", label: "P&L Report", short: "P&L", roles: ["SUPER_ADMIN", "MANAGER"] },
  { href: "/audit-log", label: "Audit Log", short: "Audit", roles: ["SUPER_ADMIN"] },
  { href: "/settings", label: "Settings", short: "Settings", roles: ["SUPER_ADMIN"] },
];

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  const visibleNav = NAV.filter((item) => item.roles.includes(user?.role ?? ""));

  return (
    <div className="min-h-screen bg-paper">
      <div className="flex h-16 items-center justify-between border-b-[3px] border-brass bg-navy px-4 text-paper md:px-6">
        <div className="flex items-baseline gap-2.5">
          <span className="font-display text-lg font-bold md:text-xl">Future Courier</span>
          <span className="hidden font-mono text-[10px] uppercase tracking-widest text-brass-light sm:inline">
            Operations
          </span>
        </div>
        <div className="flex items-center gap-2.5 md:gap-4">
          <span className="hidden font-mono text-xs text-line md:inline">
            {user?.name} · <span className="text-brass-light">{user?.role?.replace("_", " ")}</span>
          </span>
          <button
            onClick={logout}
            className="rounded border border-white/25 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wide text-line hover:border-brass-light hover:text-white md:px-3 md:text-[11px]"
          >
            Sign out
          </button>
        </div>
      </div>

      <div className="flex">
        {/* Desktop sidebar */}
        <nav className="hidden min-h-[calc(100vh-4rem)] w-52 shrink-0 border-r border-line bg-white p-3 md:block">
          {visibleNav.map((item) => {
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

        <main className="min-w-0 flex-1 p-4 pb-24 md:p-8 md:pb-8">{children}</main>
      </div>

      {/* Mobile bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex overflow-x-auto border-t border-line bg-white shadow-[0_-2px_8px_rgba(0,0,0,0.06)] md:hidden">
        {visibleNav.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex min-w-[72px] flex-1 flex-col items-center gap-1 px-2 py-2.5 font-mono text-[9px] uppercase tracking-wide ${
                active ? "text-navy" : "text-ink-soft"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${active ? "bg-brass" : "bg-transparent"}`}
                aria-hidden
              />
              <span className="whitespace-nowrap">{item.short}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
