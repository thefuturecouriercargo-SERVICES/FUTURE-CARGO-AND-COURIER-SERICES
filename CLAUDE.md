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
