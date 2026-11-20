/**
 * Notes shown in the full-screen "UPDATE REQUIRED" popup.
 * The popup opens automatically on every driver and admin page whenever a
 * new version is deployed (the build ID changes) — UPDATE THESE LINES WITH
 * EVERY EDIT so the popup describes what is new. Keep each line short, 2–4
 * items per list. Leave a list empty to show only "bugs cleared".
 */
export const RELEASE_NOTES = {
  driver: [
    "PAGES NOW OPEN WITH A SMOOTH CARD-STACK ANIMATION",
    "SCANNER OPENS WITH A CAMERA FOCUS ZOOM",
    "SCAN: GREEN FLASH + TICK WHEN ADDED, AMBER / RED GLOW WHEN ALREADY OR ERROR",
    "EVERY 10TH PARCEL SCANNED GETS A GOLD BURST",
  ],
  admin: [
    "SEARCH POPUP: NO MORE CUT OR OVERLAPPING TEXT ON PHONES",
    "SHARED CN PICTURE NOW USES THE APP FONT — NO OVERLAPPING TEXT",
    "ITEMS LISTED ONE PER LINE",
  ],
};
