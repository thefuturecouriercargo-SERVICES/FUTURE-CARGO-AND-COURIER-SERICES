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
    "RECEIPT READER KNOWS ADCB, MASHREQ, ENBD, EMIRATES ISLAMIC, ADIB, WIO, AL MARYAH, ZAND",
    "'INITIATED' / 'SUBMITTED' RECEIPTS NO LONGER MARKED FAKE",
    "MASKED ADCB NAMES (L*** C***) MATCHED TO THE STATEMENT BY INITIALS",
    "RECEIPTS FOUND ON THE BANK STATEMENT NO LONGER SHOW AS FAKE",
  ],
};
