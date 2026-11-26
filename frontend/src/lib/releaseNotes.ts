/**
 * Notes shown in the full-screen "UPDATE REQUIRED" popup.
 * The popup opens automatically on every driver and admin page whenever a
 * new version is deployed (the build ID changes) — UPDATE THESE LINES WITH
 * EVERY EDIT so the popup describes what is new. Keep each line short, 2–4
 * items per list. Leave a list empty to show only "bugs cleared".
 */
export const RELEASE_NOTES = {
  driver: ["SCANNING A WRONG BARCODE NOW SAYS \"NOT A CN\" INSTEAD OF AN ERROR"],
  admin: [
    "SCAN AND SEARCH NO LONGER FAIL ON LONG NUMBERS (PHONES, PRODUCT BARCODES)",
    "INSPIRED / ESCALO WEBSITE SYNC RETRIES ONCE WHEN THE SITE IS SLOW",
  ],
};
