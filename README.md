# Future Courier — Delivery Management System

A production-ready, full-stack delivery management system for **The Future Courier Service L.L.C.**, built as
specified: Next.js (React + TypeScript) frontend, Node.js + Express REST API, PostgreSQL + Prisma ORM, JWT
authentication, Socket.IO realtime updates, Tailwind CSS, Docker, and no client-side mock data — everything is
read from and written to Postgres.

It replaces the earlier static HTML prototype with a real client/server application: an **Admin Panel** for
daily/monthly operations, vendor and employee management, reports and audit logging, and a **Driver Portal**
for status updates, transfers, and day-end cash closing.

> **Important — read before you run anything:** this project was written and validated in a sandboxed
> environment with no access to the npm registry, so `npm install` could not actually be executed here (see
> **"How this was validated"** below for exactly what *was* tested). The code is complete and ready to run —
> just budget a few minutes for `npm install` to pull real packages, and skim the troubleshooting section if
> anything doesn't line up in your environment.

---

## 1. Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router) · React 18 · TypeScript · Tailwind CSS · Chart.js |
| Backend | Node.js · Express · TypeScript |
| Database | PostgreSQL 16 · Prisma ORM |
| Auth | JWT in an httpOnly cookie (no `localStorage`) |
| Realtime | Socket.IO (order/cash-closing events pushed to open dashboards & driver portals) |
| Reports | ExcelJS (.xlsx) · PDFKit (.pdf) |
| Deployment | Docker + docker-compose, VPS-ready |

---

## 2. Project structure

```
project/
├── docker-compose.yml        # Postgres + backend + frontend, one command
├── .env.example               # Root env for docker-compose
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma      # Full data model (see §5)
│   │   ├── seed.ts            # Seeds vendors, admin, drivers, and real July 2026 order history
│   │   └── seed-data/         # vendor_rates.json + orders.json (cleaned from your uploaded workbook)
│   ├── src/
│   │   ├── server.ts          # Entry point (HTTP + Socket.IO)
│   │   ├── app.ts             # Express app (middleware, routes)
│   │   ├── config/env.ts
│   │   ├── lib/                # prisma client, socket.io setup
│   │   ├── middleware/         # auth, error handling
│   │   ├── routes/             # auth, vendors, employees, orders, driver, cash-closings,
│   │   │                       # dashboard, reports, audit-logs, settings
│   │   ├── services/audit.service.ts
│   │   └── utils/              # jwt, password hashing, date helpers
│   ├── Dockerfile
│   └── package.json
└── frontend/
    ├── src/
    │   ├── app/
    │   │   ├── login/
    │   │   ├── (admin)/         # dashboard, dashboard/monthly, orders, employees, vendors,
    │   │   │                    # reports, audit-log, settings — all guarded for SUPER_ADMIN
    │   │   └── driver/          # driver portal — guarded for DRIVER role
    │   ├── components/          # AdminShell, AuthGate, KpiCard, StatusStamp, charts/
    │   ├── context/AuthContext.tsx
    │   └── lib/                 # api.ts (fetch wrapper), socket.ts, format.ts
    ├── Dockerfile
    └── package.json
```

---

## 3. Quick start with Docker (recommended)

```bash
cp .env.example .env        # edit passwords / JWT secret
docker compose up --build
```

This starts Postgres, runs `prisma migrate deploy` automatically when the backend container boots, and serves:

- Frontend: http://localhost:3000
- Backend API: http://localhost:4000/api/health

The database starts **empty**. Seed it once the stack is up:

```bash
docker compose exec backend npm run seed
```

That creates the vendor master (16 vendors with their delivery charges), a Super Admin account, six driver
accounts, and loads the real July 2026 consignment history from your uploaded workbook (4,181 orders) so the
dashboards aren't empty on first login.

**Default logins after seeding** (change these immediately in production):

| Role | Username | Password |
|---|---|---|
| Super Admin | `admin` | `Admin@12345` |
| Driver (e.g.) | `anas`, `niyas`, `noushad`, `faris`, `masood`, `savad` | `Driver@12345` |

---

## 4. Local development without Docker

Requires Node.js 20+ and a local PostgreSQL 16 instance.

```bash
# 1. Database
createdb future_courier   # or use any Postgres instance you have

# 2. Backend
cd backend
cp .env.example .env       # set DATABASE_URL to your local Postgres
npm install
npx prisma migrate dev --name init
npm run seed
npm run dev                 # http://localhost:4000

# 3. Frontend (new terminal)
cd frontend
cp .env.local.example .env.local
npm install
npm run dev                 # http://localhost:3000
```

---

## 5. Data model (`backend/prisma/schema.prisma`)

- **User** — `role` is either `SUPER_ADMIN` or `DRIVER`. Drivers *are* the "Employee Management" records; there's
  one table, filtered by role, so performance stats join naturally.
- **Vendor** — name + fixed `deliveryCharge`. Selecting a vendor on an order snapshots its current charge onto
  the order (so historical orders don't change if you later edit a vendor's rate).
- **Order** — one row per consignment: `date`, per-day `slNo` (auto), `cnNo`, vendor, delivery charge, total,
  payment mode, emirate, assigned employee, status (`PENDING` / `DELIVERED` / `TRANSFER` / `CANCELLED`).
  Unique on `(date, slNo)`.
- **OrderTransfer** — history row written every time an order is transferred between drivers (who, from whom,
  when, why).
- **CashClosing** — one row per driver per day. Delivered/cash/online totals are always **recomputed server-side
  from real order rows**, never trusted from the client; drivers only submit `expenses` + remarks.
- **AuditLog** — every create/update/delete/status-change/transfer/cash-closing/login is recorded with the
  acting user, entity, and a JSON diff.
- **CompanySettings** — singleton row for company profile (name/address/phone/email/logo).

---

## 6. REST API summary (all under `/api`, JSON)

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` |
| Vendors | `GET/POST /vendors`, `PUT/DELETE /vendors/:id` |
| Employees | `GET/POST /employees`, `PUT/DELETE /employees/:id`, `GET /employees/:id/performance` |
| Orders | `GET/POST /orders`, `GET/PUT/DELETE /orders/:id`, `PATCH /orders/:id/status`, `POST /orders/:id/transfer` |
| Driver portal | `GET /driver/orders`, `GET /driver/summary` |
| Cash closing | `POST /cash-closings`, `GET /cash-closings`, `GET /cash-closings/preview`, `PATCH /cash-closings/:id/review` |
| Dashboards | `GET /dashboard/daily?date=`, `GET /dashboard/monthly?month=` |
| Reports | `GET /reports/export?format=excel|pdf&...filters` |
| Audit log | `GET /audit-logs` |
| Settings | `GET/PUT /settings/company` |

Every list/report endpoint accepts filters: `date`, `month`, `from`/`to`, `employeeId`, `vendorId`, `status`,
`payment`, `emirate`. Role checks are enforced server-side (`SUPER_ADMIN` vs `DRIVER`) — the frontend routing
guard is UX only, not the security boundary.

Realtime: the backend emits `order:changed`, `order:assigned`, `order:removed`, `vendor:changed`,
`employee:changed`, `cashClosing:submitted`, `cashClosing:reviewed` over Socket.IO; both the admin dashboards and
the driver portal subscribe and refetch automatically — no polling, no manual refresh.

---

## 7. Feature checklist vs. the spec

Fully implemented: JWT auth (httpOnly cookie, no localStorage), role-based Admin/Driver access, vendor master
with auto delivery-charge lookup, daily entry with auto SL numbering, calendar/prev/next/today date navigation,
transfer workflow (removes from old driver, assigns new driver, logs history, updates dashboards live), day-end
cash closing with server-computed totals and balance formula, admin daily + monthly dashboards with charts
(status, employee sales, daily deliveries) and employee/vendor/emirate/payment breakdowns, Excel + PDF report
export with filters, employee & vendor CRUD, audit log, company settings, Docker deployment, real seed data from
your workbook.

Simplified / left as a clear extension point rather than a full UI, so nothing here was left half-wired:

- **Dark mode** — a working toggle exists on the Settings page (Tailwind `class` strategy); it isn't yet themed
  across every single table/chart.
- **Backup & Restore** — the Settings page documents the standard `pg_dump`/`pg_restore` commands (§9) rather
  than shipping an in-app backup button; for a system of this size, standard Postgres backup tooling is the more
  reliable approach.
- **User Roles** — the spec's two roles (Super Admin, Driver) are fully implemented; a UI for defining *additional*
  custom roles was not built since only two were specified.

---

## 8. How this was validated

The sandbox this project was built in has **no access to the npm/pip registries**, so `npm install` itself
could not be run here — meaning the backend/frontend could not be started or hit with real HTTP requests inside
this session. To still validate the design with real data rather than shipping untested code, the following was
actually executed against a live PostgreSQL 16 instance:

1. The Prisma schema was hand-translated to SQL DDL and run against a real database — all tables, enums,
   foreign keys, and unique constraints were created without error.
2. Your uploaded workbook (`JULY 2026 NEW.xlsx`) was parsed in full: 27 daily sheets, 4,181 valid consignment
   rows extracted and cleaned (60 blank placeholder rows skipped), and loaded into that database exactly as
   `seed.ts` loads them.
3. The aggregate queries that power the dashboards (status breakdown, employee/vendor/emirate performance,
   unique `(date, slNo)` constraint) were run directly against that data and returned consistent, sane numbers
   — e.g. 3,029 delivered / 786 pending / 366 cancelled across the month, AED 424,927 in Dubai deliveries.

What this means practically: the **data model and seed data are verified against real Postgres**. The
**Express route handlers and React components were written carefully and reviewed by hand**, but not
exercised by an actual running server in this session. Run `npm install && npm run dev` in both `backend/`
and `frontend/` first, and smoke-test login → daily entry → driver status update → cash closing before
relying on this in production.

---

## 9. Backup & restore (Postgres)

```bash
# Backup
docker compose exec postgres pg_dump -U future_courier future_courier > backup-$(date +%F).sql

# Restore
cat backup-2026-07-29.sql | docker compose exec -T postgres psql -U future_courier future_courier
```

Schedule the backup command with cron/a scheduled task for nightly backups on your VPS.

---

## 10. Deploying to a VPS

1. Copy the `project/` folder to your server (or `git clone` your repo there).
2. `cp .env.example .env` and set real values — a strong `JWT_SECRET`, real Postgres password, and
   `NEXT_PUBLIC_API_URL`/`CLIENT_ORIGIN` pointing at your public domain (e.g. `https://api.yourdomain.com`,
   `https://ops.yourdomain.com`).
3. `docker compose up -d --build`, then `docker compose exec backend npm run seed` once.
4. Put a reverse proxy (Caddy, Nginx, or Traefik) in front of ports 3000/4000 for TLS + your domain names.
5. Point your domain's DNS at the server and you're live.

---

## 11. Environment variables reference

See `backend/.env.example`, `frontend/.env.local.example`, and root `.env.example` for the full list with
defaults. The two that must be changed before production use are `JWT_SECRET` and every `SEED_*_PASSWORD`.
