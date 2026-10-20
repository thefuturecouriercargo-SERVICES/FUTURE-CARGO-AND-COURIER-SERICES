"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiClientError, VENDOR_TAB_KEY, vendorTabToken } from "@/lib/api";

const keepTabToken = (t?: string) => {
  try {
    if (t) sessionStorage.setItem(VENDOR_TAB_KEY, t);
    else sessionStorage.removeItem(VENDOR_TAB_KEY);
  } catch {
    /* private mode — falls back to the shared cookie */
  }
};

interface VendorUser {
  id: string;
  name: string;
  username: string | null;
}

interface VendorAuthContextValue {
  vendor: VendorUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<VendorUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const VendorAuthContext = createContext<VendorAuthContextValue | undefined>(undefined);

export function VendorAuthProvider({ children }: { children: React.ReactNode }) {
  const [vendor, setVendor] = useState<VendorUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const refresh = useCallback(async () => {
    try {
      const me = await apiFetch<VendorUser & { token?: string }>("/vendor-auth/me");
      // First load in this tab: pin the tab to this vendor.
      if (!vendorTabToken() && me.token) keepTabToken(me.token);
      setVendor({ id: me.id, name: me.name, username: me.username });
    } catch {
      setVendor(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await apiFetch<{ vendor: VendorUser; token?: string }>("/vendor-auth/login", {
      method: "POST",
      body: { username, password },
    });
    keepTabToken(res.token);
    setVendor(res.vendor);
    return res.vendor;
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiFetch("/vendor-auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    keepTabToken(undefined);
    setVendor(null);
    router.push("/vendor-login");
  }, [router]);

  const value = useMemo(() => ({ vendor, loading, login, logout, refresh }), [vendor, loading, login, logout, refresh]);

  return <VendorAuthContext.Provider value={value}>{children}</VendorAuthContext.Provider>;
}

export function useVendorAuth(): VendorAuthContextValue {
  const ctx = useContext(VendorAuthContext);
  if (!ctx) throw new Error("useVendorAuth must be used within VendorAuthProvider");
  return ctx;
}

export { ApiClientError };
