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
  return fmtDateInput(new Date());
}

export function currentMonthStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
