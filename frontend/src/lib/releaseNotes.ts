/**
 * Notes shown in the full-screen "UPDATE REQUIRED" popup.
 * The popup opens automatically on every driver and admin page whenever a
 * new version is deployed (the build ID changes) — UPDATE THESE LINES WITH
 * EVERY EDIT so the popup describes what is new. Keep each line short, 2–4
 * items per list. Leave a list empty to show only "bugs cleared".
 */
export const RELEASE_NOTES = {
  driver: [],
  admin: [
    "BANK RECEIPTS WITH NO PRINTED DATE NOW TAKE THE DATE FROM THE BANK REFERENCE",
    "NO MORE WRONG \"DAYS BEFORE DELIVERY\" FAKE ALERTS FROM A GUESSED DATE",
  ],
};
