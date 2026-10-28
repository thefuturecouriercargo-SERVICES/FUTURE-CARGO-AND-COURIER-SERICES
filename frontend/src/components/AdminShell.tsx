"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import AdminVoiceAssistant from "@/components/AdminVoiceAssistant";
import AdminSearch from "@/components/AdminSearch";

type NavItem = { href: string; label: string; short: string; roles: string[]; group: string };

const GROUPS = ["Overview", "Operations", "People", "Finance", "System"];

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", short: "Home", roles: ["SUPER_ADMIN", "MANAGER"], group: "Overview" },
  { href: "/dashboard/monthly", label: "Monthly", short: "Monthly", roles: ["SUPER_ADMIN", "MANAGER"], group: "Overview" },
  { href: "/orders", label: "Daily Entry", short: "Orders", roles: ["SUPER_ADMIN"], group: "Operations" },
  { href: "/assign", label: "Scan & Assign", short: "Assign", roles: ["SUPER_ADMIN", "MANAGER"], group: "Operations" },
  { href: "/awaiting-pickup", label: "Awaiting Pickup", short: "Pickup", roles: ["SUPER_ADMIN", "MANAGER"], group: "Operations" },
  { href: "/employees", label: "Employees", short: "Staff", roles: ["SUPER_ADMIN"], group: "People" },
  { href: "/agents", label: "Agents", short: "Agents", roles: ["SUPER_ADMIN", "MANAGER"], group: "People" },
  { href: "/agent-report", label: "Agent Report Upload", short: "A.Report", roles: ["SUPER_ADMIN", "MANAGER"], group: "Operations" },
  { href: "/payroll", label: "Payroll", short: "Payroll", roles: ["SUPER_ADMIN", "MANAGER"], group: "People" },
  { href: "/vendors", label: "Vendors", short: "Vendors", roles: ["SUPER_ADMIN"], group: "People" },
  { href: "/vendor-credit", label: "Vendor Credit", short: "V.Credit", roles: ["SUPER_ADMIN", "MANAGER"], group: "Finance" },
  { href: "/bank-ledger", label: "Bank Ledger", short: "Bank", roles: ["SUPER_ADMIN", "MANAGER"], group: "Finance" },
  { href: "/expenses", label: "Expenses", short: "Expenses", roles: ["SUPER_ADMIN"], group: "Finance" },
  { href: "/reports", label: "Reports", short: "Reports", roles: ["SUPER_ADMIN", "MANAGER"], group: "Overview" },
  { href: "/reports/pnl", label: "P&L Report", short: "P&L", roles: ["SUPER_ADMIN", "MANAGER"], group: "Overview" },
  { href: "/audit-log", label: "Audit Log", short: "Audit", roles: ["SUPER_ADMIN"], group: "System" },
  { href: "/settings", label: "Settings", short: "Settings", roles: ["SUPER_ADMIN"], group: "System" },
];

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  const visibleNav = NAV.filter((item) => item.roles.includes(user?.role ?? ""));

  const initials = (user?.name ?? "A").trim().slice(0, 2).toUpperCase();

  return (
    <div className="theme-midnight min-h-screen bg-paper text-ink">
      <AdminVoiceAssistant />
      <div className="flex h-[72px] items-center justify-between gap-4 border-b border-line bg-[#0A1020] px-4 md:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#D4AF5A] font-display text-[15px] font-bold text-[#0A1020] shadow-[0_0_24px_rgba(212,175,90,0.25)]">
            FC
          </div>
          <div className="flex flex-col leading-tight">
            <span className="font-display text-base font-semibold text-white md:text-[17px]">Future Courier</span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-brass">Operations</span>
          </div>
        </div>
        <div className="mx-6 hidden max-w-xl flex-1 md:block">
          <AdminSearch />
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-3 md:flex">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-brass bg-paper-2 text-[13px] font-semibold text-brass">
              {initials}
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-[13px] font-semibold text-white">{user?.name}</span>
              <span className="text-[11px] capitalize text-ink-soft">{user?.role?.replace("_", " ").toLowerCase()}</span>
            </div>
          </div>
          <button
            onClick={logout}
            className="touch-target rounded-xl border border-line px-3.5 text-[13px] text-ink-soft transition hover:border-brass hover:text-white"
          >
            Sign out
          </button>
        </div>
      </div>

      {/* Phone: search gets its own row under the top bar. */}
      <div className="sticky top-0 z-40 border-b border-line bg-[#0A1020] px-3 py-2 md:hidden">
        <AdminSearch />
      </div>

      <div className="flex">
        {/* Desktop sidebar */}
        <nav className="hidden min-h-[calc(100vh-72px)] w-60 shrink-0 border-r border-line bg-[#0A1020] px-4 py-6 md:block">
          {GROUPS.map((group) => {
            const items = visibleNav.filter((item) => item.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group} className="mb-6">
                <div className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6F7B93]">{group}</div>
                {items.map((item) => {
                  const active = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`mb-0.5 flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13.5px] transition ${
                        active
                          ? "bg-[#1A1F2E] font-semibold text-[#F1D9A0] shadow-[inset_0_0_0_1px_#3A3220]"
                          : "text-[#AAB4C8] hover:bg-[#121A2B] hover:text-white"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? "bg-brass" : "bg-[#2A3550]"}`} aria-hidden />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <main className="min-w-0 flex-1 p-4 pb-24 md:p-8 md:pb-10">{children}</main>
      </div>

      {/* Mobile bottom tab bar — padded for the iPhone home-indicator swipe area,
          so nav items never sit underneath it or get accidentally triggered by
          the system's edge-swipe gesture. */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex overflow-x-auto border-t border-line bg-[#0A1020] shadow-[0_-4px_16px_rgba(0,0,0,0.4)] md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        {visibleNav.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex min-h-[44px] min-w-[72px] flex-1 flex-col items-center justify-center gap-1 px-2 py-2.5 text-[10px] font-medium ${
                active ? "text-brass" : "text-ink-soft"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-brass" : "bg-transparent"}`} aria-hidden />
              <span className="whitespace-nowrap">{item.short}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
