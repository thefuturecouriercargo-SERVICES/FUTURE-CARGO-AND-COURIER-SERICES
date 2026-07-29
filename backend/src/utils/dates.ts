/**
 * All dates are stored/queried as UTC calendar dates (Prisma `@db.Date`).
 * Helpers here normalize "YYYY-MM-DD" and "YYYY-MM" query params into
 * UTC day/month boundaries so date filtering is consistent regardless of
 * server timezone.
 */

export function parseDateParam(value?: string): Date {
  if (!value) {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) throw new Error(`Invalid date: ${value}`);
  return new Date(Date.UTC(y, m - 1, d));
}

export function dayRange(dateStr?: string): { start: Date; end: Date; date: Date } {
  const date = parseDateParam(dateStr);
  const start = new Date(date);
  const end = new Date(date);
  return { start, end, date };
}

export function monthRange(monthStr?: string): { start: Date; end: Date; year: number; month: number } {
  let year: number;
  let month: number; // 1-12
  if (monthStr) {
    const [y, m] = monthStr.split("-").map(Number);
    year = y;
    month = m;
  } else {
    const now = new Date();
    year = now.getUTCFullYear();
    month = now.getUTCMonth() + 1;
  }
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0)); // last day of month
  return { start, end, year, month };
}

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
