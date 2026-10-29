import Link from 'next/link'
import { SignOutButton } from '@/components/sign-out-button'

export function AppHeader({ role, links }: { role: string; links: Array<{ href: string; label: string }> }) {
  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 p-4">
        <nav className="flex items-center gap-4 text-sm">
          <span className="font-semibold">Rent collection</span>
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="text-muted-foreground hover:text-foreground">
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3 text-sm">
          <span className="rounded-full border px-2 py-0.5 text-xs capitalize text-muted-foreground">{role}</span>
          <SignOutButton />
        </div>
      </div>
    </header>
  )
}
