# Future Courier — working rules

## Update popup after every edit
Every deploy automatically shows a full-screen "UPDATE REQUIRED" popup on all
driver and admin pages (frontend/src/components/UpdatePopup.tsx — it compares
the page's build ID with /app-version).

With EVERY change you make, also update `frontend/src/lib/releaseNotes.ts`:
- `driver`: 2–4 short CAPITAL-letter lines on what's new for drivers
- `admin`: 2–4 short CAPITAL-letter lines on what's new for admin/manager
Replace the previous lines (don't pile them up). Use an empty list if nothing
changed for that portal — the popup still says bugs are cleared.

## NEVER change the emirate / area the vendor or client gave (owner's rule, 19 Nov 2026)
- Saving, importing, startup fixers, labels, forms: the given emirate stays as it is.
- If the address seems to be in another emirate, only show a CHECK warning
  (`emirateWarning` in areas.ts) — on the label notes and the entry form.
- Only a blank / OTHER emirate may be filled in from the address.

## Area / emirate fixes — never repeat a mistake
`backend/src/checks/areaChecks.ts` lists every wrong-area address ever reported.
It runs inside `npm run build`; if any case is wrong the deploy stops.
- Every new wrong-area report: FIRST add the address as a case there, then fix.
- Run `cd backend && npm run check:areas` before pushing any change to areas.
- `backend/src/lib/areas.ts` and `frontend/src/lib/areas.ts` must stay identical
  (except the first comment line) — change both.
- Prefer fixing the rule that caused the mistake (so similar addresses are fixed
  too) over adding one more special case.
