export function fmtNumber(n: number | undefined | null): string {
  return Math.round(n ?? 0).toLocaleString("en-US");
}

export function fmtDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return fmtDateInput(d);
}

export function todayStr(): string {
  const dubaiOffsetMs = 4 * 60 * 60 * 1000;
  const now = new Date(Date.now() + dubaiOffsetMs);
  return now.toISOString().slice(0, 10);
}

export function currentMonthStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Previous calendar month — Payroll defaults to this rather than the current
// month, since a driver's/employee's full month isn't finalized until it's over.
export function previousMonthStr(): string {
  const d = new Date();
  d.setDate(1); // avoid month-end overflow issues (e.g. March 31 - 1 month)
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// True if an order has sat PENDING for 2 or more days — used to flag aging
// consignments wherever their status is shown.
export function isAgingPending(status: string, dateStr: string): boolean {
  if (status !== "PENDING") return false;
  const orderDate = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  const today = new Date(`${todayStr()}T00:00:00Z`);
  const diffDays = (today.getTime() - orderDate.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays >= 2;
}

// Exact number of days an order has been sitting PENDING, or null if it's not aging
// yet (under 2 days, or not Pending). Used to color-grade the badge by severity
// instead of a flat red — 2-4 days reads amber, 5+ reads red.
export function agingDays(status: string, dateStr: string): number | null {
  if (!isAgingPending(status, dateStr)) return null;
  const orderDate = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  const today = new Date(`${todayStr()}T00:00:00Z`);
  return Math.floor((today.getTime() - orderDate.getTime()) / (1000 * 60 * 60 * 24));
}

/** Tailwind classes for the aging badge, graded by how many days old it is —
 * both tiers blink to draw the eye, red blinks faster since it's more urgent. */
export function agingBadgeClass(days: number): string {
  if (days >= 5) return "!rounded-full border border-cancelled/50 bg-cancelled-bg text-cancelled animate-[badge-blink_1.2s_ease-in-out_infinite]";
  return "!rounded-full border border-pending/50 bg-pending-bg text-pending";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Calendar parts of a date: a "YYYY-MM-DD" string is taken as that day; a timestamp as its Dubai day. */
function dayParts(value: string | Date): { y: number; m: number; d: number; wd: number } | null {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    return { y, m: m - 1, d, wd: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
  }
  if (typeof value === "string" && !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null; // already formatted text — leave as is
  const t = new Date(value);
  if (isNaN(t.getTime())) return null;
  const dubai = new Date(t.getTime() + 4 * 60 * 60 * 1000);
  return { y: dubai.getUTCFullYear(), m: dubai.getUTCMonth(), d: dubai.getUTCDate(), wd: dubai.getUTCDay() };
}

/** The app's one date format: "11 Oct 2026" (or "—" when empty). */
export function fmtDate(value?: string | Date | null): string {
  if (!value) return "—";
  const p = dayParts(value);
  if (!p) return String(value);
  return `${String(p.d).padStart(2, "0")} ${MONTHS[p.m]} ${p.y}`;
}

/** "Tue, 11 Oct 2026" — for page headings and report titles. */
export function fmtDateLong(value?: string | Date | null): string {
  if (!value) return "—";
  const p = dayParts(value);
  if (!p) return String(value);
  return `${DAYS[p.wd]}, ${fmtDate(value)}`;
}

/** "11 Oct 2026, 14:20" (Dubai time) for timestamps. */
export function fmtDateTime(value?: string | Date | null): string {
  if (!value) return "—";
  const t = new Date(value);
  if (isNaN(t.getTime())) return String(value);
  const time = t.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" });
  return `${fmtDate(t)}, ${time}`;
}

/** Kept for existing callers — same as fmtDate. */
export function fmtDayDate(value?: string | null): string {
  return fmtDate(value);
}
