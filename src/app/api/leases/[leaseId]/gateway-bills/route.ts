import { getActor } from '@/lib/auth'
import { route } from '@/lib/http'
import { createBill } from '@/lib/services/gateway'

// "Pay now": only the lease's own tenant. 403 for staff and managers, 404 for anyone else's lease,
// 422 when nothing is due yet.
export const POST = route(async (request, context: { params: Promise<{ leaseId: string }> }) => {
  const actor = await getActor(request)
  const { leaseId } = await context.params
  return Response.json(await createBill(actor, leaseId, new Date()), { status: 201 })
})
