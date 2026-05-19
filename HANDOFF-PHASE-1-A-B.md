# Handoff — Phase 1.A + 1.B manual setup

> ⚠️ **Historical, partially superseded by Phase 1.E (2026-05-19).**
> The original Phase 1.A/B setup ran against `eq-shell-control` (`hxwitoveffxhcgjvubbd`) and assumed a `*.eq.solutions` wildcard custom domain would work in Netlify. Both turned out wrong.
>
> - The shell now reads from `eq-canonical` (`jvknxcmbtrfnxfrwfimn`) — `eq-shell-control` was decommissioned.
> - Netlify rejects asterisks in `custom_domain`/`domain_aliases` regardless of plan tier on external DNS, so each tenant gets a **specific** subdomain alias registered (e.g. `core.eq.solutions`, future `sks.eq.solutions`).
> - The Phase 1.D smoke test was run against the `core` tenant (EQ Solutions itself dog-fooding), not `sks-test`.
>
> Keep this doc for the dashboard URLs and the conceptual setup flow; treat the specific values (Supabase project URL, test tenant slug) as outdated. For the current state of the shell see [README.md](README.md).

Three steps you need to do by hand before the EQ Shell deploys + Phase 1.D smoke test becomes runnable end-to-end. ~15-20 minutes total. Each step has a dashboard URL, exactly what to copy from where, and a verification check so you know it landed.

| Step | What | Time | Blocks |
|---|---|---|---|
| 1 | Set three env vars on the `eq-shell` Netlify project | ~5 min | All function calls fail-fast without these |
| 2 | Link `eq-solutions/eq-shell` GitHub repo to Netlify for auto-deploy | ~5 min | Phase 1.B code isn't live until first deploy fires |
| 3 | `*.eq.solutions` wildcard DNS + Netlify domain alias | ~10 min + propagation | Tenants can't reach the shell without the wildcard |
| 4 | Smoke test | ~5 min | Confirms iframe handshake works end-to-end |

---

## Step 1 — Netlify env vars on `eq-shell`

Dashboard: <https://app.netlify.com/projects/eq-shell/configuration/env>

Three variables to add. Scope all of them to **Functions** only. Context **all** unless noted.

### `EQ_SECRET_SALT`

**Where to find the value:** <https://app.netlify.com/projects/eq-solves-field/configuration/env> → search `EQ_SECRET_SALT` → click the row → reveal → copy.

**Mark as secret.** This is the HMAC signing key for both the shell session cookie AND the iframe handoff token. Must be **byte-for-byte identical** to eq-solves-field's value or the iframe handshake silently fails (Field will reject the shell-token with `{ valid: false }` and the user lands on the PIN gate).

### `SUPABASE_URL`

Value: `https://hxwitoveffxhcgjvubbd.supabase.co`

Not secret. This is the canonical Supabase project's public URL.

### `SUPABASE_SERVICE_ROLE_KEY`

**Where to find the value:** <https://supabase.com/dashboard/project/hxwitoveffxhcgjvubbd/settings/api> → "Service role secret" section → copy the JWT.

**Mark as secret.** This is the service-role JWT — bypasses RLS. Don't confuse with the anon / publishable key, both of which are also on that page. The shell's Netlify functions use this key to read/write the canonical `tenants` / `users` / `module_entitlements` tables; deny-by-default RLS policies block anon and authenticated direct access.

### Verification

After all three are set, hit:

```bash
curl -i https://eq-shell.netlify.app/.netlify/functions/verify-shell-session
```

Expected: `HTTP/1.1 401` with body `{"valid":false}` (no cookie present → 401 is the correct response).

Failure modes:

- `500 { "error": "Server misconfigured — missing EQ_SECRET_SALT" }` → `EQ_SECRET_SALT` didn't land. Re-check the dashboard.
- `500 { "error": "Supabase env vars missing: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }` (or similar) → one of the Supabase vars didn't land.
- `404` → Netlify didn't deploy yet (do Step 2 first).

---

## Step 2 — Link `eq-solutions/eq-shell` GitHub repo to Netlify

Dashboard: <https://app.netlify.com/projects/eq-shell/configuration/deploys#continuous-deployment>

If no repo is linked, the section will show "Link repository" — click it, authorize the `eq-solutions` GitHub org if not already done, pick `eq-solutions/eq-shell`, branch `main`.

Build settings should auto-detect from `netlify.toml`:

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Publish directory | `dist` |
| Functions directory | `netlify/functions` |
| Node version | 20 (or whatever's in `package.json` engines, if set) |

After linking, click **Trigger deploy → Deploy site** (or push any commit to `main`). First deploy takes ~1-2 minutes.

### Verification

```bash
curl -I https://eq-shell.netlify.app
```

Expected: `HTTP/2 200` with `Server: Netlify`. Visit in a browser → should land on the login page (or a brief "Loading…" then the login page).

Failure modes:

- 404 page with the Netlify globe → no deploy yet. Check the **Deploys** tab for build errors.
- 500 / blank page → JS error in the React shell. Check the browser console + Netlify deploy log.

---

## Step 3 — `*.eq.solutions` wildcard DNS + Netlify domain alias

### At your DNS provider

Check the existing eq.solutions zone (probably Cloudflare given the marketing site setup per CLAUDE.md). Add:

| Type | Name | Value | TTL | Proxied? (Cloudflare) |
|---|---|---|---|---|
| CNAME | `*` | `eq-shell.netlify.app` | Auto | **No (DNS only)** |

The CNAME wildcard means any `<anything>.eq.solutions` resolves to the Netlify project. The DNS-only / un-proxied setting is important on Cloudflare — proxying breaks Netlify's HTTPS termination + Let's Encrypt issuance.

If your DNS provider doesn't support CNAME wildcards (rare — Cloudflare / Route 53 / GoDaddy all do), Netlify accepts an `A` record wildcard to their load balancer IP. Check the Netlify dashboard's "Set up a custom domain" prompt for the current recommended IP; it changes occasionally.

### At Netlify

Dashboard: <https://app.netlify.com/projects/eq-shell/configuration/domain>

→ "Add custom domain" → enter `*.eq.solutions` → confirm.

Netlify auto-provisions a Let's Encrypt **wildcard certificate**. This takes 5-10 minutes after DNS propagation. Status shown on the same page; refresh after ~10 minutes.

**Existing `eq.solutions` apex is NOT touched** — marketing stays at the root on Cloudflare Pages per the Q9 design decision.

### Verification

After DNS has propagated (give it 10-15 minutes; check via <https://dnschecker.org/#CNAME/sks-test.eq.solutions>):

```bash
curl -I https://sks-test.eq.solutions
```

Expected: `HTTP/2 200` with `Server: Netlify`. Browser visit → login page.

Failure modes:

- `Could not resolve host` → DNS hasn't propagated yet. Wait longer or check the registrar.
- `SSL certificate problem: unable to get local issuer certificate` → Let's Encrypt wildcard hasn't issued yet. Check the Netlify domain panel.
- Netlify "host not configured" page → the wildcard custom domain wasn't added (or was added but to the wrong project).

---

## Step 4 — Smoke test

Once Steps 1-3 are done, seed a test tenant + user and walk the login → iframe flow.

### Seed SQL (via Supabase MCP or dashboard SQL editor)

Target: project `eq-shell-control` (id `hxwitoveffxhcgjvubbd`).

```sql
-- Generate a bcrypt hash for the PIN '1234':
--   node -e "console.log(require('bcryptjs').hashSync('1234', 10))"
-- Then paste it into the value below.

INSERT INTO public.tenants (slug, name, brand_color)
VALUES ('sks-test', 'SKS Test', '#1F335C');

INSERT INTO public.users (email, tenant_id, role, pin_hash)
VALUES (
  'test@eq.solutions',
  (SELECT id FROM public.tenants WHERE slug = 'sks-test'),
  'admin',
  '<paste bcrypt hash here>'
);

INSERT INTO public.module_entitlements (tenant_id, module, enabled)
VALUES (
  (SELECT id FROM public.tenants WHERE slug = 'sks-test'),
  'field',
  true
);
```

### Walk the flow

1. Browser → <https://sks-test.eq.solutions>
2. Should see the shell login page.
3. Enter `test@eq.solutions` + `1234` → submit.
4. Should redirect to `/sks-test/` (the tenant home with the module nav).
5. Click **EQ Field** in the nav → routes to `/sks-test/field`.
6. Should see the EQ Field UI loaded in an iframe with **no PIN gate** — the v3.5.9 shell-token handshake skipped it.

### Failure-mode reading guide

| Symptom | Likely cause |
|---|---|
| Login page → submit → still on login page | Cookie domain mismatch. Check `Domain=.eq.solutions` was set; check the deployed URL matches `*.eq.solutions` |
| Login succeeds, tenant home loads, EQ Field iframe shows the PIN gate | `EQ_SECRET_SALT` drifted between projects. Re-copy from eq-solves-field. Console will warn `shell-token verify rejected` |
| Login fails with `Database error` | `SUPABASE_SERVICE_ROLE_KEY` is wrong or missing |
| EQ Field iframe is blank | Field rejected the shell-token (network tab → POST to `verify-pin` → `{ valid: false }`). Same root cause as drift above |

---

## What this doc does NOT cover

- Adding real customers (this is the test-tenant + login flow only).
- Phase 2 Tender Pipeline migration to React (separate work).
- Magic-link or email-based shell login (Phase 1.B uses email + PIN; magic links are a follow-up).
- Moving existing SKS prod users onto the shell (Phase 4+ once the SKS deploy is decommissioned).
- Setting up `audit_log` table on `eq-shell-control` (stdout logs cover the gap in Phase 1.B).

## Rollback

If the smoke test fails and you need to disable the shell entirely without reverting code:

1. Netlify → Domain panel → remove the `*.eq.solutions` custom domain. Shell becomes inaccessible to tenant URLs immediately; marketing at the apex is unaffected.
2. EQ Field is **not** impacted — it still works at `eq-solves-field.netlify.app` with the PIN gate exactly as before. The Phase 1.C shell-token handler in EQ Field is a pure no-op when there's no `#sh=` hash in the URL.

No data is touched by disabling the shell — `eq-shell-control` rows stay; the only effect is users can't reach the shell login page.
