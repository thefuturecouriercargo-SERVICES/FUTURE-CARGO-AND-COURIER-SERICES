import { parseDateParam } from "../utils/dates";

/** Bank checking starts fresh from this day — everything up to 22 Nov 2026 is cleared (owner, 24 Nov 2026). */
export const BANK_CHECK_FROM = "2026-11-23";
/** For Order.date (stored as a UTC calendar date). */
export const BANK_CHECK_FROM_DATE = parseDateParam(BANK_CHECK_FROM);
/** For timestamps (createdAt, resolvedAt) — 12 midnight Dubai time. */
export const BANK_CHECK_FROM_TIME = new Date(`${BANK_CHECK_FROM}T00:00:00+04:00`);
