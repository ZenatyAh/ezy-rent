import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Integration tests: they call the running app (APP_URL, default http://localhost:3000) and the
// local Supabase stack, and need a seeded database. Start the app first (npm run dev, or
// npm run build && npm start). Run with `npm run test:int`.
export default defineConfig({
  resolve: {
    alias: [
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
      // server-only throws outside Next's server runtime; tests may use the Prisma client directly.
      { find: /^server-only$/, replacement: fileURLToPath(new URL('./tests/empty.ts', import.meta.url)) },
    ],
  },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    setupFiles: ['./tests/setup-env.ts'],
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
