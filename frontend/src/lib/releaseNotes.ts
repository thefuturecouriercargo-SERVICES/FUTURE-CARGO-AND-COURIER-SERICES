/**
 * Notes shown in the full-screen "UPDATE REQUIRED" popup.
 * The popup opens automatically on every driver and admin page whenever a
 * new version is deployed (the build ID changes) — UPDATE THESE LINES WITH
 * EVERY EDIT so the popup describes what is new. Keep each line short, 2–4
 * items per list. Leave a list empty to show only "bugs cleared".
 */
export const RELEASE_NOTES = {
  driver: [
    "BANK PAYMENT NOW NEEDS THE CUSTOMER'S RECEIPT",
    "TAP ADD BANK RECEIPT AND PICK A PHOTO OR PDF",
  ],
  admin: [
    "NEW BANK RECEIPTS PAGE (FINANCE)",
    "UPLOAD THE BANK STATEMENT — RECEIPTS ARE CHECKED AUTOMATICALLY",
    "SHOWS RECEIVED, NOT RECEIVED YET AND BANK CNS WITH NO RECEIPT",
  ],
};
