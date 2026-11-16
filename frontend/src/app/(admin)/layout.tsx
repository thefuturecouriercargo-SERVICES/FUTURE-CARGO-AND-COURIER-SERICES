"use client";

import AuthGate from "@/components/AuthGate";
import AdminShell from "@/components/AdminShell";
import UpdatePopup from "@/components/UpdatePopup";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
 <AuthGate allow={["SUPER_ADMIN", "MANAGER"]}>
      <UpdatePopup portal="admin" />
      <AdminShell>{children}</AdminShell>
    </AuthGate>
  );
}
