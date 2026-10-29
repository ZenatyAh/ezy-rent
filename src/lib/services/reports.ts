import { requireRole, type Actor } from '@/lib/actor'
import { monthRange } from '@/lib/dates'
import { HttpError } from '@/lib/http'
import { senToNumber } from '@/lib/money'
import { prisma } from '@/lib/prisma'

export interface CollectionsMonth {
  month: string // 'YYYY-MM'
  collectedSen: number
}

// Approved payments per calendar month of received_at in Malaysia time (Asia/Kuala_Lumpur), for every
// month from `from` to `to` inclusive, months with nothing collected included. A payment received
// 2026-03-01 00:30 Malaysia time is 2026-02-28 16:30 UTC but counts in March: the month is taken after
// converting to Malaysia time, and the range edges are midnight in Malaysia time as well.
export async function collectionsReport(actor: Actor, from: string | null, to: string | null): Promise<CollectionsMonth[]> {
  requireRole(actor, 'manager', 'staff')

  let months: string[]
  try {
    if (from === null || to === null) throw new Error('from and to are required, as YYYY-MM')
    months = monthRange(from, to)
  } catch (error) {
    throw new HttpError(400, `Invalid range: ${error instanceof Error ? error.message : 'from and to must be YYYY-MM'}`)
  }

  const firstDay = `${months[0]}-01`
  const lastMonthFirstDay = `${months[months.length - 1]}-01`
  const rows = await prisma.$queryRaw<Array<{ month: string; total: bigint }>>`
    select to_char(received_at at time zone 'Asia/Kuala_Lumpur', 'YYYY-MM') as month,
           sum(amount_sen)::bigint as total
    from payments
    where org_id = ${actor.orgId}::uuid
      and status = 'approved'
      and received_at >= (${firstDay}::date)::timestamp at time zone 'Asia/Kuala_Lumpur'
      and received_at < ((${lastMonthFirstDay}::date + interval '1 month')::timestamp at time zone 'Asia/Kuala_Lumpur')
    group by 1`

  const totals = new Map(rows.map((row) => [row.month, row.total]))
  return months.map((month) => ({ month, collectedSen: senToNumber(totals.get(month) ?? BigInt(0)) }))
}
