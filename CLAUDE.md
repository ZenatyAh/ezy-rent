@AGENTS.md
# Project rules (read before every task)

Rent collection module for Malaysian property managers. Full brief: `docs/SPEC.md`.
The spec always wins over this file. Names in the spec (tables, columns, paths,
response shapes, file paths) are a contract: use them exactly.

## Priorities (work in this order)
1. `src/lib/billing.ts` (section 3) + unit tests
2. Access control: RLS, grants, storage policies, server checks (section 6)
3. Payments: record, cap, approve/reject/void, allocation, audit_log (section 4)
4. Webhook (section 5)
5. UI (section 9)

## How we work
- Plan first, then code. Small steps. Explain the approach in a few lines before coding.
- After each step, say what changed and why. I must be able to explain every line.
- Never invent requirements. If the spec is ambiguous, stop and ask me.
- After every migration change: `npx supabase db reset` then `npm run seed` must succeed from zero.
- Commit after every working step.

## Database
- Every DB object lives in SQL under `supabase/migrations/` (tables, constraints, RLS,
  grants, functions, triggers, storage bucket + policies). Nothing by hand in Studio.
- Supabase migrations are the source of truth. `prisma/schema.prisma` must match the DB
  (introspect with `prisma db pull`, then `prisma generate`).
- Money = BIGINT sen. Never float/real/double/numeric math in JS with number for money.
- Calendar dates = DATE. Instants = TIMESTAMPTZ.

## Time
- Business timezone: Asia/Kuala_Lumpur (UTC+8, no DST). Server runs in UTC.
- `billing.ts` must not depend on the machine timezone. Do date math on 'YYYY-MM-DD'
  strings / UTC-only Date methods (getUTC*, Date.UTC). Never `new Date('YYYY-MM-DD')` + local getters.
- "Today" = Malaysia date of `now`. Display and input of every date/time in Malaysia time,
  regardless of browser timezone, with no hydration warnings.

## Access control
- Roles come only from `memberships` (manager/staff) and `tenants.user_id` (tenant).
  Never from user_metadata or anything the user can edit.
- Server auth: `supabase.auth.getUser()` or `getClaims()`, never `getSession()`.
  Accept `Authorization: Bearer <token>` as well as the session cookie.
- Prisma connects as DB owner and BYPASSES RLS: every route/action checks org + role itself.
- Other org or other tenant's record -> 404. Visible record, role not allowed -> 403. No login -> 401.
- IDs in request bodies are untrusted: verify unit/tenant/lease belong to the caller's org.
- Data API: anon gets nothing. Only the reads in the spec table, plus tenant updating own phone.
  Every other insert/update/delete/rpc through PostgREST must fail. Revoke defaults explicitly.
- audit_log is append-only for every role, including service role and owner (trigger).
- Secret key never reaches the browser. Never in NEXT_PUBLIC_ vars or client components.

## Payments and concurrency
- Every money-changing operation is one DB transaction.
- Serialize per lease (lock the lease row with SELECT ... FOR UPDATE) before checking the cap,
  approving, voiding or allocating.
- Approve twice at once -> allocated once (status transition guarded inside the lock).
- Lease overlap on a unit must be impossible even under concurrency (DB-level guarantee).

## Webhook
- Verify HMAC exactly as the spec (all fields except x_signature, sorted, key+value, joined by |),
  constant-time compare. Missing/wrong -> 401.
- Lock the bill row in a transaction. A bill creates at most one payment, ever
  (UNIQUE on payments.gateway_bill_id). A paid bill never goes back.
- received_at = paid_at from the callback. Never log the secret or whole payloads.

## Quality
- TypeScript strict, no `any`. `npm run build` and tests pass before each commit.
- Errors as `{ "error": "message" }`.
- Keep README.md, DECISIONS.md and REVIEW.md in mind; note decisions as we go.