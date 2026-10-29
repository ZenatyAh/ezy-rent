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
| `npm run db:sync` | `supabase db reset`, then `prisma db pull` and `prisma generate`. `prisma/schema.prisma` is generated from the migrations, never edited by hand |

## What works so far

- `src/lib/billing.ts`: `generateSchedule`, `invoiceStatus`, `parseRinggitToSen`, pure and timezone independent (120 tests, green under all three timezones).
- Database (all in `supabase/migrations/`): tables with composite foreign keys, database-level lease overlap prevention, RLS and grants (anon gets nothing; the Data API allows only the reads in the brief plus a tenant updating their own phone), append-only `audit_log`, private `payment-slips` bucket with org-scoped policies.
- `POST /api/leases` and `GET /api/leases/:leaseId` with 401/403/404 handling, Bearer token or session cookie.
- Payments: record (cash / bank transfer with an uploaded slip), the cap, approve / reject / void, allocation, `audit_log` rows, and `GET /api/reports/collections` (months in Malaysia time). Every money operation is one transaction that locks the lease row first. If recording fails after a slip was uploaded, the file is removed again.
- Seed: both organizations, the 7 accounts, tenants, units, the 4 leases with their invoices, and Aisyah's two payments (cash by the manager; bank transfer by staff with a slip, approved by the manager), all created through the same services the API uses.

## Skipped so far (not done yet)

- Online payments: gateway bills, `POST /api/webhooks/gateway`, `/payments/return`, `gateway-sim.mjs`.
- All UI.
- `REVIEW.md` and `DECISIONS.md`.

## Known issues and notes

- There is no limit on lease length: a lease of thousands of years would insert one invoice per month in a single transaction (30 s timeout).
- `.env.example` contains Supabase's local-stack default keys (identical on every local stack, not real secrets). The secret key is only used server-side.
- `service_role` keeps its table privileges; `audit_log` stays append-only for it, and for the table owner, through triggers.
- A tenant reading `memberships` or `audit_log` through the Data API gets zero rows rather than an error.
- Prisma models keep the table and column names (`leases`, `org_id`), so server code reads snake_case; the API maps to camelCase in `src/lib/serializers.ts`.
