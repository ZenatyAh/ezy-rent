import { getActor } from '@/lib/auth'
import { route } from '@/lib/http'
import { collectionsReport } from '@/lib/services/reports'

// Staff and managers of the caller's organization. 400 for a missing or invalid range.
export const GET = route(async (request) => {
  const actor = await getActor(request)
  const params = new URL(request.url).searchParams
  return Response.json(await collectionsReport(actor, params.get('from'), params.get('to')))
})
