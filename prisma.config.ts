import { defineConfig } from 'prisma/config'

// Prisma 7 does not load .env files by itself. Load .env.local here; if it does not exist
// (fresh clone during `npm install`, CI) the variables must already be in the environment.
try {
  process.loadEnvFile('.env.local')
} catch {
  // no .env.local
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  // Used by `prisma db pull` (introspection). Read with process.env, not env(), so that
  // `prisma generate` in the postinstall step does not fail when the variable is not set yet.
  datasource: { url: process.env.DIRECT_URL },
})
