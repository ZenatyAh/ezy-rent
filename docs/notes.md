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
