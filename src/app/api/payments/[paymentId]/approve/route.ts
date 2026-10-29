import { getActor } from '@/lib/auth'
import { route } from '@/lib/http'
import { approvePayment } from '@/lib/services/payments'

// Managers only. 409 if the payment is not pending, 422 if it no longer fits the remaining balance.
export const POST = route(async (request, context: { params: Promise<{ paymentId: string }> }) => {
  const actor = await getActor(request)
  const { paymentId } = await context.params
  return Response.json(await approvePayment(actor, paymentId))
})
