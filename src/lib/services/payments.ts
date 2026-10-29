import { z } from 'zod'
import { requireRole, type Actor } from '@/lib/actor'
import { allocate, type AllocationPlan } from '@/lib/allocation'
import { parseOffsetInstant } from '@/lib/dates'
import type { Prisma } from '@/generated/prisma/client'
import { HttpError, isUuid, notFound } from '@/lib/http'
import { senToNumber } from '@/lib/money'
import { prisma } from '@/lib/prisma'
import { findVisibleLease } from '@/lib/services/leases'
import { lockLease } from '@/lib/services/locks'
import { assertSlipUsable, removeOrphanedSlip } from '@/lib/services/slips'

type Tx = Prisma.TransactionClient

// remaining = all invoices minus everything allocated to them; pending = payments waiting for approval.
async function balances(tx: Tx, leaseId: string): Promise<{ remaining: bigint; pending: bigint }> {
  const total = await tx.invoices.aggregate({ where: { lease_id: leaseId }, _sum: { amount_sen: true } })
  const allocated = await tx.payment_allocations.aggregate({
    where: { invoices: { lease_id: leaseId } },
    _sum: { amount_sen: true },
  })
  const pending = await tx.payments.aggregate({
    where: { lease_id: leaseId, status: 'pending_verification' },
    _sum: { amount_sen: true },
  })
  return {
    remaining: (total._sum.amount_sen ?? BigInt(0)) - (allocated._sum.amount_sen ?? BigInt(0)),
    pending: pending._sum.amount_sen ?? BigInt(0),
  }
}

const recordSchema = z.object({
  amountSen: z.number().int().positive(),
  method: z.enum(['cash', 'bank_transfer']),
  receivedAt: z.string(),
  slipPath: z.string().nullish(),
})

const reasonSchema = z.object({ reason: z.string() })

function parseReason(raw: unknown): string {
  const { reason } = reasonSchema.parse(raw)
  if (reason.trim().length < 5) throw new HttpError(400, 'reason must be at least 5 characters')
  return reason.trim()
}

function planDetails(plan: AllocationPlan) {
  return {
    allocations: plan.allocations.map((a) => ({ invoiceId: a.invoiceId, amountSen: senToNumber(a.amountSen) })),
    unappliedSen: senToNumber(plan.unappliedSen),
  }
}

// The payment if the actor may see it, otherwise 404 (another organization's payment, another tenant's
// payment, unknown or malformed id). The role check for the action comes after this.
export async function findVisiblePayment(actor: Actor, paymentId: string) {
  if (!isUuid(paymentId)) throw notFound('Payment')
  const payment = await prisma.payments.findFirst({
    where: actor.role === 'tenant' ? { id: paymentId, leases: { tenant_id: actor.tenantId } } : { id: paymentId, org_id: actor.orgId },
  })
  if (!payment) throw notFound('Payment')
  return payment
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'P2002'
}

// Order of checks: visible lease (404) -> role (403) -> body (400) -> slip (400) -> cap (422).
// A manager's payment is approved at once and allocated; a staff member's waits for approval.
// If anything fails after the slip was uploaded, the uploaded file is removed again.
export async function recordPayment(
  actor: Actor,
  leaseId: string,
  rawInput: unknown,
): Promise<{ id: string; status: 'approved' | 'pending_verification' }> {
  try {
    const lease = await findVisibleLease(actor, leaseId)
    requireRole(actor, 'manager', 'staff')

    const input = recordSchema.parse(rawInput)
    let receivedAt: Date
    try {
      receivedAt = parseOffsetInstant(input.receivedAt)
    } catch (error) {
      throw new HttpError(400, `receivedAt ${error instanceof Error ? error.message : 'is invalid'}`)
    }
    const slipPath = input.slipPath ?? undefined
    if (input.method === 'bank_transfer' && !slipPath) throw new HttpError(400, 'A bank transfer needs a slip (slipPath)')
    if (input.method === 'cash' && slipPath) throw new HttpError(400, 'A cash payment has no slip')
    if (slipPath) await assertSlipUsable(actor.orgId, slipPath)

    return await prisma.$transaction(
      async (tx) => {
        await lockLease(tx, lease.id)
        const { remaining, pending } = await balances(tx, lease.id)
        const amount = BigInt(input.amountSen)
        if (amount > remaining - pending) {
          const allowed = remaining - pending > BigInt(0) ? remaining - pending : BigInt(0)
          throw new HttpError(422, `Amount is more than the ${allowed} sen that can still be recorded (remaining balance minus pending payments)`)
        }

        const approvedNow = actor.role === 'manager'
        const payment = await tx.payments.create({
          data: {
            org_id: actor.orgId,
            lease_id: lease.id,
            amount_sen: amount,
            method: input.method,
            status: approvedNow ? 'approved' : 'pending_verification',
            received_at: receivedAt,
            slip_path: slipPath ?? null,
            created_by: actor.userId,
            decided_by: approvedNow ? actor.userId : null,
            decided_at: approvedNow ? new Date() : null,
          },
        })
        if (approvedNow) {
          const plan = await allocate(tx, payment.id)
          await tx.audit_log.create({
            data: {
              org_id: actor.orgId,
              actor_id: actor.userId,
              action: 'payment.approved',
              entity_id: payment.id,
              details: { auto: true, leaseId: lease.id, amountSen: input.amountSen, method: input.method, ...planDetails(plan) },
            },
          })
        }
        return { id: payment.id, status: payment.status as 'approved' | 'pending_verification' }
      },
      { timeout: 30_000 },
    )
  } catch (error) {
    if (actor.role !== 'tenant') {
      const slip = typeof rawInput === 'object' && rawInput !== null ? (rawInput as { slipPath?: unknown }).slipPath : undefined
      await removeOrphanedSlip(actor.orgId, slip)
    }
    if (isUniqueViolation(error)) throw new HttpError(400, 'This slip is already attached to another payment')
    throw error
  }
}

// Approve a pending payment (manager). Re-checks the balance under the lease lock; if the amount no
// longer fits, nothing changes and the payment stays pending (422).
export async function approvePayment(actor: Actor, paymentId: string): Promise<{ status: 'approved' }> {
  const found = await findVisiblePayment(actor, paymentId)
  requireRole(actor, 'manager')

  return prisma.$transaction(
    async (tx) => {
      await lockLease(tx, found.lease_id)
      const payment = await tx.payments.findUniqueOrThrow({ where: { id: found.id } })
      if (payment.status !== 'pending_verification') {
        throw new HttpError(409, `The payment is ${payment.status}; only a pending payment can be approved`)
      }
      const { remaining } = await balances(tx, payment.lease_id)
      if (payment.amount_sen > remaining) {
        throw new HttpError(422, `The payment is more than the ${remaining} sen still owed on the lease; it stays pending`)
      }
      await tx.payments.update({
        where: { id: payment.id },
        data: { status: 'approved', decided_by: actor.userId, decided_at: new Date() },
      })
      const plan = await allocate(tx, payment.id)
      await tx.audit_log.create({
        data: {
          org_id: payment.org_id,
          actor_id: actor.userId,
          action: 'payment.approved',
          entity_id: payment.id,
          details: { leaseId: payment.lease_id, amountSen: senToNumber(payment.amount_sen), method: payment.method, ...planDetails(plan) },
        },
      })
      return { status: 'approved' as const }
    },
    { timeout: 30_000 },
  )
}

// Reject a pending payment (manager) with a reason of at least 5 characters.
export async function rejectPayment(actor: Actor, paymentId: string, rawInput: unknown): Promise<{ status: 'rejected' }> {
  const found = await findVisiblePayment(actor, paymentId)
  requireRole(actor, 'manager')
  const reason = parseReason(rawInput)

  return prisma.$transaction(
    async (tx) => {
      await lockLease(tx, found.lease_id)
      const payment = await tx.payments.findUniqueOrThrow({ where: { id: found.id } })
      if (payment.status !== 'pending_verification') {
        throw new HttpError(409, `The payment is ${payment.status}; only a pending payment can be rejected`)
      }
      await tx.payments.update({
        where: { id: payment.id },
        data: { status: 'rejected', decision_reason: reason, decided_by: actor.userId, decided_at: new Date() },
      })
      await tx.audit_log.create({
        data: {
          org_id: payment.org_id,
          actor_id: actor.userId,
          action: 'payment.rejected',
          entity_id: payment.id,
          details: { leaseId: payment.lease_id, amountSen: senToNumber(payment.amount_sen), reason },
        },
      })
      return { status: 'rejected' as const }
    },
    { timeout: 30_000 },
  )
}

// Void an approved payment (manager) with a reason of at least 5 characters. Only this payment's
// allocations are removed; other payments, and any unapplied amount, are left exactly as they are.
export async function voidPayment(actor: Actor, paymentId: string, rawInput: unknown): Promise<{ status: 'voided' }> {
  const found = await findVisiblePayment(actor, paymentId)
  requireRole(actor, 'manager')
  const reason = parseReason(rawInput)

  return prisma.$transaction(
    async (tx) => {
      await lockLease(tx, found.lease_id)
      const payment = await tx.payments.findUniqueOrThrow({ where: { id: found.id } })
      if (payment.status !== 'approved') {
        throw new HttpError(409, `The payment is ${payment.status}; only an approved payment can be voided`)
      }
      const removed = await tx.payment_allocations.deleteMany({ where: { payment_id: payment.id } })
      await tx.payments.update({
        where: { id: payment.id },
        data: { status: 'voided', decision_reason: reason, decided_by: actor.userId, decided_at: new Date() },
      })
      await tx.audit_log.create({
        data: {
          org_id: payment.org_id,
          actor_id: actor.userId,
          action: 'payment.voided',
          entity_id: payment.id,
          details: {
            leaseId: payment.lease_id,
            amountSen: senToNumber(payment.amount_sen),
            reason,
            removedAllocations: removed.count,
          },
        },
      })
      return { status: 'voided' as const }
    },
    { timeout: 30_000 },
  )
}
