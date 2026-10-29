import { getActor } from '@/lib/auth'
import { route } from '@/lib/http'
import { recordPayment } from '@/lib/services/payments'

// Staff and managers record cash or bank transfer payments. 404 other organization's lease, 403 tenant,
// 400 invalid input, 422 over the cap. The body is read leniently here and validated in the service,
// after the 404 and 403 checks, so those win over a 400 for malformed input.
export const POST = route(async (request, context: { params: Promise<{ leaseId: string }> }) => {
  const actor = await getActor(request)
  const { leaseId } = await context.params
  const body: unknown = await request.json().catch(() => undefined)
  return Response.json(await recordPayment(actor, leaseId, body), { status: 201 })
})
