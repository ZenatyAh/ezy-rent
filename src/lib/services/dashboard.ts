import { malaysiaDate } from '@/lib/billing'
import { prisma } from '@/lib/prisma'

// Invoices of the organization that are overdue right now: something is still unpaid and today's Malaysia
// date is after the due date (the same rule as invoiceStatus: paid wins, then overdue).
export async function countOverdueInvoices(orgId: string, now: Date): Promise<number> {
  const today = malaysiaDate(now)
  const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
    select count(*) as n from (
      select i.id
      from invoices i
      left join payment_allocations a on a.invoice_id = i.id
      where i.org_id = ${orgId}::uuid and i.due_date < ${today}::date
      group by i.id
      having i.amount_sen - coalesce(sum(a.amount_sen), 0) > 0
    ) overdue`
  return Number(rows[0].n)
}
