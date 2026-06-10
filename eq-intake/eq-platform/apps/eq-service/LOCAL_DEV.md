# Local Development Guide — EQ Solves

Quick-start instructions for running the app locally before deploying.

---

## Prerequisites

- **Node.js** 20+ (LTS recommended)
- **npm** 10+
- A Supabase project (yours is `urjhmkhbgaxrofurpbgc`)

---

## 1. Clone and install

```bash
git clone <your-repo-url> eq-solves-service
cd eq-solves-service
npm install
```

---

## 2. Environment variables

Copy the template and fill in your values:

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://urjhmkhbgaxrofurpbgc.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your anon key from Supabase dashboard → Settings → API>
SUPABASE_SERVICE_ROLE_KEY=<your service role key from Supabase dashboard → Settings → API>
```

The app validates these at startup — if anything is missing you'll get a clear error message telling you exactly what's wrong.

> **Note on Resend:** Resend is currently configured as Supabase's custom SMTP provider in the Supabase dashboard (Settings → Auth → SMTP). No `RESEND_API_KEY` is needed in `.env.local` for the current build. When email notifications ship (Priority 1 pre-go-live), a `RESEND_API_KEY` variable will be added here.

---

## 3. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You should see the sign-in page.

---

## 4. First sign-in

If you've already run the migrations and seeded a user via the Supabase dashboard, sign in with those credentials. Otherwise:

1. Go to your Supabase dashboard → Authentication → Users
2. Create a user with email + password
3. In the SQL Editor, set their role to super_admin and attach them to a tenant:
   ```sql
   UPDATE profiles SET role = 'super_admin', is_active = true WHERE id = '<user-uuid>';
   INSERT INTO tenant_members (user_id, tenant_id, role, is_active)
   VALUES ('<user-uuid>', '<tenant-uuid>', 'super_admin', true);
   ```
   Without the `tenant_members` row the user will hit the "No tenant assigned" screen on first login (by design — see `app/(app)/layout.tsx`).
4. Sign in at localhost:3000, set up MFA, and you're in.

---

## 5. What to test before going live

### Critical path (do these first)

| # | Test | How |
|---|------|-----|
| 1 | Sign in + MFA | Sign in, enrol TOTP, verify code, sign out, sign back in with MFA |
| 2 | Create a customer + site | Customers → New, then Sites → New linked to that customer |
| 3 | Create an asset | Assets → New, linked to the site you just created |
| 4 | Create a job plan + check | Job Plans → New with 2-3 items, then Maintenance → New Check using that plan |
| 5 | Execute a check | Start → mark items pass/fail → Complete. Confirm "Complete" is blocked until required items are done |
| 6 | Create test records | Testing → New, add some readings, set result |
| 7 | Create ACB + NSX tests | One of each, add readings, set results |
| 8 | Generate reports | ACB Testing → select site → Report. NSX Testing → same. Reports → Bulk Export ZIP |
| 9 | Upload an attachment | On any check or test record, upload a PDF or image. Download it back |
| 10 | Search | Global search → try an asset name, a serial number |

### Admin features

| # | Test | How |
|---|------|-----|
| 11 | Invite a user | Admin → Users → Invite (use a second email you control) |
| 12 | Role change | Change that user's role, verify permissions change |
| 13 | Deactivate/reactivate | Deactivate a test record → confirm hidden from list → toggle Show Archived → confirm visible → Reactivate |
| 14 | Audit log | Admin → Audit Log → verify your actions from steps 1-13 appear |
| 15 | Tenant settings | Admin → Settings → change product name and colours → verify sidebar updates |
| 16 | Analytics | Analytics → verify KPI cards and charts show data from your test records |

### Edge cases worth checking

- Try to complete a check with a required item still blank (should block)
- Try to access /admin/users as a technician (should redirect)
- Submit a form with missing required fields (should show validation error)
- Upload a file larger than 10 MB (should reject)
- CSV import with a mix of valid and invalid rows (should import valid, report errors)

---

## 6. Useful commands

```bash
npm run dev        # Start dev server (hot reload)
npm run build      # Production build (run before deploying)
npm run lint       # ESLint check
npx tsc --noEmit   # TypeScript check without emitting files
npx vitest         # Run the test suite (~126 tests across 7 files — CSV parser, role utils, format utils, auth actions, levenshtein, delta WO parser, PM asset report smoke)
npx vitest run     # Run once (no watch mode)
```

---

## 7. Database

Migrations are in `supabase/migrations/` — the directory itself is the source of truth, no count is maintained in this file (numeric counts here used to bit-rot in days). They've already been applied to your Supabase project. If you need to reset or apply to a new project, run them in order via the Supabase SQL Editor or the Supabase CLI.

---

## 8. When you're ready to deploy

The app is a standard Next.js 16 project. Deployment options:

- **Vercel** — zero-config for Next.js, add env vars in project settings
- **Netlify** — use the Next.js runtime adapter, add env vars in site settings
- **Self-hosted** — `npm run build` then `npm start` (runs on port 3000 by default)

Whichever you choose, set the three environment variables from `.env.example` in your hosting provider's dashboard.
