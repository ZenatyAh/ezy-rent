import { Badge } from '@/components/ui/badge'

const LABELS: Record<string, string> = {
  paid: 'Paid',
  partially_paid: 'Partly paid',
  unpaid: 'Unpaid',
  overdue: 'Overdue',
  pending_verification: 'Pending approval',
  approved: 'Approved',
  rejected: 'Rejected',
  voided: 'Voided',
}

const TONE: Record<string, string> = {
  paid: 'bg-green-100 text-green-800 hover:bg-green-100',
  approved: 'bg-green-100 text-green-800 hover:bg-green-100',
  partially_paid: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
  pending_verification: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
  overdue: 'bg-red-100 text-red-800 hover:bg-red-100',
  rejected: 'bg-red-100 text-red-800 hover:bg-red-100',
  unpaid: 'bg-slate-100 text-slate-700 hover:bg-slate-100',
  voided: 'bg-slate-200 text-slate-600 hover:bg-slate-200',
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge className={TONE[status] ?? ''} variant="secondary">{LABELS[status] ?? status}</Badge>
}
