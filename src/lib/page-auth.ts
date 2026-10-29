import 'server-only'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import type { Actor, StaffActor, TenantActor } from '@/lib/actor'
import { getActor } from '@/lib/auth'
import { HttpError } from '@/lib/http'

// Authorization for pages (server components). The same getActor() as the API: role and organization come
// from the database, never from the URL or from user_metadata. A hidden link is not a check, so every
// page calls one of these first.
async function actorOrLogin(): Promise<Actor> {
  try {
    return await getActor({ headers: await headers() })
  } catch (error) {
    if (error instanceof HttpError) redirect('/login')
    throw error
  }
}

export async function requireStaffPage(): Promise<StaffActor> {
  const actor = await actorOrLogin()
  if (actor.role === 'tenant') redirect('/portal')
  return actor
}

export async function requireTenantPage(): Promise<TenantActor> {
  const actor = await actorOrLogin()
  if (actor.role !== 'tenant') redirect('/dashboard')
  return actor
}

// For the root page: where does this signed-in (or not signed-in) visitor belong?
export async function homeFor(): Promise<'/login' | '/dashboard' | '/portal'> {
  try {
    const actor = await getActor({ headers: await headers() })
    return actor.role === 'tenant' ? '/portal' : '/dashboard'
  } catch (error) {
    if (error instanceof HttpError) return '/login'
    throw error
  }
}
