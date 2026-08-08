"use client";

import AuthGate from "@/components/AuthGate";
import AdminShell from "@/components/AdminShell";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
 <AuthGate allow={["SUPER_ADMIN", "MANAGER"]}>
      <AdminShell>{children}</AdminShell>
    </AuthGate>
  );
}
