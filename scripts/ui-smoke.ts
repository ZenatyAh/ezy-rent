// Fetches the pages the way a browser would (session cookie, no JavaScript) and checks redirects,
// access and the Malaysia-time text. A smoke test for the server-rendered parts of the UI.
//   npm run smoke:ui      needs the app running and a freshly seeded database
import { prisma } from '@/lib/prisma'
import { BASE_URL, cookieHeaderFor } from '../tests/integration/helpers'

let failed = 0
function check(ok: boolean, label: string, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}

async function get(path: string, cookie?: string) {
  const res = await fetch(`${BASE_URL}${path}`, { headers: cookie ? { Cookie: cookie } : {}, redirect: 'manual' })
  return { status: res.status, location: res.headers.get('location') ?? '', html: res.status === 200 || res.status === 404 ? (await res.text()).replace(/<!-- -->/g, '') : '' }
}

async function main(): Promise<void> {
  const aisyahLease = await prisma.leases.findFirstOrThrow({ where: { tenants: { email: 'aisyah@northwind.test' } } })
  const [manager, staff, aisyah, managerB] = await Promise.all(
    ['manager@northwind.test', 'staff@northwind.test', 'aisyah@northwind.test', 'manager@beta.test'].map(cookieHeaderFor),
  )
  const path = (r: { location: string }) => (r.location ? new URL(r.location, BASE_URL).pathname : '')

  // not signed in
  check(path(await get('/')) === '/login', 'GET / without a login goes to /login')
  check(path(await get('/dashboard')) === '/login', 'GET /dashboard without a login goes to /login')
  check(path(await get(`/leases/${aisyahLease.id}`)) === '/login', 'GET a lease page without a login goes to /login')
  const login = await get('/login')
  check(login.status === 200 && login.html.includes('Sign in') && login.html.includes('type="password"'), '/login shows the sign-in form')

  // role redirects
  check(path(await get('/', manager)) === '/dashboard', 'manager: / goes to /dashboard')
  check(path(await get('/', staff)) === '/dashboard', 'staff: / goes to /dashboard')
  check(path(await get('/', aisyah)) === '/portal', 'tenant: / goes to /portal')
  check(path(await get('/login', manager)) === '/dashboard', 'signed-in manager: /login goes on to /dashboard')
  check(path(await get('/dashboard', aisyah)) === '/portal', 'tenant cannot open /dashboard')
  check(path(await get('/leases', aisyah)) === '/portal', 'tenant cannot open /leases')
  check(path(await get(`/leases/${aisyahLease.id}`, aisyah)) === '/portal', "tenant cannot open the staff lease page, not even their own")

  // dashboard
  const dashboard = await get('/dashboard', manager)
  const overdue = /data-testid="overdue-count"[^>]*>(\d+)</.exec(dashboard.html)?.[1]
  check(dashboard.status === 200 && overdue !== undefined, 'dashboard shows the overdue count', `count=${overdue}`)
  check(dashboard.html.includes('Collections by month') && /RM \d/.test(dashboard.html), 'dashboard shows collections in ringgit')

  // leases list
  const list = await get('/leases', staff)
  check(list.status === 200 && list.html.includes('A-12-3') && list.html.includes('Aisyah Rahman') && list.html.includes('KL-1') === false, "leases list shows Northwind's leases only")
  check(list.html.includes('31 Jan 2026') && list.html.includes('RM 1,500.00'), 'leases list: dates and rent formatted')

  // lease page
  const page = await get(`/leases/${aisyahLease.id}`, manager)
  check(page.status === 200, 'manager opens the lease page', `status ${page.status}`)
  check(page.html.includes('Unit A-12-3') && page.html.includes('Aisyah Rahman'), 'lease page: unit and tenant')
  check(page.html.includes('RM 3,000.00') && page.html.includes('RM 774.19') && page.html.includes('Deposit'), 'lease page: invoice amounts')
  check(page.html.includes('31 Jan 2026, 10:00'), 'lease page: cash payment shown as 31 Jan 2026, 10:00 (Malaysia time)')
  check(page.html.includes('01 Mar 2026, 00:30'), 'lease page: transfer shown as 01 Mar 2026, 00:30, not as 28 Feb (UTC)')
  check(!page.html.includes('28 Feb 2026, 16:30'), 'lease page: no UTC rendering of the transfer')
  check(page.html.includes('View slip') && page.html.includes('Record payment') && page.html.includes('>Void<'), 'lease page: slip link, record button and void for the manager')
  const staffPage = await get(`/leases/${aisyahLease.id}`, staff)
  check(staffPage.status === 200 && staffPage.html.includes('Record payment') && !staffPage.html.includes('>Void<') && !staffPage.html.includes('>Approve<'), 'staff: can record, but is not offered approve or void')
  // loading.tsx makes Next send the page shell before the page runs, so notFound() can no longer change the
  // HTTP status (it stays 200). What matters is that the body is the not-found page with none of the lease data.
  const isNotFoundPage = (r: { html: string }) =>
    r.html.includes('could not be found') && !r.html.includes('Aisyah') && !r.html.includes('RM 3,000.00')
  const other = await get(`/leases/${aisyahLease.id}`, managerB)
  check(isNotFoundPage(other), "another organization's manager gets the not-found page, with none of the lease data", `status ${other.status}`)
  check(isNotFoundPage(await get('/leases/not-a-uuid', manager)), 'a malformed lease id shows the not-found page')
  check(isNotFoundPage(await get(`/leases/${crypto.randomUUID()}`, manager)), 'an unknown lease id shows the not-found page')

  console.log(failed === 0 ? '\nAll UI smoke checks passed.' : `\n${failed} UI smoke check(s) FAILED.`)
  if (failed) process.exitCode = 1
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
