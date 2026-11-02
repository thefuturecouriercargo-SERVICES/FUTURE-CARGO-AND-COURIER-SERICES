import { CalculationMethod, Coordinates, PrayerTimes } from "adhan";

/**
 * Prayer times per emirate, calculated offline (no external API) with the
 * UAE / Dubai calculation method. Coordinates are each emirate's main city.
 */
const EMIRATE_COORDS: Record<string, [number, number]> = {
  DUBAI: [25.2048, 55.2708],
  SHARJAH: [25.3463, 55.4209],
  AJMAN: [25.4052, 55.5136],
  ABUDHABI: [24.4539, 54.3773],
  "AL AIN": [24.2075, 55.7447],
  "RAS AL KHAIMAH": [25.8007, 55.9762],
  "UMM AL QUWAIN": [25.5647, 55.5552],
  FUJAIRAH: [25.1288, 56.3265],
};

/** Map the many spellings stored on orders/bookings to one emirate key. */
export function normalizeEmirate(raw?: string | null): string | null {
  const s = (raw ?? "").toUpperCase().replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (/ABU ?DHABI|\bAUH\b/.test(s)) return "ABUDHABI";
  if (/AL ?AIN/.test(s)) return "AL AIN";
  if (/SHARJ|\bSHJ\b/.test(s)) return "SHARJAH";
  if (/AJMAN/.test(s)) return "AJMAN";
  if (/RAS ?AL ?KHAIMAH|\bRAK\b/.test(s)) return "RAS AL KHAIMAH";
  if (/UMM ?AL ?QU?A?I?W|\bUAQ\b/.test(s)) return "UMM AL QUWAIN";
  if (/FUJAIRA/.test(s)) return "FUJAIRAH";
  if (/DUBAI|\bDXB\b/.test(s)) return "DUBAI";
  return null;
}

export const EMIRATE_LABEL: Record<string, string> = {
  DUBAI: "Dubai",
  SHARJAH: "Sharjah",
  AJMAN: "Ajman",
  ABUDHABI: "Abu Dhabi",
  "AL AIN": "Al Ain",
  "RAS AL KHAIMAH": "Ras Al Khaimah",
  "UMM AL QUWAIN": "Umm Al Quwain",
  FUJAIRAH: "Fujairah",
};

export type PrayerName = "fajr" | "dhuhr" | "asr" | "maghrib" | "isha";

/** Today's five prayers (Dubai calendar day) plus tomorrow's Fajr, as ISO instants. */
export function prayerTimesFor(emirate: string, now = new Date()) {
  const [lat, lng] = EMIRATE_COORDS[emirate] ?? EMIRATE_COORDS.DUBAI;
  const coords = new Coordinates(lat, lng);
  const params = CalculationMethod.Dubai();
  // Calendar day in Dubai (UTC+4), handed to adhan as a local Y/M/D.
  const dubai = new Date(now.getTime() + 4 * 3600_000);
  const day = (offset: number) =>
    new Date(dubai.getUTCFullYear(), dubai.getUTCMonth(), dubai.getUTCDate() + offset);
  const today = new PrayerTimes(coords, day(0), params);
  const tomorrow = new PrayerTimes(coords, day(1), params);
  return {
    date: `${dubai.getUTCFullYear()}-${String(dubai.getUTCMonth() + 1).padStart(2, "0")}-${String(dubai.getUTCDate()).padStart(2, "0")}`,
    prayers: [
      { name: "fajr" as PrayerName, at: today.fajr.toISOString() },
      { name: "dhuhr" as PrayerName, at: today.dhuhr.toISOString() },
      { name: "asr" as PrayerName, at: today.asr.toISOString() },
      { name: "maghrib" as PrayerName, at: today.maghrib.toISOString() },
      { name: "isha" as PrayerName, at: today.isha.toISOString() },
    ],
    nextFajr: tomorrow.fajr.toISOString(),
  };
}
