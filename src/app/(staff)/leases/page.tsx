import Link from 'next/link'
import { dateToIso } from '@/lib/dates'
import { formatRinggit } from '@/lib/format'
import { senToNumber } from '@/lib/money'
import { requireStaffPage } from '@/lib/page-auth'
import { prisma } from '@/lib/prisma'
import { formatMytDate } from '@/lib/time'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export default async function LeasesPage() {
  const actor = await requireStaffPage()
  const leases = await prisma.leases.findMany({
    where: { org_id: actor.orgId },
    include: { units: true, tenants: true },
    orderBy: [{ start_date: 'desc' }],
  })

  return (
    <>
      <h1 className="text-2xl font-semibold">Leases</h1>
      {leases.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-muted-foreground">
          No leases yet. Leases are created by a manager through the API (POST /api/leases).
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Unit</TableHead>
              <TableHead>Tenant</TableHead>
              <TableHead>Start</TableHead>
              <TableHead>End</TableHead>
              <TableHead className="text-right">Monthly rent</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {leases.map((lease) => (
              <TableRow key={lease.id}>
                <TableCell className="font-medium">{lease.units.name}</TableCell>
                <TableCell>{lease.tenants.full_name}</TableCell>
                <TableCell>{formatMytDate(dateToIso(lease.start_date))}</TableCell>
                <TableCell>{formatMytDate(dateToIso(lease.end_date))}</TableCell>
                <TableCell className="text-right">{formatRinggit(senToNumber(lease.monthly_rent_sen))}</TableCell>
                <TableCell className="text-right">
                  <Link href={`/leases/${lease.id}`} className="underline">Open</Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  )
}
