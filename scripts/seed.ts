// Seeds a freshly reset database (npx supabase db reset) with the data from section 2 of the brief.
// Run it with `npm run seed`. It uses the same code paths as the app: later stages call the lease
// and payment services, so invoices, allocations and audit rows are exactly what the app produces.
import { createClient } from '@supabase/supabase-js'
import { prisma } from '@/lib/prisma'

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
  // Stage 2 (leases) and stage 3 (payments) are added with the lease and payment services.
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
