import { createClient } from '@supabase/supabase-js'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { PASSWORD, PUBLISHABLE_KEY, SUPABASE_URL } from './helpers'

// The tenant portal reads and updates through supabase-js in the browser, under the tenant's own session.
// These tests issue the same queries with the same library and the same key, signed in as the tenant.

async function signedIn(email: string) {
  const client = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw new Error(`Could not sign in as ${email}: ${error.message}`)
  return client
}

afterAll(async () => {
  await prisma.tenants.updateMany({ data: { phone: null } }) // the phone tests change it
  await prisma.$disconnect()
})

describe("tenant portal: reads straight from the browser client", () => {
  it("returns the tenant's own row, lease (with the unit name), invoices, allocations and payments", async () => {
    const aisyah = await signedIn('aisyah@northwind.test')

    const tenant = await aisyah.from('tenants').select('id, full_name, email, phone').single()
    expect(tenant.error).toBeNull()
    expect(tenant.data).toMatchObject({ full_name: 'Aisyah Rahman', email: 'aisyah@northwind.test' })

    const leases = await aisyah.from('leases').select('id, start_date, end_date, monthly_rent_sen, deposit_sen, units(name)').order('start_date', { ascending: false })
    expect(leases.error).toBeNull()
    expect(leases.data).toHaveLength(1)
    expect(leases.data?.[0]).toMatchObject({ start_date: '2026-01-31', end_date: '2026-07-15', monthly_rent_sen: 150000, deposit_sen: 300000 })
    const unit = leases.data?.[0].units as unknown
    expect(Array.isArray(unit) ? unit[0] : unit).toEqual({ name: 'A-12-3' })
    const leaseId = leases.data?.[0].id as string

    const invoices = await aisyah.from('invoices').select('id, lease_id, kind, period_start, period_end, due_date, amount_sen').in('lease_id', [leaseId]).order('due_date').order('kind').order('period_index')
    expect(invoices.error).toBeNull()
    expect(invoices.data?.map((i) => [i.kind, i.amount_sen])).toEqual([
      ['deposit', 300000], ['rent', 150000], ['rent', 150000], ['rent', 150000], ['rent', 150000], ['rent', 150000], ['rent', 77419],
    ])

    const allocations = await aisyah.from('payment_allocations').select('invoice_id, amount_sen')
    expect(allocations.data?.reduce((sum, a) => sum + Number(a.amount_sen), 0)).toBe(500000)

    const payments = await aisyah.from('payments').select('id, lease_id, amount_sen, method, status, received_at').in('lease_id', [leaseId]).order('received_at')
    expect(payments.data?.map((p) => [p.method, p.status, p.amount_sen])).toEqual([['cash', 'approved', 300000], ['bank_transfer', 'approved', 200000]])
  })

  it("shows a tenant nothing of anyone else's data", async () => {
    const ben = await signedIn('ben@northwind.test')
    const leases = await ben.from('leases').select('id, units(name)')
    expect(leases.data).toHaveLength(1)
    const payments = await ben.from('payments').select('id')
    expect(payments.data).toEqual([]) // Ben has none; Aisyah's two are not his
    const others = await ben.from('tenants').select('id')
    expect(others.data).toHaveLength(1)
  })
})

describe('tenant portal: editing the phone number from the browser client', () => {
  it('updates only the tenant\'s own phone and returns the new value', async () => {
    const aisyah = await signedIn('aisyah@northwind.test')
    const tenant = await aisyah.from('tenants').select('id').single()
    const updated = await aisyah.from('tenants').update({ phone: '+60 12-345 6789' }).eq('id', tenant.data?.id as string).select('phone')
    expect(updated.error).toBeNull()
    expect(updated.data).toEqual([{ phone: '+60 12-345 6789' }])
    const cleared = await aisyah.from('tenants').update({ phone: null }).eq('id', tenant.data?.id as string).select('phone')
    expect(cleared.data).toEqual([{ phone: null }])
  })

  it("cannot touch another tenant's phone or any other column", async () => {
    const aisyah = await signedIn('aisyah@northwind.test')
    const ben = await prisma.tenants.findFirstOrThrow({ where: { email: 'ben@northwind.test' } })
    const other = await aisyah.from('tenants').update({ phone: '000' }).eq('id', ben.id).select('phone')
    expect(other.data).toEqual([]) // Ben's row is invisible to Aisyah: nothing changes
    expect((await prisma.tenants.findFirstOrThrow({ where: { id: ben.id } })).phone).toBeNull()

    const own = await aisyah.from('tenants').select('id').single()
    const name = await aisyah.from('tenants').update({ full_name: 'Hacked' }).eq('id', own.data?.id as string).select()
    expect(name.error).not.toBeNull() // permission denied: only phone may change
    expect((await prisma.tenants.findFirstOrThrow({ where: { email: 'aisyah@northwind.test' } })).full_name).toBe('Aisyah Rahman')
  })
})
