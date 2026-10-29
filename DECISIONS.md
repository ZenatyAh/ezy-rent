# Decisions (Part C)

Every pointer is `path:line` from the repository root, for the code at commit `0f9f050` (after the code freeze; no code has
changed since). Each answer is at most 150 words.

## 1. The same paid=true callback, twice, 5 ms apart

Both pass the signature check (`src/app/api/webhooks/gateway/route.ts:20`) and call `settleCallback`. Its transaction starts with `select … for update` on the bill row (`src/lib/services/gateway.ts:92`). Delivery 1 sees `pending`, locks the lease (`src/lib/services/gateway.ts:106`), creates the payment with `gateway_bill_id` (`src/lib/services/gateway.ts:107`) and sets the bill `paid` (`src/lib/services/gateway.ts:120`). Delivery 2 waits for the row lock, sees `paid`, returns 200 (`src/lib/services/gateway.ts:104`). The final guarantee is `UNIQUE (gateway_bill_id)` (`supabase/migrations/20261029120100_schema.sql:134`); a lost race counts as a replay (`src/lib/services/gateway.ts:143`). Ten simultaneous deliveries, defences removed:

| left in place | result |
|---|---|
| lock + UNIQUE | 1 payment |
| UNIQUE only | 1 payment, nine 500s |
| lock only | 1 payment |
| none | 4 to 10 payments |

## 2. RM 800 and RM 700 at once, RM 1,000 remaining

`recordPayment` (`src/lib/services/payments.ts:72`) runs in one transaction that first locks the lease row (`src/lib/services/payments.ts:95`, which calls `src/lib/services/locks.ts:7`, `select … for update`). The second request waits, then computes remaining minus pending payments (`src/lib/services/payments.ts:96`, using `balances` at `src/lib/services/payments.ts:16`). It sees the first payment pending, so the cap is RM 200 and RM 700 is refused with 422 (`src/lib/services/payments.ts:98`). Exactly one is accepted, whichever arrives first, for staff and managers together.

| lease lock | 8 simultaneous RM 300 payments | 6 simultaneous approvals |
|---|---|---|
| on | 3 accepted, 5 refused | 1 × 200, 5 × 409 |
| removed | 7 accepted (RM 2,100) | 1 × 200, 5 × 500 |

## 3. Where "today" is worked out, and dates become instants

All in Malaysia time (UTC+8, no daylight saving), never the machine's. Today: `malaysiaDate` (`src/lib/billing.ts:135`, now + 8 h read with UTC methods), used by `invoiceStatus` (`src/lib/billing.ts:147`), Pay now (`src/lib/services/gateway.ts:21`), the overdue count (`src/lib/services/dashboard.ts:7`), dashboard months (`src/app/(staff)/dashboard/page.tsx:13`) and the portal in the browser (`src/app/portal/tenant-portal.tsx:69`). DATE columns are UTC midnight (`src/lib/dates.ts:6`, `src/lib/dates.ts:10`). Incoming instants need an offset: `src/lib/dates.ts:28`; gateway `paid_at`: `src/lib/gateway.ts:30`. Outgoing: `src/lib/dates.ts:15`. Report months: `AT TIME ZONE 'Asia/Kuala_Lumpur'` (`src/lib/services/reports.ts:30-36`). Screens: `src/lib/time.ts:17-37`; the form reads "now" on open (`src/app/(staff)/leases/[leaseId]/record-payment.tsx:32`). The API passes `new Date()` for statuses (`src/app/api/leases/[leaseId]/route.ts:10`); seed payments carry `+08:00` (`scripts/seed.ts:136`, `scripts/seed.ts:149`).

## 4. Queries that are not subject to RLS

1. Prisma, connected as the database owner (`src/lib/prisma.ts:12`): all route handlers, pages and actions. Authorization is `getActor` (`src/lib/auth.ts:38`; role from `memberships` or `tenants.user_id`, `src/lib/auth.ts:41-44`), then organization-scoped finders that answer 404 (`src/lib/services/leases.ts:97`, `src/lib/services/payments.ts:56`, `src/lib/services/gateway.ts:39`), then `requireRole` (403).
2. The secret-key client (`src/lib/supabase/admin.ts:9`): only deleting an orphaned slip in the caller's own folder that no payment uses (`src/lib/services/slips.ts:42-47`), and the seed.
3. `SECURITY DEFINER` helpers (`supabase/migrations/20261029120300_security.sql:15-49`): used by policies only; their schema is not exposed, so there is no rpc.
4. The webhook: the HMAC signature.

`npm run probe` checks the Data API and Storage as every role (478 checks).

## 5. A void reopens invoices while unapplied_sen exists

Nothing else moves. A void deletes only that payment's allocations (`src/lib/services/payments.ts:227`) and sets it `voided` (`src/lib/services/payments.ts:230`). The unapplied credit on an online payment stays unapplied, the voided payment's own `unapplied_sen` is untouched, and the reopened invoices show unpaid. The brief ties allocation to approval and says other payments' allocations do not change. Re-allocating automatically would move money without a manager's decision or an audit row, possibly onto invoices the tenant disputes. The cost: there is no "apply credit" action yet, so that credit waits for a manual correction. The void's audit row records `removedAllocations`, so the reopening can be traced.

## 6. Things the AI assistant got wrong (three of them)

I found these by reviewing the assistant's plan with a separate AI chat assistant (that conversation is not part of `ai-logs/`), not by reading the code. Each correction is recorded in `ai-logs/session-1.txt`:

1. It revoked EXECUTE on everything, including the `private.*` helpers the RLS policies call, so every RLS query would have failed. Correction: `ai-logs/session-1.txt:1842`; fix: `supabase/migrations/20261029120300_security.sql:59`, `supabase/migrations/20261029120300_security.sql:66`.
2. Its REVIEW notes cited SPEC.md line numbers instead of per-file ones. Correction: `ai-logs/session-1.txt:1849`.
3. Its review point 7 (webhook lock around `allocate`) contradicted "assume allocate is correct". Correction: `ai-logs/session-1.txt:3222`.

Mistakes caught by tests are in `docs/notes.md`, entries 3 to 7.
