import { AppHeader } from '@/components/app-header'
import { requireTenantPage } from '@/lib/page-auth'
import { TenantPortal } from './tenant-portal'

// Tenants only. The page itself shows nothing: the data is read in the browser with supabase-js under
// the tenant's own session, so Row Level Security decides what comes back.
export default async function PortalPage() {
  const actor = await requireTenantPage()
  return (
    <>
      <AppHeader role="tenant" links={[{ href: '/portal', label: 'My lease' }]} />
      <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 p-4">
        <TenantPortal tenantId={actor.tenantId} />
      </main>
    </>
  )
}
