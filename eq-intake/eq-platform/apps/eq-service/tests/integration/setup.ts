/**
 * Integration-test setup. Asserts that the test target is a LOCAL Supabase
 * instance — never production. A misconfigured env that points at the real
 * DB would risk seeding garbage rows or deleting real data on cleanup.
 *
 * Env vars must already be loaded into process.env before vitest starts.
 * Run via `npm run test:integration` which uses Node's `--env-file=.env.local`
 * (Node 20+). If env vars are missing the suite errors loudly at startup
 * rather than silently passing — better to be obviously broken than fake-green.
 */
import { beforeAll } from 'vitest'

beforeAll(() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !serviceKey || !anonKey) {
    throw new Error(
      'Integration tests require NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY ' +
        '+ NEXT_PUBLIC_SUPABASE_ANON_KEY in process.env.\n' +
        'Run `npm run test:integration` (which loads .env.local via --env-file), ' +
        'and make sure `supabase start` is running locally.',
    )
  }

  // Safety gate — refuse to run against anything that looks like production.
  // Locally `supabase start` uses 127.0.0.1:54321; CI may use a docker host.
  const isLocal =
    url.includes('127.0.0.1') ||
    url.includes('localhost') ||
    url.includes('host.docker.internal') ||
    url.includes('supabase_kong') // docker-compose internal hostname

  if (!isLocal) {
    throw new Error(
      `Refusing to run integration tests against non-local Supabase: ${url}\n` +
        'Integration tests mutate the database — they must NEVER point at a production project.\n' +
        'Override only by patching tests/integration/setup.ts after careful review.',
    )
  }
})
