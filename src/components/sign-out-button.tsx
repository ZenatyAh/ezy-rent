'use client'

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/browser'

export function SignOutButton() {
  const router = useRouter()
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        const { error } = await createClient().auth.signOut()
        if (error) {
          toast.error('Could not sign out')
          return
        }
        toast.success('Signed out')
        router.replace('/login')
        router.refresh()
      }}
    >
      Sign out
    </Button>
  )
}
