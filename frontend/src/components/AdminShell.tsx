"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import AdminVoiceAssistant from "@/components/AdminVoiceAssistant";
import AdminSearch from "@/components/AdminSearch";
import CommandPalette from "@/components/CommandPalette";
import { FeedbackHost } from "@/components/ui/Feedback";
import AlertsBell from "@/components/AlertsBell";

type NavItem = { href: string; label: string; short: string; roles: string[]; group: string };

// Thin line icons (24×24 stroke paths) for each menu item.
const ICONS: Record<string, string> = {
  "/dashboard": "M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z",
  "/dashboard/monthly": "M3 5h18v16H3zM3 10h18M8 3v4M16 3v4",
  "/orders": "M12 5v14M5 12h14",
  "/assign": "M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3M7 12h10",
  "/awaiting-pickup": "M3 7h11v10H3zM14 10h4l3 3v4h-7M7 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  "/employees": "M16 21v-2a4 4 0 0 0-8 0v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  "/agents": "M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM21 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  "/agent-report": "M14 3H6v18h12V7zM14 3v4h4M12 17v-6M9 14l3-3 3 3",
  "/payroll": "M3 6h18v12H3zM3 10h18M7 15h3",
  "/vendors": "M3 9l2-5h14l2 5M4 9v11h16V9M3 9h18M9 20v-6h6v6",
  "/vendor-credit": "M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  "/bank-ledger": "M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 21h18",
  "/expenses": "M4 3h16v18l-3-2-3 2-2-2-2 2-3-2-3 2zM8 8h8M8 12h8",
  "/reports": "M4 20V10M10 20V4M16 20v-7M22 20H2",
  "/reports/pnl": "M3 17l6-6 4 4 8-8M15 7h6v6",
  "/audit-log": "M12 8v4l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
  "/settings": "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 14H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 10h.1a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1z",
};

function NavIcon({ href, size = 18 }: { href: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
      <path d={ICONS[href] ?? ICONS["/dashboard"]} />
    </svg>
  );
}

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
  const prefs = useShellPrefs();

  const visibleNav = NAV.filter((item) => item.roles.includes(user?.role ?? ""));
  const current = NAV.find((n) => n.href === pathname);
  const initials = (user?.name ?? "A").trim().slice(0, 2).toUpperCase();
  const collapsed = prefs.collapsed;

  return (
    <div className={`admin-shell ${prefs.dark ? "theme-midnight" : ""} ${prefs.compact ? "density-compact" : ""} min-h-screen bg-paper text-ink`}>
      <FeedbackHost />
      <CommandPalette links={visibleNav.map((n) => ({ href: n.href, label: n.label, group: n.group }))} />
      <AdminVoiceAssistant />
      <div className="z-40 flex h-[72px] items-center justify-between gap-4 border-b border-[#1B2438] bg-[#0A1020] px-4 md:sticky md:top-0 md:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#D4AF5A] font-display text-[15px] font-bold text-[#0A1020] shadow-[0_0_24px_rgba(212,175,90,0.25)]">
            FC
          </div>
          <div className="flex flex-col leading-tight">
            <span className="font-display text-base font-semibold text-white md:text-[17px]">Future Courier</span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#D4AF5A]">Operations</span>
          </div>
        </div>
        <div className="mx-4 hidden max-w-xl flex-1 items-center gap-2 md:flex">
          <div className="flex-1">
            <AdminSearch />
          </div>
          <button
            onClick={() => window.dispatchEvent(new Event("fc-palette"))}
            title="Quick search (Ctrl + K)"
            className="hidden h-11 shrink-0 items-center gap-1.5 rounded-xl border border-[#1F2A40] bg-[#121A2B] px-3 text-xs text-[#8C97AD] hover:border-[#D4AF5A] hover:text-white lg:flex"
          >
            <kbd className="font-sans">Ctrl</kbd>
            <kbd className="font-sans">K</kbd>
          </button>
        </div>
        <div className="flex items-center gap-2.5 md:gap-3">
          <AlertsBell />
          <div className="hidden sm:block">
            <ThemeSwitch mode={prefs.mode} onChange={prefs.setMode} />
          </div>
          <div className="hidden items-center gap-3 lg:flex">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[#D4AF5A] bg-[#18213A] text-[13px] font-semibold text-[#D4AF5A]">
              {initials}
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-[13px] font-semibold text-white">{user?.name}</span>
              <span className="text-[11px] capitalize text-[#9AA5BA]">{user?.role?.replace("_", " ").toLowerCase()}</span>
            </div>
          </div>
          <button
            onClick={logout}
            className="touch-target rounded-xl border border-[#243049] px-3.5 text-[13px] text-[#9AA5BA] transition hover:border-[#D4AF5A] hover:text-white"
          >
            Sign out
          </button>
        </div>
      </div>

      {/* Phone: search gets its own row under the top bar. */}
      <div className="sticky top-0 z-40 border-b border-[#1B2438] bg-[#0A1020] px-3 py-2 md:hidden">
        <AdminSearch />
      </div>

      <div className="flex">
        {/* Desktop sidebar — full, or collapsed to an icon rail. */}
        <nav
          aria-label="Main"
          className={`sticky top-[72px] hidden h-[calc(100vh-72px)] shrink-0 flex-col overflow-y-auto border-r border-[#1B2438] bg-[#0A1020] py-5 transition-[width] duration-200 md:flex ${
            collapsed ? "w-[76px] items-center px-2" : "w-60 px-4"
          }`}
        >
          {GROUPS.map((group) => {
            const items = visibleNav.filter((item) => item.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group} className={`mb-5 ${collapsed ? "flex w-full flex-col items-center" : ""}`}>
                {collapsed ? (
                  <div className="mb-2 h-px w-8 bg-[#1B2438]" aria-hidden />
                ) : (
                  <div className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6F7B93]">{group}</div>
                )}
                {items.map((item) => {
                  const active = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      aria-label={collapsed ? item.label : undefined}
                      className={`group relative mb-0.5 flex items-center rounded-xl text-[13.5px] transition ${
                        collapsed ? "h-11 w-11 justify-center" : "gap-3 px-3 py-2.5"
                      } ${
                        active
                          ? "bg-[#1A1F2E] font-semibold text-[#F1D9A0] shadow-[inset_0_0_0_1px_#3A3220]"
                          : "text-[#AAB4C8] hover:bg-[#121A2B] hover:text-white"
                      }`}
                    >
                      <NavIcon href={item.href} />
                      {!collapsed && item.label}
                      {collapsed && (
                        <span className="pointer-events-none absolute left-[54px] z-50 hidden whitespace-nowrap rounded-lg border border-[#3A3220] bg-[#1A1F2E] px-2.5 py-1.5 text-xs font-medium text-[#F1D9A0] shadow-lg group-hover:block">
                          {item.label}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            );
          })}
          <button
            onClick={() => prefs.setCollapsed(!collapsed)}
            className={`mt-auto flex h-11 shrink-0 items-center gap-2.5 rounded-xl border border-[#1F2A40] text-[13px] text-[#8C97AD] hover:border-[#D4AF5A] hover:text-white ${
              collapsed ? "w-11 justify-center" : "px-3"
            }`}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className={collapsed ? "rotate-180" : ""}>
              <path d="M15 18l-6-6 6-6" />
            </svg>
            {!collapsed && "Collapse"}
          </button>
        </nav>

        <main className="min-w-0 flex-1 p-4 pb-24 md:p-8 md:pb-10">
          {current && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs text-ink-soft">
                <span>{current.group}</span>
                <span aria-hidden>/</span>
                <span className="font-medium text-navy">{current.label}</span>
              </nav>
              <DensitySwitch compact={prefs.compact} onChange={prefs.setCompact} />
            </div>
          )}
          <div key={pathname} className="page-enter">
            {children}
          </div>
        </main>
      </div>

      {/* Mobile bottom tab bar — padded for the iPhone home-indicator swipe area,
          so nav items never sit underneath it or get accidentally triggered by
          the system's edge-swipe gesture. */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex overflow-x-auto border-t border-[#1B2438] bg-[#0A1020] shadow-[0_-4px_16px_rgba(0,0,0,0.4)] md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        {visibleNav.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex min-h-[52px] min-w-[72px] flex-1 flex-col items-center justify-center gap-1 px-2 py-2 text-[10px] font-medium ${
                active ? "text-[#D4AF5A]" : "text-[#9AA5BA]"
              }`}
            >
              <NavIcon href={item.href} size={18} />
              <span className="whitespace-nowrap">{item.short}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

type ThemeMode = "dark" | "light" | "auto";

/** Per-device display preferences, remembered in this browser. */
function useShellPrefs() {
  const [mode, setModeState] = useState<ThemeMode>("dark");
  const [systemDark, setSystemDark] = useState(true);
  const [collapsed, setCollapsedState] = useState(false);
  const [compact, setCompactState] = useState(false);

  useEffect(() => {
    const read = (k: string) => {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    };
    const m = read("fc-theme");
    if (m === "light" || m === "auto" || m === "dark") setModeState(m);
    setCollapsedState(read("fc-sidebar") === "collapsed");
    setCompactState(read("fc-density") === "compact");
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemDark(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const save = (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode — preference just won't persist */
    }
  };

  return {
    mode,
    dark: mode === "dark" || (mode === "auto" && systemDark),
    collapsed,
    compact,
    setMode: (m: ThemeMode) => {
      setModeState(m);
      save("fc-theme", m);
    },
    setCollapsed: (c: boolean) => {
      setCollapsedState(c);
      save("fc-sidebar", c ? "collapsed" : "open");
    },
    setCompact: (c: boolean) => {
      setCompactState(c);
      save("fc-density", c ? "compact" : "comfortable");
    },
  };
}

function ThemeSwitch({ mode, onChange }: { mode: ThemeMode; onChange: (m: ThemeMode) => void }) {
  const opts: { value: ThemeMode; label: string; icon: string }[] = [
    { value: "light", label: "Light", icon: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5" },
    { value: "dark", label: "Dark", icon: "M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z" },
    { value: "auto", label: "Auto", icon: "M3 5h18v12H3zM8 21h8M12 17v4" },
  ];
  return (
    <div role="radiogroup" aria-label="Theme" className="flex rounded-full border border-[#1F2A40] bg-[#121A2B] p-1">
      {opts.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={mode === o.value}
          aria-label={`${o.label} theme`}
          title={`${o.label} theme`}
          onClick={() => onChange(o.value)}
          className={`flex h-9 w-9 items-center justify-center rounded-full transition ${
            mode === o.value ? "bg-[#D4AF5A] text-[#14100A]" : "text-[#9AA5BA] hover:text-white"
          }`}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d={o.icon} />
          </svg>
        </button>
      ))}
    </div>
  );
}

function DensitySwitch({ compact, onChange }: { compact: boolean; onChange: (c: boolean) => void }) {
  return (
    <div role="radiogroup" aria-label="Table density" className="hidden rounded-xl border border-line bg-white p-1 sm:flex">
      {[
        { v: false, label: "Comfortable" },
        { v: true, label: "Compact" },
      ].map((o) => (
        <button
          key={o.label}
          role="radio"
          aria-checked={compact === o.v}
          onClick={() => onChange(o.v)}
          className={`h-8 rounded-lg px-3 text-xs transition ${compact === o.v ? "bg-paper-2 font-semibold text-brass" : "text-ink-soft hover:text-navy"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
