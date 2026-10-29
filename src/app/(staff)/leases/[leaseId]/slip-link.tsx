'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/browser'

// Opens a bank transfer slip through a signed URL that is valid for 60 seconds. The Storage policy lets
// only staff and managers of the slip's organization create one.
export function SlipLink({ path }: { path: string }) {
  const [busy, setBusy] = useState(false)

  async function open() {
    setBusy(true)
    const tab = window.open('about:blank', '_blank') // opened now, inside the click, so pop-up blockers allow it
    const { data, error } = await createClient().storage.from('payment-slips').createSignedUrl(path, 60)
    setBusy(false)
    if (error || !data) {
      tab?.close()
      toast.error('Could not open the slip')
      return
    }
    if (tab) tab.location.href = data.signedUrl
    else toast.message('Allow pop-ups to see the slip')
  }

  return (
    <Button variant="link" size="sm" className="h-auto p-0" disabled={busy} onClick={open}>
      {busy ? 'Opening…' : 'View slip'}
    </Button>
  )
}
