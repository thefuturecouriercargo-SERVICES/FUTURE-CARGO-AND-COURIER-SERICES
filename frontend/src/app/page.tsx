"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const target = !user ? "/login" : user.role === "SUPER_ADMIN" ? "/dashboard" : "/driver";
    router.replace(target);
    // Backup: if the in-app navigation doesn't happen (seen on iPhone Safari),
    // do a full page load to the same place.
    const t = setTimeout(() => {
      if (window.location.pathname === "/") window.location.replace(target);
    }, 2500);
    return () => clearTimeout(t);
  }, [user, loading, router]);

  // Last resort: still stuck here after 12 s → go to login.
  useEffect(() => {
    const t = setTimeout(() => {
      if (window.location.pathname === "/") window.location.replace("/login");
    }, 12000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="relative flex h-screen flex-col items-center justify-center gap-6 overflow-hidden bg-[#0A1020]">
      <div className="pointer-events-none absolute -bottom-40 -left-40 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(212,175,90,0.12),transparent_65%)]" aria-hidden />
      <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-white shadow-[0_0_32px_rgba(212,175,90,0.3)]">
        <img src="/fc-logo-mark.png" alt="Future Courier" className="h-full w-full object-contain" />
      </div>
      <div className="h-[3px] w-40 overflow-hidden rounded-full bg-[#1B2438]">
        <div className="h-full w-1/3 animate-[fcload_1.1s_ease-in-out_infinite] rounded-full bg-[#D4AF5A]" />
      </div>
      <div className="font-mono text-[11px] uppercase tracking-[0.25em] text-[#D4AF5A]">
        Loading Future Courier Operations…
      </div>
      <style>{`@keyframes fcload{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}`}</style>
    </div>
  );
}
