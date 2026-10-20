"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api";

const EMIRATES = ["DUBAI", "SHARJAH", "AJMAN", "ABUDHABI", "AL AIN", "RAS AL KHAIMAH", "UMM AL QUWAIN", "FUJAIRAH"];
const SAVE_KEY = "fcOrderDetails";

type Saved = { name: string; phone: string; building: string; street: string; emirate: string; landmark: string; lat?: number; lng?: number };

/** Lat/lng from a pasted Google Maps link ("…/@25.27,55.33,17z", "?q=25.27,55.33"). */
function coordsFromLink(t: string): { lat: number; lng: number } | null {
  const m = t.match(/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/) || t.match(/[?&](?:q|query|ll|destination)=(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/) || t.match(/^\s*(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)\s*$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return lat > 22 && lat < 27 && lng > 51 && lng < 57 ? { lat, lng } : null;
}

/**
 * Customer delivery-details page for one vendor: /order/ZZAISHA.
 * The vendor shares the link; the customer types name + phone (last details fill
 * in), the address, and shares their current location. The vendor then adds the
 * items + amount and accepts it.
 */
export default function CustomerOrderPage() {
  const { slug } = useParams<{ slug: string }>();
  const [vendor, setVendor] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [step, setStep] = useState<"who" | "where" | "done">("who");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [building, setBuilding] = useState("");
  const [street, setStreet] = useState("");
  const [emirate, setEmirate] = useState("DUBAI");
  const [landmark, setLandmark] = useState("");
  const [notes, setNotes] = useState("");
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [pinBusy, setPinBusy] = useState(false);
  const [pinMsg, setPinMsg] = useState("");
  const [link, setLink] = useState("");
  const [welcome, setWelcome] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [hp, setHp] = useState(""); // honeypot

  useEffect(() => {
    apiFetch<{ name: string }>(`/public/vendor/${encodeURIComponent(slug)}`)
      .then((r) => setVendor(r.name))
      .catch(() => setNotFound(true));
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) || "null") as Saved | null;
      if (s) {
        setName(s.name);
        setPhone(s.phone);
      }
    } catch {
      /* ignore */
    }
  }, [slug]);

  function fill(s: Partial<Saved>) {
    if (s.building !== undefined) setBuilding(s.building);
    if (s.street !== undefined) setStreet(s.street);
    if (s.emirate) setEmirate(s.emirate);
    if (s.landmark !== undefined) setLandmark(s.landmark);
    if (s.lat != null && s.lng != null) setPin({ lat: s.lat, lng: s.lng });
  }

  async function next(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (name.trim().length < 2) return setError("Please enter your name.");
    if (phone.replace(/\D/g, "").length < 9) return setError("Please enter your mobile number.");
    setBusy(true);
    try {
      // Same phone on this device: use what was saved here.
      let filled = false;
      try {
        const s = JSON.parse(localStorage.getItem(SAVE_KEY) || "null") as Saved | null;
        if (s && s.phone.replace(/\D/g, "") === phone.replace(/\D/g, "")) {
          fill(s);
          filled = true;
        }
      } catch {
        /* ignore */
      }
      if (!filled) {
        const r = await apiFetch<{ found: boolean; address?: string; emirate?: string; landmark?: string | null; lat?: number | null; lng?: number | null }>(
          `/public/vendor/${encodeURIComponent(slug)}/lookup`,
          { method: "POST", body: { name, phone } }
        ).catch(() => ({ found: false }) as { found: false });
        if (r.found && "address" in r) {
          fill({ building: r.address ?? "", street: "", emirate: r.emirate ?? "DUBAI", landmark: r.landmark ?? "", lat: r.lat ?? undefined, lng: r.lng ?? undefined });
          filled = true;
        }
      }
      setWelcome(filled ? "Welcome back! We filled in your last address — please check it." : "");
      setStep("where");
      window.scrollTo(0, 0);
    } finally {
      setBusy(false);
    }
  }

  function useMyLocation() {
    setPinMsg("");
    if (!navigator.geolocation) return setPinMsg("Your phone doesn't share location here — paste a Google Maps link instead.");
    setPinBusy(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPin({ lat: Number(p.coords.latitude.toFixed(6)), lng: Number(p.coords.longitude.toFixed(6)) });
        setPinMsg(p.coords.accuracy > 100 ? `Location found (about ${Math.round(p.coords.accuracy)} m). If you're not at the delivery place, paste its Maps link below.` : "");
        setPinBusy(false);
      },
      (err) => {
        setPinBusy(false);
        setPinMsg(err.code === 1 ? "Location permission was blocked. Allow location for this site, or paste a Google Maps link below." : "Couldn't get your location — try again, or paste a Google Maps link below.");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    setError("");
    const address = [building.trim(), street.trim()].filter(Boolean).join(", ");
    if (address.length < 5) return setError("Please enter your building / villa and area.");
    let where = pin;
    let extra = "";
    if (!where && link.trim()) {
      where = coordsFromLink(link);
      if (!where) extra = `Location link: ${link.trim()}`;
    }
    setBusy(true);
    try {
      await apiFetch(`/public/vendor/${encodeURIComponent(slug)}/request`, {
        method: "POST",
        body: {
          customerName: name.trim(),
          customerPhone: phone.trim(),
          address,
          emirate,
          landmark: landmark.trim() || undefined,
          notes: [notes.trim(), extra].filter(Boolean).join(" · ") || undefined,
          lat: where?.lat,
          lng: where?.lng,
          website: hp,
        },
      });
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify({ name, phone, building, street, emirate, landmark, lat: where?.lat, lng: where?.lng } satisfies Saved));
      } catch {
        /* ignore */
      }
      setStep("done");
      window.scrollTo(0, 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send — please try again.");
    } finally {
      setBusy(false);
    }
  }

  const input = "w-full rounded-lg border border-line bg-white px-3.5 py-3 text-base outline-none focus:border-navy";
  const label = "mb-1 block text-sm font-semibold text-navy";

  if (notFound)
    return (
      <main className="flex min-h-screen items-center justify-center bg-paper p-6 text-center">
        <p className="text-ink-soft">This order link isn&apos;t active. Please ask the shop for the right link.</p>
      </main>
    );

  return (
    <main className="min-h-screen bg-paper">
      <header className="bg-navy px-5 pb-6 pt-7 text-paper">
        <div className="mx-auto max-w-md">
          <div className="font-mono text-[11px] uppercase tracking-widest text-brass-light">Delivery details</div>
          <h1 className="mt-1 font-display text-3xl font-semibold">{vendor ?? "…"}</h1>
          <p className="mt-1 text-sm text-paper/80">Delivered by The Future Courier Service</p>
        </div>
      </header>

      <div className="mx-auto max-w-md p-5">
        {step === "who" && (
          <form onSubmit={next} className="space-y-4">
            <p className="text-sm text-ink-soft">Tell us who you are — if you ordered before, we&apos;ll fill in your address.</p>
            <div>
              <label className={label}>Your name</label>
              <input className={input} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="e.g. Fatima Khan" />
            </div>
            <div>
              <label className={label}>Mobile number</label>
              <input className={input} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="05x xxx xxxx" />
            </div>
            {error && <p className="text-sm text-cancelled">{error}</p>}
            <button disabled={busy} className="w-full rounded-lg bg-navy py-3.5 text-base font-semibold text-paper disabled:opacity-60">
              {busy ? "Please wait…" : "Continue →"}
            </button>
          </form>
        )}

        {step === "where" && (
          <form onSubmit={send} className="space-y-4">
            {welcome && <p className="rounded-lg bg-delivered-bg px-3 py-2 text-sm text-delivered">{welcome}</p>}
            <div className="flex items-center justify-between text-sm">
              <span>
                <b>{name}</b> · {phone}
              </span>
              <button type="button" onClick={() => setStep("who")} className="text-ink-soft underline">
                Change
              </button>
            </div>

            <div className="rounded-xl border border-line bg-white p-4">
              <div className="mb-2 text-sm font-semibold text-navy">📍 Your location</div>
              {pin ? (
                <>
                  <iframe
                    title="Your location"
                    className="h-48 w-full rounded-lg border border-line"
                    src={`https://maps.google.com/maps?q=${pin.lat},${pin.lng}&z=17&output=embed`}
                    loading="lazy"
                  />
                  <div className="mt-2 flex items-center justify-between text-xs text-ink-soft">
                    <span>✓ Location pinned</span>
                    <span className="flex gap-3">
                      <button type="button" onClick={useMyLocation} className="underline">
                        Update
                      </button>
                      <button type="button" onClick={() => setPin(null)} className="underline">
                        Remove
                      </button>
                    </span>
                  </div>
                </>
              ) : (
                <button type="button" onClick={useMyLocation} disabled={pinBusy} className="w-full rounded-lg bg-delivered py-3 text-base font-semibold text-white disabled:opacity-60">
                  {pinBusy ? "Finding you…" : "📍 Use my current location"}
                </button>
              )}
              {pinMsg && <p className="mt-2 text-xs text-pending">{pinMsg}</p>}
              {!pin && (
                <input
                  className={`${input} mt-3 text-sm`}
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  placeholder="…or paste a Google Maps link (optional)"
                />
              )}
            </div>

            <div>
              <label className={label}>Building / Villa, flat number</label>
              <input className={input} value={building} onChange={(e) => setBuilding(e.target.value)} placeholder="e.g. Al Noor Building, Flat 302" />
            </div>
            <div>
              <label className={label}>Area / street</label>
              <input className={input} value={street} onChange={(e) => setStreet(e.target.value)} placeholder="e.g. Al Nahda 2, Amman Street" />
            </div>
            <div>
              <label className={label}>Emirate</label>
              <select className={input} value={emirate} onChange={(e) => setEmirate(e.target.value)}>
                {EMIRATES.map((em) => (
                  <option key={em} value={em}>
                    {em === "ABUDHABI" ? "ABU DHABI" : em}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>
                Landmark <span className="font-normal text-ink-soft">(optional)</span>
              </label>
              <input className={input} value={landmark} onChange={(e) => setLandmark(e.target.value)} placeholder="e.g. near Lulu, opposite the mosque" />
            </div>
            <div>
              <label className={label}>
                Note for the driver <span className="font-normal text-ink-soft">(optional)</span>
              </label>
              <input className={input} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. call before coming, after 6 pm" />
            </div>
            <input value={hp} onChange={(e) => setHp(e.target.value)} name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
            {error && <p className="text-sm text-cancelled">{error}</p>}
            <button disabled={busy} className="w-full rounded-lg bg-navy py-3.5 text-base font-semibold text-paper disabled:opacity-60">
              {busy ? "Sending…" : "Send my details"}
            </button>
          </form>
        )}

        {step === "done" && (
          <div className="mt-6 rounded-xl border border-delivered bg-white p-6 text-center">
            <div className="text-4xl">✅</div>
            <h2 className="mt-2 font-display text-2xl font-semibold text-navy">Thank you, {name.split(" ")[0]}!</h2>
            <p className="mt-2 text-sm text-ink-soft">
              {vendor} has your delivery details. Our driver will call you before delivery.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
