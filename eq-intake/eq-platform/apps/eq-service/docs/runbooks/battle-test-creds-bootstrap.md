# Battle test credentials — bootstrap

**One-time provisioning** so the overnight battle-test agent can sign in
as both a super_admin and a portal customer. Runs against demo tenant
`a0000000-0000-0000-0000-000000000001`.

Decision captured in the 2026-05-13 battle test (Q4, Option 1 —
"service-role mint per run"): no stored passwords. The agent uses
Supabase's `auth.admin.generateLink()` to mint a magic link for known
test-user UUIDs at run time.

---

## When to run

- After cloning the repo on a new machine
- After spinning up a fresh Supabase project (i.e. moving environments)
- After a battle-test run reports "BATTLE_TEST_* env vars missing"

The script is **idempotent** — re-running is a no-op if everything's
already provisioned.

---

## Steps

### 1. Prereqs

`.env.local` must already contain:

```
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

These are the same values you use for the rest of the app. The script
won't run without them.

### 2. Run the bootstrap

```bash
npx tsx scripts/bootstrap-battle-test-users.ts
```

Expected output:

```
Bootstrapping battle-test users on demo tenant a0000000-0000-0000-0000-000000000001
  ✓ created auth user: battle-test-admin@eq.solutions → <uuid>
  ✓ tenant_members: super_admin on demo
  ✓ created auth user: battle-test-portal@eq.solutions → <uuid>
  ✓ customer_contact <uuid> wired to customer <uuid>

Paste into .env.local:
BATTLE_TEST_ADMIN_EMAIL=battle-test-admin@eq.solutions
BATTLE_TEST_ADMIN_UUID=...
BATTLE_TEST_PORTAL_EMAIL=battle-test-portal@eq.solutions
BATTLE_TEST_PORTAL_UUID=...
BATTLE_TEST_PORTAL_CUSTOMER_ID=...
BATTLE_TEST_PORTAL_CONTACT_ID=...
```

### 3. Paste the printed lines into `.env.local`

Append the six `BATTLE_TEST_*=...` lines to `.env.local`. The UUIDs are
stable across re-runs — once pasted, you can re-run the script later
without re-pasting (same UUIDs come out).

### 4. (Optional) Verify

```bash
# Admin user
psql ... -c "SELECT user_id, role, is_active FROM tenant_members WHERE user_id = '<BATTLE_TEST_ADMIN_UUID>';"
# Expected: role = super_admin, is_active = true

# Portal contact
psql ... -c "SELECT id, email FROM customer_contacts WHERE id = '<BATTLE_TEST_PORTAL_CONTACT_ID>';"
# Expected: email = battle-test-portal@eq.solutions
```

---

## How the agent uses these

Inside `docs/battle-tests/YYYY-MM-DD-overnight-prompt.md`, the relevant
section becomes:

> Sign in as the super_admin test user. Mint a session via:
> ```
> const { data } = await supabase.auth.admin.generateLink({
>   type: 'magiclink',
>   email: process.env.BATTLE_TEST_ADMIN_EMAIL!,
> })
> // visit data.properties.action_link in the browser MCP
> ```

The portal user is minted the same way — `email = BATTLE_TEST_PORTAL_EMAIL`.
Because the portal email is already in `report_deliveries.delivered_to`,
the `/api/portal/magic-link` endpoint would also accept it; the
service-role mint just bypasses the email round-trip.

---

## Rotation / clean-up

The seeded auth users are real `auth.users` rows. To remove them (e.g.
for a clean reseeded environment):

```sql
-- Cascades through profiles + tenant_members + customer_contacts.
DELETE FROM auth.users
 WHERE email IN ('battle-test-admin@eq.solutions', 'battle-test-portal@eq.solutions');
```

Then re-run the bootstrap script.

---

## Why a script and not a SQL seed?

`auth.users` rows can technically be inserted via raw SQL, but Supabase's
own helper triggers (`handle_new_user`, email confirmation flags, the
`encrypted_password` column shape) are fiddly to replicate. Using
`supabase.auth.admin.createUser()` is the canonical path and the script
is the canonical wrapper.
