// Checks the database constraints directly (as the owner). Every case runs in its own transaction
// that is always rolled back, so the seeded data is untouched. Needs `npm run seed` first.
//   npm run check:db
import { prisma } from '@/lib/prisma'

class Rollback extends Error {}

const NORTH = `(select id from organizations where name = 'Northwind Properties')`
const lease = (start: string, end: string, unit = 'D-03-2', tenant = 'aisyah@northwind.test') =>
  `insert into leases (org_id, unit_id, tenant_id, start_date, end_date, monthly_rent_sen, deposit_sen)
   select u.org_id, u.id, t.id, '${start}', '${end}', 1000, 0 from units u, tenants t
   where u.name = '${unit}' and t.email = '${tenant}'`
const LAST_LEASE = `(select id from leases order by created_at desc limit 1)`
const invoice = (kind: 'deposit' | 'rent', index: number | null, amount: number) =>
  `insert into invoices (org_id, lease_id, kind, period_index, period_start, period_end, due_date, amount_sen)
   select org_id, id, '${kind}', ${index ?? 'null'}, ${index === null ? 'null' : `'2026-01-01'`},
          ${index === null ? 'null' : `'2026-01-31'`}, '2026-01-01', ${amount} from leases where id = ${LAST_LEASE}`
const payment = (columns: string, values: string) =>
  `insert into payments (org_id, lease_id, received_at, ${columns})
   select org_id, id, now(), ${values} from leases where id = ${LAST_LEASE}`
const BILL = `insert into gateway_bills (org_id, lease_id, amount_sen)
   select org_id, id, 1000 from leases where id = ${LAST_LEASE}`
const ONLINE = payment('amount_sen, method, status, gateway_bill_id', `1000, 'online', 'approved', (select id from gateway_bills order by created_at desc limit 1)`)

const FAILURE_WORDS: Record<string, string> = {
  exclusion: 'exclusion constraint',
  'foreign key': 'foreign key constraint',
  unique: 'unique constraint',
  check: 'check constraint',
  'append-only': 'append-only',
}

interface Case {
  label: string
  expect: 'ok' | keyof typeof FAILURE_WORDS
  sql: string[] // the last statement is the one under test
}

const cases: Case[] = [
  { label: 'lease overlapping an existing lease on the unit', expect: 'exclusion', sql: [lease('2026-01-01', '2026-01-31'), lease('2026-01-31', '2026-02-28')] },
  { label: 'lease fully inside an existing lease', expect: 'exclusion', sql: [lease('2026-01-01', '2026-12-31'), lease('2026-03-01', '2026-03-31')] },
  { label: 'lease starting the day after the previous one ends', expect: 'ok', sql: [lease('2026-01-01', '2026-01-31'), lease('2026-02-01', '2026-02-28')] },
  { label: 'one-day lease on a free day', expect: 'ok', sql: [lease('2026-01-01', '2026-01-31'), lease('2026-02-01', '2026-02-01')] },
  { label: 'lease end before start', expect: 'check', sql: [lease('2026-02-01', '2026-01-01')] },
  {
    label: 'lease for a unit of another organization (composite FK)',
    expect: 'foreign key',
    sql: [`insert into leases (org_id, unit_id, tenant_id, start_date, end_date, monthly_rent_sen, deposit_sen)
           select ${NORTH}, u.id, t.id, '2026-01-01', '2026-01-31', 1000, 0 from units u, tenants t
           where u.name = 'KL-1' and t.email = 'aisyah@northwind.test'`],
  },
  { label: 'second deposit invoice on a lease', expect: 'unique', sql: [lease('2026-01-01', '2026-03-31'), invoice('deposit', null, 100), invoice('deposit', null, 100)] },
  { label: 'second invoice with the same period_index', expect: 'unique', sql: [lease('2026-01-01', '2026-03-31'), invoice('rent', 0, 100), invoice('rent', 0, 100)] },
  { label: 'invoice for 0 sen (rounded last period)', expect: 'ok', sql: [lease('2026-01-01', '2026-03-31'), invoice('rent', 0, 0)] },
  { label: 'invoice for -1 sen', expect: 'check', sql: [lease('2026-01-01', '2026-03-31'), invoice('rent', 0, -1)] },
  {
    label: 'deposit invoice that has a period_index',
    expect: 'check',
    sql: [lease('2026-01-01', '2026-03-31'), `insert into invoices (org_id, lease_id, kind, period_index, due_date, amount_sen)
      select org_id, id, 'deposit', 0, '2026-01-01', 10 from leases where id = ${LAST_LEASE}`],
  },
  {
    label: 'rent invoice without period dates',
    expect: 'check',
    sql: [lease('2026-01-01', '2026-03-31'), `insert into invoices (org_id, lease_id, kind, period_index, due_date, amount_sen)
      select org_id, id, 'rent', 0, '2026-01-01', 10 from leases where id = ${LAST_LEASE}`],
  },
  { label: 'valid approved cash payment (control)', expect: 'ok', sql: [lease('2026-01-01', '2026-03-31'), payment('amount_sen, method, status', `1000, 'cash', 'approved'`)] },
  { label: 'payment of 0 sen', expect: 'check', sql: [lease('2026-01-01', '2026-03-31'), payment('amount_sen, method, status', `0, 'cash', 'approved'`)] },
  { label: 'bank transfer without a slip', expect: 'check', sql: [lease('2026-01-01', '2026-03-31'), payment('amount_sen, method, status', `1000, 'bank_transfer', 'pending_verification'`)] },
  {
    label: "slip_path outside the payment's org folder",
    expect: 'check',
    sql: [lease('2026-01-01', '2026-03-31'), payment('amount_sen, method, status, slip_path', `1000, 'bank_transfer', 'pending_verification', 'not-my-org/slip.png'`)],
  },
  { label: 'online payment without a gateway bill', expect: 'check', sql: [lease('2026-01-01', '2026-03-31'), payment('amount_sen, method, status', `1000, 'online', 'approved'`)] },
  { label: 'cash payment with unapplied_sen', expect: 'check', sql: [lease('2026-01-01', '2026-03-31'), payment('amount_sen, method, status, unapplied_sen', `1000, 'cash', 'approved', 5`)] },
  { label: 'decision_reason shorter than 5 characters', expect: 'check', sql: [lease('2026-01-01', '2026-03-31'), payment('amount_sen, method, status, decision_reason', `1000, 'cash', 'rejected', 'abc'`)] },
  { label: 'online payment for a bill (control)', expect: 'ok', sql: [lease('2026-01-01', '2026-03-31'), BILL, ONLINE] },
  { label: 'second payment for the same gateway bill', expect: 'unique', sql: [lease('2026-01-01', '2026-03-31'), BILL, ONLINE, ONLINE] },
  {
    label: 'allocation of 0 sen',
    expect: 'check',
    sql: [lease('2026-01-01', '2026-03-31'), invoice('rent', 0, 100), payment('amount_sen, method, status', `100, 'cash', 'approved'`),
      `insert into payment_allocations (org_id, payment_id, invoice_id, amount_sen)
       select p.org_id, p.id, i.id, 0 from payments p, invoices i where p.lease_id = ${LAST_LEASE} and i.lease_id = ${LAST_LEASE}`],
  },
  {
    label: 'same payment allocated twice to one invoice',
    expect: 'unique',
    sql: [lease('2026-01-01', '2026-03-31'), invoice('rent', 0, 100), payment('amount_sen, method, status', `100, 'cash', 'approved'`),
      `insert into payment_allocations (org_id, payment_id, invoice_id, amount_sen)
       select p.org_id, p.id, i.id, 10 from payments p, invoices i where p.lease_id = ${LAST_LEASE} and i.lease_id = ${LAST_LEASE}`,
      `insert into payment_allocations (org_id, payment_id, invoice_id, amount_sen)
       select p.org_id, p.id, i.id, 10 from payments p, invoices i where p.lease_id = ${LAST_LEASE} and i.lease_id = ${LAST_LEASE}`],
  },
  { label: 'second membership for the same user', expect: 'unique', sql: [`insert into memberships (user_id, org_id, role) select user_id, org_id, 'staff' from memberships limit 1`] },
  { label: 'audit_log insert (control)', expect: 'ok', sql: [`insert into audit_log (org_id, action, entity_id) values (${NORTH}, 'probe', gen_random_uuid())`] },
  {
    label: 'audit_log update right after inserting the row',
    expect: 'append-only',
    sql: [`insert into audit_log (org_id, action, entity_id) values (${NORTH}, 'probe', gen_random_uuid())`, `update audit_log set action = 'changed'`],
  },
]

async function run(c: Case): Promise<string> {
  let outcome = 'ok'
  try {
    await prisma.$transaction(async (tx) => {
      for (const statement of c.sql.slice(0, -1)) await tx.$executeRawUnsafe(statement)
      try {
        await tx.$executeRawUnsafe(c.sql[c.sql.length - 1])
      } catch (error) {
        outcome = error instanceof Error ? error.message : String(error)
      }
      throw new Rollback() // always roll back
    })
  } catch (error) {
    if (!(error instanceof Rollback)) outcome = `SETUP FAILED: ${error instanceof Error ? error.message : String(error)}`
  }
  return outcome
}

async function main(): Promise<void> {
  if ((await prisma.organizations.count()) === 0) throw new Error('Run npm run seed first.')
  let failed = 0
  for (const c of cases) {
    const outcome = await run(c)
    const ok = c.expect === 'ok' ? outcome === 'ok' : outcome.toLowerCase().includes(FAILURE_WORDS[c.expect])
    if (!ok) failed++
    const shown = outcome === 'ok' ? 'accepted' : `rejected: ${c.expect}`
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.label.padEnd(58)} ${c.expect === 'ok' ? 'accepted' : 'rejected'}${ok ? '' : `  (got ${shown}: ${outcome.slice(0, 120)})`}`)
  }
  console.log(`\n${cases.length - failed}/${cases.length} constraint checks passed.`)
  if (failed) process.exitCode = 1
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
