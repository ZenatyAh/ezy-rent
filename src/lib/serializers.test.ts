import { describe, expect, it } from 'vitest'
import { serializeLeaseDetail, type InvoiceRow, type LeaseRow, type PaymentRow } from './serializers'

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`) // how Prisma returns a DATE column

const lease: LeaseRow = {
  id: 'lease-1',
  unit_id: 'unit-1',
  tenant_id: 'tenant-1',
  start_date: day('2026-01-31'),
  end_date: day('2026-07-15'),
  monthly_rent_sen: BigInt(150000),
  deposit_sen: BigInt(300000),
}

const invoices: InvoiceRow[] = [
  {
    id: 'inv-deposit',
    kind: 'deposit',
    period_index: null,
    period_start: null,
    period_end: null,
    due_date: day('2026-01-31'),
    amount_sen: BigInt(300000),
    payment_allocations: [{ amount_sen: BigInt(300000) }],
  },
  {
    id: 'inv-0',
    kind: 'rent',
    period_index: 0,
    period_start: day('2026-01-31'),
    period_end: day('2026-02-27'),
    due_date: day('2026-01-31'),
    amount_sen: BigInt(150000),
    payment_allocations: [{ amount_sen: BigInt(50000) }, { amount_sen: BigInt(25000) }],
  },
  {
    id: 'inv-1',
    kind: 'rent',
    period_index: 1,
    period_start: day('2026-02-28'),
    period_end: day('2026-03-30'),
    due_date: day('2026-02-28'),
    amount_sen: BigInt(150000),
    payment_allocations: [],
  },
]

const payments: PaymentRow[] = [
  {
    id: 'pay-1',
    amount_sen: BigInt(200000),
    unapplied_sen: BigInt(0),
    method: 'bank_transfer',
    status: 'approved',
    received_at: new Date('2026-02-28T16:30:00.000Z'), // 2026-03-01 00:30 in Malaysia
  },
]

describe('GET /api/leases/:leaseId response shape', () => {
  // 2026-03-01 12:00 Malaysia: the 01-31 invoices are overdue, the 02-28 one too.
  const now = new Date('2026-03-01T04:00:00.000Z')
  const body = serializeLeaseDetail(lease, invoices, payments, now)

  it('has exactly the keys lease, invoices, payments', () => {
    expect(Object.keys(body).sort()).toEqual(['invoices', 'lease', 'payments'])
  })

  it('maps the lease to camelCase with integer sen and YYYY-MM-DD dates', () => {
    expect(body.lease).toEqual({
      id: 'lease-1',
      unitId: 'unit-1',
      tenantId: 'tenant-1',
      startDate: '2026-01-31',
      endDate: '2026-07-15',
      monthlyRentSen: 150000,
      depositSen: 300000,
    })
    expect(Object.keys(body.lease).sort()).toEqual(
      ['depositSen', 'endDate', 'id', 'monthlyRentSen', 'startDate', 'tenantId', 'unitId'],
    )
  })

  it('maps each invoice with paidSen as the sum of its allocations and a computed status', () => {
    expect(body.invoices).toEqual([
      {
        id: 'inv-deposit',
        kind: 'deposit',
        periodIndex: null,
        periodStart: null,
        periodEnd: null,
        dueDate: '2026-01-31',
        amountSen: 300000,
        paidSen: 300000,
        status: 'paid',
      },
      {
        id: 'inv-0',
        kind: 'rent',
        periodIndex: 0,
        periodStart: '2026-01-31',
        periodEnd: '2026-02-27',
        dueDate: '2026-01-31',
        amountSen: 150000,
        paidSen: 75000,
        status: 'overdue', // partly paid, but overdue wins over partially_paid
      },
      {
        id: 'inv-1',
        kind: 'rent',
        periodIndex: 1,
        periodStart: '2026-02-28',
        periodEnd: '2026-03-30',
        dueDate: '2026-02-28',
        amountSen: 150000,
        paidSen: 0,
        status: 'overdue',
      },
    ])
    for (const invoice of body.invoices) {
      expect(Object.keys(invoice).sort()).toEqual(
        ['amountSen', 'dueDate', 'id', 'kind', 'paidSen', 'periodEnd', 'periodIndex', 'periodStart', 'status'],
      )
    }
  })

  it('maps each payment with the instant written in Malaysia time', () => {
    expect(body.payments).toEqual([
      {
        id: 'pay-1',
        amountSen: 200000,
        unappliedSen: 0,
        method: 'bank_transfer',
        status: 'approved',
        receivedAt: '2026-03-01T00:30:00.000+08:00',
      },
    ])
    expect(Object.keys(body.payments[0]).sort()).toEqual(
      ['amountSen', 'id', 'method', 'receivedAt', 'status', 'unappliedSen'],
    )
  })

  it('serializes to JSON without bigint (JSON.stringify would throw on one)', () => {
    expect(() => JSON.stringify(body)).not.toThrow()
  })

  it('refuses an amount beyond the safe integer range instead of rounding it', () => {
    const huge = { ...lease, monthly_rent_sen: BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1) }
    expect(() => serializeLeaseDetail(huge, [], [], now)).toThrow()
  })
})
