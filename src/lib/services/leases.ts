import { requireRole, type Actor } from '@/lib/actor'
import { generateSchedule } from '@/lib/billing'
import { dateFromIso } from '@/lib/dates'
import { HttpError, isUuid, notFound } from '@/lib/http'
import { prisma } from '@/lib/prisma'
import { serializeLeaseDetail, type LeaseDetailResponse } from '@/lib/serializers'

export interface CreateLeaseInput {
  unitId: string
  tenantId: string
  startDate: string
  endDate: string
  monthlyRentSen: number
  depositSen: number
}

// Postgres reports the exclusion constraint on leases (same unit, overlapping days) as SQLSTATE 23P01.
function isOverlapViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const text = JSON.stringify(error, Object.getOwnPropertyNames(error))
  return text.includes('leases_no_overlap') || text.includes('23P01')
}

// Creates a lease and exactly the invoices generateSchedule returns, all or nothing, in one
// transaction. The unit and tenant are looked up inside the actor's organization, so another
// organization's ids are indistinguishable from unknown ones (404). Overlap on the unit is
// rejected by the database, so two concurrent requests cannot both succeed (409).
export async function createLease(actor: Actor, input: CreateLeaseInput): Promise<{ id: string }> {
  requireRole(actor, 'manager')

  // Pure validation first: real calendar dates, end not before start, positive rent, deposit >= 0.
  let schedule
  try {
    schedule = generateSchedule(input)
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : 'Invalid lease')
  }

  try {
    return await prisma.$transaction(
      async (tx) => {
        const unit = await tx.units.findFirst({ where: { id: input.unitId, org_id: actor.orgId } })
        if (!unit) throw notFound('Unit')
        const tenant = await tx.tenants.findFirst({ where: { id: input.tenantId, org_id: actor.orgId } })
        if (!tenant) throw notFound('Tenant')

        const lease = await tx.leases.create({
          data: {
            org_id: actor.orgId,
            unit_id: unit.id,
            tenant_id: tenant.id,
            start_date: dateFromIso(input.startDate),
            end_date: dateFromIso(input.endDate),
            monthly_rent_sen: BigInt(input.monthlyRentSen),
            deposit_sen: BigInt(input.depositSen),
            created_by: actor.userId,
          },
        })

        await tx.invoices.createMany({
          data: schedule.map((invoice) => ({
            org_id: actor.orgId,
            lease_id: lease.id,
            kind: invoice.kind,
            period_index: invoice.periodIndex,
            period_start: invoice.periodStart ? dateFromIso(invoice.periodStart) : null,
            period_end: invoice.periodEnd ? dateFromIso(invoice.periodEnd) : null,
            due_date: dateFromIso(invoice.dueDate),
            amount_sen: BigInt(invoice.amountSen),
          })),
        })

        await tx.audit_log.create({
          data: {
            org_id: actor.orgId,
            actor_id: actor.userId,
            action: 'lease.created',
            entity_id: lease.id,
            details: { ...input, invoiceCount: schedule.length },
          },
        })

        return { id: lease.id }
      },
      { timeout: 30_000 },
    )
  } catch (error) {
    if (isOverlapViolation(error)) {
      throw new HttpError(409, 'The unit already has a lease that overlaps these dates')
    }
    throw error
  }
}

// The lease if the actor may see it, otherwise 404 (other organization, other tenant, unknown id and
// malformed id all look the same). Role checks for the action itself come after this.
export async function findVisibleLease(actor: Actor, leaseId: string) {
  if (!isUuid(leaseId)) throw notFound('Lease')
  const lease = await prisma.leases.findFirst({
    where: actor.role === 'tenant' ? { id: leaseId, tenant_id: actor.tenantId } : { id: leaseId, org_id: actor.orgId },
  })
  if (!lease) throw notFound('Lease')
  return lease
}

// Lease, invoices in allocation order (due date, deposit before rent, period index) and payments.
export async function getLeaseDetail(actor: Actor, leaseId: string, now: Date): Promise<LeaseDetailResponse> {
  const lease = await findVisibleLease(actor, leaseId)
  const [invoices, payments] = await Promise.all([
    prisma.invoices.findMany({
      where: { lease_id: lease.id },
      include: { payment_allocations: { select: { amount_sen: true } } },
      orderBy: [{ due_date: 'asc' }, { kind: 'asc' }, { period_index: 'asc' }],
    }),
    prisma.payments.findMany({
      where: { lease_id: lease.id },
      orderBy: [{ received_at: 'asc' }, { created_at: 'asc' }],
    }),
  ])
  return serializeLeaseDetail(lease, invoices, payments, now)
}
