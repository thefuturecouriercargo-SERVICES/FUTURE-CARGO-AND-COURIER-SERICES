/**
 * Notes shown in the full-screen "UPDATE REQUIRED" popup.
 * The popup opens automatically on every driver and admin page whenever a
 * new version is deployed (the build ID changes) — UPDATE THESE LINES WITH
 * EVERY EDIT so the popup describes what is new. Keep each line short, 2–4
 * items per list. Leave a list empty to show only "bugs cleared".
 */
export const RELEASE_NOTES = {
  driver: [
    "PULL-DOWN REFRESH REMOVED — SCROLLING NEVER RELOADS THE PAGE",
    "TO REFRESH: TAP THE GLOWING GOLD-CIRCLED R IN FUTURE COURIER AT THE TOP",
  ],
  admin: [
    "LONG EXPLANATION TEXTS REMOVED FROM ALL ADMIN PAGES",
    "PULL-DOWN REFRESH REMOVED — TAP THE GOLD-CIRCLED R IN FUTURE COURIER TO REFRESH",
  ],
};
