// Experiment, not a test: fires N identical webhook deliveries at once on a fresh bill and prints what
// happened (HTTP statuses, payments created, money allocated). Used to see which defence stops the double
// payment: the bill-row lock, the replay handling, or UNIQUE (payments.gateway_bill_id).
//   npm run race:webhook [-- 10]        needs the app running and a seeded database
import { createHmac, randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { api, BASE_URL, login } from '../tests/integration/helpers'

const COUNT = Number(process.argv[2] ?? 10)
const KEY = process.env.GATEWAY_X_SIGNATURE_KEY ?? ''

function signed(fields: Record<string, string>): URLSearchParams {
  const source = Object.keys(fields).sort().map((k) => `${k}${fields[k]}`).join('|')
  return new URLSearchParams({ ...fields, x_signature: createHmac('sha256', KEY).update(source).digest('hex') })
}

async function main(): Promise<void> {
  const unit = await prisma.units.findFirstOrThrow({ where: { name: 'D-03-2' } })
  const tenant = await prisma.tenants.findFirstOrThrow({ where: { email: 'probe@northwind.test' } })
  const manager = await login('manager@northwind.test')
  const probe = await login('probe@northwind.test')

  const lease = await api<{ id: string }>('POST', '/api/leases', {
    token: manager,
    body: { unitId: unit.id, tenantId: tenant.id, startDate: '1960-01-01', endDate: '1960-03-31', monthlyRentSen: 100000, depositSen: 50000 },
  })
  const leaseId = lease.body.id
  try {
    const bill = (await api<{ billId: string; amountSen: number }>('POST', `/api/leases/${leaseId}/gateway-bills`, { token: probe })).body
    const fields = {
      id: bill.billId,
      paid: 'true',
      paid_amount: String(bill.amountSen),
      paid_at: '2026-04-01 00:30:12 +0800',
      transaction_id: `TX-${randomUUID()}`,
      transaction_status: 'completed',
    }
    const results = await Promise.all(
      Array.from({ length: COUNT }, async () => {
        const res = await fetch(`${BASE_URL}/api/webhooks/gateway`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: signed(fields),
        })
        return res.status
      }),
    )
    const histogram = [...new Set(results)].sort().map((s) => `${s} x${results.filter((r) => r === s).length}`).join(', ')
    const payments = await prisma.payments.findMany({ where: { gateway_bill_id: bill.billId } })
    const allocations = await prisma.payment_allocations.findMany({ where: { payments: { lease_id: leaseId } } })
    const bills = await prisma.gateway_bills.findUniqueOrThrow({ where: { id: bill.billId } })
    const allocated = allocations.reduce((sum, a) => sum + Number(a.amount_sen), 0)
    const unapplied = payments.reduce((sum, p) => sum + Number(p.unapplied_sen), 0)
    console.log(
      `${COUNT} deliveries -> HTTP ${histogram} | payments created: ${payments.length} | allocated: ${allocated} of ${bill.amountSen} | unapplied: ${unapplied} | bill: ${bills.status}`,
    )
  } finally {
    // remove the experiment's data (payments first: they reference the bill)
    const payments = await prisma.payments.findMany({ where: { lease_id: leaseId }, select: { id: true } })
    await prisma.payment_allocations.deleteMany({ where: { payment_id: { in: payments.map((p) => p.id) } } })
    await prisma.payments.deleteMany({ where: { lease_id: leaseId } })
    await prisma.gateway_bills.deleteMany({ where: { lease_id: leaseId } })
    await prisma.invoices.deleteMany({ where: { lease_id: leaseId } })
    await prisma.leases.deleteMany({ where: { id: leaseId } })
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
