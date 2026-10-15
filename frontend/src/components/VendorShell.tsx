"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useVendorAuth } from "@/context/VendorAuthContext";
import VendorNav from "@/components/VendorNav";

/** Header + menu for vendor portal pages. Must be inside VendorAuthProvider. */
export default function VendorShell({ children }: { children: React.ReactNode }) {
  const { vendor, loading, logout } = useVendorAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !vendor) router.push("/vendor-login");
  }, [loading, vendor, router]);

  if (loading || !vendor) return <div className="flex min-h-screen items-center justify-center text-ink-soft">Loading…</div>;

  return (
    <div className="min-h-screen bg-paper">
      <div className="flex h-16 items-center justify-between border-b-[3px] border-brass bg-navy px-4 text-paper md:px-6">
        <div className="flex items-baseline gap-2.5">
          <span className="font-display text-lg font-bold md:text-xl">{vendor.name}</span>
          <span className="hidden font-mono text-[10px] uppercase tracking-widest text-brass-light sm:inline">Vendor Portal</span>
        </div>
        <button
          onClick={logout}
          className="rounded border border-white/25 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wide text-line hover:border-brass-light hover:text-white"
        >
          Sign out
        </button>
      </div>
      <VendorNav />
      <div className="mx-auto max-w-5xl p-4 md:p-8">{children}</div>
    </div>
  );
}
