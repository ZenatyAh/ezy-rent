import { redirect } from 'next/navigation'
import { homeFor } from '@/lib/page-auth'
import { LoginForm } from './login-form'

export default async function LoginPage() {
  const home = await homeFor()
  if (home !== '/login') redirect(home) // already signed in
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-6 p-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Rent collection</h1>
        <p className="text-sm text-muted-foreground">Sign in with the account your property manager gave you.</p>
      </div>
      <LoginForm />
    </main>
  )
}
