import { HttpError } from '@/lib/http'
import { prisma } from '@/lib/prisma'
import { createAdminClient } from '@/lib/supabase/admin'

export const SLIP_BUCKET = 'payment-slips'
const MAX_BYTES = 5 * 1024 * 1024
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'application/pdf']

// A slip must live in the caller's own organization folder: <org_id>/<file>.
function isInOrgFolder(orgId: string, path: string): boolean {
  return (
    path.startsWith(`${orgId}/`) &&
    path.length > orgId.length + 1 &&
    path.length <= 512 &&
    !path.includes('..') &&
    !path.includes('\\') &&
    !path.endsWith('/')
  )
}

// slipPath must point to an existing file in the actor's organization folder that no other payment
// uses. The bucket already limits size and type at upload; they are checked again here.
export async function assertSlipUsable(orgId: string, path: string): Promise<void> {
  if (!isInOrgFolder(orgId, path)) {
    throw new HttpError(400, "slipPath must point to a file in your organization's folder")
  }
  const rows = await prisma.$queryRaw<Array<{ size: string | null; mimetype: string | null }>>`
    select metadata->>'size' as size, metadata->>'mimetype' as mimetype
    from storage.objects where bucket_id = ${SLIP_BUCKET} and name = ${path}`
  if (rows.length === 0) throw new HttpError(400, 'slipPath does not point to an uploaded file')
  const { size, mimetype } = rows[0]
  if (size !== null && Number(size) > MAX_BYTES) throw new HttpError(400, 'The slip is larger than 5 MB')
  if (mimetype !== null && !ALLOWED_TYPES.includes(mimetype)) throw new HttpError(400, 'The slip must be a JPEG, PNG or PDF')
  const used = await prisma.payments.findUnique({ where: { slip_path: path }, select: { id: true } })
  if (used) throw new HttpError(400, 'This slip is already attached to another payment')
}

// Recording a payment failed after its slip was uploaded: delete the file, so no orphan is left.
// Only a file in the caller's own folder that no payment references is ever deleted, so a failing
// request can never remove another payment's slip. The secret key is needed because the bucket has
// no delete policy for users.
export async function removeOrphanedSlip(orgId: string, path: unknown): Promise<void> {
  if (typeof path !== 'string' || !isInOrgFolder(orgId, path)) return
  try {
    const used = await prisma.payments.findUnique({ where: { slip_path: path }, select: { id: true } })
    if (used) return
    await createAdminClient().storage.from(SLIP_BUCKET).remove([path])
  } catch {
    console.error('Could not remove an orphaned slip upload')
  }
}
