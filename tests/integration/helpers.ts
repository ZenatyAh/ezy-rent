import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'

export const BASE_URL = process.env.APP_URL ?? 'http://localhost:3000'
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
export const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ''
export const SECRET_KEY = process.env.SUPABASE_SECRET_KEY ?? ''
export const PASSWORD = 'Northwind#2026'

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export async function login(email: string, password = PASSWORD): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const json = (await res.json()) as { access_token?: string }
  if (!res.ok || !json.access_token) throw new Error(`Login failed for ${email} (${res.status}). Is the database seeded?`)
  return json.access_token
}

// The cookie header a browser would send after signing in, built with the same @supabase/ssr code
// the app uses to read it.
export async function cookieHeaderFor(email: string): Promise<string> {
  const jar = new Map<string, string>()
  const supabase = createServerClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) jar.set(name, value)
      },
    },
  })
  const { error } = await supabase.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw error
  await new Promise((resolve) => setTimeout(resolve, 50)) // let the client flush its cookies
  if (jar.size === 0) throw new Error('No session cookie was produced')
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
}

export function adminClient() {
  return createClient(SUPABASE_URL, SECRET_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
}

interface ApiOptions {
  token?: string
  cookie?: string
  headers?: Record<string, string>
  body?: unknown
  rawBody?: string
}

export async function api<T = unknown>(
  method: 'GET' | 'POST',
  path: string,
  options: ApiOptions = {},
): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = { ...options.headers }
  if (options.token) headers.Authorization = `Bearer ${options.token}`
  if (options.cookie) headers.Cookie = options.cookie
  let body: string | undefined
  if (options.rawBody !== undefined) {
    body = options.rawBody
    headers['Content-Type'] = 'application/json'
  } else if (options.body !== undefined) {
    body = JSON.stringify(options.body)
    headers['Content-Type'] = 'application/json'
  }
  const res = await fetch(`${BASE_URL}${path}`, { method, headers, body })
  const text = await res.text()
  let parsed: unknown = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = text
  }
  return { status: res.status, body: parsed as T }
}

export interface ErrorBody {
  error: string
}

export const hasErrorMessage = (body: unknown): boolean =>
  typeof body === 'object' && body !== null && typeof (body as ErrorBody).error === 'string' && (body as ErrorBody).error.length > 0
