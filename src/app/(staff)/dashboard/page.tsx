import { malaysiaDate } from '@/lib/billing'
import { formatRinggit } from '@/lib/format'
import { requireStaffPage } from '@/lib/page-auth'
import { countOverdueInvoices } from '@/lib/services/dashboard'
import { collectionsReport } from '@/lib/services/reports'
import { formatMonth, monthsBack } from '@/lib/time'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export default async function DashboardPage() {
  const actor = await requireStaffPage()
  const now = new Date()
  const thisMonth = malaysiaDate(now).slice(0, 7)
  const [overdue, report] = await Promise.all([
    countOverdueInvoices(actor.orgId, now),
    collectionsReport(actor, monthsBack(thisMonth, 6), thisMonth),
  ])
  const total = report.reduce((sum, month) => sum + month.collectedSen, 0)

  return (
    <>
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Overdue invoices</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold" data-testid="overdue-count">{overdue}</p>
            <p className="text-sm text-muted-foreground">
              {overdue === 0 ? 'Nothing is overdue. Nice.' : 'Unpaid and past their due date (Malaysia time).'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Collected, last 6 months</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{formatRinggit(total)}</p>
            <p className="text-sm text-muted-foreground">Approved payments, by the month they were received.</p>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Collections by month</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">Collected</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.map((entry) => (
                <TableRow key={entry.month}>
                  <TableCell>{formatMonth(entry.month)}</TableCell>
                  <TableCell className="text-right">{formatRinggit(entry.collectedSen)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  )
}
