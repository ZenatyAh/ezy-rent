import { getActor } from '@/lib/auth'
import { route } from '@/lib/http'
import { rejectPayment } from '@/lib/services/payments'

// Managers only. 400 if the reason is missing or shorter than 5 characters, 409 if not pending.
export const POST = route(async (request, context: { params: Promise<{ paymentId: string }> }) => {
  const actor = await getActor(request)
  const { paymentId } = await context.params
  const body: unknown = await request.json().catch(() => undefined)
  return Response.json(await rejectPayment(actor, paymentId, body))
})
