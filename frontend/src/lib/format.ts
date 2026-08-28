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

// True if an order has sat PENDING for more than 2 days — used to flag aging
// consignments wherever their status is shown.
export function isAgingPending(status: string, dateStr: string): boolean {
  if (status !== "PENDING") return false;
  const orderDate = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  const today = new Date(`${todayStr()}T00:00:00Z`);
  const diffDays = (today.getTime() - orderDate.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays > 2;
}
