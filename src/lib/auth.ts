import 'server-only'
import { createClient as createStatelessClient } from '@supabase/supabase-js'
import type { Actor } from '@/lib/actor'
import { requireEnv } from '@/lib/env'
import { HttpError } from '@/lib/http'
import { prisma } from '@/lib/prisma'
import { createClient as createCookieClient } from '@/lib/supabase/server'

// Step 1 of every protected handler: who is calling? Throws 401 when there is no valid login.
// An Authorization: Bearer header takes precedence over the cookie, and a bad header is a 401, never
// a silent fallback to the cookie. getUser() asks the Auth server to verify the token, so revoked
// users and tampered tokens are rejected (getSession() would trust the cookie as is).
async function authenticatedUserId(source: { headers: Pick<Headers, 'get'> }): Promise<string> {
  const header = source.headers.get('authorization')

  if (header !== null) {
    const match = /^Bearer\s+(\S+)$/i.exec(header.trim())
    if (!match) throw new HttpError(401, 'Authorization header must be: Bearer <access token>')
    const client = createStatelessClient(
      requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
      requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
      { auth: { persistSession: false, autoRefreshToken: false } },
    )
    const { data, error } = await client.auth.getUser(match[1])
    if (error || !data.user) throw new HttpError(401, 'Invalid or expired access token')
    return data.user.id
  }

  const supabase = await createCookieClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) throw new HttpError(401, 'Not signed in')
  return data.user.id
}

// Authenticates, then loads the role and organization from the database: memberships for
// staff/managers, tenants.user_id for tenants. A valid login with neither gets 403.
// Pass the Request in route handlers, or { headers: await headers() } in server components/actions.
export async function getActor(source: { headers: Pick<Headers, 'get'> }): Promise<Actor> {
  const userId = await authenticatedUserId(source)

  const membership = await prisma.memberships.findUnique({ where: { user_id: userId } })
  if (membership) return { userId, orgId: membership.org_id, role: membership.role }

  const tenant = await prisma.tenants.findUnique({ where: { user_id: userId } })
  if (tenant) return { userId, orgId: tenant.org_id, role: 'tenant', tenantId: tenant.id }

  throw new HttpError(403, 'This account has no role in any organization')
}
