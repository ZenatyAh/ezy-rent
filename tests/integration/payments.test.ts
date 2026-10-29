import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import type { LeaseDetailResponse } from '@/lib/serializers'
import { adminClient, api, hasErrorMessage, login, PUBLISHABLE_KEY, SUPABASE_URL } from './helpers'

// Payment tests run on their own leases on the free unit D-03-2 (one per test, a different year each),
// so the seeded leases and payments stay untouched. afterAll removes what they created; audit_log rows
// are append-only and stay, so reset the database (db reset + seed) before the final checks.

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

interface Ids {
  unitFree: string
  tenantProbe: string
  tenantAisyah: string
  orgNorthwind: string
  orgBeta: string
  leaseAisyah: string
  leaseChen: string
  managerNorthwind: string
}
let ids: Ids
const token: Record<string, string> = {}
const leaseIds: string[] = []
const slipPaths: string[] = []
let nextYear = 2050

type PaymentBody = { amountSen?: unknown; method?: unknown; receivedAt?: unknown; slipPath?: unknown }
type Recorded = { id?: string; status?: string; error?: string }

// A lease with the given monthly rent and deposit, in a year no other test uses.
// start = YYYY-01-01, so a lease of N months has N rent periods plus the deposit.
async function freshLease(months = 1, rent = 100000, deposit = 0): Promise<{ id: string; year: number }> {
  const year = nextYear++
  const lastDay = new Date(Date.UTC(year, months, 0)).getUTCDate()
  const end = `${year}-${String(months).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  const res = await api<{ id: string }>('POST', '/api/leases', {
    token: token.manager,
    body: { unitId: ids.unitFree, tenantId: ids.tenantProbe, startDate: `${year}-01-01`, endDate: end, monthlyRentSen: rent, depositSen: deposit },
  })
  expect(res.status).toBe(201)
  leaseIds.push(res.body.id)
  return { id: res.body.id, year }
}

const RECEIVED = '2026-05-01T09:00:00+08:00'
const cash = (amountSen: number, extra: PaymentBody = {}): PaymentBody => ({ amountSen, method: 'cash', receivedAt: RECEIVED, ...extra })

function record(who: string, leaseId: string, body: unknown) {
  return api<Recorded>('POST', `/api/leases/${leaseId}/payments`, { token: token[who], body })
}
const approve = (who: string, paymentId: string) => api<{ status?: string; error?: string }>('POST', `/api/payments/${paymentId}/approve`, { token: token[who] })
const reject = (who: string, paymentId: string, body: unknown) => api<{ status?: string; error?: string }>('POST', `/api/payments/${paymentId}/reject`, { token: token[who], body })
const voidIt = (who: string, paymentId: string, body: unknown) => api<{ status?: string; error?: string }>('POST', `/api/payments/${paymentId}/void`, { token: token[who], body })
const lease = (who: string, leaseId: string) => api<LeaseDetailResponse>('GET', `/api/leases/${leaseId}`, { token: token[who] })

async function uploadSlip(who: string, orgId: string): Promise<string> {
  const path = `${orgId}/test-${randomUUID()}.png`
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/payment-slips/${path}`, {
    method: 'POST',
    headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${token[who]}`, 'Content-Type': 'image/png' },
    body: new Uint8Array(PNG),
  })
  expect(res.status).toBe(200)
  slipPaths.push(path)
  return path
}

async function slipExists(path: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`select count(*) as n from storage.objects where bucket_id = 'payment-slips' and name = ${path}`
  return Number(rows[0].n) === 1
}

const allocationsOf = (paymentId: string) => prisma.payment_allocations.findMany({ where: { payment_id: paymentId } })
const sum = (rows: Array<{ amount_sen: bigint }>) => rows.reduce((total, row) => total + Number(row.amount_sen), 0)

beforeAll(async () => {
  const find = async (q: Promise<{ id: string } | null>) => {
    const row = await q
    if (!row) throw new Error('Database is not seeded: run npm run seed')
    return row.id
  }
  ids = {
    unitFree: await find(prisma.units.findFirst({ where: { name: 'D-03-2' } })),
    tenantProbe: await find(prisma.tenants.findFirst({ where: { email: 'probe@northwind.test' } })),
    tenantAisyah: await find(prisma.tenants.findFirst({ where: { email: 'aisyah@northwind.test' } })),
    orgNorthwind: await find(prisma.organizations.findFirst({ where: { name: 'Northwind Properties' } })),
    orgBeta: await find(prisma.organizations.findFirst({ where: { name: 'Beta Realty' } })),
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
  if (leaseIds.length) {
    const payments = await prisma.payments.findMany({ where: { lease_id: { in: leaseIds } }, select: { id: true } })
    await prisma.payment_allocations.deleteMany({ where: { payment_id: { in: payments.map((p) => p.id) } } })
    await prisma.payments.deleteMany({ where: { lease_id: { in: leaseIds } } })
    await prisma.invoices.deleteMany({ where: { lease_id: { in: leaseIds } } })
    await prisma.leases.deleteMany({ where: { id: { in: leaseIds } } })
  }
  if (slipPaths.length) await adminClient().storage.from('payment-slips').remove(slipPaths)
  await prisma.$disconnect()
})

describe('seed data', () => {
  it("Aisyah's two payments are allocated as the brief describes", async () => {
    const { status, body } = await lease('aisyah', ids.leaseAisyah)
    expect(status).toBe(200)
    expect(body.payments.map((p) => [p.method, p.status, p.amountSen, p.receivedAt])).toEqual([
      ['cash', 'approved', 300000, '2026-01-31T10:00:00.000+08:00'],
      ['bank_transfer', 'approved', 200000, '2026-03-01T00:30:00.000+08:00'],
    ])
    expect(body.invoices.map((i) => i.paidSen)).toEqual([300000, 150000, 50000, 0, 0, 0, 0])
  })

  it("Northwind's collections for 2026-01..2026-03 match the brief", async () => {
    const res = await api('GET', '/api/reports/collections?from=2026-01&to=2026-03', { token: token.manager })
    expect(res.status).toBe(200)
    expect(res.body).toEqual([
      { month: '2026-01', collectedSen: 300000 },
      { month: '2026-02', collectedSen: 0 },
      { month: '2026-03', collectedSen: 200000 }, // received 2026-03-01 00:30 Malaysia = 2026-02-28 16:30 UTC
    ])
  })
})

describe('recording a payment and the cap', () => {
  it('approves and allocates a manager payment at once, and leaves a staff payment pending', async () => {
    const { id } = await freshLease(1, 100000)
    const m = await record('manager', id, cash(30000))
    expect(m.status).toBe(201)
    expect(Object.keys(m.body).sort()).toEqual(['id', 'status'])
    expect(m.body.status).toBe('approved')
    const s = await record('staff', id, cash(20000))
    expect(s.status).toBe(201)
    expect(s.body.status).toBe('pending_verification')

    const detail = (await lease('manager', id)).body
    expect(detail.invoices[0].paidSen).toBe(30000) // only the approved payment is allocated
    expect(detail.invoices[0].status).toBe('partially_paid')
    expect(detail.payments.map((p) => p.status).sort()).toEqual(['approved', 'pending_verification'])
    expect(sum(await allocationsOf(m.body.id as string))).toBe(30000)
    expect(await allocationsOf(s.body.id as string)).toHaveLength(0)
  })

  it('answers 422 when a payment is more than the remaining balance, accepts exactly the balance', async () => {
    const { id } = await freshLease(1, 100000)
    const over = await record('manager', id, cash(100001))
    expect(over.status).toBe(422)
    expect(hasErrorMessage(over.body)).toBe(true)
    expect((await record('manager', id, cash(100000))).status).toBe(201)
    expect((await record('manager', id, cash(1))).status).toBe(422) // nothing left
    expect((await lease('manager', id)).body.invoices[0].status).toBe('paid')
  })

  it('counts pending payments against the cap', async () => {
    const { id } = await freshLease(1, 100000)
    expect((await record('staff', id, cash(60000))).status).toBe(201)
    expect((await record('staff', id, cash(40001))).status).toBe(422)
    expect((await record('manager', id, cash(40001))).status).toBe(422)
    expect((await record('staff', id, cash(40000))).status).toBe(201)
    expect((await record('staff', id, cash(1))).status).toBe(422)
  })

  it('lets exactly one of RM 800 and RM 700 through when RM 1,000 remains', async () => {
    const { id } = await freshLease(1, 100000) // RM 1,000.00
    const [a, b] = await Promise.all([record('staff', id, cash(80000)), record('staff', id, cash(70000))])
    expect([a.status, b.status].sort()).toEqual([201, 422])
    const pending = await prisma.payments.findMany({ where: { lease_id: id, status: 'pending_verification' } })
    expect(pending).toHaveLength(1)
  })

  it('never lets simultaneous payments exceed the cap together', async () => {
    const { id } = await freshLease(1, 100000)
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => record(i % 2 === 0 ? 'staff' : 'manager', id, cash(30000))),
    )
    const accepted = results.filter((r) => r.status === 201)
    expect(accepted).toHaveLength(3) // 3 x 30000 = 90000 <= 100000 < 120000
    expect(results.filter((r) => r.status === 422)).toHaveLength(5)
    const all = await prisma.payments.findMany({ where: { lease_id: id } })
    expect(sum(all)).toBe(90000)
    const allocated = await prisma.payment_allocations.findMany({ where: { payments: { lease_id: id } } })
    expect(sum(allocated)).toBe(sum(all.filter((p) => p.status === 'approved')))
  })

  it('allows paying future periods in advance within the cap', async () => {
    const { id } = await freshLease(3, 100000) // three rent invoices, all due in the future
    expect((await record('manager', id, cash(250000))).status).toBe(201)
    const detail = (await lease('manager', id)).body
    expect(detail.invoices.map((i) => [i.paidSen, i.status])).toEqual([
      [100000, 'paid'],
      [100000, 'paid'],
      [50000, 'partially_paid'],
    ])
    expect((await record('manager', id, cash(50001))).status).toBe(422)
    expect((await record('manager', id, cash(50000))).status).toBe(201)
  })

  it('allocates by due date, then deposit before rent, then period index', async () => {
    const { id } = await freshLease(3, 100000, 50000) // deposit and rent 0 are both due on Jan 1
    expect((await record('manager', id, cash(120000))).status).toBe(201)
    const detail = (await lease('manager', id)).body
    expect(detail.invoices.map((i) => [i.kind, i.periodIndex, i.amountSen, i.paidSen])).toEqual([
      ['deposit', null, 50000, 50000],
      ['rent', 0, 100000, 70000],
      ['rent', 1, 100000, 0],
      ['rent', 2, 100000, 0],
    ])
  })
})

describe('recording: validation (400), never 500', () => {
  const invalid: Array<[string, PaymentBody]> = [
    ['amount 0', cash(0)],
    ['negative amount', cash(-5)],
    ['fractional amount', cash(1.5)],
    ['amount as a string', cash('100' as unknown as number)],
    ['amount null', cash(null as unknown as number)],
    ['amount beyond the safe integer range', cash(1e300)],
    ['missing amount', { method: 'cash', receivedAt: RECEIVED }],
    ['method online (only the webhook creates those)', cash(100, { method: 'online' })],
    ['unknown method', cash(100, { method: 'wire' })],
    ['missing method', { amountSen: 100, receivedAt: RECEIVED }],
    ['missing receivedAt', { amountSen: 100, method: 'cash' }],
    ['receivedAt without an offset', cash(100, { receivedAt: '2026-05-01T09:00:00' })],
    ['receivedAt on an impossible day', cash(100, { receivedAt: '2026-02-30T09:00:00+08:00' })],
    ['receivedAt at 24:00', cash(100, { receivedAt: '2026-05-01T24:00:00+08:00' })],
    ['receivedAt not a date', cash(100, { receivedAt: 'yesterday' })],
    ['receivedAt a number', cash(100, { receivedAt: 1767225600000 })],
    ['bank transfer without a slip', { amountSen: 100, method: 'bank_transfer', receivedAt: RECEIVED }],
    ['cash with a slip', cash(100, { slipPath: 'x/y.png' })],
  ]
  it.each(invalid)('rejects %s', async (_label, body) => {
    const { id } = await freshLease(1)
    const res = await record('manager', id, body)
    expect(res.status).toBe(400)
    expect(hasErrorMessage(res.body)).toBe(true)
    expect(await prisma.payments.count({ where: { lease_id: id } })).toBe(0)
  })

  it.each([
    ['text that is not JSON', 'nope'],
    ['an empty body', ''],
    ['a JSON array', '[]'],
    ['JSON null', 'null'],
  ])('rejects %s', async (_label, rawBody) => {
    const { id } = await freshLease(1)
    const res = await api<Recorded>('POST', `/api/leases/${id}/payments`, { token: token.manager, rawBody })
    expect(res.status).toBe(400)
  })

  it('rejects slip paths outside the caller\'s organization folder or pointing at nothing', async () => {
    const { id } = await freshLease(1)
    const bank = (slipPath: string): PaymentBody => ({ amountSen: 100, method: 'bank_transfer', receivedAt: RECEIVED, slipPath })
    for (const slipPath of [
      '../escape.png',
      `${ids.orgNorthwind}/../${ids.orgBeta}/x.png`,
      `${ids.orgBeta}/other-org.png`,
      `${ids.orgNorthwind}/does-not-exist.png`,
      `${ids.orgNorthwind}/`,
      '/absolute.png',
      'no-folder.png',
    ]) {
      const res = await record('staff', id, bank(slipPath))
      expect(res.status, slipPath).toBe(400)
    }
  })
})

describe('slips: stored with the payment, removed when recording fails', () => {
  it('records a bank transfer with an uploaded slip, and refuses to reuse the slip', async () => {
    const { id } = await freshLease(1)
    const slip = await uploadSlip('staff', ids.orgNorthwind)
    const first = await record('staff', id, { amountSen: 5000, method: 'bank_transfer', receivedAt: RECEIVED, slipPath: slip })
    expect(first.status).toBe(201)
    expect((await prisma.payments.findUniqueOrThrow({ where: { id: first.body.id } })).slip_path).toBe(slip)

    const reuse = await record('staff', id, { amountSen: 5000, method: 'bank_transfer', receivedAt: RECEIVED, slipPath: slip })
    expect(reuse.status).toBe(400)
    expect(await slipExists(slip)).toBe(true) // a failed request never deletes another payment's slip
  })

  it('removes the uploaded file when the payment is over the cap (422)', async () => {
    const { id } = await freshLease(1, 100000)
    const slip = await uploadSlip('staff', ids.orgNorthwind)
    expect(await slipExists(slip)).toBe(true)
    const res = await record('staff', id, { amountSen: 100001, method: 'bank_transfer', receivedAt: RECEIVED, slipPath: slip })
    expect(res.status).toBe(422)
    expect(await slipExists(slip)).toBe(false)
  })

  it('removes the uploaded file when the input is invalid (400)', async () => {
    const { id } = await freshLease(1)
    const slip = await uploadSlip('manager', ids.orgNorthwind)
    const res = await record('manager', id, { amountSen: 100, method: 'cash', receivedAt: RECEIVED, slipPath: slip })
    expect(res.status).toBe(400)
    expect(await slipExists(slip)).toBe(false)
  })

  it("removes the uploaded file when the lease belongs to another organization (404)", async () => {
    const slip = await uploadSlip('staff', ids.orgNorthwind)
    const res = await record('staff', ids.leaseChen, { amountSen: 100, method: 'bank_transfer', receivedAt: RECEIVED, slipPath: slip })
    expect(res.status).toBe(404)
    expect(await slipExists(slip)).toBe(false)
  })

  it("never deletes another organization's file", async () => {
    const { id } = await freshLease(1)
    const betaSlip = await uploadSlip('managerB', ids.orgBeta)
    const res = await record('staff', id, { amountSen: 100, method: 'bank_transfer', receivedAt: RECEIVED, slipPath: betaSlip })
    expect(res.status).toBe(400)
    expect(await slipExists(betaSlip)).toBe(true)
  })
})

describe('access: 401, 403, 404', () => {
  it('requires a login', async () => {
    const { id } = await freshLease(1)
    const pending = await record('staff', id, cash(100))
    const paymentId = pending.body.id as string
    expect((await api('POST', `/api/leases/${id}/payments`, { body: cash(1) })).status).toBe(401)
    for (const action of ['approve', 'reject', 'void']) {
      expect((await api('POST', `/api/payments/${paymentId}/${action}`, { body: { reason: 'because' } })).status).toBe(401)
    }
    expect((await api('GET', '/api/reports/collections?from=2026-01&to=2026-02')).status).toBe(401)
  })

  it('403: tenants cannot record; staff cannot approve, reject or void; tenants cannot either', async () => {
    const { id } = await freshLease(1)
    expect((await record('probe', id, cash(100))).status).toBe(403) // the lease's own tenant: visible, not allowed
    const pending = (await record('staff', id, cash(100))).body.id as string
    for (const who of ['staff', 'probe']) {
      expect((await approve(who, pending)).status, `${who} approve`).toBe(403)
      expect((await reject(who, pending, { reason: 'because' })).status, `${who} reject`).toBe(403)
      expect((await voidIt(who, pending, { reason: 'because' })).status, `${who} void`).toBe(403)
    }
    expect((await api('GET', '/api/reports/collections?from=2026-01&to=2026-02', { token: token.probe })).status).toBe(403)
    expect((await prisma.payments.findUniqueOrThrow({ where: { id: pending } })).status).toBe('pending_verification')
  })

  it("404: another organization's or another tenant's records look like they do not exist", async () => {
    const { id } = await freshLease(1)
    const pending = (await record('staff', id, cash(100))).body.id as string
    expect((await record('managerB', id, cash(100))).status).toBe(404)
    expect((await record('chen', id, cash(100))).status).toBe(404)
    expect((await record('ben', id, cash(100))).status).toBe(404) // another tenant, same organization
    for (const who of ['managerB', 'chen', 'ben']) {
      expect((await approve(who, pending)).status, `${who} approve`).toBe(404)
      expect((await reject(who, pending, { reason: 'because' })).status, `${who} reject`).toBe(404)
      expect((await voidIt(who, pending, { reason: 'because' })).status, `${who} void`).toBe(404)
    }
    expect((await approve('manager', randomUUID())).status).toBe(404)
    expect((await approve('manager', 'not-a-uuid')).status).toBe(404)
    expect((await prisma.payments.findUniqueOrThrow({ where: { id: pending } })).status).toBe('pending_verification')
  })
})

describe('approve, reject, void', () => {
  it('approves a pending payment, allocates it once, and refuses a second approval', async () => {
    const { id } = await freshLease(1, 100000)
    const paymentId = (await record('staff', id, cash(40000))).body.id as string
    const res = await approve('manager', paymentId)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'approved' })
    expect(sum(await allocationsOf(paymentId))).toBe(40000)
    expect((await approve('manager', paymentId)).status).toBe(409)
    expect(sum(await allocationsOf(paymentId))).toBe(40000)
  })

  it('allocates once when the same approval arrives several times at the same moment', async () => {
    const { id } = await freshLease(1, 100000)
    const paymentId = (await record('staff', id, cash(50000))).body.id as string
    const results = await Promise.all(Array.from({ length: 6 }, () => approve('manager', paymentId)))
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409, 409, 409, 409])
    expect(await allocationsOf(paymentId)).toHaveLength(1)
    expect(sum(await allocationsOf(paymentId))).toBe(50000)
    const audit = await prisma.audit_log.findMany({ where: { entity_id: paymentId, action: 'payment.approved' } })
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ actor_id: ids.managerNorthwind })
  })

  it('refuses an approval that no longer fits the balance and leaves the payment pending (422)', async () => {
    const { id } = await freshLease(1, 100000)
    const paymentId = (await record('staff', id, cash(60000))).body.id as string
    // Something else (an online payment, say) uses up the balance after the payment was recorded.
    const other = await prisma.payments.create({
      data: { org_id: ids.orgNorthwind, lease_id: id, amount_sen: BigInt(70000), method: 'cash', status: 'approved', received_at: new Date() },
    })
    const invoice = await prisma.invoices.findFirstOrThrow({ where: { lease_id: id } })
    await prisma.payment_allocations.create({ data: { org_id: ids.orgNorthwind, payment_id: other.id, invoice_id: invoice.id, amount_sen: BigInt(70000) } })

    const res = await approve('manager', paymentId)
    expect(res.status).toBe(422)
    expect(hasErrorMessage(res.body)).toBe(true)
    expect((await prisma.payments.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe('pending_verification')
    expect(await allocationsOf(paymentId)).toHaveLength(0)
  })

  it('rejects with a reason of at least 5 characters, once', async () => {
    const { id } = await freshLease(1, 100000)
    const paymentId = (await record('staff', id, cash(10000))).body.id as string
    for (const body of [undefined, {}, { reason: '' }, { reason: 'abcd' }, { reason: '     ' }, { reason: ' ab  ' }, { reason: 12345 }, { reason: null }]) {
      expect((await reject('manager', paymentId, body)).status, JSON.stringify(body)).toBe(400)
    }
    const res = await reject('manager', paymentId, { reason: 'Slip is unreadable' })
    expect(res).toMatchObject({ status: 200, body: { status: 'rejected' } })
    expect((await reject('manager', paymentId, { reason: 'Slip is unreadable' })).status).toBe(409)
    expect((await approve('manager', paymentId)).status).toBe(409)
    expect((await voidIt('manager', paymentId, { reason: 'Slip is unreadable' })).status).toBe(409)
    const stored = await prisma.payments.findUniqueOrThrow({ where: { id: paymentId } })
    expect(stored).toMatchObject({ status: 'rejected', decision_reason: 'Slip is unreadable', decided_by: ids.managerNorthwind })
    expect(await allocationsOf(paymentId)).toHaveLength(0)
    const audit = await prisma.audit_log.findFirstOrThrow({ where: { entity_id: paymentId, action: 'payment.rejected' } })
    expect(audit.details).toMatchObject({ reason: 'Slip is unreadable' })
  })

  it('answers 400 for a missing reason before it answers 409 for a payment in the wrong state', async () => {
    const { id } = await freshLease(1, 100000)
    const approved = (await record('manager', id, cash(10000))).body.id as string
    expect((await reject('manager', approved, {})).status).toBe(400)
    expect((await reject('manager', approved, { reason: 'valid reason' })).status).toBe(409)
  })

  it("voids an approved payment: its allocations disappear, other payments' allocations stay", async () => {
    const { id } = await freshLease(2, 100000) // two rent invoices of RM 1,000.00
    const first = (await record('manager', id, cash(100000))).body.id as string
    const second = (await record('manager', id, cash(50000))).body.id as string
    expect(sum(await allocationsOf(first))).toBe(100000)
    const secondBefore = await allocationsOf(second)

    for (const body of [undefined, {}, { reason: 'abcd' }, { reason: '    ' }]) {
      expect((await voidIt('manager', first, body)).status, JSON.stringify(body)).toBe(400)
    }
    const res = await voidIt('manager', first, { reason: 'Entered twice by mistake' })
    expect(res).toMatchObject({ status: 200, body: { status: 'voided' } })

    expect(await allocationsOf(first)).toHaveLength(0)
    expect(await allocationsOf(second)).toEqual(secondBefore) // untouched
    const detail = (await lease('manager', id)).body
    expect(detail.invoices.map((i) => i.paidSen)).toEqual([0, 50000]) // invoice 0 reopened, invoice 1 still holds the second payment
    expect(detail.payments.find((p) => p.id === first)?.status).toBe('voided')

    expect((await voidIt('manager', first, { reason: 'Entered twice by mistake' })).status).toBe(409)
    expect((await approve('manager', first)).status).toBe(409)
    const audit = await prisma.audit_log.findFirstOrThrow({ where: { entity_id: first, action: 'payment.voided' } })
    expect(audit.details).toMatchObject({ reason: 'Entered twice by mistake', removedAllocations: 1 })

    // the freed balance can be paid again
    expect((await record('manager', id, cash(150000))).status).toBe(201)
  })

  it('only voids approved payments; a pending one is a 409', async () => {
    const { id } = await freshLease(1, 100000)
    const pending = (await record('staff', id, cash(100))).body.id as string
    expect((await voidIt('manager', pending, { reason: 'not approved yet' })).status).toBe(409)
  })
})

describe('GET /api/reports/collections', () => {
  const report = (who: string, query: string) => api<Array<{ month: string; collectedSen: number }>>('GET', `/api/reports/collections${query}`, { token: token[who] })

  it('returns one entry per month, zeros included, with exactly the documented keys', async () => {
    const res = await report('staff', '?from=2025-11&to=2026-04')
    expect(res.status).toBe(200)
    expect(res.body.map((m) => m.month)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04'])
    expect(res.body.map((m) => m.collectedSen)).toEqual([0, 0, 300000, 0, 200000, 0])
    for (const entry of res.body) expect(Object.keys(entry).sort()).toEqual(['collectedSen', 'month'])
    expect((await report('manager', '?from=2026-03&to=2026-03')).body).toEqual([{ month: '2026-03', collectedSen: 200000 }])
  })

  it('shows each organization only its own collections', async () => {
    const res = await report('managerB', '?from=2026-01&to=2026-03')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([
      { month: '2026-01', collectedSen: 0 },
      { month: '2026-02', collectedSen: 0 },
      { month: '2026-03', collectedSen: 0 },
    ])
  })

  it('assigns months by Malaysia time, counts only approved payments, and drops voided ones', async () => {
    const { id } = await freshLease(12, 100000)
    const pay = async (who: string, amount: number, receivedAt: string) => (await record(who, id, cash(amount, { receivedAt }))).body.id as string
    await pay('manager', 100, '2090-03-31T23:59:59+08:00') // last second of March in Malaysia
    await pay('manager', 200, '2090-03-31T16:00:00Z') // = 2090-04-01 00:00 Malaysia: April, although it is still March in UTC
    await pay('manager', 400, '2090-04-30T15:59:59Z') // = 2090-04-30 23:59:59 Malaysia: April
    await pay('manager', 800, '2090-04-30T16:00:00Z') // = 2090-05-01 00:00 Malaysia: May
    await pay('staff', 1600, '2090-04-10T12:00:00+08:00') // pending: not counted
    const rejected = await pay('staff', 3200, '2090-04-11T12:00:00+08:00')
    await reject('manager', rejected, { reason: 'wrong amount' })
    const voided = await pay('manager', 6400, '2090-04-12T12:00:00+08:00')
    await voidIt('manager', voided, { reason: 'entered twice' })

    const res = await report('manager', '?from=2090-02&to=2090-06')
    expect(res.body).toEqual([
      { month: '2090-02', collectedSen: 0 },
      { month: '2090-03', collectedSen: 100 },
      { month: '2090-04', collectedSen: 600 },
      { month: '2090-05', collectedSen: 800 },
      { month: '2090-06', collectedSen: 0 },
    ])
  })

  it.each([
    ['no parameters', ''],
    ['only from', '?from=2026-01'],
    ['only to', '?to=2026-03'],
    ['from after to', '?from=2026-04&to=2026-03'],
    ['month 13', '?from=2026-01&to=2026-13'],
    ['month 00', '?from=2026-00&to=2026-02'],
    ['unpadded month', '?from=2026-1&to=2026-03'],
    ['a full date', '?from=2026-01-01&to=2026-03-01'],
    ['text', '?from=abc&to=def'],
    ['empty values', '?from=&to='],
  ])('answers 400 for %s', async (_label, query) => {
    const res = await report('manager', query)
    expect(res.status).toBe(400)
    expect(hasErrorMessage(res.body)).toBe(true)
  })
})
