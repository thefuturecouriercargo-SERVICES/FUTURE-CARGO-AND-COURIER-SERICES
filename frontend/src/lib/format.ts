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

/** dd/mm/yyyy for a timestamp, or "—" when empty. */
export function fmtDayDate(value?: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}
