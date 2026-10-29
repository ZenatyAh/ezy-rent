// Load .env.local for integration tests (Vitest does not load it for non-VITE_ variables).
try {
  process.loadEnvFile('.env.local')
} catch {
  // variables must already be in the environment
}
