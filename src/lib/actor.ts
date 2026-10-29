import { HttpError } from '@/lib/http'

// Who is calling. Built only from the database (memberships, tenants.user_id), never from
// anything the user can edit such as user_metadata.
export interface StaffActor {
  userId: string
  orgId: string
  role: 'manager' | 'staff'
}

export interface TenantActor {
  userId: string
  orgId: string
  role: 'tenant'
  tenantId: string
}

export type Actor = StaffActor | TenantActor

// 403: the caller is signed in and can see the record, but their role may not do this.
export function requireRole(actor: Actor, ...roles: Array<Actor['role']>): void {
  if (!roles.includes(actor.role)) {
    throw new HttpError(403, `This action requires one of these roles: ${roles.join(', ')}`)
  }
}
