import type { ReactNode } from 'react'
import { AppHeader } from '@/components/app-header'
import { requireStaffPage } from '@/lib/page-auth'

// Staff and managers only. Each page also calls requireStaffPage(): a layout does not re-run on
// client-side navigation, so it is never the only check.
export default async function StaffLayout({ children }: { children: ReactNode }) {
  const actor = await requireStaffPage()
  return (
    <>
      <AppHeader
        role={actor.role}
        links={[
          { href: '/dashboard', label: 'Dashboard' },
          { href: '/leases', label: 'Leases' },
        ]}
      />
      <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 p-4">{children}</main>
    </>
  )
}
