"use client";

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
        <div className="flex w-[92px] shrink-0 flex-col items-stretch gap-1.5 whitespace-nowrap">
          <button
            onClick={logout}
            className="w-full rounded-full border border-white/25 px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-line hover:border-brass-light hover:text-white"
          >
            Sign out
          </button>
          <PrayerReminder />
        </div>
      </div>
    </div>
  );
}
