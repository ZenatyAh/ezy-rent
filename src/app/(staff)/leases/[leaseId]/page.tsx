import Link from 'next/link'
import { notFound } from 'next/navigation'
import { StatusBadge } from '@/components/status-badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatRinggit } from '@/lib/format'
import { HttpError } from '@/lib/http'
import { requireStaffPage } from '@/lib/page-auth'
import { prisma } from '@/lib/prisma'
import { getLeaseDetail } from '@/lib/services/leases'
import { formatMyt, formatMytDate } from '@/lib/time'
import { PaymentActions } from './payment-actions'
import { RecordPayment } from './record-payment'
import { SlipLink } from './slip-link'

const METHOD: Record<string, string> = { cash: 'Cash', bank_transfer: 'Bank transfer', online: 'Online' }

export default async function LeasePage({ params }: { params: Promise<{ leaseId: string }> }) {
  const actor = await requireStaffPage()
  const { leaseId } = await params

  // getLeaseDetail applies the same visibility rule as the API: another organization's lease is a 404.
  let detail
  try {
    detail = await getLeaseDetail(actor, leaseId, new Date())
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) notFound()
    throw error
  }
  const lease = await prisma.leases.findUniqueOrThrow({ where: { id: detail.lease.id }, include: { units: true, tenants: true } })
  const slips = new Map(
    (await prisma.payments.findMany({ where: { lease_id: lease.id }, select: { id: true, slip_path: true } })).map((p) => [p.id, p.slip_path]),
  )

  const owed = detail.invoices.reduce((sum, invoice) => sum + invoice.amountSen, 0)
  const paid = detail.invoices.reduce((sum, invoice) => sum + invoice.paidSen, 0)
  const isManager = actor.role === 'manager'

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <Link href="/leases" className="text-sm text-muted-foreground underline">All leases</Link>
          <h1 className="text-2xl font-semibold">Unit {lease.units.name}, {lease.tenants.full_name}</h1>
          <p className="text-sm text-muted-foreground">
            {formatMytDate(detail.lease.startDate)} to {formatMytDate(detail.lease.endDate)} · rent {formatRinggit(detail.lease.monthlyRentSen)} a month
            {detail.lease.depositSen > 0 ? ` · deposit ${formatRinggit(detail.lease.depositSen)}` : ''}
          </p>
        </div>
        <RecordPayment leaseId={detail.lease.id} orgId={actor.orgId} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">Invoiced</CardTitle></CardHeader><CardContent className="text-xl font-semibold">{formatRinggit(owed)}</CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">Paid</CardTitle></CardHeader><CardContent className="text-xl font-semibold">{formatRinggit(paid)}</CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">Still to pay</CardTitle></CardHeader><CardContent className="text-xl font-semibold">{formatRinggit(owed - paid)}</CardContent></Card>
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Invoices</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Period</TableHead>
              <TableHead>Due</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.invoices.map((invoice) => (
              <TableRow key={invoice.id}>
                <TableCell>
                  {invoice.kind === 'deposit' ? 'Deposit' : `${formatMytDate(invoice.periodStart ?? '')} to ${formatMytDate(invoice.periodEnd ?? '')}`}
                </TableCell>
                <TableCell>{formatMytDate(invoice.dueDate)}</TableCell>
                <TableCell className="text-right">{formatRinggit(invoice.amountSen)}</TableCell>
                <TableCell className="text-right">{formatRinggit(invoice.paidSen)}</TableCell>
                <TableCell><StatusBadge status={invoice.status} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Payments</h2>
        {detail.payments.length === 0 ? (
          <p className="rounded-lg border p-6 text-center text-muted-foreground">No payments yet. Use “Record payment” to add the first one.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Received (Malaysia time)</TableHead>
                <TableHead>Method</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Slip</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.payments.map((payment) => {
                const slip = slips.get(payment.id)
                return (
                  <TableRow key={payment.id}>
                    <TableCell>{formatMyt(payment.receivedAt)}</TableCell>
                    <TableCell>{METHOD[payment.method] ?? payment.method}</TableCell>
                    <TableCell className="text-right">
                      {formatRinggit(payment.amountSen)}
                      {payment.unappliedSen > 0 ? <span className="block text-xs text-muted-foreground">{formatRinggit(payment.unappliedSen)} unapplied</span> : null}
                    </TableCell>
                    <TableCell><StatusBadge status={payment.status} /></TableCell>
                    <TableCell>{slip ? <SlipLink path={slip} /> : <span className="text-muted-foreground">-</span>}</TableCell>
                    <TableCell className="text-right">
                      <PaymentActions paymentId={payment.id} status={payment.status} isManager={isManager} />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </section>
    </>
  )
}
