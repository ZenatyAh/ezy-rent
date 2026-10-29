// Probes the Supabase Data API (PostgREST) and Storage exactly as an outside caller would: plain
// fetch with the publishable key and each seeded user's access token. Prints role x table x action
// matrices and exits 1 if any cell differs from what the brief allows.
//
//   npm run probe                       against seeded data
//   npm run probe -- --with-fixtures    on an empty-lease database (Phase 2 only): inserts leases,
//                                       invoices, payments, bills and audit rows first, so tenant
//                                       isolation can be tested. Run db reset + seed afterwards.
//
// Expected row counts are computed from the database itself (as owner), not hard-coded.
import { randomUUID } from 'node:crypto'
import { generateSchedule } from '@/lib/billing'
import { prisma } from '@/lib/prisma'

const BASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ''
const SECRET = process.env.SUPABASE_SECRET_KEY ?? ''
const PASSWORD = 'Northwind#2026'
const WITH_FIXTURES = process.argv.includes('--with-fixtures')

const TABLES = [
  'organizations',
  'memberships',
  'units',
  'tenants',
  'leases',
  'invoices',
  'payments',
  'payment_allocations',
  'gateway_bills',
  'audit_log',
] as const
type Table = (typeof TABLES)[number]

interface Principal {
  name: string
  kind: 'anon' | 'tenant' | 'staff' | 'manager' | 'service'
  token?: string
  orgId?: string
  tenantId?: string
}

interface Result {
  status: number
  code: string | null
  count: number | null
  rows: unknown[] | null
  text: string
}

let checks = 0
const failures: string[] = []
function expect(ok: boolean, what: string): boolean {
  checks++
  if (!ok) failures.push(what)
  return ok
}

async function sql<T>(query: string): Promise<T[]> {
  return (await prisma.$queryRawUnsafe(query)) as T[]
}
const n = (value: unknown): number => Number(value)

async function login(email: string): Promise<string> {
  const res = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: PUB, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  const json = (await res.json()) as { access_token?: string }
  if (!res.ok || !json.access_token) throw new Error(`Login failed for ${email} (${res.status}). Did you run npm run seed?`)
  return json.access_token
}

async function call(
  p: Principal,
  method: string,
  path: string,
  body?: unknown,
  extra: Record<string, string> = {},
): Promise<Result> {
  const headers: Record<string, string> = {
    apikey: p.kind === 'service' ? SECRET : PUB,
    'Content-Type': 'application/json',
    ...extra,
  }
  if (p.token) headers.Authorization = `Bearer ${p.token}`
  const res = await fetch(`${BASE}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json: unknown = null
  try {
    json = JSON.parse(text)
  } catch {
    // not JSON
  }
  const range = res.headers.get('content-range')
  const total = range?.includes('/') ? Number(range.split('/')[1]) : NaN
  const code =
    json && typeof json === 'object' && !Array.isArray(json) && 'code' in json
      ? String((json as { code: unknown }).code)
      : null
  return {
    status: res.status,
    code,
    count: Number.isFinite(total) ? total : null,
    rows: Array.isArray(json) ? json : null,
    text,
  }
}

const isDeny = (r: Result): boolean => (r.status === 401 || r.status === 403) && r.code === '42501'

// ---- matrix printing ---------------------------------------------------------------------

const cells = new Map<string, string>()
function put(row: string, col: string, ok: boolean, text: string, what: string): void {
  expect(ok, `${what} [${row} / ${col}]: ${text}`)
  cells.set(`${row}|${col}`, ok ? text : `!! ${text}`)
}
function printMatrix(title: string, rows: string[], cols: string[]): void {
  const w0 = Math.max(...rows.map((r) => r.length), 6)
  const ws = cols.map((c) => Math.max(c.length, ...rows.map((r) => (cells.get(`${r}|${c}`) ?? '').length)))
  const line = (parts: string[]) => parts.map((s, i) => s.padEnd(i === 0 ? w0 : ws[i - 1])).join(' | ')
  console.log(`\n${title}`)
  console.log(line(['', ...cols]))
  console.log(['-'.repeat(w0), ...ws.map((w) => '-'.repeat(w))].join('-+-'))
  for (const r of rows) console.log(line([r, ...cols.map((c) => cells.get(`${r}|${c}`) ?? '')]))
  cells.clear()
}

// ---- facts and fixtures --------------------------------------------------------------------

interface Ids {
  orgN: string
  orgB: string
  unitFree: string
  unitAisyah: string
  unitBen: string
  unitChen: string
  tenant: Record<'aisyah' | 'ben' | 'chen', string>
  membershipUser: string
  lease: string
  invoice: string
  payment: string
  allocation: string
  bill: string
  audit: string
}

async function ensureFixtures(): Promise<void> {
  const existing = n((await sql<{ n: bigint }>('select count(*) n from leases'))[0].n)
  if (existing > 0) return
  if (!WITH_FIXTURES) throw new Error('No leases in the database. Seed it, or run: npm run probe -- --with-fixtures')

  const org = async (name: string) => (await sql<{ id: string }>(`select id from organizations where name = '${name}'`))[0].id
  const tenant = async (email: string) =>
    (await sql<{ id: string; org_id: string }>(`select id, org_id from tenants where email = '${email}'`))[0]
  const unit = async (name: string) => (await sql<{ id: string }>(`select id from units where name = '${name}'`))[0].id

  const plan = [
    { t: await tenant('aisyah@northwind.test'), unit: await unit('A-12-3'), start: '2026-01-31', end: '2026-07-15', rent: 150000, dep: 300000 },
    { t: await tenant('ben@northwind.test'), unit: await unit('B-05-1'), start: '2026-01-01', end: '2026-04-15', rent: 100029, dep: 0 },
    { t: await tenant('chen@beta.test'), unit: await unit('KL-1'), start: '2026-03-15', end: '2027-03-14', rent: 220000, dep: 440000 },
  ]
  const leaseIds: string[] = []
  for (const p of plan) {
    const leaseId = randomUUID()
    leaseIds.push(leaseId)
    await prisma.$executeRaw`insert into leases (id, org_id, unit_id, tenant_id, start_date, end_date, monthly_rent_sen, deposit_sen)
      values (${leaseId}::uuid, ${p.t.org_id}::uuid, ${p.unit}::uuid, ${p.t.id}::uuid, ${p.start}::date, ${p.end}::date, ${BigInt(p.rent)}, ${BigInt(p.dep)})`
    for (const inv of generateSchedule({ startDate: p.start, endDate: p.end, monthlyRentSen: p.rent, depositSen: p.dep })) {
      await prisma.$executeRaw`insert into invoices (id, org_id, lease_id, kind, period_index, period_start, period_end, due_date, amount_sen)
        values (${randomUUID()}::uuid, ${p.t.org_id}::uuid, ${leaseId}::uuid, ${inv.kind}::invoice_kind, ${inv.periodIndex}, ${inv.periodStart}::date, ${inv.periodEnd}::date, ${inv.dueDate}::date, ${BigInt(inv.amountSen)})`
    }
  }
  const orgN = await org('Northwind Properties')
  const orgB = await org('Beta Realty')
  // Aisyah: one approved cash payment, allocated to her deposit. Ben: one pending cash payment.
  const payId = randomUUID()
  await prisma.$executeRaw`insert into payments (id, org_id, lease_id, amount_sen, method, status, received_at)
    values (${payId}::uuid, ${orgN}::uuid, ${leaseIds[0]}::uuid, 300000, 'cash', 'approved', '2026-01-31T02:00:00Z'::timestamptz)`
  const dep = (await sql<{ id: string }>(`select id from invoices where lease_id = '${leaseIds[0]}' and kind = 'deposit'`))[0].id
  await prisma.$executeRaw`insert into payment_allocations (org_id, payment_id, invoice_id, amount_sen)
    values (${orgN}::uuid, ${payId}::uuid, ${dep}::uuid, 300000)`
  await prisma.$executeRaw`insert into payments (org_id, lease_id, amount_sen, method, status, received_at)
    values (${orgN}::uuid, ${leaseIds[1]}::uuid, 10000, 'cash', 'pending_verification', '2026-02-01T02:00:00Z'::timestamptz)`
  await prisma.$executeRaw`insert into gateway_bills (org_id, lease_id, amount_sen) values (${orgN}::uuid, ${leaseIds[0]}::uuid, 150000)`
  await prisma.$executeRaw`insert into gateway_bills (org_id, lease_id, amount_sen) values (${orgB}::uuid, ${leaseIds[2]}::uuid, 100000)`
  await prisma.$executeRaw`insert into audit_log (org_id, action, entity_id) values (${orgN}::uuid, 'lease.created', ${leaseIds[0]}::uuid)`
  await prisma.$executeRaw`insert into audit_log (org_id, action, entity_id) values (${orgB}::uuid, 'lease.created', ${leaseIds[2]}::uuid)`
  console.log('Inserted fixtures (3 leases + invoices, 2 payments, 1 allocation, 2 bills, 2 audit rows).')
}

async function loadIds(): Promise<Ids> {
  const one = async (q: string) => {
    const rows = await sql<{ id: string }>(q)
    if (!rows[0]) throw new Error(`Missing seed data for: ${q}`)
    return rows[0].id
  }
  const orgN = await one(`select id from organizations where name = 'Northwind Properties'`)
  const orgB = await one(`select id from organizations where name = 'Beta Realty'`)
  const tenant = async (email: string) => one(`select id from tenants where email = '${email}'`)
  const aisyah = await tenant('aisyah@northwind.test')
  return {
    orgN,
    orgB,
    unitFree: await one(`select id from units where name = 'D-03-2'`),
    unitAisyah: await one(`select id from units where name = 'A-12-3'`),
    unitBen: await one(`select id from units where name = 'B-05-1'`),
    unitChen: await one(`select id from units where name = 'KL-1'`),
    tenant: { aisyah, ben: await tenant('ben@northwind.test'), chen: await tenant('chen@beta.test') },
    membershipUser: await one(`select user_id as id from memberships where org_id = '${orgN}' and role = 'manager'`),
    lease: await one(`select id from leases where tenant_id = '${aisyah}'`),
    invoice: await one(`select i.id from invoices i join leases l on l.id = i.lease_id where l.tenant_id = '${aisyah}' order by i.due_date limit 1`),
    payment: await one(`select p.id from payments p join leases l on l.id = p.lease_id where l.tenant_id = '${aisyah}' limit 1`),
    allocation: await one(`select a.id from payment_allocations a join payments p on p.id = a.payment_id join leases l on l.id = p.lease_id where l.tenant_id = '${aisyah}' limit 1`),
    bill: await one(`select b.id from gateway_bills b join leases l on l.id = b.lease_id where l.tenant_id = '${aisyah}' limit 1`),
    audit: await one(`select id from audit_log where org_id = '${orgN}' limit 1`),
  }
}

async function expectedCount(table: Table, p: Principal): Promise<number> {
  const count = async (q: string) => n((await sql<{ n: bigint }>(q))[0].n)
  if (p.kind === 'staff' || p.kind === 'manager') {
    if (table === 'organizations') return 1
    if (table === 'audit_log' && p.kind === 'staff') return 0
    return count(`select count(*) n from ${table} where org_id = '${p.orgId}'`)
  }
  const t = p.tenantId
  const byTenant: Record<Table, string> = {
    organizations: `select count(*) n from organizations where id = '${p.orgId}'`,
    memberships: `select 0 n`,
    units: `select count(distinct unit_id) n from leases where tenant_id = '${t}'`,
    tenants: `select count(*) n from tenants where id = '${t}'`,
    leases: `select count(*) n from leases where tenant_id = '${t}'`,
    invoices: `select count(*) n from invoices i join leases l on l.id = i.lease_id where l.tenant_id = '${t}'`,
    payments: `select count(*) n from payments x join leases l on l.id = x.lease_id where l.tenant_id = '${t}'`,
    payment_allocations: `select count(*) n from payment_allocations a join invoices i on i.id = a.invoice_id join leases l on l.id = i.lease_id where l.tenant_id = '${t}'`,
    gateway_bills: `select count(*) n from gateway_bills b join leases l on l.id = b.lease_id where l.tenant_id = '${t}'`,
    audit_log: `select 0 n`,
  }
  return count(byTenant[table])
}

// ---- Data API ----------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!BASE || !PUB || !SECRET) throw new Error('Missing Supabase env vars (run through npm run probe)')
  await ensureFixtures()
  const ids = await loadIds()

  const member = async (email: string) =>
    (await sql<{ org_id: string; role: 'manager' | 'staff' }>(
      `select m.org_id, m.role from memberships m join auth.users u on u.id = m.user_id where u.email = '${email}'`,
    ))[0]
  const tenantRow = async (email: string) =>
    (await sql<{ id: string; org_id: string }>(`select id, org_id from tenants where email = '${email}'`))[0]
  const [mn, sn, mb, ta, tb, tc] = await Promise.all([
    member('manager@northwind.test'),
    member('staff@northwind.test'),
    member('manager@beta.test'),
    tenantRow('aisyah@northwind.test'),
    tenantRow('ben@northwind.test'),
    tenantRow('chen@beta.test'),
  ])
  const principals: Principal[] = [
    { name: 'anon', kind: 'anon' },
    { name: 'aisyah(tenant N)', kind: 'tenant', token: await login('aisyah@northwind.test'), orgId: ta.org_id, tenantId: ta.id },
    { name: 'ben(tenant N)', kind: 'tenant', token: await login('ben@northwind.test'), orgId: tb.org_id, tenantId: tb.id },
    { name: 'chen(tenant B)', kind: 'tenant', token: await login('chen@beta.test'), orgId: tc.org_id, tenantId: tc.id },
    { name: 'staff N', kind: 'staff', token: await login('staff@northwind.test'), orgId: sn.org_id },
    { name: 'manager N', kind: 'manager', token: await login('manager@northwind.test'), orgId: mn.org_id },
    { name: 'manager B', kind: 'manager', token: await login('manager@beta.test'), orgId: mb.org_id },
  ]
  const cols = principals.map((p) => p.name)
  const service: Principal = { name: 'service_role', kind: 'service' }

  const countsBefore = await tableCounts()

  // 1. SELECT: rows visible per role, compared with the ground truth computed from the database.
  for (const t of TABLES) {
    for (const p of principals) {
      const r = await call(p, 'GET', `${t}?select=*&limit=1`, undefined, { Prefer: 'count=exact' })
      if (p.kind === 'anon') {
        put(t, p.name, isDeny(r), isDeny(r) ? 'deny' : `HTTP ${r.status}`, 'SELECT must be denied')
      } else {
        const want = await expectedCount(t, p)
        const ok = (r.status === 200 || r.status === 206) && r.count === want
        put(t, p.name, ok, ok ? String(r.count) : `got ${r.status}/${r.count} want ${want}`, 'SELECT row count')
      }
    }
  }
  printMatrix('SELECT: rows visible (number) or deny. Counts are checked against the database.', [...TABLES], cols)

  // 2-4. INSERT / UPDATE / DELETE must fail for every role on every table.
  const insertBody: Record<Table, unknown> = {
    organizations: { name: 'probe' },
    memberships: { user_id: randomUUID(), org_id: ids.orgN, role: 'manager' },
    units: { org_id: ids.orgN, name: `probe-${randomUUID().slice(0, 8)}` },
    tenants: { org_id: ids.orgN, full_name: 'Probe', email: 'probe-insert@x.test' },
    leases: { org_id: ids.orgN, unit_id: ids.unitFree, tenant_id: ids.tenant.aisyah, start_date: '2030-01-01', end_date: '2030-12-31', monthly_rent_sen: 1000, deposit_sen: 0 },
    invoices: { org_id: ids.orgN, lease_id: ids.lease, kind: 'rent', period_index: 99, period_start: '2030-01-01', period_end: '2030-01-31', due_date: '2030-01-01', amount_sen: 1 },
    payments: { org_id: ids.orgN, lease_id: ids.lease, amount_sen: 1, method: 'cash', status: 'approved', received_at: '2026-01-01T00:00:00Z' },
    payment_allocations: { org_id: ids.orgN, payment_id: ids.payment, invoice_id: ids.invoice, amount_sen: 1 },
    gateway_bills: { org_id: ids.orgN, lease_id: ids.lease, amount_sen: 1 },
    audit_log: { org_id: ids.orgN, action: 'probe', entity_id: randomUUID() },
  }
  const target: Record<Table, { filter: string; patch: unknown }> = {
    organizations: { filter: `id=eq.${ids.orgN}`, patch: { name: 'hacked' } },
    memberships: { filter: `user_id=eq.${ids.membershipUser}`, patch: { role: 'staff' } },
    units: { filter: `id=eq.${ids.unitAisyah}`, patch: { name: 'hacked' } },
    tenants: { filter: `id=eq.${ids.tenant.ben}`, patch: { full_name: 'hacked' } },
    leases: { filter: `id=eq.${ids.lease}`, patch: { monthly_rent_sen: 1 } },
    invoices: { filter: `id=eq.${ids.invoice}`, patch: { amount_sen: 1 } },
    payments: { filter: `id=eq.${ids.payment}`, patch: { status: 'voided' } },
    payment_allocations: { filter: `id=eq.${ids.allocation}`, patch: { amount_sen: 1 } },
    gateway_bills: { filter: `id=eq.${ids.bill}`, patch: { status: 'paid' } },
    audit_log: { filter: `id=eq.${ids.audit}`, patch: { action: 'hacked' } },
  }
  const verbs: Array<[string, (t: Table, p: Principal) => Promise<Result>]> = [
    ['INSERT', (t, p) => call(p, 'POST', t, insertBody[t], { Prefer: 'return=minimal' })],
    ['UPDATE', (t, p) => call(p, 'PATCH', `${t}?${target[t].filter}`, target[t].patch, { Prefer: 'return=representation' })],
    ['DELETE', (t, p) => call(p, 'DELETE', `${t}?${target[t].filter}`, undefined, { Prefer: 'return=representation' })],
  ]
  for (const [verb, run] of verbs) {
    for (const t of TABLES) {
      for (const p of principals) {
        const r = await run(t, p)
        put(t, p.name, isDeny(r), isDeny(r) ? 'deny' : `HTTP ${r.status}`, `${verb} must be denied`)
      }
    }
    printMatrix(`${verb}: every role on every table must be denied (42501)`, [...TABLES], cols)
  }

  // 5. tenants: the one allowed write is a tenant changing their own phone number.
  const rowOf = (p: Principal, other: boolean): string => {
    if (p.kind === 'tenant') return other ? (p.tenantId === ids.tenant.aisyah ? ids.tenant.ben : ids.tenant.aisyah) : (p.tenantId ?? '')
    return other ? ids.tenant.ben : ids.tenant.aisyah
  }
  const phoneRows: Array<{ label: string; col: string; other: boolean; want: (p: Principal) => 'deny' | '1 row' | '0 rows' }> = [
    { label: 'phone, own tenant row', col: 'phone', other: false, want: (p) => (p.kind === 'tenant' ? '1 row' : p.name === 'manager B' ? '0 rows' : 'deny') },
    { label: 'phone, a different tenant row', col: 'phone', other: true, want: (p) => (p.kind === 'tenant' || p.name === 'manager B' ? '0 rows' : 'deny') },
    { label: 'full_name, own/any row', col: 'full_name', other: false, want: () => 'deny' },
    { label: 'email, own/any row', col: 'email', other: false, want: () => 'deny' },
    { label: 'user_id, own/any row', col: 'user_id', other: false, want: () => 'deny' },
    { label: 'org_id, own/any row', col: 'org_id', other: false, want: () => 'deny' },
  ]
  for (const row of phoneRows) {
    for (const p of principals) {
      const value = row.col === 'user_id' || row.col === 'org_id' ? randomUUID() : 'probe-value'
      const r = await call(p, 'PATCH', `tenants?id=eq.${rowOf(p, row.other)}`, { [row.col]: value }, { Prefer: 'return=representation' })
      const want = row.want(p)
      const got = isDeny(r) ? 'deny' : r.status === 200 && r.rows ? `${r.rows.length} row${r.rows.length === 1 ? '' : 's'}` : `HTTP ${r.status}`
      put(row.label, p.name, got === want, got, 'tenants column update')
    }
  }
  printMatrix('UPDATE tenants by column: only a tenant changing their own phone may succeed (1 row)', phoneRows.map((r) => r.label), cols)
  await sql(`update tenants set phone = null where email like '%@%'`)

  // 6. RPC: no function is callable through PostgREST by anyone.
  const fns = (await sql<{ proname: string }>(
    `select p.proname from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname in ('public', 'private') order by 1`,
  )).map((f) => f.proname)
  for (const fn of [...fns, 'no_such_function']) {
    for (const p of [...principals, service]) {
      const r = await call(p, 'POST', `rpc/${fn}`, {})
      put(`rpc/${fn}`, p.name, r.status >= 400, `HTTP ${r.status}`, 'rpc must fail')
    }
  }
  for (const schema of ['private', 'public']) {
    for (const p of [...principals, service]) {
      const r = await call(p, 'POST', 'rpc/staff_org_ids', {}, { 'Content-Profile': schema, 'Accept-Profile': schema })
      put(`rpc/staff_org_ids (profile ${schema})`, p.name, r.status >= 400, `HTTP ${r.status}`, 'rpc via schema profile must fail')
    }
  }
  printMatrix(
    'RPC: POST /rest/v1/rpc/<function>. HTTP status shown; any 4xx is a pass.',
    [...fns, 'no_such_function'].map((f) => `rpc/${f}`).concat(['private', 'public'].map((s) => `rpc/staff_org_ids (profile ${s})`)),
    [...cols, service.name],
  )

  // 7. audit_log is append-only for everyone, including service_role and the table owner.
  const auditRows: Array<[string, boolean, string]> = []
  const randomId = randomUUID()
  for (const [label, method, filter] of [
    ['service_role PATCH existing row', 'PATCH', `id=eq.${ids.audit}`],
    ['service_role PATCH no matching row', 'PATCH', `id=eq.${randomId}`],
    ['service_role DELETE existing row', 'DELETE', `id=eq.${ids.audit}`],
    ['service_role DELETE no matching row', 'DELETE', `id=eq.${randomId}`],
  ] as const) {
    const r = await call(service, method, `audit_log?${filter}`, method === 'PATCH' ? { action: 'hacked' } : undefined)
    const blocked = r.status >= 400 && r.text.includes('append-only')
    auditRows.push([label, blocked, blocked ? `blocked (HTTP ${r.status})` : `NOT BLOCKED HTTP ${r.status}`])
  }
  for (const [label, statement] of [
    ['owner (postgres) UPDATE', `update audit_log set action = action`],
    ['owner (postgres) DELETE', `delete from audit_log`],
    ['owner (postgres) TRUNCATE', `truncate audit_log`],
  ] as const) {
    let message = 'NOT BLOCKED'
    try {
      await prisma.$executeRawUnsafe(statement)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    const blocked = message.includes('append-only')
    auditRows.push([label, blocked, blocked ? 'blocked (append-only trigger)' : message.slice(0, 80)])
  }
  console.log('\nAPPEND-ONLY audit_log: attempts by roles that DO hold table privileges')
  for (const [label, ok, text] of auditRows) {
    expect(ok, `audit_log append-only: ${label}: ${text}`)
    console.log(`  ${label.padEnd(40)} ${ok ? text : '!! ' + text}`)
  }

  // 8. Nothing written, and the API surface exposes no tables to anon.
  const countsAfter = await tableCounts()
  const unchanged = TABLES.every((t) => countsBefore[t] === countsAfter[t])
  expect(unchanged, `row counts changed during the probe: ${JSON.stringify(countsBefore)} -> ${JSON.stringify(countsAfter)}`)
  console.log(`\nRow counts identical before and after all write attempts: ${unchanged ? 'yes' : '!! NO'}`)

  const openapi = await fetch(`${BASE}/rest/v1/`, { headers: { apikey: PUB } })
  const spec = (await openapi.json()) as { paths?: Record<string, unknown> }
  const paths = Object.keys(spec.paths ?? {})
  expect(paths.every((p) => p === '/'), `anon OpenAPI lists paths: ${paths.join(', ')}`)
  console.log(`anon GET /rest/v1/ (OpenAPI) paths: ${JSON.stringify(paths)}  ${paths.every((p) => p === '/') ? '(no tables exposed)' : '!! TABLES EXPOSED'}`)

  const gql = await fetch(`${BASE}/graphql/v1`, {
    method: 'POST',
    headers: { apikey: PUB, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '{ organizationsCollection { edges { node { id } } } }' }),
  })
  const gqlText = await gql.text()
  expect(!gqlText.includes('"edges"'), `anon GraphQL returned data: ${gqlText.slice(0, 120)}`)
  console.log(`anon POST /graphql/v1 -> HTTP ${gql.status}, returns data: ${gqlText.includes('"edges"') ? '!! YES' : 'no'}`)

  await probeStorage(principals, ids)

  console.log(`\n${checks} checks, ${failures.length} failed.`)
  if (failures.length) {
    console.log('\nFAILURES:')
    for (const f of failures) console.log(`  - ${f}`)
    process.exitCode = 1
  }
}

async function tableCounts(): Promise<Record<Table, number>> {
  const out = {} as Record<Table, number>
  for (const t of TABLES) out[t] = n((await sql<{ n: bigint }>(`select count(*) n from ${t}`))[0].n)
  return out
}

// ---- Storage -----------------------------------------------------------------------------

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

async function storage(
  p: Principal,
  method: string,
  path: string,
  init: { body?: Buffer | string; type?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; text: string }> {
  const headers: Record<string, string> = { apikey: p.kind === 'service' ? SECRET : PUB, ...init.headers }
  if (p.token) headers.Authorization = `Bearer ${p.token}`
  if (init.type) headers['Content-Type'] = init.type
  const res = await fetch(`${BASE}/storage/v1/${path}`, {
    method,
    headers,
    body: init.body === undefined ? undefined : new Uint8Array(init.body instanceof Buffer ? init.body : Buffer.from(init.body)),
  })
  return { status: res.status, text: await res.text() }
}

// Short reason for a failed Storage call, so a denial can be told apart from a malformed request.
function why(text: string): string {
  const message = (() => {
    try {
      return String((JSON.parse(text) as { message?: unknown }).message ?? text)
    } catch {
      return text
    }
  })().toLowerCase()
  if (message.includes('row-level security')) return 'RLS'
  if (message.includes('mime')) return 'mime type'
  if (message.includes('maximum allowed size') || message.includes('too large')) return 'size'
  if (message.includes('not found')) return 'not found'
  if (message.includes('jwt') || message.includes('authorization')) return 'auth'
  return message.slice(0, 24)
}
const deny = (r: { status: number; text: string }): string => `HTTP ${r.status} deny [${why(r.text)}]`

async function probeStorage(all: Principal[], ids: Ids): Promise<void> {
  const who = (name: string) => all.find((p) => p.name === name) as Principal
  const sp = ['anon', 'aisyah(tenant N)', 'staff N', 'manager N', 'manager B'].map(who)
  const cols = sp.map((p) => p.name)
  const run = Date.now().toString(36)
  const uploaded: string[] = []
  const service: Principal = { name: 'service_role', kind: 'service' }
  const bucket = 'payment-slips'
  const nPath = (p: Principal) => `${ids.orgN}/probe-${run}-${p.kind}-${p.name.replace(/\W/g, '')}.png`
  const bPath = (p: Principal) => `${ids.orgB}/probe-${run}-${p.kind}-${p.name.replace(/\W/g, '')}.png`
  const ok2xx = (s: number) => s >= 200 && s < 300
  const canN = (p: Principal) => p.name === 'staff N' || p.name === 'manager N'
  const row = (label: string) => label

  // upload
  const uploads: Array<[string, (p: Principal) => string, string, Buffer, boolean | ((p: Principal) => boolean)]> = [
    [row('upload png into own-org folder N'), nPath, 'image/png', PNG, canN],
    [row('upload png into folder B'), bPath, 'image/png', PNG, (p) => p.name === 'manager B'],
    [row('upload text/plain into folder N'), (p) => nPath(p).replace('.png', '.txt'), 'text/plain', Buffer.from('hello'), false],
    [row('upload 5 MB + 1 byte png into folder N'), (p) => nPath(p).replace('.png', '-big.png'), 'image/png', Buffer.alloc(5 * 1024 * 1024 + 1), false],
    [row('upload png at bucket root (no org folder)'), (p) => `probe-${run}-root-${p.kind}.png`, 'image/png', PNG, false],
  ]
  for (const [label, pathFor, type, body, allowed] of uploads) {
    for (const p of sp) {
      const path = pathFor(p)
      const r = await storage(p, 'POST', `object/${bucket}/${path}`, { body, type })
      const want = typeof allowed === 'function' ? allowed(p) : allowed
      if (ok2xx(r.status)) uploaded.push(path)
      put(label, p.name, ok2xx(r.status) === want, ok2xx(r.status) ? `HTTP ${r.status} stored` : deny(r), label)
    }
  }

  const target = nPath(who('staff N'))
  // overwrite / delete
  for (const p of sp) {
    const r = await storage(p, 'POST', `object/${bucket}/${target}`, { body: PNG, type: 'image/png', headers: { 'x-upsert': 'true' } })
    put(row('overwrite existing object (x-upsert)'), p.name, !ok2xx(r.status), ok2xx(r.status) ? `HTTP ${r.status} OVERWRITTEN` : deny(r), 'overwrite must fail')
  }
  for (const p of sp) {
    const r = await storage(p, 'DELETE', `object/${bucket}/${target}`)
    const still = n((await sql<{ n: bigint }>(`select count(*) n from storage.objects where bucket_id = '${bucket}' and name = '${target}'`))[0].n) === 1
    put(row('delete object N'), p.name, still, `HTTP ${r.status} [${why(r.text)}], ${still ? 'object kept' : 'OBJECT DELETED'}`, 'delete must not remove the object')
  }

  // list / download / sign
  for (const p of sp) {
    const r = await storage(p, 'POST', `object/list/${bucket}`, { body: JSON.stringify({ prefix: ids.orgN, limit: 100 }), type: 'application/json' })
    let listed = 0
    try {
      listed = (JSON.parse(r.text) as unknown[]).length
    } catch {
      listed = -1
    }
    const want = canN(p)
    const ok = want ? ok2xx(r.status) && listed >= 1 : !(ok2xx(r.status) && listed > 0)
    put(row('list folder N'), p.name, ok, listed >= 0 && ok2xx(r.status) ? `${listed} objects` : deny(r), 'list folder N')
  }
  for (const p of sp) {
    const r = await storage(p, 'GET', `object/authenticated/${bucket}/${target}`)
    put(row('download object N with own token'), p.name, ok2xx(r.status) === canN(p), ok2xx(r.status) ? `HTTP ${r.status} bytes` : deny(r), 'download object N')
  }
  let signedUrl = ''
  for (const p of sp) {
    const r = await storage(p, 'POST', `object/sign/${bucket}/${target}`, { body: JSON.stringify({ expiresIn: 60 }), type: 'application/json' })
    const ok = ok2xx(r.status) === canN(p)
    if (ok2xx(r.status) && !signedUrl) signedUrl = (JSON.parse(r.text) as { signedURL: string }).signedURL
    put(row('create 60 s signed URL for object N'), p.name, ok, ok2xx(r.status) ? `HTTP ${r.status} url` : deny(r), 'sign object N')
  }
  for (const p of sp) {
    const publicUrl = await storage(p, 'GET', `object/public/${bucket}/${target}`)
    put(row('public URL (private bucket)'), p.name, !ok2xx(publicUrl.status), ok2xx(publicUrl.status) ? `HTTP ${publicUrl.status} EXPOSED` : deny(publicUrl), 'public URL must fail')
  }
  // The signed URL itself carries the permission, so it works without any credentials, until it expires.
  if (signedUrl) {
    const res = await fetch(`${BASE}/storage/v1${signedUrl}`)
    put(row('fetch signed URL with NO credentials'), 'staff N', res.status === 200, `HTTP ${res.status}`, 'signed URL works')
    const claim = JSON.parse(Buffer.from(new URL(`${BASE}/storage/v1${signedUrl}`).searchParams.get('token')!.split('.')[1], 'base64url').toString()) as { exp: number; iat?: number }
    const ttl = claim.exp - Math.floor(Date.now() / 1000)
    put(row('signed URL lifetime left (s)'), 'staff N', ttl > 0 && ttl <= 60, `${ttl} s`, 'signed URL is short-lived')
  }
  printMatrix(
    `STORAGE bucket ${bucket}: HTTP status per role and action (deny = non-2xx)`,
    [...new Set(uploads.map((u) => u[0]).concat([
      'overwrite existing object (x-upsert)', 'delete object N', 'list folder N', 'download object N with own token',
      'create 60 s signed URL for object N', 'public URL (private bucket)', 'fetch signed URL with NO credentials', 'signed URL lifetime left (s)',
    ]))],
    cols,
  )

  const bucketRow = (await sql<{ public: boolean; file_size_limit: bigint; allowed_mime_types: string[] }>(
    `select public, file_size_limit, allowed_mime_types from storage.buckets where id = '${bucket}'`,
  ))[0]
  const bucketOk = bucketRow && !bucketRow.public && n(bucketRow.file_size_limit) === 5242880
  expect(Boolean(bucketOk), 'bucket must be private with a 5 MB limit')
  console.log(`bucket ${bucket}: public=${bucketRow?.public}, file_size_limit=${bucketRow?.file_size_limit}, mime=${bucketRow?.allowed_mime_types?.join(',')}`)

  // Remove what the probe uploaded (only the secret key can delete: there is no delete policy).
  if (uploaded.length) {
    await storage(service, 'DELETE', `object/${bucket}`, { body: JSON.stringify({ prefixes: uploaded }), type: 'application/json' })
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
