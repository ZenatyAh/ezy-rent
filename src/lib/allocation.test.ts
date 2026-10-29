import { describe, expect, it } from 'vitest'
import { compareForAllocation, planAllocation, type UnpaidInvoice } from './allocation'

const inv = (
  invoiceId: string,
  kind: 'deposit' | 'rent',
  dueDate: string,
  periodIndex: number | null,
  unpaid: number,
): UnpaidInvoice => ({ invoiceId, kind, dueDate, periodIndex, unpaidSen: BigInt(unpaid) })

// Aisyah's lease: the deposit and rent 0 are both due on 2026-01-31.
const lease: UnpaidInvoice[] = [
  inv('rent0', 'rent', '2026-01-31', 0, 150000),
  inv('deposit', 'deposit', '2026-01-31', null, 300000),
  inv('rent2', 'rent', '2026-03-31', 2, 150000),
  inv('rent1', 'rent', '2026-02-28', 1, 150000),
]

describe('compareForAllocation', () => {
  it('orders by due date, then deposit before rent, then period index', () => {
    const ordered = [...lease].sort(compareForAllocation).map((i) => i.invoiceId)
    expect(ordered).toEqual(['deposit', 'rent0', 'rent1', 'rent2'])
  })

  it('orders rent invoices that share a due date by period index', () => {
    const same = [inv('b', 'rent', '2026-05-01', 3, 1), inv('a', 'rent', '2026-05-01', 2, 1)]
    expect([...same].sort(compareForAllocation).map((i) => i.invoiceId)).toEqual(['a', 'b'])
  })
})

describe('planAllocation', () => {
  it('fills the deposit first, then rent, up to each unpaid amount', () => {
    // the seeded cash payment of RM 3,000.00 exactly pays the deposit
    expect(planAllocation(lease, BigInt(300000))).toEqual({
      allocations: [{ invoiceId: 'deposit', amountSen: BigInt(300000) }],
      unappliedSen: BigInt(0),
    })
  })

  it('spills into the next invoices, including ones that are not due yet', () => {
    const plan = planAllocation(lease, BigInt(500000))
    expect(plan.allocations).toEqual([
      { invoiceId: 'deposit', amountSen: BigInt(300000) },
      { invoiceId: 'rent0', amountSen: BigInt(150000) },
      { invoiceId: 'rent1', amountSen: BigInt(50000) },
    ])
    expect(plan.unappliedSen).toBe(BigInt(0))
  })

  it('leaves what is left after every invoice is paid as unapplied', () => {
    const plan = planAllocation(lease, BigInt(1_000_000))
    expect(plan.allocations.map((a) => a.invoiceId)).toEqual(['deposit', 'rent0', 'rent1', 'rent2'])
    expect(plan.unappliedSen).toBe(BigInt(1_000_000 - 750_000))
  })

  it('allocates a partial payment to the first invoice only', () => {
    expect(planAllocation(lease, BigInt(1))).toEqual({
      allocations: [{ invoiceId: 'deposit', amountSen: BigInt(1) }],
      unappliedSen: BigInt(0),
    })
  })

  it('never creates a row for an invoice with nothing unpaid (including 0-sen invoices)', () => {
    const withZero = [inv('zero', 'rent', '2026-01-01', 0, 0), inv('paid', 'rent', '2026-01-02', 1, 0), inv('open', 'rent', '2026-01-03', 2, 500)]
    expect(planAllocation(withZero, BigInt(500))).toEqual({
      allocations: [{ invoiceId: 'open', amountSen: BigInt(500) }],
      unappliedSen: BigInt(0),
    })
  })

  it('puts the whole amount in unapplied when every invoice is already paid', () => {
    expect(planAllocation([], BigInt(700))).toEqual({ allocations: [], unappliedSen: BigInt(700) })
  })

  it('conserves money exactly: allocations plus unapplied equal the payment', () => {
    for (const amount of [1, 149999, 150000, 150001, 449999, 450000, 749999, 750000, 750001, 9_999_999]) {
      const plan = planAllocation(lease, BigInt(amount))
      const total = plan.allocations.reduce((sum, a) => sum + a.amountSen, BigInt(0)) + plan.unappliedSen
      expect(total).toBe(BigInt(amount))
    }
  })

  it('does not change its input', () => {
    const copy = lease.map((i) => i.invoiceId)
    planAllocation(lease, BigInt(100))
    expect(lease.map((i) => i.invoiceId)).toEqual(copy)
  })
})
