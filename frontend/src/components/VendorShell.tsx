"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useVendorAuth } from "@/context/VendorAuthContext";
import VendorNav from "@/components/VendorNav";

import VendorHeader from "@/components/VendorHeader";
/** Header + menu for vendor portal pages. Must be inside VendorAuthProvider. */
export default function VendorShell({ children }: { children: React.ReactNode }) {
  const { vendor, loading, logout } = useVendorAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !vendor) router.push("/vendor-login");
  }, [loading, vendor, router]);

  if (loading || !vendor) return <div className="theme-midnight flex min-h-screen items-center justify-center bg-paper text-ink-soft">Loading…</div>;

  return (
    <div className="theme-midnight admin-shell min-h-screen bg-paper text-ink">
      <VendorHeader name={vendor.name} onLogout={logout} />
      <VendorNav />
      <div className="mx-auto max-w-5xl p-4 md:p-8">{children}</div>
    </div>
  );
}
