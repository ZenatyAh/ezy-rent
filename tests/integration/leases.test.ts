import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { generateSchedule, invoiceStatus } from '@/lib/billing'
import { prisma } from '@/lib/prisma'
import type { LeaseDetailResponse } from '@/lib/serializers'
import { adminClient, api, cookieHeaderFor, hasErrorMessage, login, PASSWORD, PUBLISHABLE_KEY, UUID } from './helpers'

interface Ids {
  unitAisyah: string
  unitFree: string
  unitBeta: string
  tenantAisyah: string
  tenantProbe: string
  tenantChen: string
  leaseAisyah: string
  leaseChen: string
  managerNorthwind: string
}

let ids: Ids
const token: Record<string, string> = {}
const createdLeaseIds: string[] = []
const tempUserIds: string[] = []

async function post(who: string, body: unknown) {
  return api<{ id?: string; error?: string }>('POST', '/api/leases', { token: token[who], body })
}

// Posts a lease and remembers it so afterAll can remove it again.
async function postAndTrack(who: string, body: unknown) {
  const res = await post(who, body)
  if (res.status === 201 && res.body.id) createdLeaseIds.push(res.body.id)
  return res
}

beforeAll(async () => {
  const find = async (q: Promise<{ id: string } | null>) => {
    const row = await q
    if (!row) throw new Error('Database is not seeded: run npm run seed')
    return row.id
  }
  ids = {
    unitAisyah: await find(prisma.units.findFirst({ where: { name: 'A-12-3' } })),
    unitFree: await find(prisma.units.findFirst({ where: { name: 'D-03-2' } })),
    unitBeta: await find(prisma.units.findFirst({ where: { name: 'KL-1' } })),
    tenantAisyah: await find(prisma.tenants.findFirst({ where: { email: 'aisyah@northwind.test' } })),
    tenantProbe: await find(prisma.tenants.findFirst({ where: { email: 'probe@northwind.test' } })),
    tenantChen: await find(prisma.tenants.findFirst({ where: { email: 'chen@beta.test' } })),
    leaseAisyah: await find(prisma.leases.findFirst({ where: { tenants: { email: 'aisyah@northwind.test' } } })),
    leaseChen: await find(prisma.leases.findFirst({ where: { tenants: { email: 'chen@beta.test' } } })),
    managerNorthwind: (await prisma.memberships.findFirstOrThrow({ where: { role: 'manager', organizations: { name: 'Northwind Properties' } } })).user_id,
  }
  for (const [who, email] of Object.entries({
    manager: 'manager@northwind.test',
    staff: 'staff@northwind.test',
    aisyah: 'aisyah@northwind.test',
    ben: 'ben@northwind.test',
    probe: 'probe@northwind.test',
    managerB: 'manager@beta.test',
    chen: 'chen@beta.test',
  })) {
    token[who] = await login(email)
  }
})

afterAll(async () => {
  // Remove what these tests created (audit_log rows are append-only and stay: reset the database
  // with `npx supabase db reset && npm run seed` before the final checks).
  if (createdLeaseIds.length) {
    await prisma.invoices.deleteMany({ where: { lease_id: { in: createdLeaseIds } } })
    await prisma.leases.deleteMany({ where: { id: { in: createdLeaseIds } } })
  }
  const admin = adminClient()
  for (const id of tempUserIds) await admin.auth.admin.deleteUser(id)
  await prisma.$disconnect()
})

describe('401: no valid login', () => {
  it('rejects requests without credentials', async () => {
    expect((await api('GET', `/api/leases/${ids.leaseAisyah}`)).status).toBe(401)
    expect((await api('POST', '/api/leases', { body: {} })).status).toBe(401)
  })

  it.each([
    ['garbage token', 'Bearer not-a-real-token'],
    ['wrong scheme', 'Basic dXNlcjpwYXNz'],
    ['no token after Bearer', 'Bearer'],
    ['the publishable key (no user)', `Bearer ${PUBLISHABLE_KEY}`],
  ])('rejects %s', async (_label, header) => {
    const res = await api<{ error: string }>('GET', `/api/leases/${ids.leaseAisyah}`, { headers: { Authorization: header } })
    expect(res.status).toBe(401)
    expect(hasErrorMessage(res.body)).toBe(true)
  })

  it('accepts the session cookie as well as a Bearer token', async () => {
    const cookie = await cookieHeaderFor('aisyah@northwind.test')
    expect((await api('GET', `/api/leases/${ids.leaseAisyah}`, { cookie })).status).toBe(200)
    expect((await api('GET', `/api/leases/${ids.leaseAisyah}`, { cookie: 'sb-garbage-auth-token=nope' })).status).toBe(401)
  })

  it('does not fall back to the cookie when the Bearer header is invalid', async () => {
    const cookie = await cookieHeaderFor('aisyah@northwind.test')
    const res = await api('GET', `/api/leases/${ids.leaseAisyah}`, { cookie, headers: { Authorization: 'Bearer garbage' } })
    expect(res.status).toBe(401)
  })

  it('applies the cookie path to POST too (a staff cookie is a 403, not a 401)', async () => {
    const cookie = await cookieHeaderFor('staff@northwind.test')
    expect((await api('POST', '/api/leases', { cookie, body: {} })).status).toBe(403)
  })
})

describe('403: a signed-in account with no role', () => {
  it('gets 403 on every endpoint, then the temporary user is deleted', async () => {
    const admin = adminClient()
    const email = `norole-${randomUUID()}@example.test`
    const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
    if (error || !data.user) throw new Error(`Could not create the temporary user: ${error?.message}`)
    tempUserIds.push(data.user.id)

    const jwt = await login(email)
    const get = await api<{ error: string }>('GET', `/api/leases/${ids.leaseAisyah}`, { token: jwt })
    const create = await api<{ error: string }>('POST', '/api/leases', { token: jwt, body: {} })
    expect(get.status).toBe(403)
    expect(create.status).toBe(403)
    expect(hasErrorMessage(get.body)).toBe(true)

    // The user holds no membership and no tenant row, so the Data API shows it nothing either.
    const rest = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/leases?select=id`, {
      headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${jwt}` },
    })
    expect(await rest.json()).toEqual([])

    await admin.auth.admin.deleteUser(data.user.id)
    tempUserIds.splice(tempUserIds.indexOf(data.user.id), 1)
    const stale = await api('GET', `/api/leases/${ids.leaseAisyah}`, { token: jwt })
    expect(stale.status).toBe(401) // a deleted user's token no longer works
  })
})

describe('GET /api/leases/:leaseId', () => {
  const INVOICE_KEYS = ['amountSen', 'dueDate', 'id', 'kind', 'paidSen', 'periodEnd', 'periodIndex', 'periodStart', 'status']

  it("returns exactly the documented shape for Aisyah's lease", async () => {
    const { status, body } = await api<LeaseDetailResponse>('GET', `/api/leases/${ids.leaseAisyah}`, { token: token.aisyah })
    expect(status).toBe(200)
    expect(Object.keys(body).sort()).toEqual(['invoices', 'lease', 'payments'])
    expect(Object.keys(body.lease).sort()).toEqual(
      ['depositSen', 'endDate', 'id', 'monthlyRentSen', 'startDate', 'tenantId', 'unitId'],
    )
    expect(body.lease).toEqual({
      id: ids.leaseAisyah,
      unitId: ids.unitAisyah,
      tenantId: ids.tenantAisyah,
      startDate: '2026-01-31',
      endDate: '2026-07-15',
      monthlyRentSen: 150000,
      depositSen: 300000,
    })

    // Invoices are in allocation order and are exactly what generateSchedule returns.
    const schedule = generateSchedule({ startDate: '2026-01-31', endDate: '2026-07-15', monthlyRentSen: 150000, depositSen: 300000 })
    expect(body.invoices).toHaveLength(7)
    const now = new Date()
    // seed stage 3: cash 300000 fills the deposit, the bank transfer 200000 fills rent 0 and half of rent 1
    const seededPaid = [300000, 150000, 50000, 0, 0, 0, 0]
    body.invoices.forEach((invoice, i) => {
      const expected = schedule[i]
      expect(Object.keys(invoice).sort()).toEqual(INVOICE_KEYS)
      expect(invoice.id).toMatch(UUID)
      expect(invoice).toMatchObject({
        kind: expected.kind,
        periodIndex: expected.periodIndex,
        periodStart: expected.periodStart,
        periodEnd: expected.periodEnd,
        dueDate: expected.dueDate,
        amountSen: expected.amountSen,
        paidSen: seededPaid[i],
        status: invoiceStatus({ dueDate: expected.dueDate, amountSen: expected.amountSen, paidSen: seededPaid[i] }, now),
      })
      expect(Number.isSafeInteger(invoice.amountSen)).toBe(true)
    })
    expect(body.invoices[0].kind).toBe('deposit')
    expect(body.invoices[6].amountSen).toBe(77419)
    expect(body.payments).toHaveLength(2)
    for (const payment of body.payments) {
      expect(Object.keys(payment).sort()).toEqual(['amountSen', 'id', 'method', 'receivedAt', 'status', 'unappliedSen'])
      expect(payment.id).toMatch(UUID)
    }
    expect(body.payments[0]).toMatchObject({ amountSen: 300000, unappliedSen: 0, method: 'cash', status: 'approved', receivedAt: '2026-01-31T10:00:00.000+08:00' })
    expect(body.payments[1]).toMatchObject({ amountSen: 200000, unappliedSen: 0, method: 'bank_transfer', status: 'approved', receivedAt: '2026-03-01T00:30:00.000+08:00' })
  })

  it.each(['manager', 'staff', 'aisyah'])('lets %s read the lease', async (who) => {
    const res = await api<LeaseDetailResponse>('GET', `/api/leases/${ids.leaseAisyah}`, { token: token[who] })
    expect(res.status).toBe(200)
    expect(res.body.lease.id).toBe(ids.leaseAisyah)
  })

  it.each([
    ['another tenant of the same organization (Ben)', 'ben'],
    ['a tenant with a different lease (Probe)', 'probe'],
    ['the manager of another organization', 'managerB'],
    ['a tenant of another organization (Chen)', 'chen'],
  ])('answers 404, not 403, for %s', async (_label, who) => {
    const res = await api<{ error: string }>('GET', `/api/leases/${ids.leaseAisyah}`, { token: token[who] })
    expect(res.status).toBe(404)
    expect(hasErrorMessage(res.body)).toBe(true)
  })

  it('answers 404 for an unknown id and for a malformed id', async () => {
    expect((await api('GET', `/api/leases/${randomUUID()}`, { token: token.manager })).status).toBe(404)
    expect((await api('GET', '/api/leases/not-a-uuid', { token: token.manager })).status).toBe(404)
    expect((await api('GET', '/api/leases/00000000-0000-0000-0000-000000000000', { token: token.manager })).status).toBe(404)
  })

  it("keeps Beta's lease invisible to Northwind staff and managers", async () => {
    expect((await api('GET', `/api/leases/${ids.leaseChen}`, { token: token.manager })).status).toBe(404)
    expect((await api('GET', `/api/leases/${ids.leaseChen}`, { token: token.staff })).status).toBe(404)
    expect((await api('GET', `/api/leases/${ids.leaseChen}`, { token: token.managerB })).status).toBe(200)
  })
})

describe('POST /api/leases: role, validation and ownership', () => {
  const valid = () => ({
    unitId: ids.unitFree,
    tenantId: ids.tenantProbe,
    startDate: '2040-01-01',
    endDate: '2040-12-31',
    monthlyRentSen: 100000,
    depositSen: 0,
  })

  it.each(['staff', 'aisyah', 'probe', 'chen'])('answers 403 for %s, even with an empty body', async (who) => {
    expect((await post(who, valid())).status).toBe(403)
    expect((await post(who, {})).status).toBe(403)
  })

  const invalid: Array<[string, Record<string, unknown>]> = [
    ['missing unitId', { unitId: undefined }],
    ['missing tenantId', { tenantId: undefined }],
    ['missing startDate', { startDate: undefined }],
    ['missing endDate', { endDate: undefined }],
    ['missing monthlyRentSen', { monthlyRentSen: undefined }],
    ['missing depositSen', { depositSen: undefined }],
    ['unitId that is not an id', { unitId: 'not-a-uuid' }],
    ['tenantId that is a number', { tenantId: 123 }],
    ['impossible date 2040-02-30', { startDate: '2040-02-30' }],
    ['month 13', { startDate: '2040-13-01' }],
    ['two-digit year', { startDate: '40-01-01' }],
    ['slashes', { startDate: '2040/01/01' }],
    ['unpadded date', { endDate: '2040-1-1' }],
    ['a date with a time', { startDate: '2040-01-01T00:00:00Z' }],
    ['year 0000 (Postgres cannot store it)', { startDate: '0000-01-01' }],
    ['end date in year 0000', { startDate: '0000-01-01', endDate: '0000-12-31' }],
    ['end before start', { endDate: '2039-12-31' }],
    ['rent 0', { monthlyRentSen: 0 }],
    ['negative rent', { monthlyRentSen: -5 }],
    ['fractional rent', { monthlyRentSen: 1.5 }],
    ['rent as a string', { monthlyRentSen: '1000' }],
    ['rent null', { monthlyRentSen: null }],
    ['rent beyond the safe integer range', { monthlyRentSen: 1e300 }],
    ['negative deposit', { depositSen: -1 }],
    ['fractional deposit', { depositSen: 0.5 }],
    ['deposit as a string', { depositSen: '0' }],
  ]
  it.each(invalid)('answers 400 (never 500) for %s', async (_label, override) => {
    const res = await post('manager', { ...valid(), ...override })
    expect(res.status).toBe(400)
    expect(hasErrorMessage(res.body)).toBe(true)
  })

  it.each([
    ['text that is not JSON', 'nope'],
    ['an empty body', ''],
    ['a JSON array', '[]'],
    ['JSON null', 'null'],
    ['a JSON string', '"lease"'],
  ])('answers 400 for %s', async (_label, rawBody) => {
    const res = await api<{ error: string }>('POST', '/api/leases', { token: token.manager, rawBody })
    expect(res.status).toBe(400)
    expect(hasErrorMessage(res.body)).toBe(true)
  })

  it.each([
    ['a unit of another organization', { unitId: 'beta' }],
    ['a tenant of another organization', { tenantId: 'chen' }],
    ['an unknown unit', { unitId: 'random' }],
    ['an unknown tenant', { tenantId: 'random' }],
    ['the nil uuid as unit', { unitId: 'nil' }],
  ])('answers 404 for %s, without creating anything', async (_label, swap) => {
    const body: Record<string, unknown> = valid()
    const pick = { beta: ids.unitBeta, chen: ids.tenantChen, random: randomUUID(), nil: '00000000-0000-0000-0000-000000000000' }
    if ('unitId' in swap) body.unitId = pick[swap.unitId as keyof typeof pick]
    if ('tenantId' in swap) body.tenantId = pick[swap.tenantId as keyof typeof pick]
    const before = await prisma.leases.count()
    const res = await post('manager', body)
    expect(res.status).toBe(404)
    expect(await prisma.leases.count()).toBe(before)
  })

  it("lets Beta's manager use Beta's unit but not Northwind's", async () => {
    const ownUnit = await post('managerB', { ...valid(), unitId: ids.unitBeta, tenantId: ids.tenantChen, startDate: '2040-01-01', endDate: '2040-06-30' })
    expect(ownUnit.status).toBe(201)
    if (ownUnit.body.id) createdLeaseIds.push(ownUnit.body.id)
    const foreign = await post('managerB', valid())
    expect(foreign.status).toBe(404)
  })
})

describe('POST /api/leases: overlap (409) and creation (201)', () => {
  const onAisyahUnit = (startDate: string, endDate: string) => ({
    unitId: ids.unitAisyah,
    tenantId: ids.tenantProbe,
    startDate,
    endDate,
    monthlyRentSen: 100000,
    depositSen: 0,
  })

  it.each([
    ['identical dates', '2026-01-31', '2026-07-15'],
    ['touching the last day (both ends inclusive)', '2026-07-15', '2026-12-31'],
    ['touching the first day', '2025-12-01', '2026-01-31'],
    ['inside the existing lease', '2026-03-01', '2026-03-31'],
    ['enclosing the existing lease', '2025-01-01', '2027-12-31'],
  ])('answers 409 for a lease %s', async (_label, start, end) => {
    const leasesBefore = await prisma.leases.count()
    const invoicesBefore = await prisma.invoices.count()
    const res = await post('manager', onAisyahUnit(start, end))
    expect(res.status).toBe(409)
    expect(hasErrorMessage(res.body)).toBe(true)
    // all or nothing: the rejected request left neither a lease nor any invoices
    expect(await prisma.leases.count()).toBe(leasesBefore)
    expect(await prisma.invoices.count()).toBe(invoicesBefore)
  })

  it('accepts leases that start the day after, or end the day before, the existing one', async () => {
    expect((await postAndTrack('manager', onAisyahUnit('2026-07-16', '2026-12-31'))).status).toBe(201)
    expect((await postAndTrack('manager', onAisyahUnit('2025-01-01', '2026-01-30'))).status).toBe(201)
  })

  it('stores the lease with exactly the invoices generateSchedule returns, and an audit row', async () => {
    const input = { unitId: ids.unitFree, tenantId: ids.tenantProbe, startDate: '2041-01-31', endDate: '2041-07-15', monthlyRentSen: 123456, depositSen: 100000 }
    const res = await postAndTrack('manager', input)
    expect(res.status).toBe(201)
    expect(Object.keys(res.body)).toEqual(['id'])
    const leaseId = res.body.id as string
    expect(leaseId).toMatch(UUID)

    const detail = await api<LeaseDetailResponse>('GET', `/api/leases/${leaseId}`, { token: token.probe })
    expect(detail.status).toBe(200) // the lease's tenant can read it
    const schedule = generateSchedule(input)
    expect(detail.body.invoices.map((i) => [i.kind, i.periodIndex, i.periodStart, i.periodEnd, i.dueDate, i.amountSen])).toEqual(
      schedule.map((i) => [i.kind, i.periodIndex, i.periodStart, i.periodEnd, i.dueDate, i.amountSen]),
    )
    const orgId = (await prisma.leases.findFirstOrThrow({ where: { id: leaseId } })).org_id
    expect((await prisma.invoices.findMany({ where: { lease_id: leaseId } })).every((i) => i.org_id === orgId)).toBe(true)

    const audit = await prisma.audit_log.findMany({ where: { entity_id: leaseId } })
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ action: 'lease.created', actor_id: ids.managerNorthwind, org_id: orgId })
  })

  it('lets exactly one of several simultaneous requests for the same unit succeed', async () => {
    const input = { unitId: ids.unitFree, tenantId: ids.tenantProbe, startDate: '2045-01-01', endDate: '2045-12-31', monthlyRentSen: 100000, depositSen: 50000 }
    const results = await Promise.all(Array.from({ length: 6 }, () => postAndTrack('manager', input)))
    const statuses = results.map((r) => r.status).sort()
    expect(statuses).toEqual([201, 409, 409, 409, 409, 409])
    const leases = await prisma.leases.findMany({ where: { unit_id: ids.unitFree, start_date: new Date('2045-01-01T00:00:00Z') } })
    expect(leases).toHaveLength(1)
    // all or nothing: the winner has its full schedule, the losers left no invoices behind
    expect(await prisma.invoices.count({ where: { lease_id: leases[0].id } })).toBe(generateSchedule(input).length)
  })
})
