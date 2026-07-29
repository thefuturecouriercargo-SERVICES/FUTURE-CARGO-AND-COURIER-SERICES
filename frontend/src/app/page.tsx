"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) return router.replace("/login");
    if (user.role === "SUPER_ADMIN") return router.replace("/dashboard");
    return router.replace("/driver");
  }, [user, loading, router]);

  return (
    <div className="flex h-screen items-center justify-center bg-paper font-mono text-xs uppercase tracking-widest text-ink-soft">
      Loading Future Courier Operations…
    </div>
  );
}
