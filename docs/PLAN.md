# PLAN: Rent Collection (ezy-rent)

> On approval, step 0 is to copy this file verbatim to `docs/PLAN.md` (plan mode only lets me write here).
> Timer at planning: **3h 35m**. Clock for the boxes below starts at approval.
> Spec wins over CLAUDE.md. Every phase ends with: what changed and why, files list, verification output, **STOP for your check**.

## Review outcome: APPROVED with these decisions (supersede anything below that disagrees)

| # | Decision |
|---|---|
| Q1 | Seed password for all 7 accounts: `Northwind#2026` (constant in `scripts/seed.ts`; contains `#`, so never put it unquoted in a dotenv file) |
| Q2 | **Remove** `cacheComponents` and `partialPrefetching` from `next.config.ts` (Phase 0). Keep the Tailwind turbopack loader |
| Q3 | Rename `master` → `main`. You create the public GitHub repo and give me the URL. **Never push without your say-so** |
| Q4 | Webhook: (a) trust `paid`, ignore `transaction_status`; (b) wrong `paid_amount` ⇒ 422 even if bill already paid; (c) bad/missing `paid_at` or non-numeric `paid_amount` (valid signature) ⇒ 400 |
| Q5 | Void: leave other payments and unapplied credit untouched; leave the voided payment's own `unapplied_sen` untouched; explain in DECISIONS Q5 |
| Q6 | Manager-recorded payment also writes `audit_log` `payment.approved` with `details.auto = true` |
| Q7 | **CHANGED: do NOT revoke table privileges from `service_role`.** Tests use publishable key + user token; the secret key never leaves the server. `audit_log` stays append-only for every role (service_role and owner included) **via triggers only** |
| Q8 | `/payments/return` requires login + ownership (tenant of the lease, or staff/manager of its org); otherwise "not found" |
| Q9 | Prisma pinned to 7.10.1 (CLI, client, adapter). **Confirm the installed API before writing `prisma.ts`** |
| Q10 | All listed defaults accepted |

**Corrections to this plan** (also logged in `docs/notes.md` for DECISIONS Q6):
- **A. D6 / Phase 2 migration 3.** RLS policies call `private.*` helpers, so `authenticated` needs `USAGE` on schema `private` and `EXECUTE` on those functions, otherwise every RLS query fails with permission denied. They stay unreachable via `/rest/v1/rpc` because `private` is not in `api.schemas`. Revoke `EXECUTE` from `PUBLIC` and `anon` only (not from `authenticated`). Phase 2 adds a probe test proving rpc calls to the `private.*` helpers fail.
- **B. Appendix A.** The `L###` numbers are line numbers in `SPEC.md`. REVIEW.md must use line numbers within each snippet file (`late-fees/route.ts`, `webhooks/gateway/route.ts`, `dashboard/actions.ts`), counted from 1 per file. Fixed in Phase 7.

---

## Phase 0 progress so far (executed after your approval message, before plan mode was re-asserted)

Done: `docs/PLAN.md` (copy of this file) + `docs/notes.md` (both corrections logged); branch `master` → `main`; `cacheComponents`/`partialPrefetching` removed from `next.config.ts`; `.gitignore` now tracks `.env.example`; `.env.example` + `.env.local` written (local stack keys); `supabase init` + `[api] schemas = ["public"]`; `supabase start` (healthy: auth, rest, postgres 17.11, storage; `btree_gist` available); installed `@supabase/supabase-js`, `@supabase/ssr`, `zod`, `server-only`, `@prisma/client@7.10.1`, `@prisma/adapter-pg@7.10.1`; `vitest.config.ts` written.
Also done: `npm install -D prisma@7.10.1 --foreground-scripts` finished with **exit 0 in about 3 minutes (11:00:07), no hang**; its `preinstall` and `@prisma/engines` `postinstall` ran in the foreground. Registry fetches were slow (7–84 s each), and the CLI pulls a large tree (`@visx/*`, `lodash`, `@electric-sql/pglite`, `@prisma/studio-core`, `fast-check`). npm's `allowScripts` warning still lists `prisma` and `@prisma/engines` as "not yet covered", so I must confirm the engine binaries really exist (`npx prisma -v`) before relying on them.
Not yet done: `npm i -D vitest tsx @types/node@^24` (the first attempt failed with ERESOLVE because vitest 5 needs `@types/node` ^22 or >=24 and the scaffold has ^20), `shadcn init`, `package.json` scripts, `npx prisma -v` + Prisma 7.10.1 API check, `docs/PLAN.md` re-copy (it predates the Appendix A edit and this block), verification, first commit, **stop for your check**.
Nothing is committed yet.

---

## 0. Reality check (what I found, differs from the brief you pasted)

| Finding | Consequence |
|---|---|
| Next.js 16.4.3 / React 19.3 / Tailwind 4 already scaffolded (not empty). Git already has "Initial commit from Create Next App"; `CLAUDE.md` + `docs/` untracked. Branch is `master`, main branch is `main`. | Phase 0 does not scaffold. Branch name: Open Q3. |
| **`supabase/` does not exist and no Supabase containers are running** (only an exited `youthful_bell`). Images are already pulled (postgres 17.11, gotrue, storage, postgrest, kong, studio...). | Phase 0 runs `supabase init` + `supabase start` (fast, no pulls). Not "already running". |
| `next.config.ts` has `cacheComponents: true` + `partialPrefetching: true` (docs read). With Cache Components, any page reading `cookies()` outside `<Suspense>` is a **build error**, and request-time `Date`/random in server components needs care. | Open Q2: I recommend removing both flags. |
| `.gitignore` has `.env*`, which also hides **`.env.example`** (required deliverable). | Add `!.env.example`. |
| `prisma` CLI `latest` tag = **8.0.0-rc.28**, but `@prisma/client` `latest` = **7.10.1**. A plain `npm i -D prisma` pulls an RC that does not match the client. Plausible cause of the hang. | Pin all three to **7.10.1**, install with `--foreground-scripts`. |
| `TZ=...` is **silently dropped by Git Bash** (verified: `process.env.TZ` was `undefined`). PowerShell and a Node child process honour it (verified: KL gives offset -480, NY gives 300). This machine is UTC+2, so neither test zone is the local one. | TZ tests run through `scripts/test-tz.mjs` (spawns vitest with `env.TZ` set), never inline `TZ=` in bash. |
| Next 16 conventions (read in `node_modules/next/dist/docs`): `proxy.ts` replaces `middleware.ts`; `params` is a `Promise`; `cookies()` is async; `RouteContext<'/path'>` helper exists. Proxy is not an authorization layer. | Auth is checked in every handler. `proxy.ts` only refreshes the cookie session and does optimistic redirects. |
| Your second paste was cut off mid-sentence ("...append-only audit_log even for"). | I used the full list from the first paste. |

---

## 1. Requirements checklist

Legend: ⛔ = **INSTANT FAIL**. "Phase" = where it gets built/verified. Weights from "How We Assess" (total 100).

### ⛔ The 4 instant-fail rules (checked in every phase, re-verified in Phase 7)
| ID | Rule | Guard |
|---|---|---|
| ⛔ IF1 | Service-role/secret key never reaches the browser | Only `SUPABASE_SECRET_KEY` (no `NEXT_PUBLIC_`), used only in `import 'server-only'` modules. After build: `grep -r "sb_secret\|SUPABASE_SECRET_KEY" .next/static` must be empty. |
| ⛔ IF2 | No table anon can read or write through the Data API | All grants revoked from `anon`; no anon policies; probe test over every table/function. |
| ⛔ IF3 | No floating-point money | `bigint` sen in DB; BigInt in TS domain code; billing proration in BigInt. |
| ⛔ IF4 | A bill/invoice is never settled by the return page | `/payments/return` is read-only; only the webhook route mutates `gateway_bills`/`payments`. |

### S: Setup, seed, deliverables (gates everything)
| ID | Rule | Phase |
|---|---|---|
| S1 | Fresh clone works with exactly: `npx supabase start`, `npx supabase db reset`, `npm install`, `cp .env.example .env.local`, `npm run seed`, `npm run build && npm start` | 0, 3, CP1, 7 |
| S2 | Commit `supabase/config.toml`, `supabase/migrations/`, `.env.example` (every var, local values, comment on where each comes from). Never commit real `.env*` | 0 |
| S3 | Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `DATABASE_URL`, `DIRECT_URL`, `GATEWAY_X_SIGNATURE_KEY` | 0 |
| S4 | `npm run seed` on a freshly reset DB creates exactly the seed data, **through our lease/payment code paths** | 2→4 |
| S5 | Orgs `Northwind Properties`, `Beta Realty`. Accounts (one shared password): `manager@northwind.test` (manager), `staff@northwind.test` (staff), `aisyah@northwind.test` (tenant Aisyah Rahman), `ben@northwind.test` (Ben Lim), `probe@northwind.test` (Probe Tenant), `manager@beta.test` (manager), `chen@beta.test` (tenant Chen Wei) | 2 |
| S6 | Units/leases: A-12-3 Aisyah 2026-01-31→2026-07-15 RM1,500.00 dep RM3,000.00; B-05-1 Ben 2026-01-01→2026-04-15 RM1,000.29 no deposit; C-01-7 Probe 2026-02-28→2027-02-27 RM2,000.00 dep RM4,000.00; D-03-2 no lease; Beta KL-1 Chen 2026-03-15→2027-03-14 RM2,200.00 dep RM4,400.00 | 3 |
| S7 | Aisyah payments: cash 300000 sen received 2026-01-31 10:00 MYT by manager; bank_transfer 200000 sen received 2026-03-01 00:30 MYT by staff **with slip file**, then approved by manager | 4 |
| S8 | `gateway-sim.mjs` saved at repo root, verbatim from brief | 5 |
| S9 | Deliverables at root: `README.md` (run, known issues, next steps, **what was skipped**), `REVIEW.md`, `DECISIONS.md`, `ai-logs/` (`/export` of every AI session), `prisma/schema.prisma`, seed script, `.env.example` | CP1, 7 |

### B: Billing, `src/lib/billing.ts` (15 pts; hidden ~50 cases under TZ=UTC, Asia/Kuala_Lumpur, America/New_York)
Exports (contract): `InvoiceKind`, `ScheduledInvoice`, `generateSchedule`, `InvoiceStatus`, `invoiceStatus`, `parseRinggitToSen`. Pure: no I/O, no Next/React/Supabase/Prisma imports.
| ID | Rule | Phase |
|---|---|---|
| B1 | `generateSchedule` throws on: non-real calendar date or not `YYYY-MM-DD` (2026-02-30, 2026-2-3, 2026-13-01), `endDate < startDate`, `monthlyRentSen` not positive integer, `depositSen` not non-negative integer | 1 |
| B2 | `depositSen > 0` ⇒ first invoice `kind:'deposit'`, due `startDate`, `periodIndex/periodStart/periodEnd = null`. `depositSen = 0` ⇒ none | 1 |
| B3 | Anchor k = start + k calendar months **from the start date** (never from the previous anchor); clamp to month's last day (Jan 31 → Feb 28/29 → Mar 31 → Apr 30) | 1 |
| B4 | Period k = anchor k … day before anchor k+1 (`periodEnd` inclusive), due on anchor k; one period per anchor on or before `endDate` | 1 |
| B5 | Last period cut at `endDate`; if shorter than full: `round_half_up(monthlyRentSen × daysUsed / daysInFullPeriod)`; all others cost `monthlyRentSen`. If `endDate` = last day of a full period ⇒ full price (Probe, Chen) | 1 |
| B6 | Order: deposit, then rent by `periodIndex`. Aisyah example = 7 rows, last = 77419; Ben's last = 50015 (50014.5 rounds up) | 1 |
| B7 | `invoiceStatus(inv, now)` in order: `paid` if paidSen ≥ amountSen → `overdue` if Malaysia date of `now` > `dueDate` → `partially_paid` if paidSen > 0 → `unpaid`. Due 2026-03-01 turns overdue at `2026-03-01T16:00:00Z`, not 1 ms earlier | 1 |
| B8 | `parseRinggitToSen`: digits, optional comma thousands (groups of exactly 3), optional 1–2 digit decimals, trims whitespace. `"1,500.50"→150050`, `"1.15"→115`, `"7"→700`. Throws on `""`, `"-5"`, `"1.234"`, `"1e3"`, `"RM 10"`, `"1,23"` (also `"1."`, `".5"`, unsafe-integer overflow) | 1 |
| B9 | No dependence on machine TZ (UTC-only math; never `new Date('YYYY-MM-DD')` + local getters); suite green under all 3 TZs; used by the app (server and browser) | 1 |

### P: Payments (15 pts)
| ID | Rule | Phase |
|---|---|---|
| P1 | Staff/manager record `cash` or `bank_transfer` with `amountSen`, `method`, `receivedAt` (ISO 8601 with offset). Bank transfer **requires** slip (JPEG/PNG/PDF ≤ 5 MB) in Storage; **if recording fails after upload, the file is not left behind** | 4 |
| P2 | Manager-recorded ⇒ `approved` immediately (and allocated). Staff-recorded ⇒ `pending_verification` | 4 |
| P3 | Cap: new amount ≤ (Σ invoices − Σ allocations) − Σ `pending_verification` payments of that lease; future periods allowed within cap; else **422** | 4 |
| P4 | Approve (manager): only `pending_verification` (else **409**); re-check amount ≤ remaining balance, else **422** and stays pending | 4 |
| P5 | Reject (manager): only pending (else **409**); `reason` ≥ 5 chars (else **400**) | 4 |
| P6 | Void (manager): only `approved` (else **409**); `reason` ≥ 5 chars (**400**); deletes **that payment's** allocations only | 4 |
| P7 | Payments never deleted. `audit_log` row (actor_id, action, entity_id, details, created_at) for every approval, rejection, void and lease creation | 3, 4 |
| P8 | Allocation on approval: unpaid invoices ordered by `due_date`, then deposit before rent, then `period_index`; fill each fully (incl. not-yet-due) before the next; leftover → `payments.unapplied_sen` (only online can have any). `paidSen` = Σ allocations; status computed with `invoiceStatus`, never stored | 4 |
| P9 | Concurrency: two staff record RM800 + RM700 on RM1,000 remaining ⇒ exactly one accepted; double approve at once ⇒ allocated once | 4 |
| P10 | `GET /api/reports/collections?from=YYYY-MM&to=YYYY-MM`: Σ approved payments per month of `received_at` **in MYT**, every month in range incl. zeros, ordered. Seed: Northwind 2026-01..03 = `[{2026-01,300000},{2026-02,0},{2026-03,200000}]` (the 2026-03-01 00:30 MYT payment is 2026-02-28T16:30Z, the trap) | 4 |

### W: Online payments & webhook (15 pts)
| ID | Rule | Phase |
|---|---|---|
| W1 | `POST /api/leases/:leaseId/gateway-bills` (the lease's tenant only): amount = Σ unpaid of invoices with `due_date` ≤ today (MYT); nothing due ⇒ **422**; `201 { billId, amountSen }`; `gateway_bills.id` unguessable (`bill_` + 122-bit random) | 5 |
| ⛔ W2 | `/payments/return?bill_id=...&paid=true` only displays the DB status, changes nothing (IF4) | 5 |
| W3 | `POST /api/webhooks/gateway`, `application/x-www-form-urlencoded`; extra fields allowed and included in the signature | 5 |
| W4 | Signature: all fields except `x_signature`, sort keys ascending by char code, `key+value` joined with `\|`, HMAC-SHA256 hex lowercase with `GATEWAY_X_SIGNATURE_KEY`, **constant-time compare**. Vector: key `test_x_signature_key` ⇒ `06994fab2d674e7829144eaa2204631716d3c099b503d38945e92b6296531641` | 5 |
| W5 | Table: sig missing/wrong ⇒ **401** none; unknown bill ⇒ **404**; paid=true & `paid_amount` ≠ bill amount ⇒ **422**; paid=true & pending/failed ⇒ **200**, bill `paid` + ONE `approved` `online` payment, `received_at = paid_at`, allocated; paid=true & already paid ⇒ 200 no-op; paid=false & pending ⇒ 200, bill `failed`; paid=false & failed ⇒ 200 no-op; paid=false & already paid ⇒ 200 no-op (paid never goes back) | 5 |
| W6 | Duplicate/concurrent deliveries ⇒ at most one payment ever (`UNIQUE payments.gateway_bill_id` + bill row lock) | 5 |
| W7 | Never log the secret or whole payloads | 5 |
| W8 | `node gateway-sim.mjs <bill_id> <amount_sen> [true\|false]` works end to end | 5 |

### A: Access control, server code (25 pts shared with D and ST)
| ID | Rule | Phase |
|---|---|---|
| A1 | Roles only from `memberships` (manager/staff) and `tenants.user_id` (tenant); never `user_metadata` | 3 |
| A2 | Authenticate with `supabase.auth.getUser()` (or `getClaims()`), never `getSession()` | 3 |
| A3 | Accept `Authorization: Bearer <access token>` as well as the session cookie | 3 |
| A4 | No/invalid login ⇒ **401**; visible record + role not allowed ⇒ **403**; other org's or other tenant's record ⇒ **404** (no existence leak) | 3, 4, 5 |
| A5 | Body IDs untrusted: manager cannot create a lease on another org's unit/tenant; slip path must be in own org folder | 3, 4 |
| A6 | Route handlers, Server Actions and server components all check org + role (Prisma bypasses RLS) | 3, 6 |
| ⛔ A7 | Secret key never in browser (IF1) | all |

### D: Supabase Data API (PostgREST with publishable key + user token)
Max allowed (grant less where unused). Everything else **fails**: insert/update/delete on every table/view, and every function via `/rest/v1/rpc/...` ⇒ see D9.
| ID | Table | anon | tenant | staff | manager |
|---|---|---|---|---|---|
| D1 | organizations | none | read own org | read own org | read own org |
| D2 | memberships | none | none | read own org | read own org |
| D3 | units | none | units of own leases | read own org | read own org |
| D4 | tenants | none | read own row; **update only `phone`** | read own org | read own org |
| D5 | leases, invoices, payments, payment_allocations, gateway_bills | none | rows of own leases | read own org | read own org |
| D6 | audit_log | none | none | none | read own org |
| ⛔ D7 | anon: nothing on any table (IF2) | | | | |
| D8 | tenant portal reads own data + updates phone **directly from the browser with supabase-js** (so tenant RLS must work and the UI must use it) | | | | |
| D9 | No insert/update/delete/rpc for anyone beyond the table above, covering tables, views and functions we create | | | | |
| D10 | `audit_log` append-only for **every** role incl. service role and DB owner (trigger) | | | | |

### ST: Storage
| ID | Rule | Phase |
|---|---|---|
| ST1 | Private bucket `payment-slips`, objects under `<org_id>/...` | 2 |
| ST2 | Only staff/managers of that org upload; they read via short-lived signed URLs; tenants, other orgs, anon cannot read, list or upload | 2 |
| ST3 | `payments.slip_path` must point to an existing file in the payment's own org folder | 4 |
| ST4 | Bucket enforces 5 MB + JPEG/PNG/PDF (`file_size_limit`, `allowed_mime_types`) | 2 |

### H: HTTP API contract (JSON; sen integers; dates `YYYY-MM-DD`; instants ISO 8601 with offset; errors `{ "error": "message" }`; every endpoint can also return 401/403/404)
| Endpoint | Who | Success | Other |
|---|---|---|---|
| `POST /api/leases` body `{unitId,tenantId,startDate,endDate,monthlyRentSen,depositSen}` | manager | 201 `{id}` | 400, 409 overlap |
| `GET /api/leases/:leaseId` | staff, manager, lease's tenant | 200 `{lease:{id,unitId,tenantId,startDate,endDate,monthlyRentSen,depositSen}, invoices:[{id,kind,periodIndex,periodStart,periodEnd,dueDate,amountSen,paidSen,status}] (allocation order), payments:[{id,amountSen,unappliedSen,method,status,receivedAt}]}` | |
| `POST /api/leases/:leaseId/payments` body `{amountSen,method:'cash'\|'bank_transfer',receivedAt,slipPath?}` | staff, manager | 201 `{id,status}` | 400, 422 over cap |
| `POST /api/payments/:paymentId/approve` | manager | 200 `{status}` | 409 not pending, 422 over balance |
| `POST /api/payments/:paymentId/reject` body `{reason}` | manager | 200 `{status}` | 400 missing reason, 409 not pending |
| `POST /api/payments/:paymentId/void` body `{reason}` | manager | 200 `{status}` | 400 missing reason, 409 not approved |
| `POST /api/leases/:leaseId/gateway-bills` | lease's tenant | 201 `{billId,amountSen}` | 422 nothing due |
| `GET /api/reports/collections?from&to` | staff, manager | 200 `[{month,collectedSen}]` | 400 invalid range |
| `POST /api/webhooks/gateway` | gateway | see W5 | |

### DB: Database (migrations are the source of truth)
| ID | Rule | Phase |
|---|---|---|
| DB1 | All objects in `supabase/migrations/` (tables, constraints, RLS, grants, functions, triggers, bucket + policies); `db reset` rebuilds everything; nothing from Studio | 2 |
| DB2 | Tables/columns exactly: `organizations(id,name)`, `memberships(user_id,org_id,role)`, `units(id,org_id,name)`, `tenants(id,org_id,user_id,full_name,email,phone)`, `leases(id,org_id,unit_id,tenant_id,start_date,end_date,monthly_rent_sen,deposit_sen)`, `invoices(id,org_id,lease_id,kind,period_index,period_start,period_end,due_date,amount_sen)`, `payments(id,org_id,lease_id,amount_sen,unapplied_sen,method,status,received_at,slip_path,gateway_bill_id)`, `payment_allocations(id,org_id,payment_id,invoice_id,amount_sen)`, `gateway_bills(id,org_id,lease_id,amount_sen,status)`, `audit_log(id,org_id,actor_id,action,entity_id,details,created_at)` | 2 |
| DB3 | Money `bigint`; calendar dates `date`; instants `timestamptz`; `prisma/schema.prisma` matches DB | 2 |
| DB4 | Lease + exactly `generateSchedule`'s invoices stored all-or-nothing | 3 |
| DB5 | Leases on a unit never overlap (inclusive both ends), even under concurrent requests (DB-level) | 2, 3 |

### T: Timezones (10 pts, cross-cutting)
T1 overdue boundary in MYT (B7) · T2 collections bucketed by MYT month (P10) · T3 `paid_at` `+0800` → `received_at` instant (W5) · T4 every input (datetime for payments) interpreted as MYT whatever the browser TZ · T5 every display in MYT whatever the browser TZ, **no hydration warnings** · T6 billing identical under 3 TZs (B9).

### U: UI & code quality (10 pts)
shadcn/ui + Tailwind throughout · toasts on every action (success and error) · loading states (skeletons), no blank screens · helpful empty/invalid-input messages · TS strict, no `any`.
- U1 Staff/manager dashboard: overdue-invoice count + collections report, last 6 months
- U2 Leases list; lease page: invoices (period, due, amount, paid, status) + payments (slip link for bank transfers via signed URL)
- U3 Record payment: ringgit text → `parseRinggitToSen`; datetime in MYT; slip upload for bank transfer
- U4 Manager: approve / reject / void (confirm step + reason)
- U5 Tenant: lease, invoices with statuses, payments, **amount due now**, Pay now (shows bill id + amount), `/payments/return`, edit phone
- U6 `npm run build` + tests green before every commit

### Part B, C, Bonus
- **RV** (5 pts) `REVIEW.md`: per problem line numbers, concrete scenario, severity, fix, ordered most→least severe; **no false positives** (may state "looks suspicious but correct"). Prep notes in Appendix A.
- **DC** (5 pts) `DECISIONS.md`: 6 answers ≤ 150 words each with repo file:line pointers. Written after code freeze.
- Bonus (only if done well, skip unless ahead): create-lease form with live schedule preview; realtime; unit tests for billing + allocation (billing/allocation tests are in the core plan anyway); URL-synced search/pagination.

---

## 2. Phased plan

Build budget 3h05m + 30m write-ups = 3h35m. Commit trailer on every commit: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

| Phase | Box | Elapsed |
|---|---|---|
| 0 Setup | 15m | 0:00–0:15 |
| 1 Billing + TZ tests | 20m | 0:15–0:35 |
| 2 Schema + access control (DB side) + seed stage 1 | 35m | 0:35–1:10 |
| 3 Auth helper + leases API + seed stage 2 | 15m | 1:10–1:25 |
| **★ CP1 Safe submission #1** | 10m | 1:25–1:35 |
| 4 Payments + allocation + report + seed stage 3 | 35m | 1:35–2:10 |
| 5 Gateway bills + webhook + return page | 20m | 2:10–2:30 |
| **★ CP2 tag + push** | 2m | 2:30 |
| 6 UI | 35m | 2:30–3:05 |
| 7 REVIEW, DECISIONS, README, ai-logs, final fresh-clone check, submit | 30m | 3:05–3:35 (**code freeze at 3:05**) |

Overrun rule: if a phase runs >10 min over, apply the cut list (Section 4) and move on.
Shared verify helper (built in Phase 3): `node scripts/token.mjs <email>` prints a Supabase access token (`POST /auth/v1/token?grant_type=password`), used as `-H "Authorization: Bearer $T"` in curl.

### Phase 0: Setup (15m)
- **Do**
  1. `docker ps`; `npx supabase init`; `npx supabase start`; `npx supabase status -o env` (copy keys). In `supabase/config.toml` set `[api] schemas = ["public"]` (drops `graphql_public` from the Data API surface); leave signup default.
  2. Fix `.gitignore` (`!.env.example`). Write `.env.example` + `.env.local` (local URL, publishable key, secret key, `DATABASE_URL=DIRECT_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`, `GATEWAY_X_SIGNATURE_KEY=test_x_signature_key`) with a comment per var saying which `supabase status` field it comes from.
  3. Deps: `npm i @supabase/supabase-js @supabase/ssr zod server-only`; `npm i -D vitest tsx`.
  4. **Prisma separately**: `npm i @prisma/client@7.10.1 @prisma/adapter-pg@7.10.1 --foreground-scripts` then `npm i -D prisma@7.10.1 --foreground-scripts --loglevel=http`. If no progress for 3 min: Ctrl+C, retry with `--ignore-scripts`, then `npx prisma -v` with `DEBUG=*` to see which download stalls (check `npm config get registry`, antivirus, proxy). Confirm the Prisma 7 API from the installed package before using it (config file `prisma.config.ts`, driver adapter, generator output path); my recollection may be stale.
  5. `npx shadcn@latest init -d` only (components added in Phase 6). If the registry call stalls, hand-write `components.json` and defer.
  6. `package.json` scripts: `test`, `test:tz`, `test:int`, `typecheck`, `seed`, `db:reset`, `db:pull`, `postinstall` (`prisma generate`).
  7. (If Open Q2 = remove) drop `cacheComponents`/`partialPrefetching` from `next.config.ts`.
- **Files**: `supabase/config.toml`, `.env.example`, `.gitignore`, `package.json`, `prisma/` + `prisma.config.ts`, `components.json`, `vitest.config.ts`, `docs/PLAN.md`, `docs/notes.md` (running log of AI mistakes for DECISIONS Q6).
- **Verify**: `npx supabase status` healthy; `npx prisma -v` prints 7.10.1; `npm run build` passes on the stock app; `npx vitest run` runs (no tests yet is OK); `git status` shows `.env.example` tracked, `.env.local` ignored.
- **Covers**: S1 (partly), S2, S3.
- **Commit**: `chore: project setup (supabase init, prisma 7.10.1, vitest, shadcn init, env example)`

### Phase 1: Billing + tests (20m)
- **Do (tests first)**: write `billing.test.ts` from the brief (worked example; Ben's half-up 50014.5→50015; Probe/Chen last period full; Jan 31 anchors incl. leap year 2028; start=end single day; end exactly at period end; clamp cases; every validation throw; exact status boundary at `…T15:59:59.999Z` vs `…T16:00:00.000Z`; paid beats overdue; every parse example). Then implement.
- **Design**: all date math on `YYYY-MM-DD` strings via integer y/m/d arithmetic and `Date.UTC`; proration in BigInt: `floor((2·rent·used + full) / (2·full))`; Malaysia date = `new Date(now.getTime() + 8·3600000).toISOString().slice(0,10)` (one exported helper `malaysiaDate(now)`, the only place "today" is derived); `parseRinggitToSen` via one anchored regex then integer math; reject unsafe integers.
- **Files**: `src/lib/billing.ts`, `src/lib/billing.test.ts`, `scripts/test-tz.mjs`, `vitest.config.ts`.
- **Verify**: `npm test`; `npm run test:tz` (spawns vitest under UTC, Asia/Kuala_Lumpur, America/New_York; first prints `getTimezoneOffset()` per run to prove TZ took effect); `grep -nE "from '(next|react|@supabase|@prisma)|getFullYear|getMonth|getDate\(|getHours|new Date\(['\"]" src/lib/billing.ts` returns nothing.
- **Covers**: B1–B9, T1, T6.
- **Commit**: `feat(billing): pure TZ-independent schedule, invoice status and ringgit parsing with tests`

### Phase 2: Schema + access control (DB side) + seed stage 1 (35m)
- **Migrations** (`npx supabase migration new ...`, applied in order):
  1. `*_schema.sql`: `btree_gist`; enums (`invoice_kind`, `payment_method`, `payment_status`, `bill_status`, `member_role`); the 10 tables with `uuid default gen_random_uuid()` PKs (`gateway_bills.id` = `'bill_' || replace(gen_random_uuid()::text,'-','')`); FKs; CHECKs (amounts, `end_date >= start_date`, `unapplied_sen` between 0 and `amount_sen`, rent > 0, deposit >= 0); `UNIQUE(memberships.user_id)`; `UNIQUE(tenants.user_id)`; `UNIQUE(payments.gateway_bill_id)`; `UNIQUE(payments.slip_path)` where not null; one deposit per lease, `UNIQUE(lease_id, period_index)`; `UNIQUE(payment_id, invoice_id)` on allocations; composite FKs `leases(unit_id,org_id)→units(id,org_id)` and `leases(tenant_id,org_id)→tenants(id,org_id)`; **`EXCLUDE USING gist (unit_id WITH =, daterange(start_date, end_date, '[]') WITH &&)`**; indexes on `lease_id`/`org_id`. Extra columns of ours: `payments.created_by/decided_by/decided_at/decision_reason`, `created_at`s, `audit_log.actor_id` nullable (system actions).
  2. `*_audit_append_only.sql`: row trigger `BEFORE UPDATE OR DELETE` + statement trigger `BEFORE TRUNCATE` raising for every role incl. `service_role` and the owner (D10); additionally revoke UPDATE/DELETE/TRUNCATE from `anon`/`authenticated` only.
  3. `*_security.sql`: schema `private` (not in `api.schemas`) holding `SECURITY DEFINER` helpers with `set search_path = ''` (`staff_org_ids()`, `manager_org_ids()`, `my_tenant_ids()`, `my_lease_ids()`); `ENABLE ROW LEVEL SECURITY` on all 10 tables; `REVOKE ALL ... FROM PUBLIC, anon, authenticated` on public tables (**not** `service_role`, per Q7) and `REVOKE EXECUTE ... FROM PUBLIC, anon` on functions; `GRANT USAGE ON SCHEMA private` + `GRANT EXECUTE` on the `private.*` helpers TO `authenticated` (required for RLS to evaluate); then `GRANT SELECT` to `authenticated` per D1–D6 and `GRANT UPDATE (phone) ON tenants` + RLS update policy `user_id = auth.uid()`; policies are `TO authenticated` only; no write policies anywhere else.
  4. `*_storage.sql`: bucket `payment-slips` (private, `file_size_limit` 5242880, `allowed_mime_types` jpeg/png/pdf); `storage.objects` policies for `authenticated`: INSERT and SELECT only when `bucket_id='payment-slips'` and the first folder segment equals an org in `private.staff_org_ids()` (string compare, no uuid cast); no UPDATE/DELETE policy.
- **Then**: `npm run db:sync` (= `supabase db reset` → `prisma db pull` → `prisma generate`); seed stage 1 (`scripts/seed.ts`): 2 orgs, 7 auth users via `auth.admin.createUser({email_confirm:true})`, memberships, tenants (with `user_id`), units. Also `src/lib/prisma.ts` (server-only).
- **Verify**: `npx supabase db reset` + `npm run seed` from zero; `tests/integration/data-api.test.ts` (or `scripts/probe-data-api.mjs`) logs in each seeded role and asserts the D1–D6 matrix: row visibility, every insert/update/delete rejected, tenant `PATCH phone` ok but `PATCH full_name` rejected, `audit_log` update/delete rejected as service key, `rpc` calls to every function name rejected, anon gets nothing on every table (IF2), storage: staff uploads to own org folder OK / other org rejected / tenant rejected / anon rejected / tenant list denied / staff signed URL works / 6 MB or `text/plain` rejected. Overlap constraint tested with raw SQL (two overlapping inserts fail, adjacent ranges pass).
- **Covers**: D1–D7, D9, D10, ST1, ST2, ST4, DB1–DB3, DB5, S5, IF2.
- **Commit**: `feat(db): schema, overlap exclusion, RLS + grants lockdown, append-only audit_log, payment-slips bucket policies; seed users/orgs`

### Phase 3: Auth helper + leases API + seed stage 2 (15m)
- **Do**: read `node_modules/next/dist/docs/01-app/02-guides/authentication.md` and the `route` + `proxy` API refs first. Build `src/lib/supabase/{server,browser,admin}.ts`, `src/proxy.ts` (cookie refresh + optimistic redirect for pages only; `/api` and `_next` excluded), `src/lib/http.ts` (`HttpError`, `route()` wrapper → `{error}`, zod → 400, bad JSON → 400, Prisma `23P01` → 409, unknown → 500 with generic message), `src/lib/auth.ts` (see D3), `src/lib/services/leases.ts` (`createLease(actor, input)`: one tx = verify unit/tenant in actor's org → insert lease → insert `generateSchedule` invoices → audit `lease.created`), routes `POST /api/leases` and `GET /api/leases/[leaseId]`, `scripts/token.mjs`, seed stage 2 (the 5 leases via `createLease`).
- **Files**: above + `src/app/api/leases/route.ts`, `src/app/api/leases/[leaseId]/route.ts`.
- **Verify** (curl as seeded users, `$T_*` from `token.mjs`): no token ⇒ 401; garbage Bearer ⇒ 401; tenant `POST /api/leases` ⇒ 403; Beta manager posting a Northwind `unitId` ⇒ 404; overlapping lease ⇒ 409; **two concurrent identical POSTs** (`Promise.all`) on free unit D-03-2 ⇒ exactly one 201, one 409; Ben GET Aisyah's lease ⇒ 404; Beta manager GET Northwind lease ⇒ 404; Aisyah GET own ⇒ 200 with 7 invoices in order and `status` filled; staff GET ⇒ 200. Cookie path checked in the browser in Phase 6.
- **Covers**: A1–A5, DB4, DB5, P7 (lease audit), H (first two rows), S4/S6 (partly).
- **Commit**: `feat(api): auth helper (cookie + bearer), leases create/get with org scoping, seed leases`

### ★ CP1: Safe submission #1 (10m)
Minimal `README.md` (run steps, what works, **what is skipped**), `.env.example` verified, `supabase db reset && npm run seed && npm run build` clean, secret-key grep on `.next/static` empty, you run `/export` into `ai-logs/`, tag `checkpoint-1`, push (you give me the remote; I will not push without your say-so). This is a valid submission: billing + access control + leases.

### Phase 4: Payments (35m)
- **Do**: `src/lib/allocation.ts` (pure `planAllocation(unpaidInvoices, amount)` + `allocate(tx, paymentId)`), `src/lib/dates.ts` (`monthRange`, `parseOffsetInstant`), `src/lib/services/payments.ts` (`recordPayment`, `approvePayment`, `rejectPayment`, `voidPayment`; each = one `prisma.$transaction` starting with `SELECT id FROM leases WHERE id=$1 FOR UPDATE` and a status re-read inside the lock; audit rows in the same tx), slip validation + cleanup (D7), collections report query, 4 payment routes + report route, seed stage 3 (cash by manager actor; bank transfer by staff actor with a tiny PNG uploaded to `payment-slips/<northwind_org_id>/...` via the admin client with `upsert`, then `approvePayment` by manager).
- **Verify**: unit tests for `planAllocation` (order: due date → deposit-before-rent → period index; leftover → unapplied; zero/one-sen edges). `tests/integration/payments.test.ts` against `npm run dev`: staff 80000 + 70000 concurrently on a lease with 100000 remaining ⇒ one 201 and one 422; double approve concurrently ⇒ one 200, one 409, allocation rows = exactly the expected set; approve over balance ⇒ 422 and still pending; reject/void reason < 5 chars ⇒ 400; void removes only its allocations; 409 states; manager-recorded ⇒ approved + allocated; staff ⇒ pending; slip: bank transfer without slip ⇒ 400, slip in other org's folder ⇒ 400, over cap after upload ⇒ 422 **and object gone from storage**; collections for Northwind 2026-01..03 matches the brief; 403 for staff on approve, 404 for Beta manager on Northwind payment; `audit_log` rows for lease/approve/reject/void present.
- **Covers**: P1–P10, A4, A5, ST3, T2, S4, S7, IF3.
- **Commit**: `feat(payments): record/approve/reject/void with per-lease locking, allocation, audit, collections report, slip cleanup`

### Phase 5: Gateway bills + webhook (20m)
- **Do**: `src/lib/gateway.ts` (pure `signatureSource(fields)`, `computeSignature`, `verifySignature` with `timingSafeEqual`), `src/lib/services/gateway.ts` (`createBill`, `settleCallback`), `POST /api/leases/[leaseId]/gateway-bills`, `POST /api/webhooks/gateway`, `src/app/payments/return/page.tsx` (read-only), `gateway-sim.mjs` verbatim.
- **Verify**: unit test with the spec vector (exact source string and hex); extra-field signature test; integration: forged ⇒ 401, unknown id ⇒ 404, wrong amount ⇒ 422, valid ⇒ 200 + 1 payment + allocations, repeat ⇒ 200 + still 1 payment, **10 concurrent identical deliveries ⇒ 1 payment**, paid=false after paid ⇒ 200 and bill stays paid, paid=false on pending ⇒ failed, paid=true after failed ⇒ settles; `received_at` equals `paid_at` instant; nothing logged contains the key or the body (read the logger calls); visiting `/payments/return?paid=true` for a pending bill leaves it pending; `node gateway-sim.mjs` works against `npm start`; Beta manager/staff cannot create bills (403), other tenant 404.
- **Covers**: W1–W8, T3, A4, IF4.
- **Commit**: `feat(gateway): bills, HMAC-verified idempotent webhook, read-only return page, simulator`

### ★ CP2 (2m): `git tag checkpoint-2`, push, `/export` AI log #2.

### Phase 6: UI (35m)
- **Do**: `npx shadcn@latest add button card table input label dialog alert-dialog sonner skeleton badge select textarea`; `Toaster` in root layout. `src/lib/time.ts` (`formatMyt(iso)` using fixed month arrays + `UTC+8` arithmetic, no `Intl`/locale, so server and browser output identical; `mytInputToIso(localDateTime)` appends `+08:00`). Pages: `/login`, `/` (role redirect), `/dashboard` (overdue count via `invoiceStatus` + 6-month report), `/leases`, `/leases/[leaseId]` (invoices, payments, record-payment dialog with ringgit + MYT datetime + slip upload to Storage with the user's token, approve/reject/void dialogs with confirm + reason, slip link = signed URL from a staff-only route), `/portal` (tenant: **client components with browser supabase-js** for reads and phone update, amount due now, Pay now), `/payments/return`. Every list has skeleton + empty state; every mutation toasts. Default "now" values for forms are set after mount (no `Date` in render).
- **Verify**: `npm run build`; click-through as manager, staff, Aisyah; DevTools → Sensors → Location → Timezone ID `America/New_York` and `Pacific/Auckland`: all dates still MYT, console free of hydration warnings; staff sees no approve/void buttons and direct API call still 403; tenant sees only own lease; secret-key grep on `.next/static` empty.
- **Covers**: U1–U6, T4, T5, A6, D8.
- **Commit**: `feat(ui): dashboard, leases, payments, tenant portal with MYT-safe date handling and toasts`

### Phase 7: Write-ups + submission (30m, code frozen at 3:05)
1. `REVIEW.md` (10m) from Appendix A, re-checking each line number against the brief's snippet.
2. `DECISIONS.md` (10m): 6 answers ≤150 words, pointing at final file:line (grep for line numbers after freeze). Q6 from `docs/notes.md` + the ai-logs.
3. `README.md` (5m): run steps, test accounts + password, env, known issues, **skipped**, next steps.
4. (5m) You `/export` the final session(s) into `ai-logs/`; `supabase db reset` → `npm run seed` → `npm run build && npm start` one last time; `git status` clean; push; I draft the submission summary (what works, what doesn't, what was skipped, env values from `.env.local`, test account + password).
- **Commit**: `docs: REVIEW, DECISIONS, README, ai-logs`

---

## 3. Key design decisions (recommendation, why)

**D1 Migrations vs Prisma.** *Migrations are the source of truth; `schema.prisma` is generated.* Needed for RLS, grants, triggers, the exclusion constraint and the bucket, none of which Prisma Migrate models. Sync: `npm run db:sync` = `supabase db reset && prisma db pull && prisma generate`, never hand-edit `schema.prisma`, commit it after every migration change. `db pull` cannot express the `EXCLUDE`/CHECKs; that is fine (they live in SQL), and I will verify the pull is clean in Phase 2. Prisma is used only for server-side data access (as owner, bypassing RLS).

**D2 Seed.** *`scripts/seed.ts` (run by `tsx --env-file=.env.local`) calls the same service functions the API uses, with an `Actor` object, not HTTP.* Users via `supabase.auth.admin.createUser({ email_confirm: true, password })` with the secret key; memberships/tenants/units via Prisma; leases through `createLease`; payments through `recordPayment` (manager ⇒ approved, staff ⇒ pending) then `approvePayment`, so invoices, allocations and audit rows are exactly what the app produces. Slip PNG uploaded with `upsert: true` (db reset does not clear storage volumes). Refuses to run if orgs already exist (prints "run `npx supabase db reset`"), so a double run cannot create duplicates.

**D3 Auth helper.** *One `getActor(req)` in `src/lib/auth.ts`.* If an `Authorization: Bearer` header exists, validate it with `getUser(token)` using a stateless client built from the publishable key, and a bad token is 401 with **no cookie fallback**. Otherwise use the `@supabase/ssr` cookie client's `getUser()`. `getUser` over `getClaims` because it checks with the Auth server (sees revoked users) and the local Auth is fast. Then role lookup: `memberships` by `user_id` ⇒ staff/manager + `orgId`; else `tenants` by `user_id` ⇒ tenant + `tenantId` + `orgId`; valid login with neither ⇒ 403. Fixed pipeline in every handler: **authenticate (401) → load the record through a visibility-scoped finder (404; malformed UUID is also 404) → role check (403) → body validation (400) → state check (409) → cap/balance (422)**. The finder scopes by `org_id` for staff/manager and by `tenant_id` for tenants, so cross-org and cross-tenant are indistinguishable from "missing". `route()` wrapper maps `HttpError` to `{error}` JSON. Server Actions and server components call the same `getActor`.

**D4 Concurrency and overlap.** *Lock the lease row.* Every money-changing operation (record+cap, approve, reject, void, webhook allocation) runs in one `prisma.$transaction`, first statement `SELECT id FROM leases WHERE id = $1 FOR UPDATE`, then re-reads the payment/bill status **inside** the lock and guards the transition. The cap sum, the approve re-check, void, and allocation therefore all serialize per lease, and "approve twice" allocates once (second waits, sees `approved`, returns 409). Webhook lock order is bill → lease; nothing locks lease → bill, so no deadlock. Business logic stays in TypeScript services (explainable line by line) instead of PL/pgSQL functions, which would also be new rpc surface to lock down. Overlap: `EXCLUDE USING gist (unit_id WITH =, daterange(start_date, end_date, '[]') WITH &&)`: the database rejects the second concurrent insert (SQLSTATE `23P01` ⇒ 409), no app-level lock needed. Backstops: `UNIQUE(payment_id, invoice_id)` on allocations.

**D5 Webhook idempotency.** *Row lock plus unique index.* Order: parse raw body with `URLSearchParams` (duplicate keys ⇒ treated as bad signature) → verify HMAC (constant time; lengths checked first) ⇒ 401 → read `id` → tx: `SELECT ... FROM gateway_bills WHERE id=$1 FOR UPDATE` (none ⇒ 404) → `paid=true`: amount mismatch ⇒ 422; `paid` ⇒ 200 no-op; else lock lease, insert the approved online payment (`gateway_bill_id`, `received_at = paid_at` parsed with its offset), `allocate`, set bill `paid`, audit → `paid=false`: only `pending → failed`. A second concurrent delivery blocks on the bill lock, then sees `paid` and returns 200. `UNIQUE(payments.gateway_bill_id)` is the structural guarantee ("at most one payment, ever"); a `23505` is treated as a replay (200), never 500. Logging: only bill id + outcome codes; no body, no key.

**D6 Data API lockdown.** *Deny by default, grant narrowly, helpers off the API surface.* `REVOKE ALL` on public tables from `PUBLIC, anon, authenticated` (`service_role` keeps its grants, per Q7), then `GRANT SELECT` to `authenticated` only on the 9 readable tables, plus column-level `UPDATE (phone)` on `tenants`. Defaults are neutralised by revoking after creation in the same migration (plus `ALTER DEFAULT PRIVILEGES` for the migration role). Policies `TO authenticated`, built on `private.*` SECURITY DEFINER helpers (avoids recursive RLS). `authenticated` gets `USAGE` on schema `private` and `EXECUTE` on the helpers (RLS needs both); they are still not callable via `/rest/v1/rpc` because nothing lives in `public` and `private` is not in `api.schemas`. EXECUTE is revoked from `PUBLIC` and `anon` only. A probe test proves rpc calls to each `private.*` helper fail. Tenant phone update = column grant + RLS `user_id = auth.uid()` (full_name/email/user_id/org_id updates fail with permission denied). `audit_log`: triggers on UPDATE/DELETE/TRUNCATE raise for everyone (owner and `service_role` included); UPDATE/DELETE/TRUNCATE also revoked from `anon`/`authenticated`; INSERT only by Prisma/owner. `service_role` keeps table privileges (Q7): the tests use the publishable key + user tokens and the secret key never leaves the server, so the triggers are what make `audit_log` append-only for it.

**D7 Storage and cleanup.** Bucket in a migration: private, 5 MB, jpeg/png/pdf. Policies: INSERT and SELECT for staff/managers whose org id equals the first path segment; no UPDATE/DELETE, no tenant or anon policy. Signed URLs (60 s) created with the user-scoped client, so the policy is a second enforcement layer. Upload happens first (client, user token), then `POST .../payments` carries `slipPath`. Server validation: path starts with `<actor.orgId>/`, no `..`, and a `storage.objects` row exists for the bucket (also re-checks size and mimetype). **Cleanup:** in the route's failure path, after the caller is authenticated as staff/manager, if `slipPath` is in the caller's own org folder and **no payment references it**, delete the object with the admin client. `UNIQUE(slip_path)` plus "only delete if unreferenced" means a failed request can never delete another payment's slip, and the loser of a concurrent same-slip race does not delete the winner's file.

**D8 Time.** Everything derives from three primitives in pure code: `malaysiaDate(now)` (billing.ts) for "today", `parseOffsetInstant` for incoming instants (rejects strings without an offset), SQL `AT TIME ZONE 'Asia/Kuala_Lumpur'` for month bucketing (report range = `[first-of-from 00:00 MYT, first-of-(to+1) 00:00 MYT)`, zero months filled in TS from `monthRange`). UI: `formatMyt` is pure arithmetic with no `Intl`/locale, so server and client render identical strings; `datetime-local` text is combined with `+08:00` rather than parsed by the browser; no `new Date()`/`Date.now()` in render paths. This also makes DECISIONS Q3 a short list.

**D9 Money in TS.** DB `bigint` ⇒ Prisma `BigInt`; services do arithmetic in BigInt or in SQL (`SUM`); a single `senToNumber()` at the API boundary asserts `Number.isSafeInteger`. `billing.ts` keeps the contract's `number` fields (integers only) and uses BigInt for proration.

---

## 4. Risks and fallbacks

| Risk | Impact | Mitigation / fallback |
|---|---|---|
| Prisma install/generate hang again | Blocks Phases 0, 2 | Pinned 7.10.1, foreground logs, 3-min stall rule, `--ignore-scripts` retry. **Fallback**: use `postgres`/`pg` raw SQL in services for the locking-critical paths, keep Prisma only for introspection. |
| Prisma 7 API differs from my memory (config file, adapter, generator output) | 10 min lost | Read installed package docs in Phase 0 before writing `prisma.ts`. |
| `db pull` mangles auth FKs, enums, exclusion constraint | schema.prisma mismatch | Spike in Phase 2 start; if FK to `auth.users` confuses Prisma, keep column plain `uuid` and rely on seed/server checks. |
| RLS/grant mistake leaks data (25 pts + IF2) | Fatal | Probe test over every role × table × verb × rpc is part of Phase 2; re-run in Phases 5 and 7. |
| Concurrency tests flaky | Time sink | Use `Promise.all` of N requests plus assert on final DB state, not timing. |
| Next 16 `cacheComponents` build errors on dynamic pages | UI phase blow-up | Open Q2 (remove flags). Fallback `export const instant = false` per page. |
| shadcn CLI network stall | UI delay | Only `init` in P0, components added in P6; fallback copy components by hand. |
| TZ test setup on Windows | False greens | `test-tz.mjs` prints `getTimezoneOffset()` in each run; never rely on bash `TZ=`. |
| Overrun | Missing write-ups | Hard stop at 3:05; write-ups are pre-planned (Appendix A). |

**Cut list, in order** (brief: a correct secure subset beats a complete sloppy app): bonuses → UI polish/empty states → tenant portal polish (keep phone edit + pay now) → composite FKs and extra constraints beyond the exclusion/uniques → `/payments/return` styling → leases list pagination. **Never cut**: IF1–IF4, RLS/grants/audit trigger, the 401/403/404 pipeline, lease locking, webhook table + unique index, billing tests, README "skipped" section.

---

## 5. Open questions (answer before we start; each has my default)

1. **Seed password** for all 7 accounts (goes in `.env`-adjacent docs, README, submission). Needs your value.
2. **`cacheComponents: true` / `partialPrefetching: true` in `next.config.ts`**: remove? *Default: remove both* (every page here is per-user dynamic; flags add Suspense/prerender rules and build-error risk; the brief does not need them). Keep the Tailwind turbopack loader.
3. **Branch/remote**: rename `master` → `main`? Who creates the public GitHub repo and what is the remote URL? *Default: rename to `main`; I never push until you say so.*
4. **Webhook gaps** (brief is silent): (a) `paid=true` but `transaction_status` is `failed`/`pending`: *default: ignore `transaction_status`, trust `paid`*. (b) `paid=true` with wrong `paid_amount` on an already-paid bill: *default: 422 (amount check before status)*. (c) missing/unparseable `paid_at` or non-numeric `paid_amount` with a valid signature: *default: 400*.
5. **Void of an online payment that still has `unapplied_sen`** (DECISIONS Q5): *default: do nothing to other payments (brief: their allocations do not change), leave unapplied credit as is, and leave the voided payment's own `unapplied_sen` untouched*. Alternative: zero it on void or auto-reallocate. Your call.
6. **Manager-recorded payment** (approved immediately): write an `audit_log` row `payment.approved` too? *Default: yes* (details mark `auto: true`).
7. **`service_role` on public tables via Data API**: *default: revoke everything* ("every other insert/update/delete must fail for everyone"). Risk: a hidden test that inserts an audit row with the service key as setup would fail.
8. **`/payments/return`**: require login and show "not found" unless the bill belongs to the viewer (tenant of the lease, or staff/manager of its org)? *Default: yes.* Alternative: public by unguessable bill id, status only.
9. **Prisma version**: *default: `7.10.1` for CLI, client and adapter (not the 8.0.0-rc.28 that `latest` resolves to).*
10. **Defaults I will apply unless you object**: cross-org or unknown `unitId`/`tenantId`/`leaseId` in a body or path ⇒ 404 (CLAUDE.md rule); `reason` is trimmed before the 5-char test; `cash` with a `slipPath` ⇒ 400; `receivedAt` without an offset ⇒ 400; `amountSen` must be a positive safe integer ⇒ 400; valid login with no membership/tenant row ⇒ 403; collections range has no maximum span, `from > to` or bad format ⇒ 400; invalid UUID in a path ⇒ 404.

---

## Appendix A: REVIEW.md prep (Part B)

> **Correction B: every `L###` below is a SPEC.md line number, NOT a line number inside the snippet file.** In Phase 7, re-count from 1 within each of the three files (`late-fees/route.ts`, `webhooks/gateway/route.ts`, `dashboard/actions.ts`) and use only those numbers in REVIEW.md. (Offsets, with the `// app/...` path comment counted as line 1: snippet 1 starts at SPEC.md 389 ⇒ SPEC `L401` = line 13; snippet 2 starts at SPEC.md 443; snippet 3 at SPEC.md 485. REVIEW.md will state this convention at the top, and I will recount each cited line against the snippet text rather than trusting the offset arithmetic.)

Ordered most → least severe. Only real problems; "looks wrong but fine" listed separately.

**`late-fees/route.ts`**
1. **Critical** L401: role read from `user_metadata` (user-editable) ⇒ any user escalates to manager. Fix: role from `memberships`.
2. **Critical** L406: no org/ownership check on `leaseId`; Prisma bypasses RLS ⇒ a manager of org B adds fees to org A's lease (IDOR). Fix: scope lookup by actor's org ⇒ 404.
3. **High** L415–434: not idempotent (second call adds the same fees again), no transaction (partial writes on failure), no lease lock (concurrent calls duplicate).
4. **High** L429/L438–440: `reference: await nextReference()` is resolved before any create runs (Prisma queries are lazy), so every invoice in the loop gets the same `INV-n`; also read-then-write race and `parseInt` of a null/other-format reference gives `INV-NaN`.
5. **Medium** L421: `kind: 'late_fee'` is outside the allowed invoice kinds (`deposit`/`rent`) and breaks the lease balance/cap model.
6. **Medium** L419–420: money via floats (`Number(...)/Number(...) >= 0.995` silently forgives up to 0.5%; `Math.round(x*2/100)`). Fix: BigInt integer math, explicit rule.
7. **Low** L401–403: unauthenticated returns 403, should be 401; L427 `new Date(todayMyt)` fine (UTC midnight) but only works because Prisma reads DATE as UTC.

**`webhooks/gateway/route.ts`**
1. **Critical** L458: logs `fields` and the **expected signature** ⇒ anyone with log access can forge valid callbacks (and logs whole payload, forbidden).
2. **High** L463–475: read-then-write race, no lock; two concurrent deliveries both see `pending` ⇒ double payment (or 500 on unique). Fix: `FOR UPDATE` on bill row in the transaction + unique `gateway_bill_id`.
3. **High** L461: `paid !== 'true'` returns 200 before the bill lookup ⇒ unknown id never 404, pending bill never becomes `failed`.
4. **High** L475: `BigInt(fields.paid_amount)` throws on junk (500) and is never compared to `bill.amountSen` ⇒ attacker or gateway bug settles a bill with any amount (422 required).
5. **Medium** L476: `receivedAt: new Date()` instead of `paid_at` ⇒ wrong month in collections.
6. **Medium** L457: `!==` string compare is not constant-time; `!` on a missing env var gives a 500.
(Former point 7, "allocation without locking the lease", deleted at review: the brief says to assume `allocate(tx, paymentId)` is correct, so it is out of scope for REVIEW.md. Our own webhook still locks bill → lease before calling `allocate`, see D5.)

**`dashboard/actions.ts`**
1. **Critical** L490: `'use server'` export is a public endpoint; `orgId` comes from the client, no authentication/authorization ⇒ any caller (including tenants/anon) reads any org's collections.
2. **High** L492–495: `date_trunc('month', received_at)` and `::date` comparisons use the DB session timezone (UTC) ⇒ payments between 00:00–08:00 MYT on the 1st land in the previous month, range edges shifted 8 h. Fix: `AT TIME ZONE 'Asia/Kuala_Lumpur'` on both.
3. **Medium** L497: months with no payments are omitted (brief requires zero rows); no validation of `from`/`to` (bad input ⇒ 500).
4. **Looks suspicious but fine**: the tagged-template `$queryRaw` is parameterised (no SQL injection); `Number(r.total)` is safe within the safe-integer range (type annotation `bigint` is wrong, since `SUM` returns numeric, but the conversion still works).
