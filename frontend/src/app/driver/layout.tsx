"use client";

import Link from "next/link";

import AuthGate from "@/components/AuthGate";
import { useAuth } from "@/context/AuthContext";

export default function DriverLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate allow={["DRIVER"]}>
      <DriverTopbar />
      {children}
    </AuthGate>
  );
}

function DriverTopbar() {
  const { user, logout } = useAuth();
  return (
    <div className="border-b-[3px] border-brass bg-navy px-4 py-3 text-paper">
      <div className="flex flex-wrap items-center justify-between gap-y-2">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-lg font-bold">Future Courier</span>
          <span className="hidden font-mono text-[10px] uppercase tracking-widest text-brass-light sm:inline">Driver Portal</span>
        </div>
        <button
          onClick={logout}
          className="rounded border border-white/25 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-line hover:border-brass-light hover:text-white"
        >
          Sign out
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-white/10 pt-2">
        <Link href="/driver/history" className="font-mono text-[11px] uppercase tracking-wide text-line hover:text-brass-light">
          My History
        </Link>
        <Link href="/driver/payroll" className="font-mono text-[11px] uppercase tracking-wide text-line hover:text-brass-light">
          My Payroll
        </Link>
        <span className="ml-auto font-mono text-xs text-brass-light">{user?.name}</span>
      </div>
    </div>
  );
}
