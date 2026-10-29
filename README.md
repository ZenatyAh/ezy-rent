# ezy-rent: rent collection for Malaysian property managers

Next.js 16 (App Router), TypeScript, Supabase (Postgres, Auth, Storage), Prisma 7, shadcn/ui, Tailwind.
The brief is in `docs/SPEC.md`, the plan in `docs/PLAN.md`, running notes in `docs/notes.md`.

> **Status: work in progress (checkpoint 1).** This README is the short version; the final one is written
> at the end.

## Run it

Needs Docker, Node 22 or newer, and the Supabase CLI (used through `npx`).

```
npx supabase start            # starts the local stack from supabase/config.toml
npx supabase db reset         # rebuilds the database from supabase/migrations/
npm install                   # also runs `prisma generate`
cp .env.example .env.local    # local stack values; replace keys with `npx supabase status` if they differ
npm run seed                  # creates exactly the data from section 2 of the brief
npm run build && npm start    # http://localhost:3000
```

## Test accounts

All seeded accounts share one password: `Northwind#2026`.

| Account | Role | Organization |
|---|---|---|
| manager@northwind.test | manager | Northwind Properties |
| staff@northwind.test | staff | Northwind Properties |
| aisyah@northwind.test, ben@northwind.test, probe@northwind.test | tenant | Northwind Properties |
| manager@beta.test | manager | Beta Realty |
| chen@beta.test | tenant | Beta Realty |

Call the API with `Authorization: Bearer <token>`; `node --env-file=.env.local scripts/token.mjs <email>` prints one.

## Scripts

| Command | What it does |
|---|---|
| `npm test` / `npm run test:tz` | Unit tests; the second runs them under UTC, Asia/Kuala_Lumpur and America/New_York |
| `npm run test:int` | API integration tests; needs the app running and a seeded database. They leave audit rows behind (append-only), so run `npx supabase db reset && npm run seed` afterwards |
| `npm run probe` | Calls the Supabase Data API and Storage as every role and prints role x table x action matrices (output of the Phase 2 run: `docs/probe-phase2.txt`) |
| `npm run check:db` | 26 checks of the database constraints (overlap, composite foreign keys, CHECKs, append-only audit log) |
| `npm run check:secrets` | After `npm run build`: looks in everything the browser can download for the secret key and gateway key values and for server-only variable names |
| `npm run smoke:ui` | Fetches the pages with real session cookies (redirects, role access, Malaysia-time text); needs the app running |
| `npm run race:webhook` | Fires 10 identical webhook deliveries at once and reports the outcome (the experiment behind DECISIONS Q1) |
| `npm run db:sync` | `supabase db reset`, then `prisma db pull` and `prisma generate`. `prisma/schema.prisma` is generated from the migrations, never edited by hand |

## What works so far

- `src/lib/billing.ts`: `generateSchedule`, `invoiceStatus`, `parseRinggitToSen`, pure and timezone independent (120 tests, green under all three timezones).
- Database (all in `supabase/migrations/`): tables with composite foreign keys, database-level lease overlap prevention, RLS and grants (anon gets nothing; the Data API allows only the reads in the brief plus a tenant updating their own phone), append-only `audit_log`, private `payment-slips` bucket with org-scoped policies.
- `POST /api/leases` and `GET /api/leases/:leaseId` with 401/403/404 handling, Bearer token or session cookie.
- Payments: record (cash / bank transfer with an uploaded slip), the cap, approve / reject / void, allocation, `audit_log` rows, and `GET /api/reports/collections` (months in Malaysia time). Every money operation is one transaction that locks the lease row first. If recording fails after a slip was uploaded, the file is removed again.
- Online payments: `POST /api/leases/:leaseId/gateway-bills` (Pay now), `POST /api/webhooks/gateway` (HMAC-SHA256 over all fields, constant-time compare; one payment per bill, ever: row lock plus a UNIQUE constraint), the read-only `/payments/return` page, and `gateway-sim.mjs` (`node gateway-sim.mjs <bill_id> <amount_sen> [true|false]`, with `GATEWAY_X_SIGNATURE_KEY` set).
- UI (shadcn/ui + Tailwind): `/login`; staff and managers: `/dashboard` (overdue invoices, collections for the last 6 months), `/leases`, `/leases/[leaseId]` (invoices, payments with a signed-URL slip link, record payment with ringgit input / Malaysia-time input / slip upload, approve / reject / void behind a confirm dialog with a reason); tenants: `/portal` (reads and the phone update go straight from the browser through supabase-js under RLS; amount due now; Pay now shows the bill id and amount). Every action toasts success and error; pages show skeletons while loading. All dates and times go through `src/lib/time.ts` (Malaysia time, plain UTC+8 arithmetic), so the server and the browser render identical text whatever the viewer's timezone.
- Seed: both organizations, the 7 accounts, tenants, units, the 4 leases with their invoices, and Aisyah's two payments (cash by the manager; bank transfer by staff with a slip, approved by the manager), all created through the same services the API uses.

## Skipped so far (not done yet)

- A create-lease form (leases are created with `POST /api/leases`), search and pagination on the leases list, realtime updates, charts. The dashboard shows the collections as a table.

## AI use

A separate AI chat assistant was also used for planning and review; its transcript is not included.

## Known issues and notes

- There is no limit on lease length: a lease of thousands of years would insert one invoice per month in a single transaction (30 s timeout).
- `.env.example` contains Supabase's local-stack default keys (identical on every local stack, not real secrets). The secret key is only used server-side.
- `service_role` keeps its table privileges; `audit_log` stays append-only for it, and for the table owner, through triggers.
- A tenant reading `memberships` or `audit_log` through the Data API gets zero rows rather than an error.
- The page `/leases/[leaseId]` shows the not-found page for another organization's lease (no lease data), but with HTTP status 200: `loading.tsx` makes Next send the page shell first, after which the status can no longer change. The API answers a real 404.
- The interactive parts of the UI (dialogs, toasts, the file upload) are covered by type checking, the API and data-layer tests and the server-rendered page checks, but there is no scripted browser run; click through them once with `npm start`.
- Prisma models keep the table and column names (`leases`, `org_id`), so server code reads snake_case; the API maps to camelCase in `src/lib/serializers.ts`.
