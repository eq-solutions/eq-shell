import { defineConfig } from 'vitest/config'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Vitest config for integration tests against a real local Supabase.
 *
 * Different from `vitest.config.ts` (which runs unit tests in jsdom + mocks):
 * - node environment (server-side flow, no DOM)
 * - longer timeouts (DB round-trips)
 * - separate include glob — only files under tests/integration/
 * - serial execution (singleFork) so seed data doesn't collide
 * - loads `.env.local` at config time so devs don't need to source it
 *
 * Run with: `npm run test:integration`.
 *
 * Requires `supabase start` to be running locally with NEXT_PUBLIC_SUPABASE_URL,
 * NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in .env.local.
 * See tests/integration/README.md for full setup.
 */

// Minimal .env.local loader — avoids adding `dotenv` just for tests. Skips
// silently if the file doesn't exist (so CI runners can inject env vars
// directly without needing a file).
function loadEnvLocal() {
  const envPath = resolve(__dirname, '.env.local')
  if (!existsSync(envPath)) return
  const content = readFileSync(envPath, 'utf8')
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    const key = m[1]
    if (process.env[key] !== undefined) continue // don't clobber existing
    let value = m[2]
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}
loadEnvLocal()

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/integration/setup.ts'],
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 15_000,
    hookTimeout: 30_000,
    // Each test seeds its own tenants with random UUIDs, so parallelism is
    // safe today. If you add tests with shared fixtures, set
    // `fileParallelism: false` here to force serial execution.
    alias: { '@': resolve(__dirname, '.') },
  },
})
