"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { VendorAuthProvider, useVendorAuth } from "@/context/VendorAuthContext";
import LabelSheet from "@/components/LabelSheet";
import { Booking } from "@/types";

function Labels() {
  const { vendor, loading } = useVendorAuth();
  const router = useRouter();
  const ids = useSearchParams().get("ids") ?? "";
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading && !vendor) router.push("/vendor-login");
  }, [loading, vendor, router]);

  useEffect(() => {
    if (!vendor || !ids) return;
    apiFetch<{ bookings: Booking[] }>("/vendor-portal/bookings", { query: { ids } })
      .then((r) => {
        // Keep the order the labels were selected in.
        const order = ids.split(",");
        setBookings([...r.bookings].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load labels"));
  }, [vendor, ids]);

  if (error) return <p className="p-6 text-cancelled">{error}</p>;
  if (!bookings) return <p className="p-6 text-ink-soft">Loading labels…</p>;

  return (
    <LabelSheet
      bookings={bookings}
      backHref="/vendor-portal/consignments"
      onPrinted={(printed) => {
        apiFetch("/vendor-portal/bookings/mark-printed", { method: "POST", body: { ids: printed } }).catch(() => {});
      }}
    />
  );
}

export default function VendorLabelsPage() {
  return (
    <VendorAuthProvider>
      <Suspense fallback={<p className="p-6 text-ink-soft">Loading…</p>}>
        <Labels />
      </Suspense>
    </VendorAuthProvider>
  );
}
