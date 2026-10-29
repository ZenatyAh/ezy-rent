# Running notes (source for DECISIONS.md Q6: things the AI got wrong)

Format: what the AI got wrong, how it was noticed, where to point in `ai-logs/`.

## 1. Planning session: RLS helper functions would have been unreachable
- **AI error:** In plan section D6 / Phase 2 migration 3 the AI said to `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role` on tables **and functions**, with policies built on `private.*` SECURITY DEFINER helpers. Revoking EXECUTE (and not granting USAGE on schema `private`) from `authenticated` makes every RLS policy evaluation fail with "permission denied", so no query would work.
- **Noticed by:** user review of the plan, before any SQL was written.
- **Fix:** `authenticated` gets `USAGE` on schema `private` and `EXECUTE` on the helpers; `EXECUTE` is revoked from `PUBLIC`/`anon` only. They stay unreachable through `/rest/v1/rpc` because `private` is not in `api.schemas`. A probe test must prove the rpc calls fail.
- **ai-logs pointer:** `ai-logs/` planning session (fill in file + position when exported).

## 2. Planning session: REVIEW.md prep used the wrong line numbers
- **AI error:** Appendix A of the plan cited `L401`, `L458`, ... which are line numbers in `docs/SPEC.md`, not line numbers inside each snippet file. The AI also gave the start lines of snippets 2 and 3 off by one while correcting it.
- **Noticed by:** user review of the plan; the off-by-one by the AI re-reading the SPEC.md listing.
- **Fix:** REVIEW.md uses per-file line numbers counted from 1 (path comment = line 1, convention stated at top of REVIEW.md), recounted against the snippet text in Phase 7.
- **ai-logs pointer:** `ai-logs/` planning session (fill in file + position when exported).

## 3. Phase 1: wrong expected value in the large-rent billing test
- **AI error:** The test "does not overflow or lose precision on very large rents" used a lease starting 2026-06-30 and expected 9e15 x 16 / 31 sen. A lease that starts on the 30th has its next anchor on Jul 30, so the full period is 30 days, not 31 (31 only happens for a day-31 start, as in Aisyah's lease). The AI copied the 16/31 ratio from the worked example without recomputing the anchors.
- **Noticed by:** the test failed on first run (`expected 4800000000000000 to be 4645161290322581`); recomputing showed 9e15 x 16 / 30 = 4.8e15 exactly, so the implementation was right and the expectation was wrong.
- **Fix:** the test now uses 2026-07-31 to 2026-08-15 (16 of 31 days) so it really exercises a non-exact product above 2^53.
- **ai-logs pointer:** Phase 1 session (fill in file + position when exported).

## Decisions recorded at Phase 1 review
- `invoices.amount_sen` CHECK (>= 0) because the brief's last-period formula can round to 0 sen. `payment_allocations.amount_sen` CHECK (> 0), and allocation skips invoices with nothing unpaid, so a 0-sen invoice never gets an allocation row.
- `billing.ts` stays as is (accepts any `YYYY-MM-DD` that round-trips, including year 0000). `POST /api/leases` (Phase 3) rejects dates Postgres cannot store with 400, never 500.

## 4. Phase 2: two schema choices that Prisma introspection could not represent
- **AI error:** The first migration used (a) foreign keys from `memberships.user_id` and `tenants.user_id` to `auth.users`, and (b) a partial unique index `... on invoices (lease_id) where kind = 'deposit'` for "one deposit per lease". The AI had flagged (a) as a risk in the plan but wrote it anyway, and did not think about how Prisma would read (b).
- **Noticed by:** `npm run db:sync` failed twice. (a) `prisma db pull` stopped with P4002 (cross-schema reference to `auth.users`). (b) Prisma turned the partial index into a column-level `@unique` on `invoices.lease_id`, which made `leases -> invoices` a one-to-one relation and failed validation.
- **Fix:** (a) `user_id` columns are plain `uuid` with a comment in the migration (no cascade on user deletion; an orphaned membership grants nothing). (b) `UNIQUE NULLS NOT DISTINCT (lease_id, period_index)`: only deposits have a null period_index (CHECK), so it also allows one deposit per lease, with no partial index.
- **Also learned:** `prisma db pull` re-introspects on top of the existing `schema.prisma`, so a broken model from a failed attempt makes every later pull fail. Recovery: reset the file to just the generator and datasource blocks, then pull again. The Prisma models keep the table names (`leases`, `org_id`, ...) because nothing is hand-edited.
- **ai-logs pointer:** Phase 2 session (fill in file + position when exported).

## 5. Phase 2: first probe version could not tell a denial from a malformed request
- **AI error:** The first Storage matrix printed a bare `HTTP 400 deny` for almost every cell. A wrong request shape (bad path, wrong header) would have produced the same 400 for everyone and looked like a perfect pass.
- **Noticed by:** the AI reviewing its own output before presenting it: the same text in cells that should fail for different reasons (RLS, MIME type, size, no delete policy).
- **Fix:** every denied cell now carries the reason from the Storage error body (`[RLS]`, `[mime type]`, `[size]`, `[access denied]`), and positive controls (staff upload, download, signed URL) must succeed in the same run.
- **ai-logs pointer:** Phase 2 session (fill in file + position when exported).

## Phase 2 design notes
- `tenants_update_own`: USING matches the read policy and WITH CHECK is `user_id = auth.uid()`. A staff member who can see a tenant row gets a 403 on update, not a silent "0 rows updated". A tenant (or another org's manager) targeting a row they cannot see gets 0 rows, which also hides that the row exists.
- `service_role` keeps its table privileges (review decision Q7); `audit_log` is append-only for it through statement- and row-level triggers, which also fire when zero rows match.
- `auto_expose_new_tables = false` is set in `supabase/config.toml`; the migrations also revoke explicitly, and with the setting off, `service_role` needs the explicit grants the security migration gives it.

## 6. Phase 3: integration tests all failed because of an env var name clash
- **AI error:** The test helper read the app URL from `process.env.BASE_URL`. Vitest itself sets `BASE_URL` to `/`, so every request went to `//api/leases` and all 68 tests failed with "Failed to parse URL".
- **Noticed by:** the first run: 68 of 68 failing with the identical `Invalid URL` error pointing at the helper, which ruled out the app.
- **Fix:** the override is now `APP_URL`.
- **ai-logs pointer:** Phase 3 session (fill in file + position when exported).

## 7. Phase 3: production smoke test ran against a stale dev server
- **AI error:** The AI stopped the dev server with TaskStop, which only ends the npm wrapper; the `next dev` node process kept port 3000. `next build` then overwrote `.next`, so the leftover dev server answered the "production" smoke test with 500s on GET.
- **Noticed by:** `npm start` printed `EADDRINUSE` in the same output, so the 500s could not come from the production server. Not blamed on the bundle.
- **Fix:** found the PID that owns the port (Get-NetTCPConnection), stopped it, rebuilt, started the real production server, and repeated the smoke test and the full integration suite (68/68). Rule for later phases: free port 3000 by PID before starting a server, and never `next build` while another server uses `.next`.
- **ai-logs pointer:** Phase 3 session (fill in file + position when exported).

## Phase 3 design notes
- Check order in every handler: authenticate (401) -> load the record through a visibility-scoped finder (404) -> role (403) -> body (400) -> state (409/422). `POST /api/leases` has no record to hide, so it checks role (403) before the body (400), then unit/tenant in the caller's org (404), then overlap (409, from the database exclusion constraint).
- A malformed or nil UUID in a path is 404. In a body it is accepted by the regex if it looks like a uuid and then 404s when no unit/tenant matches; a non-uuid string is 400. ids are matched with a plain hex regex, not `z.uuid()`, so ids like 00000000-... reach the lookup and get 404.
- Dates Postgres cannot store: year 0000 is rejected with 400 before any database call. billing.ts itself is unchanged.
- API instants (`receivedAt`) are written in Malaysia time with a +08:00 offset, e.g. 2026-03-01T00:30:00.000+08:00. The brief only says "ISO 8601 with an offset"; Z would also qualify, so tests that compare parsed instants pass either way.
- Bearer token wins over the cookie; a bad Bearer header is a 401 with no fallback to the cookie.
- The no-role test creates its own auth user and deletes it (`auth.users` is back to 7 afterwards). The seed creates only the brief's data.
- Integration tests leave `lease.created` audit rows (append-only), so run `npx supabase db reset && npm run seed` after `npm run test:int`.

## Phase 4 notes
- **Mutation check (tests can fail):** with `lockLease` turned into a no-op, the 8-way concurrent cap test accepted 7 payments instead of 3, and 6 concurrent approvals returned `[200, 500, 500, 500, 500, 500]` instead of `[200, 409 x5]`: the unique constraint on `payment_allocations (payment_id, invoice_id)` still prevented a double allocation, but as a crash, not a clean 409. The two-request RM 800 / RM 700 test happened to pass without the lock (timing), so the 8-way test is the one that proves the lock. The lock was restored.
- Locking: every money operation (record + cap, approve, reject, void, allocation) is one `$transaction` whose first statement is `select id from leases where id = $1 for update`, then it re-reads the payment status and balances inside the lock.
- Order of checks for payments: visible record (404) -> role (403) -> body (400) -> state (409) -> cap or balance (422). A reject or void with no reason on a payment in the wrong state is a 400, not a 409.
- `receivedAt` must be ISO 8601 with an offset and a real date and time: `new Date()` silently turns 2026-02-30 into Mar 2 and accepts 24:00, so `parseOffsetInstant` checks the parts first.
- Slip cleanup: only deletes a file in the caller's own organization folder that no payment references, so a failing request can never delete another payment's slip. It runs for every failure after authentication (400, 404, 422, a lost race on the same slip).
- A manager-recorded payment writes a `payment.approved` audit row with `auto: true`; a staff-recorded one writes nothing until a manager approves or rejects it.
- Void leaves the voided payment's own `unapplied_sen` and every other payment untouched (review decision Q5).
- Collections: month = `received_at at time zone 'Asia/Kuala_Lumpur'`, range edges are midnight Malaysia time; months are filled with zeros in TypeScript (`monthRange`). Counts only `approved` payments, so pending, rejected and voided ones are excluded.
- Phase 3's Aisyah shape test had to change when seed stage 3 added her payments (it asserted `paidSen: 0`): expected, not a bug.
