-- Data API access control. Deny by default, then grant the minimum from section 6 of the brief.
-- anon gets nothing. authenticated gets SELECT (rows filtered by RLS) plus UPDATE of tenants.phone.
-- Every other insert, update, delete and rpc through PostgREST fails. Server code uses Prisma as the
-- database owner, which bypasses all of this and therefore checks org and role itself.

----------------------------------------------------------------------------------------------
-- Helpers used by the policies. SECURITY DEFINER so they can read memberships/tenants/leases
-- without recursing into those tables' own policies. search_path is empty so nothing can be
-- shadowed. They live in schema private, which PostgREST does not expose, so they cannot be called
-- through /rest/v1/rpc. authenticated needs USAGE on the schema and EXECUTE on each function
-- because RLS evaluates the policies (and these calls) as the requesting role.
----------------------------------------------------------------------------------------------

create function private.staff_org_ids() returns setof uuid
language sql stable security definer set search_path = ''
as $$ select org_id from public.memberships where user_id = (select auth.uid()) $$;

create function private.manager_org_ids() returns setof uuid
language sql stable security definer set search_path = ''
as $$ select org_id from public.memberships where user_id = (select auth.uid()) and role = 'manager' $$;

create function private.my_org_ids() returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select org_id from public.memberships where user_id = (select auth.uid())
  union
  select org_id from public.tenants where user_id = (select auth.uid())
$$;

create function private.my_tenant_ids() returns setof uuid
language sql stable security definer set search_path = ''
as $$ select id from public.tenants where user_id = (select auth.uid()) $$;

create function private.my_lease_ids() returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select l.id from public.leases l
  where l.tenant_id in (select t.id from public.tenants t where t.user_id = (select auth.uid()))
$$;

create function private.my_unit_ids() returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select l.unit_id from public.leases l
  where l.tenant_id in (select t.id from public.tenants t where t.user_id = (select auth.uid()))
$$;

create function private.my_invoice_ids() returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select i.id from public.invoices i
  where i.lease_id in (
    select l.id from public.leases l
    where l.tenant_id in (select t.id from public.tenants t where t.user_id = (select auth.uid()))
  )
$$;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

revoke execute on function
  private.staff_org_ids(), private.manager_org_ids(), private.my_org_ids(), private.my_tenant_ids(),
  private.my_lease_ids(), private.my_unit_ids(), private.my_invoice_ids(),
  private.audit_log_is_append_only()
from public, anon;
grant execute on function
  private.staff_org_ids(), private.manager_org_ids(), private.my_org_ids(), private.my_tenant_ids(),
  private.my_lease_ids(), private.my_unit_ids(), private.my_invoice_ids()
to authenticated;

----------------------------------------------------------------------------------------------
-- Privileges. Revoke everything first (the Supabase defaults grant ALL to anon and authenticated),
-- then grant back only what the brief allows.
----------------------------------------------------------------------------------------------

revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

-- Objects created by later migrations must not be exposed by default either.
alter default privileges in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;

-- With auto_expose_new_tables = false nothing is granted automatically, so service_role needs an
-- explicit grant. It bypasses RLS and is only ever used server-side. audit_log stays append-only
-- for it through the triggers.
grant all on all tables in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;

grant select on
  public.organizations, public.memberships, public.units, public.tenants, public.leases,
  public.invoices, public.payments, public.payment_allocations, public.gateway_bills, public.audit_log
to authenticated;

-- A tenant may change only their own phone number: column-level grant plus a row policy below.
grant update (phone) on public.tenants to authenticated;

----------------------------------------------------------------------------------------------
-- Row level security. Policies apply to authenticated only. anon has no grants and no policies.
----------------------------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.units enable row level security;
alter table public.tenants enable row level security;
alter table public.leases enable row level security;
alter table public.invoices enable row level security;
alter table public.payments enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.gateway_bills enable row level security;
alter table public.audit_log enable row level security;

-- Everyone reads their own organization.
create policy organizations_select on public.organizations
  for select to authenticated
  using (id in (select private.my_org_ids()));

-- Staff and managers read their organization's memberships. Tenants have no membership rows.
create policy memberships_select on public.memberships
  for select to authenticated
  using (org_id in (select private.staff_org_ids()));

create policy units_select on public.units
  for select to authenticated
  using (org_id in (select private.staff_org_ids()) or id in (select private.my_unit_ids()));

create policy tenants_select on public.tenants
  for select to authenticated
  using (org_id in (select private.staff_org_ids()) or user_id = (select auth.uid()));

-- USING matches the read policy, so a staff member who can see a tenant row and tries to update it
-- hits WITH CHECK and gets an error instead of a silent "0 rows updated". Only the tenant's own row
-- passes, and the column grant limits what they can change to phone.
create policy tenants_update_own on public.tenants
  for update to authenticated
  using (org_id in (select private.staff_org_ids()) or user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy leases_select on public.leases
  for select to authenticated
  using (org_id in (select private.staff_org_ids()) or id in (select private.my_lease_ids()));

create policy invoices_select on public.invoices
  for select to authenticated
  using (org_id in (select private.staff_org_ids()) or lease_id in (select private.my_lease_ids()));

create policy payments_select on public.payments
  for select to authenticated
  using (org_id in (select private.staff_org_ids()) or lease_id in (select private.my_lease_ids()));

create policy payment_allocations_select on public.payment_allocations
  for select to authenticated
  using (org_id in (select private.staff_org_ids()) or invoice_id in (select private.my_invoice_ids()));

create policy gateway_bills_select on public.gateway_bills
  for select to authenticated
  using (org_id in (select private.staff_org_ids()) or lease_id in (select private.my_lease_ids()));

-- Only managers read the audit log.
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (org_id in (select private.manager_org_ids()));
