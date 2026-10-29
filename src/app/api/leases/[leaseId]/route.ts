import { getActor } from '@/lib/auth'
import { route } from '@/lib/http'
import { getLeaseDetail } from '@/lib/services/leases'

// Staff and managers of the lease's organization, and the lease's own tenant. Everyone else gets
// 404, so the response never reveals that the lease exists.
export const GET = route(async (request, context: { params: Promise<{ leaseId: string }> }) => {
  const actor = await getActor(request)
  const { leaseId } = await context.params
  return Response.json(await getLeaseDetail(actor, leaseId, new Date()))
})
