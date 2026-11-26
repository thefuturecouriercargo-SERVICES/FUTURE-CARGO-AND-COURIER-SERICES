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
    "ONE BANK RECEIPT FOR SAME CUSTOMER'S ORDERS IS NO LONGER FLAGGED AS FAKE",
    "IT IS ONLY FLAGGED IF THE CNS DON'T ADD UP TO THE RECEIPT AMOUNT",
  ],
};
