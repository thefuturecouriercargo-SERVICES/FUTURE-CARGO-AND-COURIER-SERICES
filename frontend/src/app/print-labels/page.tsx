"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import AuthGate from "@/components/AuthGate";
import LabelSheet from "@/components/LabelSheet";
import { apiFetch } from "@/lib/api";
import { Booking } from "@/types";

// Office label printing — outside the admin layout so the page is just the labels.
function Labels() {
  const ids = useSearchParams().get("ids") ?? "";
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!ids) return;
    apiFetch<{ bookings: Booking[] }>("/bookings", { query: { ids } })
      .then((r) => {
        const order = ids.split(",");
        setBookings([...r.bookings].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load labels"));
  }, [ids]);

  if (error) return <p className="p-6 text-cancelled">{error}</p>;
  if (!bookings) return <p className="p-6 text-ink-soft">Loading labels…</p>;

  return (
    <LabelSheet
      bookings={bookings}
      backHref="/awaiting-pickup"
      onPrinted={(printed) => {
        apiFetch<{ website?: { marked: number; failed: number; error?: string } }>("/bookings/mark-printed", { method: "POST", body: { ids: printed } })
          .then((r: { website?: { marked: number; failed: number; error?: string } }) => {
          if (r?.website?.failed) alert(`Labels printed. ${r.website.failed} website order(s) could not be marked "Completed" on the website — please mark them there.\n\n${r.website.error ?? ""}`);
        })
          .catch(() => {});
      }}
    />
  );
}

export default function PrintLabelsPage() {
  return (
    <AuthGate allow={["SUPER_ADMIN", "MANAGER"]}>
      <Suspense fallback={<p className="p-6 text-ink-soft">Loading…</p>}>
        <Labels />
      </Suspense>
    </AuthGate>
  );
}
