import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { requireEnv } from '@/lib/env'

// Supabase client bound to the current request's session cookie (route handlers, Server Actions,
// server components). Uses the publishable key, so it acts as the signed-in user, under RLS.
export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options)
          } catch {
            // Called from a Server Component, where cookies are read-only. proxy.ts refreshes the session.
          }
        },
      },
    },
  )
}
