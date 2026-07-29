"use client";

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
    <div className="flex h-16 items-center justify-between border-b-[3px] border-brass bg-navy px-6 text-paper">
      <div className="flex items-baseline gap-2.5">
        <span className="font-display text-xl font-bold">Future Courier</span>
        <span className="font-mono text-[10px] uppercase tracking-widest text-brass-light">Driver Portal</span>
      </div>
      <div className="flex items-center gap-4">
        <span className="font-mono text-xs text-line">{user?.name}</span>
        <button onClick={logout} className="rounded border border-white/25 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-line hover:border-brass-light hover:text-white">
          Sign out
        </button>
      </div>
    </div>
  );
}
