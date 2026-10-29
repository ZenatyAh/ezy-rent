'use client'

import Link from 'next/link'
import { useEffect, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { invoiceStatus, malaysiaDate, type InvoiceStatus } from '@/lib/billing'
import { formatRinggit } from '@/lib/format'
import { createClient } from '@/lib/supabase/browser'
import { formatMyt, formatMytDate } from '@/lib/time'

interface Row {
  tenant: { id: string; full_name: string; email: string; phone: string | null }
  leases: Array<{
    id: string
    start_date: string
    end_date: string
    monthly_rent_sen: number
    deposit_sen: number
    units: { name: string } | null
    invoices: Array<{
      id: string
      kind: 'deposit' | 'rent'
      period_start: string | null
      period_end: string | null
      due_date: string
      amount_sen: number
      paid: number
      status: InvoiceStatus
    }>
    payments: Array<{ id: string; amount_sen: number; method: string; status: string; received_at: string }>
    dueNow: number
  }>
}

// Everything below is read with the tenant's own session straight from the browser. There is no server
// code in between, so Row Level Security alone limits the rows to this tenant's own lease data.
async function load(tenantId: string): Promise<Row> {
  const supabase = createClient()
  const tenant = await supabase.from('tenants').select('id, full_name, email, phone').eq('id', tenantId).single()
  if (tenant.error) throw new Error(tenant.error.message)
  const leases = await supabase
    .from('leases')
    .select('id, start_date, end_date, monthly_rent_sen, deposit_sen, units(name)')
    .order('start_date', { ascending: false })
  if (leases.error) throw new Error(leases.error.message)
  const ids = leases.data.map((lease) => lease.id)
  if (ids.length === 0) return { tenant: tenant.data, leases: [] } // nothing else to ask for

  const [invoices, allocations, payments] = await Promise.all([
    supabase.from('invoices').select('id, lease_id, kind, period_start, period_end, due_date, amount_sen').in('lease_id', ids).order('due_date').order('kind').order('period_index'),
    supabase.from('payment_allocations').select('invoice_id, amount_sen'),
    supabase.from('payments').select('id, lease_id, amount_sen, method, status, received_at').in('lease_id', ids).order('received_at'),
  ])
  for (const result of [invoices, allocations, payments]) if (result.error) throw new Error(result.error.message)

  const paid = new Map<string, number>()
  for (const allocation of allocations.data ?? []) paid.set(allocation.invoice_id, (paid.get(allocation.invoice_id) ?? 0) + Number(allocation.amount_sen))

  // "Now" and "today" are worked out here, in the browser after the page has loaded, never while rendering
  // on the server, so there is no hydration mismatch. Today is the Malaysia date.
  const now = new Date()
  const today = malaysiaDate(now)

  return {
    tenant: tenant.data,
    leases: leases.data.map((lease) => {
      const leaseInvoices = (invoices.data ?? [])
        .filter((invoice) => invoice.lease_id === lease.id)
        .map((invoice) => {
          const amount = Number(invoice.amount_sen)
          const paidSen = paid.get(invoice.id) ?? 0
          return {
            id: invoice.id,
            kind: invoice.kind,
            period_start: invoice.period_start,
            period_end: invoice.period_end,
            due_date: invoice.due_date,
            amount_sen: amount,
            paid: paidSen,
            status: invoiceStatus({ dueDate: invoice.due_date, amountSen: amount, paidSen }, now),
          }
        })
      const unit = Array.isArray(lease.units) ? (lease.units[0] ?? null) : lease.units
      return {
        id: lease.id,
        start_date: lease.start_date,
        end_date: lease.end_date,
        monthly_rent_sen: Number(lease.monthly_rent_sen),
        deposit_sen: Number(lease.deposit_sen),
        units: unit,
        invoices: leaseInvoices,
        payments: (payments.data ?? [])
          .filter((payment) => payment.lease_id === lease.id)
          .map((payment) => ({ id: payment.id, amount_sen: Number(payment.amount_sen), method: payment.method, status: payment.status, received_at: payment.received_at })),
        dueNow: leaseInvoices.filter((invoice) => invoice.due_date <= today).reduce((sum, invoice) => sum + Math.max(0, invoice.amount_sen - invoice.paid), 0),
      }
    }),
  }
}

const METHOD: Record<string, string> = { cash: 'Cash', bank_transfer: 'Bank transfer', online: 'Online' }

export function TenantPortal({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<Row | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    load(tenantId)
      .then((row) => {
        if (!cancelled) setData(row)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load your lease')
      })
    return () => {
      cancelled = true
    }
  }, [tenantId])

  function reload() {
    setData(null)
    setError(null)
    load(tenantId)
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load your lease'))
  }

  if (error) {
    return (
      <div className="space-y-3 rounded-lg border p-6" role="alert">
        <p className="font-medium">We could not load your lease.</p>
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button onClick={reload}>Try again</Button>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading your lease">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-32" />
        <Skeleton className="h-56" />
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Hello, {data.tenant.full_name}</h1>
        <Button variant="outline" size="sm" onClick={reload}>Refresh</Button>
      </div>
      <PhoneForm tenant={data.tenant} onSaved={(phone) => setData({ ...data, tenant: { ...data.tenant, phone } })} />
      {data.leases.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-muted-foreground">You have no lease yet. Your property manager will add it.</p>
      ) : (
        data.leases.map((lease) => <LeaseCard key={lease.id} lease={lease} />)
      )}
    </>
  )
}

function PhoneForm({ tenant, onSaved }: { tenant: Row['tenant']; onSaved: (phone: string | null) => void }) {
  const [phone, setPhone] = useState(tenant.phone ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const value = phone.trim()
    if (value !== '' && !/^\+?[0-9][0-9 ()-]{5,19}$/.test(value)) {
      setError('Enter a phone number such as +60 12-345 6789.')
      return
    }
    setBusy(true)
    // Straight from the browser: only the phone column of the tenant's own row can be updated.
    const { data, error: updateError } = await createClient()
      .from('tenants')
      .update({ phone: value === '' ? null : value })
      .eq('id', tenant.id)
      .select('phone')
    setBusy(false)
    if (updateError || !data || data.length !== 1) {
      setError(updateError?.message ?? 'Your phone number could not be saved.')
      toast.error('Could not save your phone number')
      return
    }
    onSaved(data[0].phone)
    toast.success('Phone number saved')
  }

  return (
    <form onSubmit={save} className="flex flex-wrap items-end gap-3 rounded-lg border p-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="phone">Phone number</Label>
        <Input id="phone" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+60 12-345 6789" />
      </div>
      <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
      {error ? <p role="alert" className="basis-full text-sm text-destructive">{error}</p> : null}
    </form>
  )
}

function LeaseCard({ lease }: { lease: Row['leases'][number] }) {
  const [busy, setBusy] = useState(false)
  const [bill, setBill] = useState<{ billId: string; amountSen: number } | null>(null)

  async function payNow() {
    setBusy(true)
    try {
      const res = await fetch(`/api/leases/${lease.id}/gateway-bills`, { method: 'POST' })
      const body: { billId?: string; amountSen?: number; error?: string } = await res.json().catch(() => ({}))
      if (!res.ok || !body.billId || body.amountSen === undefined) {
        toast.error(body.error ?? 'Could not create the bill')
        return
      }
      setBill({ billId: body.billId, amountSen: body.amountSen })
      toast.success('Bill created')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Unit {lease.units?.name ?? ''} · {formatMytDate(lease.start_date)} to {formatMytDate(lease.end_date)}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Rent {formatRinggit(lease.monthly_rent_sen)} a month{lease.deposit_sen > 0 ? ` · deposit ${formatRinggit(lease.deposit_sen)}` : ''}
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-muted p-4">
          <div>
            <p className="text-sm text-muted-foreground">Amount due now</p>
            <p className="text-3xl font-semibold" data-testid="due-now">{formatRinggit(lease.dueNow)}</p>
          </div>
          <Button onClick={payNow} disabled={busy || lease.dueNow === 0}>
            {busy ? 'Creating bill…' : lease.dueNow === 0 ? 'Nothing due' : 'Pay now'}
          </Button>
        </div>

        {bill ? (
          <div className="space-y-2 rounded-lg border border-green-300 bg-green-50 p-4" role="status">
            <p className="font-medium">Your bill is ready</p>
            <p className="text-sm">Bill id: <span className="break-all font-mono" data-testid="bill-id">{bill.billId}</span></p>
            <p className="text-sm">Amount: <span data-testid="bill-amount">{formatRinggit(bill.amountSen)}</span></p>
            <p className="text-sm text-muted-foreground">
              In production you would now be sent to the payment gateway. In this test the gateway is played by the
              simulator: <code className="rounded bg-muted px-1">node gateway-sim.mjs {bill.billId} {bill.amountSen}</code>
            </p>
            <Link href={`/payments/return?bill_id=${bill.billId}`} className="text-sm underline">Check the bill&apos;s status</Link>
          </div>
        ) : null}

        <section className="space-y-2">
          <h2 className="font-semibold">Invoices</h2>
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
              {lease.invoices.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell>{invoice.kind === 'deposit' ? 'Deposit' : `${formatMytDate(invoice.period_start ?? '')} to ${formatMytDate(invoice.period_end ?? '')}`}</TableCell>
                  <TableCell>{formatMytDate(invoice.due_date)}</TableCell>
                  <TableCell className="text-right">{formatRinggit(invoice.amount_sen)}</TableCell>
                  <TableCell className="text-right">{formatRinggit(invoice.paid)}</TableCell>
                  <TableCell><StatusBadge status={invoice.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold">Payments</h2>
          {lease.payments.length === 0 ? (
            <p className="rounded-lg border p-4 text-center text-sm text-muted-foreground">No payments yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Received (Malaysia time)</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lease.payments.map((payment) => (
                  <TableRow key={payment.id}>
                    <TableCell>{formatMyt(payment.received_at)}</TableCell>
                    <TableCell>{METHOD[payment.method] ?? payment.method}</TableCell>
                    <TableCell className="text-right">{formatRinggit(payment.amount_sen)}</TableCell>
                    <TableCell><StatusBadge status={payment.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      </CardContent>
    </Card>
  )
}
