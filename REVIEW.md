# Code review: late fees, payment webhook, collections action (Part B)

**Convention.** The pull request has three files, shown in `docs/SPEC.md` (Part B). Line numbers below count from 1
**within each file**; line 1 is the `// app/...` path comment, the first line the brief shows for that file.

- **A** = `app/api/leases/[leaseId]/late-fees/route.ts` (53 lines)
- **B** = `app/api/webhooks/gateway/route.ts` (41 lines)
- **C** = `app/(staff)/dashboard/actions.ts` (15 lines)

Findings are ordered from most to least severe. **Critical**: another user's or organization's data or money is exposed or
changed. **High**: wrong money or wrong state under normal operation. **Medium**: wrong result in a common case, no direct
loss. **Low**: hardening. The rules of the brief apply: Prisma connects as the database owner (so RLS does not protect it),
instants are in Malaysia time, money is integer sen, and every endpoint checks organization and role itself.

---

## Critical

### 1. A: the "manager" role is read from `user_metadata` (lines 12-15)
**What goes wrong.** `user_metadata` is writable by the user. A tenant runs
`supabase.auth.updateUser({ data: { role: 'manager' } })` in the browser console; from then on line 13 passes and they can
charge a 2 % fee on any lease they can name. The check also trusts nothing the database knows about the user.
**Fix.** Keep `getUser()`, then take role and organization from the database: `memberships` for staff and managers
(`tenants.user_id` for tenants). Require role `manager`; use that membership's `orgId` for everything that follows.

### 2. C: a Server Action with no authentication, and `orgId` supplied by the caller (lines 2, 6)
**What goes wrong.** Every export of a `'use server'` file is a POST endpoint, and once a page or component imports it
the action id ships in the client bundle for anyone to read. Nothing checks who is calling, and the organization comes from
an argument. A signed-out
visitor, or a tenant of another company, calls `getCollections('<any org uuid>', '2026-01-01', '2026-12-01')` and receives
that company's monthly takings. A hidden dashboard page is not a check.
**Fix.** Drop the `orgId` parameter. Inside the action, authenticate, look up role and organization in the database, require
staff or manager, and query with the caller's own `orgId`. Validate `from` and `to` (finding 14).

### 3. A: the lease is looked up by id alone (lines 18-22)
**What goes wrong.** `findUnique({ where: { id: leaseId } })` ignores the caller's organization, and Prisma bypasses RLS. A
real manager of company B posts to `/api/leases/<company A lease id>/late-fees`: fees are created on company A's tenants. The
200 versus 404 answer also tells B which lease ids exist in A.
**Fix.** After resolving the caller (finding 1), look the lease up with `findFirst({ where: { id: leaseId, orgId: actor.orgId } })`
and answer 404 when it is not found, so another organization's lease looks the same as a missing one.

### 4. B: the expected signature and the whole payload are logged (line 16)
**What goes wrong.** On a bad signature the handler writes `{ fields, expected }` to the log. `expected` is the *correct*
HMAC for exactly the body that was sent. Anyone who can read the logs (a log vendor, support staff) can send a crafted body,
read the valid signature for it from the log, and replay the body with that signature: a forged `paid=true` for any bill.
The brief also forbids logging whole callback payloads, which hold payment data.
**Fix.** Log nothing from the body and never the expected value; at most the reason (`invalid signature`) and the request
time. The secret and the computed signature never leave the function.

---

## High

### 5. B: a repeated callback can create two payments (lines 21-23, 25-39)
**What goes wrong.** The bill is read outside the transaction and not locked. Two deliveries of the same `paid=true`
callback 5 ms apart both read `pending` (line 23 only protects against deliveries that arrive *after* the first commit),
and both run the transaction: two approved payments for one bill, collections and allocations counted twice. If
`payments.gateway_bill_id` is unique, the loser instead fails with an unhandled error and the gateway sees a 500. I measured
the effect in my own implementation with the lock and the unique constraint removed: 10 simultaneous identical callbacks
created 4 to 10 payments.
**Fix.** Do the lookup inside the transaction with `SELECT ... FOR UPDATE` on the bill row and re-check the status after
the lock; keep `UNIQUE (payments.gateway_bill_id)` as the structural guarantee; treat a unique violation as a repeat
delivery (200).

### 6. B: `paid_amount` is never compared with the bill amount (lines 21-26, 33)
**What goes wrong.** Callbacks are signed, so this is not about forgery: it is about a *validly signed* callback whose amount
differs from the bill (the customer paid part of it, or the gateway has a bug). For a RM 2,000.00 bill, a callback with
`paid_amount=10000` (RM 100.00) marks the bill `paid` and records RM 100.00 as an approved payment. The tenant now sees a
paid bill, a repeat delivery is ignored by line 23, and the missing RM 1,900.00 is never collected through it. A larger
amount creates a surplus nobody asked for. A non-numeric value makes `BigInt(...)` throw a `SyntaxError` and answers 500.
**Fix.** Validate that `paid_amount` is a whole number of sen, compare it as an integer with `bill.amountSen` inside the
locked transaction, and answer 422 without changing anything when they differ.

### 7. A: not idempotent and not atomic (lines 27-46)
**What goes wrong.** Nothing records that an invoice already has a late fee. The manager presses the button twice (or a client
retries after a timeout, or two requests overlap): every overdue invoice gets a second fee, then a third. The creates are
separate statements under `Promise.all`, not one transaction, so if one fails (see findings 11 and 13) the earlier ones are
already committed and the retry duplicates them.
**Fix.** One `prisma.$transaction`; lock the lease row (`FOR UPDATE`); skip any invoice that already has a fee, backed by a
unique key on (source invoice, fee type); insert with `createMany`.

### 8. C: months are cut in the database's timezone (lines 8, 11)
**What goes wrong.** `date_trunc('month', received_at)` and `received_at >= $from::date` use the database session timezone
(UTC). A payment received `2026-03-01 00:30` Malaysia time is `2026-02-28 16:30` UTC, so it is reported in February; a
report for March alone (`from = 2026-03-01`) leaves it out completely, because the range edges are 8 hours off.
**Fix.** Bucket with `date_trunc('month', received_at AT TIME ZONE 'Asia/Kuala_Lumpur')` and compare against
`(from::date)::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur'` (and the same for the end of the range).

---

## Medium

### 9. B: `received_at` is the time the callback arrived, not `paid_at` (line 34)
**What goes wrong.** After a gateway outage the retry arrives hours later. A customer who paid at 23:50 on 31 March in
Malaysia and whose callback is retried at 00:10 on 1 April is recorded as an April payment: the March collections report is
short and April's is overstated. The brief says `received_at` is `paid_at`.
**Fix.** Parse `paid_at` explicitly (`2026-04-01 00:30:12 +0800` is not ISO 8601: a space and an offset without a colon) into
an instant and store that.

### 10. B: `paid=false` never reaches the bill, and unknown bills get 200 (line 19)
**What goes wrong.** Any callback whose `paid` is not exactly `'true'` returns 200 before the bill is looked up. A failed
payment never turns its bill `failed`, so it stays `pending` for ever; a callback for a bill id that does not exist is
answered 200 instead of 404; a `paid` value of `True` or a missing field is silently treated as a failure.
**Fix.** Look the bill up first (404 when unknown), then apply the table of the brief: `paid=false` on a `pending` bill sets
`failed`, on any other bill does nothing; reject a `paid` that is neither `true` nor `false` with 400.

### 11. A: every fee gets the same `reference`, and the numbering is unsafe (lines 41, 46, 50-53)
**What goes wrong.** Prisma queries are lazy: the `create(...)` calls on line 34 do not run until `Promise.all` on line 46,
while `await nextReference(...)` on line 41 runs immediately inside the loop. All N calls read the same "last" invoice, so N
fees get the same `INV-n`. Two requests at once do the same read-then-write. `parseInt(last.reference.slice(4), 10)` returns
`NaN` (`INV-NaN`) when the newest invoice has another format, and `createdAt` order is not the highest number. If `reference`
is unique, the second create fails after the first has already been saved.
**Fix.** Allocate numbers from a database sequence (or a per-organization counter row locked inside the transaction) and
create the fees one after another in that transaction.

### 12. A: money is handled as floating point, with an invented tolerance (lines 31-32)
**What goes wrong.** `Number(paid) / Number(invoice.amountSen) >= 0.995` treats an invoice as paid when up to 0.5 % is
missing: RM 9.99 unpaid on a RM 2,000.00 invoice (ratio 0.995005) earns no fee although it is more than 7 days overdue, and
the rule is not in the comment or the brief. A 0-sen invoice divides by zero, `NaN >= 0.995` is false, and a 0-sen fee is
created. Line 32 rounds with `Math.round` on a float.
**Fix.** Stay in integer sen: skip an invoice when `unpaid <= 0n`, and compute the fee as `(unpaid * 2n + 50n) / 100n`
(2 %, rounded half up).

### 13. A: `kind: 'late_fee'` is not an invoice kind of the system (line 38)
**What goes wrong.** The brief's invoices are `deposit` or `rent` (`InvoiceKind`, the `kind` in
`GET /api/leases/:leaseId`). A `late_fee` row is rejected by an enum-typed column (500, nothing created) or, if accepted,
reaches clients that only know two kinds and have `null` period fields to display; schedule and status code that branch on
`kind` handle it wrongly.
**Fix.** Decide the model on purpose: either extend the documented kinds (API, types, status rules) or keep fees in their
own table, linked to the invoice they penalize.

### 14. C: no zero months, no input validation (lines 7-14)
**What goes wrong.** The brief wants one entry per month in the range, including months with nothing collected; the query
only returns months that have payments, so the dashboard has gaps. `from` and `to` are passed straight into `::date` casts:
`'abc'` raises a database error (an unhandled 500), and a `to` that is not the first of a month silently changes the end of
the range.
**Fix.** Validate `YYYY-MM`, build the list of months in code (or with `generate_series`) and fill the missing ones with 0.

---

## Low

### 15. B: non-constant-time comparison, and a non-null assertion on the secret (lines 14-15)
**What goes wrong.** `expected !== fields.x_signature` stops at the first differing character, a small timing side channel on
the one value that authenticates the gateway; it is hard to exploit over a network and trivial to avoid. The `!` on
`process.env.GATEWAY_X_SIGNATURE_KEY` hides a missing variable: `createHmac` then throws a `TypeError` and every callback is
answered 500 with no clear message.
**Fix.** Compare equal-length buffers with `crypto.timingSafeEqual` (reject a missing or wrongly sized signature first); read
the key through a helper that fails with a clear configuration error.

### 16. A: a signed-out request is answered 403 instead of 401 (lines 13-15)
**What goes wrong.** With no session `user` is `null`, `user?.user_metadata.role` is `undefined`, and the code returns 403. The
brief wants 401 for "no valid login", 403 only for a signed-in user whose role is not allowed.
**Fix.** `if (!user) return 401` before the role check.

---

## Looks suspicious, but is correct

- **B lines 9-14, the signature source.** Filtering out `x_signature`, sorting the keys, writing `key + value` and joining with
  `|` before the HMAC is exactly the algorithm in the brief, and it does not depend on the order the fields arrive in.
- **A lines 24-25 and 29, the grace period.** Today in Malaysia is `now + 8 h` read as a UTC date; `Date.parse('YYYY-MM-DD')`
  is UTC midnight and a DATE column comes back as UTC midnight too, so `dueDate >= cutoff` is a plain date comparison that
  does not depend on the server timezone. It skips an invoice due exactly 7 days ago and charges one due 8 days ago, which is
  "more than 7 days after the due date".
- **C lines 7-13, the SQL.** The values are interpolated into a tagged template, so Prisma sends them as bound parameters:
  there is no SQL injection. The weaknesses are authorization (finding 2) and timezone (finding 8).
- **B lines 25-39, the transaction.** Updating the bill and creating the payment in one transaction is right (a failure in
  `create` rolls back the status change). It is missing the lock and the amount check (findings 5 and 6), not atomicity.
- **A line 10 and 17, `params` as a Promise.** Correct for the Next.js version in use.
