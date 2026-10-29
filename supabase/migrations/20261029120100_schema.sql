-- Tables, constraints and indexes. Row level security, grants and storage are in later migrations.
-- Money is bigint sen, calendar dates are date, instants are timestamptz.

create extension if not exists btree_gist with schema extensions;

-- Helper functions for policies live here. This schema is not in [api] schemas, so PostgREST
-- never exposes them as /rest/v1/rpc endpoints.
create schema if not exists private;

create type public.invoice_kind as enum ('deposit', 'rent');
create type public.payment_method as enum ('cash', 'bank_transfer', 'online');
create type public.payment_status as enum ('pending_verification', 'approved', 'rejected', 'voided');
create type public.bill_status as enum ('pending', 'paid', 'failed');
create type public.member_role as enum ('manager', 'staff');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- Primary key on user_id: a staff member or manager belongs to exactly one organization.
-- user_id has no foreign key to auth.users: Prisma cannot introspect a reference into the auth
-- schema without also pulling in all of Supabase's auth tables. The server resolves users through
-- Supabase Auth, and a membership row of a deleted user grants nothing.
create table public.memberships (
  user_id uuid primary key,
  org_id uuid not null references public.organizations (id),
  role public.member_role not null,
  created_at timestamptz not null default now()
);
create index memberships_org_id_idx on public.memberships (org_id);

-- (id, org_id) is unique so that child tables can use a composite foreign key. That makes it
-- impossible for a row to point at a parent that belongs to another organization.
create table public.units (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id),
  name text not null,
  created_at timestamptz not null default now(),
  unique (org_id, name),
  unique (id, org_id)
);

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id),
  user_id uuid unique, -- auth user of this tenant; null if the tenant has no login. No FK, see memberships.
  full_name text not null,
  email text not null,
  phone text,
  created_at timestamptz not null default now(),
  unique (id, org_id)
);
create index tenants_org_id_idx on public.tenants (org_id);

create table public.leases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id),
  unit_id uuid not null,
  tenant_id uuid not null,
  start_date date not null,
  end_date date not null,
  monthly_rent_sen bigint not null check (monthly_rent_sen > 0),
  deposit_sen bigint not null check (deposit_sen >= 0),
  created_by uuid,
  created_at timestamptz not null default now(),
  check (end_date >= start_date),
  unique (id, org_id),
  foreign key (unit_id, org_id) references public.units (id, org_id),
  foreign key (tenant_id, org_id) references public.tenants (id, org_id),
  -- Two leases on one unit can never share a day (both dates are inclusive). The database
  -- enforces it, so it also holds when two requests arrive at the same moment.
  constraint leases_no_overlap
    exclude using gist (unit_id with =, daterange(start_date, end_date, '[]') with &&)
);
create index leases_tenant_id_idx on public.leases (tenant_id);
create index leases_org_id_idx on public.leases (org_id);

-- amount_sen can be 0: the last, shortened period rounds to 0 sen for tiny rents.
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id),
  lease_id uuid not null,
  kind public.invoice_kind not null,
  period_index integer,
  period_start date,
  period_end date,
  due_date date not null,
  amount_sen bigint not null check (amount_sen >= 0),
  created_at timestamptz not null default now(),
  check (
    (kind = 'deposit' and period_index is null and period_start is null and period_end is null)
    or (
      kind = 'rent' and period_index is not null and period_index >= 0
      and period_start is not null and period_end is not null and period_end >= period_start
    )
  ),
  unique (id, org_id),
  -- NULLS NOT DISTINCT: only deposits have a null period_index (see the check above), so this also
  -- allows at most one deposit per lease. A partial unique index would say the same, but Prisma
  -- cannot introspect a partial unique index on a foreign key column.
  unique nulls not distinct (lease_id, period_index),
  foreign key (lease_id, org_id) references public.leases (id, org_id)
);
create index invoices_lease_due_idx on public.invoices (lease_id, due_date);
create index invoices_org_due_idx on public.invoices (org_id, due_date);

-- The id is unguessable: 'bill_' plus 122 random bits.
create table public.gateway_bills (
  id text primary key default 'bill_' || replace(gen_random_uuid()::text, '-', ''),
  org_id uuid not null references public.organizations (id),
  lease_id uuid not null,
  amount_sen bigint not null check (amount_sen > 0),
  status public.bill_status not null default 'pending',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (lease_id, org_id) references public.leases (id, org_id)
);
create index gateway_bills_lease_idx on public.gateway_bills (lease_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id),
  lease_id uuid not null,
  amount_sen bigint not null check (amount_sen > 0),
  unapplied_sen bigint not null default 0,
  method public.payment_method not null,
  status public.payment_status not null,
  received_at timestamptz not null,
  slip_path text unique,
  -- unique: a bill creates at most one payment, ever.
  gateway_bill_id text unique references public.gateway_bills (id),
  created_by uuid,
  decided_by uuid,
  decided_at timestamptz,
  decision_reason text,
  created_at timestamptz not null default now(),
  check (unapplied_sen >= 0 and unapplied_sen <= amount_sen),
  check (method = 'online' or unapplied_sen = 0),
  check ((method = 'online') = (gateway_bill_id is not null)),
  check (method <> 'bank_transfer' or slip_path is not null),
  check (slip_path is null or starts_with(slip_path, org_id::text || '/')),
  check (decision_reason is null or length(btrim(decision_reason)) >= 5),
  unique (id, org_id),
  foreign key (lease_id, org_id) references public.leases (id, org_id)
);
create index payments_lease_status_idx on public.payments (lease_id, status);
create index payments_org_received_idx on public.payments (org_id, received_at);

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id),
  payment_id uuid not null,
  invoice_id uuid not null,
  amount_sen bigint not null check (amount_sen > 0),
  created_at timestamptz not null default now(),
  unique (payment_id, invoice_id),
  foreign key (payment_id, org_id) references public.payments (id, org_id),
  foreign key (invoice_id, org_id) references public.invoices (id, org_id)
);
create index payment_allocations_invoice_idx on public.payment_allocations (invoice_id);

-- actor_id is null for system actions such as the payment webhook.
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id),
  actor_id uuid,
  action text not null,
  entity_id uuid not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_org_created_idx on public.audit_log (org_id, created_at desc);
