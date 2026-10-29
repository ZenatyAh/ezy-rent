import { redirect } from 'next/navigation'
import { homeFor } from '@/lib/page-auth'

// The root sends everyone where they belong: staff and managers to the dashboard, tenants to their
// portal, visitors who are not signed in to the login page.
export default async function Home() {
  redirect(await homeFor())
}
