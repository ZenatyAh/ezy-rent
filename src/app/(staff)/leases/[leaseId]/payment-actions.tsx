'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

type Action = 'approve' | 'reject' | 'void'

const COPY: Record<Action, { label: string; title: string; description: string; done: string; reason: boolean }> = {
  approve: {
    label: 'Approve',
    title: 'Approve this payment?',
    description: "It will be added to the lease's unpaid invoices, oldest first. This cannot be undone, only voided.",
    done: 'Payment approved',
    reason: false,
  },
  reject: {
    label: 'Reject',
    title: 'Reject this payment?',
    description: 'The payment stays on record as rejected and does not count towards any invoice.',
    done: 'Payment rejected',
    reason: true,
  },
  void: {
    label: 'Void',
    title: 'Void this payment?',
    description: 'Its allocations are removed and the invoices it paid become unpaid again.',
    done: 'Payment voided',
    reason: true,
  },
}

function ConfirmAction({ paymentId, action }: { paymentId: string; action: Action }) {
  const router = useRouter()
  const copy = COPY[action]
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    setError(null)
    if (copy.reason && reason.trim().length < 5) {
      setError('Give a reason of at least 5 characters.')
      return
    }
    setBusy(true)
    try {
      const res = await fetch(`/api/payments/${paymentId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: copy.reason ? JSON.stringify({ reason: reason.trim() }) : undefined,
      })
      const body: { error?: string } = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? 'Something went wrong.')
        toast.error(body.error ?? `Could not ${action} the payment`)
        return
      }
      toast.success(copy.done)
      setOpen(false)
      setReason('')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => { setOpen(next); setError(null) }}>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant={action === 'approve' ? 'default' : 'outline'}>{copy.label}</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>{copy.description}</AlertDialogDescription>
        </AlertDialogHeader>
        {copy.reason ? (
          <div className="space-y-2">
            <Label htmlFor={`reason-${action}-${paymentId}`}>Reason (at least 5 characters)</Label>
            <Textarea id={`reason-${action}-${paymentId}`} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          </div>
        ) : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button onClick={confirm} disabled={busy} variant={action === 'approve' ? 'default' : 'destructive'}>
            {busy ? 'Working…' : `Yes, ${action}`}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// Managers only (the API enforces it as well). A pending payment can be approved or rejected, an approved
// one can be voided; nothing else is offered.
export function PaymentActions({ paymentId, status, isManager }: { paymentId: string; status: string; isManager: boolean }) {
  if (!isManager) return null
  if (status === 'pending_verification') {
    return (
      <div className="flex justify-end gap-2">
        <ConfirmAction paymentId={paymentId} action="approve" />
        <ConfirmAction paymentId={paymentId} action="reject" />
      </div>
    )
  }
  if (status === 'approved') {
    return (
      <div className="flex justify-end">
        <ConfirmAction paymentId={paymentId} action="void" />
      </div>
    )
  }
  return null
}
