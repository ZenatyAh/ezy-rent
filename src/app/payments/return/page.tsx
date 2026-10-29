import { headers } from 'next/headers'
import Link from 'next/link'
import type { Actor } from '@/lib/actor'
import { getActor } from '@/lib/auth'
import { formatRinggit } from '@/lib/format'
import { senToNumber } from '@/lib/money'
import { findVisibleBill } from '@/lib/services/gateway'

// Where the gateway sends the tenant back to (/payments/return?bill_id=...&paid=true). It only DISPLAYS
// the bill's status from the database and changes nothing: the `paid` query parameter is ignored, and
// only the signed webhook can settle a bill. The viewer must be signed in and allowed to see the bill
// (the lease's tenant, or staff/manager of its organization); otherwise the page says "not found".
export default async function PaymentReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ bill_id?: string | string[] }>
}) {
  const { bill_id: rawBillId } = await searchParams
  const billId = typeof rawBillId === 'string' ? rawBillId : undefined

  let actor: Actor | null = null
  try {
    actor = await getActor({ headers: await headers() })
  } catch {
    actor = null // not signed in, or no role: treated like "not found"
  }

  // The id is only ever used as a bound query parameter; the length limit just avoids pointless lookups.
  const bill = actor && billId && billId.length <= 100 ? await findVisibleBill(actor, billId) : null

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
      {bill ? (
        <>
          <h1 className="text-2xl font-semibold">Payment status</h1>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg border p-4">
            <dt className="text-muted-foreground">Bill</dt>
            <dd className="break-all font-mono text-sm" data-testid="bill-id">{bill.id}</dd>
            <dt className="text-muted-foreground">Amount</dt>
            <dd data-testid="bill-amount">{formatRinggit(senToNumber(bill.amount_sen))}</dd>
            <dt className="text-muted-foreground">Status</dt>
            <dd className="font-medium" data-testid="bill-status">{bill.status}</dd>
          </dl>
          <p className="text-sm text-muted-foreground">
            This page only shows what our records say. A bill is settled by the payment gateway&apos;s
            confirmation, never by this page, so a pending bill may take a moment to turn paid.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-semibold">Bill not found</h1>
          <p className="text-sm text-muted-foreground" data-testid="bill-not-found">
            We could not find this bill. Sign in with the account that created it and try again.
          </p>
        </>
      )}
      <Link href="/" className="text-sm underline">Back to the app</Link>
    </main>
  )
}
