import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { requireEnv } from '@/lib/env'

// Client with the secret key: it bypasses RLS and Storage policies. Server-only (the import above makes
// the build fail if a client component ever imports this file) and used for Storage cleanup, never to
// answer a request on a caller's behalf without an authorization check first.
export function createAdminClient() {
  return createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SECRET_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
