"use client";

import Link from "next/link";

import AuthGate from "@/components/AuthGate";
import LiveBridge from "@/components/LiveBridge";
import PrayerReminder from "@/components/PrayerReminder";
import { useAuth } from "@/context/AuthContext";

export default function DriverLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate allow={["DRIVER"]}>
      <LiveBridge />
      <DriverTopbar />
      {children}
    </AuthGate>
  );
}

function DriverTopbar() {
  const { user, logout } = useAuth();
  return (
    <div className="border-b-[3px] border-brass bg-navy px-4 pb-3 pt-2.5 uppercase text-paper">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1 leading-tight">
          <div className="font-display text-lg font-bold tracking-wide">Future Courier</div>
          <div className="truncate font-mono text-[10.5px] uppercase tracking-wide text-brass-light">{user?.name}</div>
        </div>
        <button
          onClick={logout}
          className="shrink-0 rounded-full border border-white/25 px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-line hover:border-brass-light hover:text-white"
        >
          Sign out
        </button>
      </div>
      <div className="mt-2 flex items-center gap-x-3.5 overflow-hidden whitespace-nowrap border-t border-white/10 pt-2">
        <Link href="/driver/history" className="shrink-0 font-mono text-[10.5px] uppercase tracking-wide text-line hover:text-brass-light">
          My History
        </Link>
        <Link href="/driver/payroll" className="shrink-0 font-mono text-[10.5px] uppercase tracking-wide text-line hover:text-brass-light">
          My Payroll
        </Link>
        <span className="ml-auto min-w-0 truncate text-[11px]">
          <PrayerReminder />
        </span>
      </div>
    </div>
  );
}
