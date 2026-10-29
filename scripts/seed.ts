// Seeds a freshly reset database (npx supabase db reset) with the data from section 2 of the brief.
// Run it with `npm run seed`. It uses the same code paths as the app: later stages call the lease
// and payment services, so invoices, allocations and audit rows are exactly what the app produces.
import { createClient } from '@supabase/supabase-js'
import type { Actor } from '@/lib/actor'
import { prisma } from '@/lib/prisma'
import { createLease } from '@/lib/services/leases'
import { approvePayment, recordPayment } from '@/lib/services/payments'
import { SLIP_BUCKET } from '@/lib/services/slips'
import { createAdminClient } from '@/lib/supabase/admin'

// All seeded accounts share this password (also submitted with the work).
const PASSWORD = 'Northwind#2026'

const ORGS = ['Northwind Properties', 'Beta Realty'] as const
type OrgName = (typeof ORGS)[number]

const UNITS: Record<OrgName, string[]> = {
  'Northwind Properties': ['A-12-3', 'B-05-1', 'C-01-7', 'D-03-2'],
  'Beta Realty': ['KL-1'],
}

type Account =
  | { email: string; org: OrgName; role: 'manager' | 'staff' }
  | { email: string; org: OrgName; tenant: string }

const ACCOUNTS: Account[] = [
  { email: 'manager@northwind.test', org: 'Northwind Properties', role: 'manager' },
  { email: 'staff@northwind.test', org: 'Northwind Properties', role: 'staff' },
  { email: 'aisyah@northwind.test', org: 'Northwind Properties', tenant: 'Aisyah Rahman' },
  { email: 'ben@northwind.test', org: 'Northwind Properties', tenant: 'Ben Lim' },
  { email: 'probe@northwind.test', org: 'Northwind Properties', tenant: 'Probe Tenant' },
  { email: 'manager@beta.test', org: 'Beta Realty', role: 'manager' },
  { email: 'chen@beta.test', org: 'Beta Realty', tenant: 'Chen Wei' },
]

interface SeededAccounts {
  orgIds: Record<OrgName, string>
  userIds: Record<string, string> // email -> auth user id
  tenantIds: Record<string, string> // email -> tenants.id
  unitIds: Record<string, string> // unit name -> units.id
}

// Stage 1: organizations, auth users, memberships, tenants, units.
async function seedAccounts(): Promise<SeededAccounts> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secret = process.env.SUPABASE_SECRET_KEY
  if (!url || !secret) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set (.env.local)')
  const admin = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } })

  const orgIds = {} as Record<OrgName, string>
  const unitIds: Record<string, string> = {}
  for (const name of ORGS) {
    const org = await prisma.organizations.create({ data: { name } })
    orgIds[name] = org.id
    for (const unitName of UNITS[name]) {
      const unit = await prisma.units.create({ data: { org_id: org.id, name: unitName } })
      unitIds[unitName] = unit.id
    }
  }

  const userIds: Record<string, string> = {}
  const tenantIds: Record<string, string> = {}
  for (const account of ACCOUNTS) {
    const { data, error } = await admin.auth.admin.createUser({
      email: account.email,
      password: PASSWORD,
      email_confirm: true,
    })
    if (error || !data.user) throw new Error(`Could not create ${account.email}: ${error?.message}`)
    userIds[account.email] = data.user.id

    // The role comes from the database (memberships / tenants.user_id), never from user_metadata.
    if ('role' in account) {
      await prisma.memberships.create({
        data: { user_id: data.user.id, org_id: orgIds[account.org], role: account.role },
      })
    } else {
      const tenant = await prisma.tenants.create({
        data: { org_id: orgIds[account.org], user_id: data.user.id, full_name: account.tenant, email: account.email },
      })
      tenantIds[account.email] = tenant.id
    }
  }

  return { orgIds, userIds, tenantIds, unitIds }
}

const LEASES = [
  { manager: 'manager@northwind.test', unit: 'A-12-3', tenant: 'aisyah@northwind.test', startDate: '2026-01-31', endDate: '2026-07-15', monthlyRentSen: 150000, depositSen: 300000 },
  { manager: 'manager@northwind.test', unit: 'B-05-1', tenant: 'ben@northwind.test', startDate: '2026-01-01', endDate: '2026-04-15', monthlyRentSen: 100029, depositSen: 0 },
  { manager: 'manager@northwind.test', unit: 'C-01-7', tenant: 'probe@northwind.test', startDate: '2026-02-28', endDate: '2027-02-27', monthlyRentSen: 200000, depositSen: 400000 },
  { manager: 'manager@beta.test', unit: 'KL-1', tenant: 'chen@beta.test', startDate: '2026-03-15', endDate: '2027-03-14', monthlyRentSen: 220000, depositSen: 440000 },
] as const

// Stage 2: leases, created through the same service the API uses (one transaction per lease: the lease,
// exactly the invoices generateSchedule returns, and a lease.created audit row). D-03-2 stays empty.
async function seedLeases(accounts: SeededAccounts): Promise<Record<string, string>> {
  const leaseIds: Record<string, string> = {} // tenant email -> lease id
  for (const lease of LEASES) {
    const account = ACCOUNTS.find((a) => a.email === lease.manager)
    if (!account) throw new Error(`Unknown manager ${lease.manager}`)
    const actor: Actor = { userId: accounts.userIds[lease.manager], orgId: accounts.orgIds[account.org], role: 'manager' }
    const { id } = await createLease(actor, {
      unitId: accounts.unitIds[lease.unit],
      tenantId: accounts.tenantIds[lease.tenant],
      startDate: lease.startDate,
      endDate: lease.endDate,
      monthlyRentSen: lease.monthlyRentSen,
      depositSen: lease.depositSen,
    })
    leaseIds[lease.tenant] = id
  }
  return leaseIds
}

// A 1x1 PNG standing in for the photographed bank transfer slip.
const SLIP_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

// Stage 3: Aisyah's two payments, recorded and approved through the payment service (so they are
// allocated and audited exactly as the app does it).
//   1. cash RM 3,000.00 received 2026-01-31 10:00 Malaysia time, recorded by the manager (approved at once)
//   2. bank transfer RM 2,000.00 received 2026-03-01 00:30 Malaysia time, recorded by staff with a slip
//      (pending), then approved by the manager
async function seedPayments(accounts: SeededAccounts, leaseId: string): Promise<void> {
  const orgId = accounts.orgIds['Northwind Properties']
  const manager: Actor = { userId: accounts.userIds['manager@northwind.test'], orgId, role: 'manager' }
  const staff: Actor = { userId: accounts.userIds['staff@northwind.test'], orgId, role: 'staff' }

  await recordPayment(manager, leaseId, {
    amountSen: 300000,
    method: 'cash',
    receivedAt: '2026-01-31T10:00:00+08:00',
  })

  // The browser uploads the slip to Storage first; the seed does the same with the secret key.
  const slipPath = `${orgId}/aisyah-transfer-2026-03-01.png`
  const { error } = await createAdminClient()
    .storage.from(SLIP_BUCKET)
    .upload(slipPath, SLIP_PNG, { contentType: 'image/png', upsert: true })
  if (error) throw new Error(`Could not upload the seed slip: ${error.message}`)

  const pending = await recordPayment(staff, leaseId, {
    amountSen: 200000,
    method: 'bank_transfer',
    receivedAt: '2026-03-01T00:30:00+08:00',
    slipPath,
  })
  await approvePayment(manager, pending.id)
}

async function main(): Promise<void> {
  if ((await prisma.organizations.count()) > 0) {
    console.log('The database already has data. Run `npx supabase db reset` first, then `npm run seed`.')
    return
  }

  const accounts = await seedAccounts()
  console.log(
    `Seeded ${Object.keys(accounts.orgIds).length} organizations, ${Object.keys(accounts.userIds).length} accounts, ` +
      `${Object.keys(accounts.tenantIds).length} tenants, ${Object.keys(accounts.unitIds).length} units.`,
  )

  const leaseIds = await seedLeases(accounts)
  const invoices = await prisma.invoices.count()
  console.log(`Seeded ${Object.keys(leaseIds).length} leases with ${invoices} invoices.`)
  await seedPayments(accounts, leaseIds['aisyah@northwind.test'])
  console.log(`Seeded ${await prisma.payments.count()} payments, ${await prisma.payment_allocations.count()} allocations.`)
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
