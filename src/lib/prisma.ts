import 'server-only'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'

// Prisma connects as the database owner, so it bypasses RLS: every caller of this client must check
// organization and role itself (see src/lib/auth.ts). One client per server process; in development
// it is kept on globalThis so hot reloads do not open a new connection pool each time.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
