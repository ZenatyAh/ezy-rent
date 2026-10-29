import { z } from 'zod'
import { requireRole } from '@/lib/actor'
import { getActor } from '@/lib/auth'
import { readJson, route } from '@/lib/http'
import { createLease } from '@/lib/services/leases'

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// YYYY-MM-DD. Year 0000 is rejected here because Postgres cannot store it (it would be a 500).
// Whether the day really exists on the calendar is checked by generateSchedule.
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date written as YYYY-MM-DD')
  .refine((value) => !value.startsWith('0000-'), 'year 0000 is not supported')

const createLeaseSchema = z.object({
  unitId: z.string().regex(ID, 'must be an id'),
  tenantId: z.string().regex(ID, 'must be an id'),
  startDate: day,
  endDate: day,
  monthlyRentSen: z.number(),
  depositSen: z.number(),
})

// Order of checks: 401 (login) -> 403 (role) -> 400 (body) -> 404 (unit/tenant not in the
// caller's organization) -> 409 (overlap).
export const POST = route(async (request) => {
  const actor = await getActor(request)
  requireRole(actor, 'manager')
  const input = createLeaseSchema.parse(await readJson(request))
  const { id } = await createLease(actor, input)
  return Response.json({ id }, { status: 201 })
})
