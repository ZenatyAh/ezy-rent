import { createBrowserClient } from '@supabase/ssr'

// Supabase client for the browser. It uses the publishable key and the signed-in user's session, so
// everything it reads or writes is checked by RLS and the Storage policies. The secret key never
// reaches the browser. The process.env.NEXT_PUBLIC_* references must stay literal so Next inlines them.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
  )
}
