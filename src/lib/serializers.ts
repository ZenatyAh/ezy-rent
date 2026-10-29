// Database rows (snake_case, bigint, Date) to the API shapes in section 7 (camelCase, integer
// numbers, 'YYYY-MM-DD' strings, instants in Malaysia time). The only place this mapping happens.
import { invoiceStatus, type InvoiceKind, type InvoiceStatus } from '@/lib/billing'
import { dateToIso, toMalaysiaIso } from '@/lib/dates'
import { senToNumber } from '@/lib/money'

export interface LeaseRow {
  id: string
  unit_id: string
  tenant_id: string
  start_date: Date
  end_date: Date
  monthly_rent_sen: bigint
  deposit_sen: bigint
}

export interface InvoiceRow {
  id: string
  kind: InvoiceKind
  period_index: number | null
  period_start: Date | null
  period_end: Date | null
  due_date: Date
  amount_sen: bigint
  payment_allocations: Array<{ amount_sen: bigint }>
}

export interface PaymentRow {
  id: string
  amount_sen: bigint
  unapplied_sen: bigint
  method: 'cash' | 'bank_transfer' | 'online'
  status: 'pending_verification' | 'approved' | 'rejected' | 'voided'
  received_at: Date
}

export interface LeaseDetailResponse {
  lease: {
    id: string
    unitId: string
    tenantId: string
    startDate: string
    endDate: string
    monthlyRentSen: number
    depositSen: number
  }
  invoices: Array<{
    id: string
    kind: InvoiceKind
    periodIndex: number | null
    periodStart: string | null
    periodEnd: string | null
    dueDate: string
    amountSen: number
    paidSen: number
    status: InvoiceStatus
  }>
  payments: Array<{
    id: string
    amountSen: number
    unappliedSen: number
    method: PaymentRow['method']
    status: PaymentRow['status']
    receivedAt: string
  }>
}

// Invoices must already be in allocation order (due date, deposit before rent, period index).
export function serializeLeaseDetail(
  lease: LeaseRow,
  invoices: InvoiceRow[],
  payments: PaymentRow[],
  now: Date,
): LeaseDetailResponse {
  return {
    lease: {
      id: lease.id,
      unitId: lease.unit_id,
      tenantId: lease.tenant_id,
      startDate: dateToIso(lease.start_date),
      endDate: dateToIso(lease.end_date),
      monthlyRentSen: senToNumber(lease.monthly_rent_sen),
      depositSen: senToNumber(lease.deposit_sen),
    },
    invoices: invoices.map((invoice) => {
      const amountSen = senToNumber(invoice.amount_sen)
      const paidSen = senToNumber(invoice.payment_allocations.reduce((sum, a) => sum + a.amount_sen, BigInt(0)))
      const dueDate = dateToIso(invoice.due_date)
      return {
        id: invoice.id,
        kind: invoice.kind,
        periodIndex: invoice.period_index,
        periodStart: invoice.period_start ? dateToIso(invoice.period_start) : null,
        periodEnd: invoice.period_end ? dateToIso(invoice.period_end) : null,
        dueDate,
        amountSen,
        paidSen,
        status: invoiceStatus({ dueDate, amountSen, paidSen }, now),
      }
    }),
    payments: payments.map((payment) => ({
      id: payment.id,
      amountSen: senToNumber(payment.amount_sen),
      unappliedSen: senToNumber(payment.unapplied_sen),
      method: payment.method,
      status: payment.status,
      receivedAt: toMalaysiaIso(payment.received_at),
    })),
  }
}
