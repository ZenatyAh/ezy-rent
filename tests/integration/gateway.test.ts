import { createHmac, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { malaysiaDate } from '@/lib/billing'
import { prisma } from '@/lib/prisma'
import type { LeaseDetailResponse } from '@/lib/serializers'
import { api, BASE_URL, cookieHeaderFor, hasErrorMessage, login } from './helpers'

// Gateway tests run on their own leases on the free unit D-03-2 (one per test, a different year in the
// past, so every invoice is already due). afterAll removes what they created; audit_log rows are
// append-only and stay, so reset the database (db reset + seed) before the final checks.

const KEY = process.env.GATEWAY_X_SIGNATURE_KEY ?? ''

// The brief's signing algorithm, written out again here on purpose instead of importing the app's code.
function sign(fields: Record<string, string>, key = KEY): string {
  const source = Object.keys(fields)
    .filter((k) => k !== 'x_signature')
    .sort()
    .map((k) => `${k}${fields[k]}`)
    .join('|')
  return createHmac('sha256', key).update(source).digest('hex')
}

let unitFree: string
let tenantProbe: string
let orgNorthwind: string
const token: Record<string, string> = {}
const leaseIds: string[] = []
let nextYear = 1990

interface Bill {
  billId: string
  amountSen: number
}

// A lease whose 4 invoices (deposit 50000, rent 3 x 100000) are all due: RM 3,500.00 to pay.
async function dueLease(): Promise<string> {
  const year = nextYear++
  const res = await api<{ id: string }>('POST', '/api/leases', {
    token: token.manager,
    body: { unitId: unitFree, tenantId: tenantProbe, startDate: `${year}-01-01`, endDate: `${year}-03-31`, monthlyRentSen: 100000, depositSen: 50000 },
  })
  expect(res.status).toBe(201)
  leaseIds.push(res.body.id)
  return res.body.id
}

async function newBill(leaseId: string, who = 'probe'): Promise<Bill> {
  const res = await api<Bill>('POST', `/api/leases/${leaseId}/gateway-bills`, { token: token[who] })
  expect(res.status).toBe(201)
  return res.body
}

function fieldsFor(bill: Bill, over: Record<string, string> = {}): Record<string, string> {
  return {
    id: bill.billId,
    paid: 'true',
    paid_amount: String(bill.amountSen),
    paid_at: '2026-04-01 00:30:12 +0800',
    transaction_id: `TX-${randomUUID()}`,
    transaction_status: 'completed',
    ...over,
  }
}

interface Delivery {
  key?: string
  signature?: string | null // null: send no x_signature at all
  mutate?: (fields: Record<string, string>) => Record<string, string> // applied AFTER signing
}

async function deliver(fields: Record<string, string>, options: Delivery = {}) {
  const signed: Record<string, string> = { ...fields }
  delete signed.x_signature
  if (options.signature !== null) signed.x_signature = options.signature ?? sign(signed, options.key)
  const body = new URLSearchParams(options.mutate ? options.mutate(signed) : signed)
  const res = await fetch(`${BASE_URL}/api/webhooks/gateway`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  const text = await res.text()
  let parsed: unknown = text
  try {
    parsed = JSON.parse(text)
  } catch {
    // not JSON
  }
  return { status: res.status, body: parsed as { ok?: boolean; error?: string } }
}

const billRow = (billId: string) => prisma.gateway_bills.findUniqueOrThrow({ where: { id: billId } })
const paymentsOf = (billId: string) => prisma.payments.findMany({ where: { gateway_bill_id: billId } })
const lease = (who: string, leaseId: string) => api<LeaseDetailResponse>('GET', `/api/leases/${leaseId}`, { token: token[who] })

beforeAll(async () => {
  expect(KEY.length).toBeGreaterThan(0)
  const find = async (q: Promise<{ id: string } | null>) => {
    const row = await q
    if (!row) throw new Error('Database is not seeded: run npm run seed')
    return row.id
  }
  unitFree = await find(prisma.units.findFirst({ where: { name: 'D-03-2' } }))
  tenantProbe = await find(prisma.tenants.findFirst({ where: { email: 'probe@northwind.test' } }))
  orgNorthwind = await find(prisma.organizations.findFirst({ where: { name: 'Northwind Properties' } }))
  for (const [who, email] of Object.entries({
    manager: 'manager@northwind.test',
    staff: 'staff@northwind.test',
    probe: 'probe@northwind.test',
    ben: 'ben@northwind.test',
    aisyah: 'aisyah@northwind.test',
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
    await prisma.gateway_bills.deleteMany({ where: { lease_id: { in: leaseIds } } })
    await prisma.invoices.deleteMany({ where: { lease_id: { in: leaseIds } } })
    await prisma.leases.deleteMany({ where: { id: { in: leaseIds } } })
  }
  await prisma.$disconnect()
})

describe('POST /api/leases/:leaseId/gateway-bills', () => {
  it('creates a bill for everything due: 201 { billId, amountSen }', async () => {
    const id = await dueLease()
    const res = await api<Bill>('POST', `/api/leases/${id}/gateway-bills`, { token: token.probe })
    expect(res.status).toBe(201)
    expect(Object.keys(res.body).sort()).toEqual(['amountSen', 'billId'])
    expect(res.body.amountSen).toBe(350000)
    expect(res.body.billId).toMatch(/^bill_[0-9a-f]{32}$/)
    const stored = await billRow(res.body.billId)
    expect(stored).toMatchObject({ status: 'pending', lease_id: id, org_id: orgNorthwind })
    expect(Number(stored.amount_sen)).toBe(350000)
  })

  it('makes bill ids that cannot be guessed (122 random bits, all different)', async () => {
    const id = await dueLease()
    const ids = await Promise.all(Array.from({ length: 5 }, () => newBill(id)))
    expect(new Set(ids.map((b) => b.billId)).size).toBe(5)
  })

  it('bills only what is unpaid: an approved payment lowers it, a pending one does not', async () => {
    const id = await dueLease()
    const pay = (who: string, amountSen: number) =>
      api('POST', `/api/leases/${id}/payments`, { token: token[who], body: { amountSen, method: 'cash', receivedAt: '2026-05-01T09:00:00+08:00' } })
    expect((await pay('staff', 20000)).status).toBe(201) // pending: not allocated yet
    expect((await newBill(id)).amountSen).toBe(350000)
    expect((await pay('manager', 80000)).status).toBe(201) // approved: deposit 50000 + 30000 of rent 0
    expect((await newBill(id)).amountSen).toBe(270000)
  })

  it("counts invoices due today (Malaysia date) but not tomorrow's", async () => {
    const today = malaysiaDate(new Date())
    const [y, m] = today.split('-').map(Number)
    const end = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10) // last day of next month: 2 rent periods
    const res = await api<{ id: string }>('POST', '/api/leases', {
      token: token.manager,
      body: { unitId: unitFree, tenantId: tenantProbe, startDate: today, endDate: end, monthlyRentSen: 100000, depositSen: 50000 },
    })
    expect(res.status).toBe(201)
    leaseIds.push(res.body.id)
    // the deposit and rent 0 are due today (included); rent 1 is due next month (not included)
    expect((await newBill(res.body.id)).amountSen).toBe(150000)
  })

  it('answers 422 when nothing is due yet', async () => {
    const res0 = await api<{ id: string }>('POST', '/api/leases', {
      token: token.manager,
      body: { unitId: unitFree, tenantId: tenantProbe, startDate: '2070-01-01', endDate: '2070-03-31', monthlyRentSen: 100000, depositSen: 50000 },
    })
    expect(res0.status).toBe(201)
    leaseIds.push(res0.body.id)
    const res = await api<{ error: string }>('POST', `/api/leases/${res0.body.id}/gateway-bills`, { token: token.probe })
    expect(res.status).toBe(422)
    expect(hasErrorMessage(res.body)).toBe(true)
    expect(await prisma.gateway_bills.count({ where: { lease_id: res0.body.id } })).toBe(0)
  })

  it('answers 422 once everything that is due has been paid', async () => {
    const id = await dueLease()
    const pay = await api('POST', `/api/leases/${id}/payments`, { token: token.manager, body: { amountSen: 350000, method: 'cash', receivedAt: '2026-05-01T09:00:00+08:00' } })
    expect(pay.status).toBe(201)
    expect((await api('POST', `/api/leases/${id}/gateway-bills`, { token: token.probe })).status).toBe(422)
  })

  it('401 without a login; 403 for staff and managers; 404 for another tenant or organization', async () => {
    const id = await dueLease()
    expect((await api('POST', `/api/leases/${id}/gateway-bills`)).status).toBe(401)
    expect((await api('POST', `/api/leases/${id}/gateway-bills`, { token: token.staff })).status).toBe(403)
    expect((await api('POST', `/api/leases/${id}/gateway-bills`, { token: token.manager })).status).toBe(403)
    for (const who of ['ben', 'aisyah', 'chen', 'managerB']) {
      expect((await api('POST', `/api/leases/${id}/gateway-bills`, { token: token[who] })).status, who).toBe(404)
    }
    expect((await api('POST', `/api/leases/${randomUUID()}/gateway-bills`, { token: token.probe })).status).toBe(404)
    expect((await api('POST', '/api/leases/not-a-uuid/gateway-bills', { token: token.probe })).status).toBe(404)
    expect(await prisma.gateway_bills.count({ where: { lease_id: id } })).toBe(0)
  })
})

describe('POST /api/webhooks/gateway: the signature', () => {
  async function untouched(bill: Bill) {
    expect((await billRow(bill.billId)).status).toBe('pending')
    expect(await paymentsOf(bill.billId)).toHaveLength(0)
  }

  it('401 and no effect when the signature is missing, wrong, or from another key', async () => {
    const bill = await newBill(await dueLease())
    const fields = fieldsFor(bill)
    for (const [label, options] of [
      ['no x_signature', { signature: null }],
      ['empty signature', { signature: '' }],
      ['random signature', { signature: 'a'.repeat(64) }],
      ['upper-case signature', { signature: sign(fields).toUpperCase() }],
      ['signed with another key', { key: 'not_the_key' }],
    ] as const) {
      const res = await deliver(fields, options)
      expect(res.status, label).toBe(401)
      expect(hasErrorMessage(res.body), label).toBe(true)
    }
    await untouched(bill)
  })

  it('401 when any field is changed, added or removed after signing', async () => {
    const bill = await newBill(await dueLease())
    const fields = fieldsFor(bill)
    const tampered: Array<[string, Delivery['mutate']]> = [
      ['changed paid_amount', (f) => ({ ...f, paid_amount: String(bill.amountSen + 1) })],
      ['changed id', (f) => ({ ...f, id: `${bill.billId}x` })],
      ['changed paid', (f) => ({ ...f, paid: 'false' })],
      ['changed paid_at', (f) => ({ ...f, paid_at: '2026-04-02 00:30:12 +0800' })],
      ['added field', (f) => ({ ...f, extra: '1' })],
      ['removed field', (f) => Object.fromEntries(Object.entries(f).filter(([k]) => k !== 'transaction_id'))],
    ]
    for (const [label, mutate] of tampered) {
      expect((await deliver(fields, { mutate })).status, label).toBe(401)
    }
    await untouched(bill)
  })

  it('401 for an empty body, plain text and a repeated field name', async () => {
    const bill = await newBill(await dueLease())
    const post = (body: string, type = 'application/x-www-form-urlencoded') =>
      fetch(`${BASE_URL}/api/webhooks/gateway`, { method: 'POST', headers: { 'content-type': type }, body })
    expect((await post('')).status).toBe(401)
    expect((await post('hello')).status).toBe(401)
    expect((await post(JSON.stringify(fieldsFor(bill)), 'application/json')).status).toBe(401)
    const fields = fieldsFor(bill)
    const duplicated = `${new URLSearchParams({ ...fields, x_signature: sign(fields) }).toString()}&paid=false`
    expect((await post(duplicated)).status).toBe(401)
    await untouched(bill)
  })

  it('accepts fields the gateway may add later, as long as the signature covers them', async () => {
    const bill = await newBill(await dueLease())
    const res = await deliver(fieldsFor(bill, { future_field: 'x y', another_one: '1' }))
    expect(res.status).toBe(200)
    expect((await billRow(bill.billId)).status).toBe('paid')
  })

  it('does not care in which order the fields arrive', async () => {
    const bill = await newBill(await dueLease())
    const res = await deliver(fieldsFor(bill), { mutate: (f) => Object.fromEntries(Object.entries(f).reverse()) })
    expect(res.status).toBe(200)
  })
})

describe('POST /api/webhooks/gateway: outcomes', () => {
  it('404 for an unknown bill (valid signature), whether paid is true or false', async () => {
    for (const paid of ['true', 'false']) {
      const res = await deliver(fieldsFor({ billId: 'bill_00000000000000000000000000000000', amountSen: 100 }, { paid }))
      expect(res.status, paid).toBe(404)
    }
  })

  it('422 when paid_amount is not the bill amount, and nothing changes', async () => {
    const bill = await newBill(await dueLease())
    for (const amount of [bill.amountSen - 1, bill.amountSen + 1, 1, 0, bill.amountSen * 10]) {
      const res = await deliver(fieldsFor(bill, { paid_amount: String(amount) }))
      expect(res.status, String(amount)).toBe(422)
    }
    expect((await billRow(bill.billId)).status).toBe('pending')
    expect(await paymentsOf(bill.billId)).toHaveLength(0)
  })

  it('400 for a signed callback whose fields are not valid (paid_amount, paid_at, paid, id)', async () => {
    const bill = await newBill(await dueLease())
    const bad: Array<[string, Record<string, string>]> = [
      ['paid_amount with decimals', { paid_amount: '3500.50' }],
      ['paid_amount in exponent form', { paid_amount: '3.5e5' }],
      ['paid_amount negative', { paid_amount: '-350000' }],
      ['paid_amount with a sign', { paid_amount: '+350000' }],
      ['paid_amount text', { paid_amount: 'abc' }],
      ['paid_amount empty', { paid_amount: '' }],
      ['paid_amount with spaces', { paid_amount: ' 350000' }],
      ['paid_at in ISO 8601', { paid_at: '2026-04-01T00:30:12+08:00' }],
      ['paid_at with a colon in the offset', { paid_at: '2026-04-01 00:30:12 +08:00' }],
      ['paid_at without an offset', { paid_at: '2026-04-01 00:30:12' }],
      ['paid_at an impossible day', { paid_at: '2026-02-30 00:30:12 +0800' }],
      ['paid_at empty', { paid_at: '' }],
      ['paid neither true nor false', { paid: 'yes' }],
      ['paid empty', { paid: '' }],
      ['id empty', { id: '' }],
    ]
    for (const [label, over] of bad) {
      const res = await deliver(fieldsFor(bill, over))
      expect(res.status, label).toBe(400)
      expect(hasErrorMessage(res.body), label).toBe(true)
    }
    for (const missing of ['paid_amount', 'paid_at', 'paid', 'id']) {
      const fields = fieldsFor(bill)
      delete fields[missing]
      expect((await deliver(fields)).status, `missing ${missing}`).toBe(400)
    }
    expect((await billRow(bill.billId)).status).toBe('pending')
    expect(await paymentsOf(bill.billId)).toHaveLength(0)
  })

  it('paid=true on a pending bill: bill paid, ONE approved online payment, received_at = paid_at, allocated', async () => {
    const id = await dueLease()
    const bill = await newBill(id)
    const res = await deliver(fieldsFor(bill, { paid_at: '2026-04-01 00:30:12 +0800' }))
    expect(res).toMatchObject({ status: 200, body: { ok: true } })

    expect((await billRow(bill.billId)).status).toBe('paid')
    const payments = await paymentsOf(bill.billId)
    expect(payments).toHaveLength(1)
    expect(payments[0]).toMatchObject({ method: 'online', status: 'approved', org_id: orgNorthwind, lease_id: id, slip_path: null })
    expect(Number(payments[0].amount_sen)).toBe(bill.amountSen)
    // "2026-04-01 00:30:12 +0800" is 2026-03-31 16:30:12 UTC
    expect(payments[0].received_at.toISOString()).toBe('2026-03-31T16:30:12.000Z')

    const detail = (await lease('probe', id)).body
    expect(detail.invoices.map((i) => [i.amountSen, i.paidSen, i.status])).toEqual([
      [50000, 50000, 'paid'],
      [100000, 100000, 'paid'],
      [100000, 100000, 'paid'],
      [100000, 100000, 'paid'],
    ])
    expect(detail.payments).toEqual([
      expect.objectContaining({ amountSen: 350000, unappliedSen: 0, method: 'online', status: 'approved', receivedAt: '2026-04-01T00:30:12.000+08:00' }),
    ])
    const audit = await prisma.audit_log.findFirstOrThrow({ where: { entity_id: payments[0].id } })
    expect(audit).toMatchObject({ action: 'payment.approved', actor_id: null, org_id: orgNorthwind })
  })

  it('a repeated paid=true delivery is a 200 with no further effect', async () => {
    const id = await dueLease()
    const bill = await newBill(id)
    const fields = fieldsFor(bill)
    expect((await deliver(fields)).status).toBe(200)
    for (let i = 0; i < 3; i++) expect((await deliver(fieldsFor(bill))).status).toBe(200) // new transaction_id each time
    expect(await paymentsOf(bill.billId)).toHaveLength(1)
    expect(await prisma.payment_allocations.count({ where: { payments: { lease_id: id } } })).toBe(4)
  })

  it('422 for a wrong amount even when the bill is already paid; nothing changes', async () => {
    const bill = await newBill(await dueLease())
    expect((await deliver(fieldsFor(bill))).status).toBe(200)
    expect((await deliver(fieldsFor(bill, { paid_amount: '1' }))).status).toBe(422)
    expect(await paymentsOf(bill.billId)).toHaveLength(1)
  })

  it('paid=false on a pending bill fails it; a repeat is a 200; paid=true can still settle a failed bill', async () => {
    const bill = await newBill(await dueLease())
    expect(await deliver(fieldsFor(bill, { paid: 'false', paid_amount: '0', transaction_status: 'failed' }))).toMatchObject({ status: 200 })
    expect((await billRow(bill.billId)).status).toBe('failed')
    expect((await deliver(fieldsFor(bill, { paid: 'false', paid_amount: '0' }))).status).toBe(200)
    expect((await billRow(bill.billId)).status).toBe('failed')
    expect(await paymentsOf(bill.billId)).toHaveLength(0)

    expect((await deliver(fieldsFor(bill))).status).toBe(200)
    expect((await billRow(bill.billId)).status).toBe('paid')
    expect(await paymentsOf(bill.billId)).toHaveLength(1)
  })

  it('a paid bill never goes back: a late paid=false is a 200 and changes nothing', async () => {
    const bill = await newBill(await dueLease())
    expect((await deliver(fieldsFor(bill))).status).toBe(200)
    expect((await deliver(fieldsFor(bill, { paid: 'false', paid_amount: '0', transaction_status: 'failed' }))).status).toBe(200)
    expect((await billRow(bill.billId)).status).toBe('paid')
    expect(await paymentsOf(bill.billId)).toHaveLength(1)
  })

  it('keeps what does not fit as unapplied when invoices were paid after the bill was created', async () => {
    const id = await dueLease()
    const bill = await newBill(id)
    const pay = await api('POST', `/api/leases/${id}/payments`, { token: token.manager, body: { amountSen: 350000, method: 'cash', receivedAt: '2026-05-01T09:00:00+08:00' } })
    expect(pay.status).toBe(201) // everything is now paid by cash
    expect((await deliver(fieldsFor(bill))).status).toBe(200)
    const [payment] = await paymentsOf(bill.billId)
    expect(payment).toMatchObject({ method: 'online', status: 'approved' })
    expect(Number(payment.unapplied_sen)).toBe(350000)
    expect(await prisma.payment_allocations.count({ where: { payment_id: payment.id } })).toBe(0)
    const detail = (await lease('manager', id)).body
    expect(detail.payments.find((p) => p.method === 'online')?.unappliedSen).toBe(350000)
  })
})

describe('POST /api/webhooks/gateway: duplicates and races', () => {
  it('creates exactly one payment when 10 identical deliveries arrive at the same moment', async () => {
    const id = await dueLease()
    const bill = await newBill(id)
    const fields = fieldsFor(bill) // identical callback, delivered 10 times at once
    const results = await Promise.all(Array.from({ length: 10 }, () => deliver(fields)))
    expect(results.map((r) => r.status)).toEqual(Array(10).fill(200))
    expect((await billRow(bill.billId)).status).toBe('paid')
    const payments = await paymentsOf(bill.billId)
    expect(payments).toHaveLength(1)
    const allocations = await prisma.payment_allocations.findMany({ where: { payment_id: payments[0].id } })
    expect(allocations.reduce((sum, a) => sum + Number(a.amount_sen), 0)).toBe(bill.amountSen)
    expect(await prisma.audit_log.count({ where: { entity_id: payments[0].id } })).toBe(1)
  })

  it('creates exactly one payment when paid=true and paid=false deliveries race', async () => {
    const id = await dueLease()
    const bill = await newBill(id)
    const deliveries = Array.from({ length: 12 }, (_, i) =>
      i % 2 === 0 ? deliver(fieldsFor(bill)) : deliver(fieldsFor(bill, { paid: 'false', paid_amount: '0', transaction_status: 'failed' })),
    )
    const results = await Promise.all(deliveries)
    expect(results.every((r) => r.status === 200)).toBe(true)
    expect((await billRow(bill.billId)).status).toBe('paid') // a paid bill never goes back, whatever the order
    expect(await paymentsOf(bill.billId)).toHaveLength(1)
  })

  it('serializes simultaneous bills settling on one lease: no invoice is paid twice', async () => {
    const id = await dueLease()
    const bills = await Promise.all([newBill(id), newBill(id), newBill(id)]) // 3 x RM 3,500.00 on a RM 3,500.00 lease
    const results = await Promise.all(bills.map((b) => deliver(fieldsFor(b))))
    expect(results.every((r) => r.status === 200)).toBe(true)
    const detail = (await lease('manager', id)).body
    expect(detail.invoices.every((i) => i.paidSen === i.amountSen)).toBe(true) // never more than the invoice
    const payments = await prisma.payments.findMany({ where: { lease_id: id } })
    expect(payments).toHaveLength(3)
    const unapplied = payments.reduce((sum, p) => sum + Number(p.unapplied_sen), 0)
    expect(unapplied).toBe(2 * 350000) // one payment filled the lease, the other two are all unapplied
  })
})

describe('/payments/return only displays, it never settles', () => {
  const page = async (billId: string, cookie?: string, query = 'paid=true') => {
    const res = await fetch(`${BASE_URL}/payments/return?bill_id=${billId}&${query}`, { headers: cookie ? { Cookie: cookie } : {} })
    const html = await res.text()
    return {
      status: res.status,
      html,
      state: /data-testid="bill-status"[^>]*>([a-z]+)</.exec(html)?.[1] ?? null,
      notFound: html.includes('data-testid="bill-not-found"'),
    }
  }

  it('leaves a pending bill pending when visited with paid=true, and shows the real status', async () => {
    const id = await dueLease()
    const bill = await newBill(id)
    const cookie = await cookieHeaderFor('probe@northwind.test')
    for (const query of ['paid=true', 'paid=true&transaction_status=completed', 'paid=false', '']) {
      const view = await page(bill.billId, cookie, query)
      expect(view.status).toBe(200)
      expect(view.state, query).toBe('pending')
    }
    expect((await billRow(bill.billId)).status).toBe('pending')
    expect(await paymentsOf(bill.billId)).toHaveLength(0)
    expect(await prisma.payment_allocations.count({ where: { payments: { lease_id: id } } })).toBe(0)
    const detail = (await lease('probe', id)).body
    expect(detail.invoices.every((i) => i.paidSen === 0)).toBe(true)
    expect(detail.payments).toEqual([])
  })

  it('shows paid only after the webhook has settled it, and failed after a failed callback', async () => {
    const cookie = await cookieHeaderFor('probe@northwind.test')
    const paidBill = await newBill(await dueLease())
    await deliver(fieldsFor(paidBill))
    expect((await page(paidBill.billId, cookie, 'paid=false')).state).toBe('paid') // the URL does not matter
    const failedBill = await newBill(await dueLease())
    await deliver(fieldsFor(failedBill, { paid: 'false', paid_amount: '0' }))
    expect((await page(failedBill.billId, cookie, 'paid=true')).state).toBe('failed')
  })

  it('shows the amount in ringgit', async () => {
    const bill = await newBill(await dueLease())
    const view = await page(bill.billId, await cookieHeaderFor('probe@northwind.test'))
    expect(view.html).toContain('RM 3,500.00')
  })

  it('says "not found" without a login, for another tenant or organization, and for unknown ids', async () => {
    const bill = await newBill(await dueLease())
    expect((await page(bill.billId)).notFound).toBe(true)
    expect((await page(bill.billId, await cookieHeaderFor('ben@northwind.test'))).notFound).toBe(true)
    expect((await page(bill.billId, await cookieHeaderFor('manager@beta.test'))).notFound).toBe(true)
    expect((await page('bill_00000000000000000000000000000000', await cookieHeaderFor('probe@northwind.test'))).notFound).toBe(true)
    expect((await page('', await cookieHeaderFor('probe@northwind.test'))).notFound).toBe(true)
    const staffView = await page(bill.billId, await cookieHeaderFor('staff@northwind.test'))
    expect(staffView.state).toBe('pending') // the organization's own staff may look
    expect((await billRow(bill.billId)).status).toBe('pending')
  })
})
