'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { parseRinggitToSen } from '@/lib/billing'
import { createClient } from '@/lib/supabase/browser'
import { mytInputToIso, toMytInput } from '@/lib/time'

const SLIP_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' }
const MAX_SLIP_BYTES = 5 * 1024 * 1024

export function RecordPayment({ leaseId, orgId }: { leaseId: string; orgId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<'cash' | 'bank_transfer'>('cash')
  const [receivedAt, setReceivedAt] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function onOpenChange(next: boolean) {
    setOpen(next)
    setError(null)
    // "Now" is read when the dialog opens, in an event handler, never while rendering: the server
    // render and the browser would otherwise disagree. It is shown as Malaysia time, not device time.
    if (next) setReceivedAt(toMytInput(new Date()))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    let amountSen: number
    try {
      amountSen = parseRinggitToSen(amount)
    } catch {
      setError('Enter the amount in ringgit, for example 1,500.50')
      return
    }
    if (amountSen <= 0) {
      setError('The amount must be more than RM 0.00')
      return
    }
    if (!receivedAt) {
      setError('Choose when the money was received (Malaysia time)')
      return
    }
    if (method === 'bank_transfer') {
      if (!file) return setError('Attach the bank transfer slip (JPEG, PNG or PDF, up to 5 MB)')
      if (!(file.type in SLIP_TYPES)) return setError('The slip must be a JPEG, PNG or PDF file')
      if (file.size > MAX_SLIP_BYTES) return setError('The slip is larger than 5 MB')
    }

    setBusy(true)
    try {
      let slipPath: string | undefined
      if (method === 'bank_transfer' && file) {
        // The slip goes to Storage first, straight from the browser, under the organization's folder.
        // If recording then fails, the server deletes the file again.
        slipPath = `${orgId}/${crypto.randomUUID()}.${SLIP_TYPES[file.type]}`
        const { error: uploadError } = await createClient().storage.from('payment-slips').upload(slipPath, file, { contentType: file.type })
        if (uploadError) {
          setError(`The slip could not be uploaded: ${uploadError.message}`)
          toast.error('Slip upload failed')
          return
        }
      }
      const res = await fetch(`/api/leases/${leaseId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountSen, method, receivedAt: mytInputToIso(receivedAt), ...(slipPath ? { slipPath } : {}) }),
      })
      const body: { status?: string; error?: string } = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? 'The payment could not be recorded.')
        toast.error(body.error ?? 'Could not record the payment')
        return
      }
      toast.success(body.status === 'approved' ? 'Payment recorded and approved' : 'Payment recorded; a manager needs to approve it')
      setOpen(false)
      setAmount('')
      setFile(null)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>Record payment</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>Record a payment</DialogTitle>
            <DialogDescription>
              A manager&apos;s payment is approved at once. A staff member&apos;s payment waits for a manager to approve it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="amount">Amount (RM)</Label>
            <Input id="amount" inputMode="decimal" placeholder="1,500.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="method">Method</Label>
            <select
              id="method"
              value={method}
              onChange={(e) => setMethod(e.target.value === 'bank_transfer' ? 'bank_transfer' : 'cash')}
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
            >
              <option value="cash">Cash</option>
              <option value="bank_transfer">Bank transfer</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="received">Received on (Malaysia time)</Label>
            <Input id="received" type="datetime-local" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} />
          </div>
          {method === 'bank_transfer' ? (
            <div className="space-y-2">
              <Label htmlFor="slip">Bank transfer slip</Label>
              <Input id="slip" type="file" accept="image/jpeg,image/png,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <p className="text-xs text-muted-foreground">JPEG, PNG or PDF, up to 5 MB.</p>
            </div>
          ) : null}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Record payment'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
