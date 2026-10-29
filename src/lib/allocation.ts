// Allocation of an approved payment to a lease's invoices (section 4 of the brief).
// planAllocation and compareForAllocation are pure; allocate() applies the plan inside a transaction
// in which the caller already holds the lease row lock.
import type { Prisma } from '@/generated/prisma/client'

export interface UnpaidInvoice {
  invoiceId: string
  kind: 'deposit' | 'rent'
  dueDate: string // 'YYYY-MM-DD'
  periodIndex: number | null
  unpaidSen: bigint
}

// Order in which a payment fills invoices: due date, then deposit before rent, then period index.
export function compareForAllocation(a: UnpaidInvoice, b: UnpaidInvoice): number {
  if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1
  if (a.kind !== b.kind) return a.kind === 'deposit' ? -1 : 1
  return (a.periodIndex ?? -1) - (b.periodIndex ?? -1)
}

export interface AllocationPlan {
  allocations: Array<{ invoiceId: string; amountSen: bigint }>
  unappliedSen: bigint
}

// Each invoice is filled up to what is still unpaid before the next one, including invoices that are
// not due yet. Invoices with nothing unpaid never get a row. What is left over is unapplied.
export function planAllocation(unpaid: UnpaidInvoice[], amountSen: bigint): AllocationPlan {
  const allocations: AllocationPlan['allocations'] = []
  let left = amountSen
  for (const invoice of [...unpaid].sort(compareForAllocation)) {
    if (left <= BigInt(0)) break
    if (invoice.unpaidSen <= BigInt(0)) continue
    const part = left < invoice.unpaidSen ? left : invoice.unpaidSen
    allocations.push({ invoiceId: invoice.invoiceId, amountSen: part })
    left -= part
  }
  return { allocations, unappliedSen: left }
}

interface UnpaidRow {
  id: string
  kind: 'deposit' | 'rent'
  due_date: string
  period_index: number | null
  unpaid: bigint
}

// The caller must hold the lease row lock (SELECT ... FOR UPDATE), so two payments can never both
// see the same invoice as unpaid.
export async function allocate(tx: Prisma.TransactionClient, paymentId: string): Promise<AllocationPlan> {
  const payment = await tx.payments.findUniqueOrThrow({ where: { id: paymentId } })

  const rows = await tx.$queryRaw<UnpaidRow[]>`
    select i.id, i.kind::text as kind, i.due_date::text as due_date, i.period_index,
           (i.amount_sen - coalesce(sum(a.amount_sen), 0))::bigint as unpaid
    from invoices i
    left join payment_allocations a on a.invoice_id = i.id
    where i.lease_id = ${payment.lease_id}::uuid
    group by i.id
    having i.amount_sen - coalesce(sum(a.amount_sen), 0) > 0`

  const plan = planAllocation(
    rows.map((row) => ({
      invoiceId: row.id,
      kind: row.kind,
      dueDate: row.due_date,
      periodIndex: row.period_index,
      unpaidSen: row.unpaid,
    })),
    payment.amount_sen,
  )

  if (plan.allocations.length > 0) {
    await tx.payment_allocations.createMany({
      data: plan.allocations.map((a) => ({
        org_id: payment.org_id,
        payment_id: payment.id,
        invoice_id: a.invoiceId,
        amount_sen: a.amountSen,
      })),
    })
  }
  await tx.payments.update({ where: { id: payment.id }, data: { unapplied_sen: plan.unappliedSen } })
  return plan
}
