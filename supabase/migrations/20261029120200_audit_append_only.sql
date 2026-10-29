-- audit_log is append-only for every role, including the service role and the table owner.
-- Triggers fire for all of them, unlike privileges, which the owner bypasses.
-- The statement-level triggers fire even when the statement matches zero rows, so an UPDATE or
-- DELETE always fails instead of silently doing nothing.

create function private.audit_log_is_append_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only: % is not allowed', tg_op
    using errcode = '42501';
end;
$$;

create trigger audit_log_no_update_statement
  before update or delete on public.audit_log
  for each statement execute function private.audit_log_is_append_only();

create trigger audit_log_no_update_row
  before update or delete on public.audit_log
  for each row execute function private.audit_log_is_append_only();

create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function private.audit_log_is_append_only();
