# Deploying the EQ Shell — demo first, then SKS

Walks through the steps to deploy `@eq/shell`. Per Option C
(`EQ-TENANCY-MODEL.md`), we provision **two** Supabase projects upfront:

- `eq-demo-canonical` — proving ground. Local Vite points here. Bugs and
  schema iteration happen here, not on SKS.
- `sks-canonical` (`ehowgjardagevnrluult`) — SKS live canonical. Already provisioned with sql/001–036 applied.

Each project pairs with its own Netlify site eventually. Everything that
touches live Supabase / Netlify is **your** step (CLAUDE.md rule: never
deploy or modify auth without explicit instruction). The code is ready;
you wire it up.

---

## Step 1 — Provision both Supabase projects

Do this for `eq-demo-canonical` FIRST, then repeat for `sks-canonical`.

1. Go to https://supabase.com/dashboard → New project
2. Settings:
   - Project name: `eq-demo-canonical` (first time) or `sks-canonical`
     (second time)
   - Region: `ap-southeast-2` (Sydney) for low latency
   - Database password: generate a strong one + store it in your password manager
3. Wait for provisioning (~2 min)
4. Once ready, **Settings → API**:
   - Copy the **Project URL** (e.g. `https://abcdefgh.supabase.co`)
   - Copy the **anon (public) key** — used by the client
   - Copy the **service_role key** — keep this secret, only for server-side stuff later

Keep the two sets of credentials clearly labelled (demo vs sks) in your
password manager. Mixing them up later is the failure mode worth
guarding against.

### Apply the canonical schema to BOTH

For each project, in Supabase **SQL editor**:

1. Open `eq-platform/.generated/all-migrations.sql` (154 KB, produced by
   `pnpm db:apply` from the repo root)
2. Paste the entire file into a new query
3. Run

This creates every canonical table (staff, sites, customers, contacts,
etc.) + the intake spine (`eq_intake_events`, `eq_intake_templates`,
`eq_intake_commit_batch` RPC, etc.) + seeds `eq_schema_registry`.

Demo gets the schema first so we can prove the wire-up there. SKS gets
the same schema so it's ready to flip on once demo is signed off.

## Step 2 — Create your first user (each project)

Two ways:

**Easiest (via dashboard):**
1. **Authentication → Users → Add user → Create new user**
2. Email: yours (or `royce@eq.solutions` etc.)
3. Password: generate + store
4. **Auto Confirm User** → yes (skip email confirmation flow for the first user)

**Via sign-in screen** (after deploy):
You can sign yourself up by visiting the deployed shell + entering email
+ password. But Supabase by default sends a confirmation email — needs
email-template setup. Easier to just create the user via dashboard first.

Do this in both projects (one user each is enough to start). Adding the
bookkeeper / others is the same dashboard flow.

## Step 3 — Local sanity check (against demo)

Run the shell locally pointing at `eq-demo-canonical` to confirm auth +
intake commit work end-to-end:

```bash
# In eq-platform/apps/eq-shell/, create .env.local (gitignored):
VITE_TENANT=demo
VITE_TENANT_NAME=EQ Demo
VITE_ENABLED_MODULES=intake,quotes
VITE_SUPABASE_URL=https://YOUR-DEMO-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR-DEMO-ANON-KEY
```

Then from the repo root:
```bash
pnpm --filter @eq/shell dev
```

Open http://localhost:5180/, you should see the sign-in screen with the
EQ Sky-blue branding. Sign in with the demo user from step 2. Should
land on `/intake` with the bundle flow.

Drop your three SimPRO files, run the rollup, hit the commit button —
canonical rows should appear in `eq-demo-canonical` (verify via Supabase
Table editor → `customers` / `contacts` / `sites`).

If anything's off, fix locally against demo. Never iterate against SKS.

## Step 4 — Create Netlify projects (demo first, SKS once proven)

One Netlify site per tenant. Suggested names mirror the existing
EQ pattern from CLAUDE.md (`eq-solves-field` / `sks-nsw-labour`):

- `eq-demo-shell.netlify.app` (or whatever) → pointing at `eq-demo-canonical`
- `sks-shell.netlify.app` (or `sks.eq.solutions`) → pointing at `sks-canonical`

For each:

1. https://app.netlify.com → Add new site → Import an existing project
2. Connect your GitHub (or your git provider) — point at this repo
3. **Build settings:**
   - Base directory: `eq-platform/apps/eq-shell`
   - Build command: `pnpm --filter @eq/shell build`
   - Publish directory: `eq-platform/apps/eq-shell/dist`
   - Node version: 20.x (set via `NODE_VERSION` env var or `.nvmrc`)
4. **Environment variables** (Site settings → Environment variables):

   For the **demo** site:
   - `VITE_TENANT=demo`
   - `VITE_TENANT_NAME=EQ Demo`
   - `VITE_ENABLED_MODULES=intake,quotes`
   - `VITE_SUPABASE_URL=https://YOUR-DEMO-PROJECT.supabase.co`
   - `VITE_SUPABASE_ANON_KEY=YOUR-DEMO-ANON-KEY`

   For the **SKS** site:
   - `VITE_TENANT=sks`
   - `VITE_TENANT_NAME=SKS Technologies`
   - `VITE_ENABLED_MODULES=intake,quotes`
   - `VITE_SUPABASE_URL=https://YOUR-SKS-PROJECT.supabase.co`
   - `VITE_SUPABASE_ANON_KEY=YOUR-SKS-ANON-KEY`

5. **`netlify.toml`** (optional but cleaner — drop this in
   `eq-platform/apps/eq-shell/netlify.toml`):

   ```toml
   [build]
     base = "eq-platform/apps/eq-shell"
     command = "pnpm --filter @eq/shell build"
     publish = "dist"

   [[redirects]]
     from = "/*"
     to = "/index.html"
     status = 200
   ```

   The redirect is critical for SPA routing — without it, `/intake`
   refreshed mid-flow gives a 404.

6. Trigger the first deploy.

## Step 5 — Custom domain (optional)

In Netlify → Domain management:
- Add custom domain: `intake.sks.com.au` or `sks.eq.solutions` (whichever)
- Configure DNS at your registrar to point at Netlify
- TLS is automatic

## Step 6 — Verify

1. Visit the deployed URL
2. You should see the SKS-branded sign-in screen
3. Sign in
4. Land on `/intake` → drop your three SimPRO files → roll up → download
5. Click "Quotes" in the nav → see the placeholder (until EQ Quotes is built)

## Adding more users later

Supabase → Authentication → Users → Add user. They get an email (if
SMTP is configured) or you set the password and share it via 1Password
etc. No code changes.

## Future tenants

Same shell repo, new Netlify site, different env vars:
- `VITE_TENANT=their-tenant-key`
- `VITE_TENANT_NAME=Their Company Name`
- `VITE_ENABLED_MODULES=intake` (or whatever they want)
- New Supabase project URL + anon key

Add their palette to `src/tenant-config.ts` in the `TENANT_PALETTES`
map. Re-deploy the shell to their site.

## Resuming the master plan

Once the shell is live with auth + Intake working, the next phase
(per `EQ-TENANCY-MODEL.md`) is making EQ Intake commit canonical rows
to this same Supabase. That involves:
- SQL codegen from `@eq/schemas` → per-entity tables
- Applying the 3 migrations in `sql/`
- Seeding `eq_schema_registry`
- Wiring the commit fn

All deferred until the deployable shell is in your hands first.
