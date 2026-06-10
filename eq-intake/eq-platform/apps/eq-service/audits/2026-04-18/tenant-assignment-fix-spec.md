# Tenant Assignment Gap — Fix Specification

**Date:** 2026-04-18  
**Status:** Specification (Not Yet Implemented)  
**Next Migration:** 0046

---

## Current Behaviour (As-Is)

### Signup Flow
1. User signs up via Supabase Auth → `auth.users` row created
2. Trigger `on_auth_user_created` fires (`supabase/migrations/0001_profiles_and_recovery_codes.sql`, line 93–96)
3. Function `handle_new_user()` auto-creates a row in `public.profiles` with:
   - `id = auth.uid()`
   - `email` from auth.users
   - `role = 'user'` (or `'admin'` if email matches hardcoded list)
4. **No `tenant_members` row is created** — new user gets no tenant assignment
5. User lands on the app → `app/(app)/layout.tsx` queries `tenant_members` (line 22–27)
6. Result: Layout now correctly shows "No tenant assigned" screen (lines 29–55)

### Current State
- **✓ GOOD:** Layout explicitly checks for zero memberships and shows clear error screen with "Sign out" button
- **✓ GOOD:** `getTenantSettings()` handles null tenantId gracefully, returns defaults
- **✗ GAP:** No auto-assignment on signup → requires manual intervention by admin
- **✗ GAP:** `handle_new_user()` has **no way** to know which tenant to assign (no context passed to trigger)

### Why It's a Problem
1. **Support burden:** Every new signup requires manual DB edit to add `tenant_members` row
2. **Scalability risk:** If multi-org invitations become a feature, admins must remember to invite users
3. **Orphaned accounts:** Hard to discover which `profiles` rows lack `tenant_members` entries
4. **Inconsistent UX:** Some flows might bypass the guard and leak tenant data to unassigned users

---

## Proposed Behaviour (To-Be)

### Option A: Auto-Assign to Configurable Default Tenant (Recommended)
**Approach:** Add a `default_tenant_for_new_users` setting (nullable UUID). When a user signs up:
1. If setting exists → auto-create `tenant_members` row with that tenant
2. If setting is null → user stays unassigned (same as today, but explicit)
3. Backfill: Identify orphaned `profiles` rows and **allow (not force) admin** to bulk-assign them

**Pros:**
- Smallest code change
- No signup flow refactor
- Compatible with future invitation links
- Admin stays in control via a setting

**Cons:**
- Requires knowing the default tenant ID before signup
- May assign users to the "wrong" tenant if setting not updated

### Option B: Invitation-Link-Only Signup (Alternative)
- All signups require a pre-generated token with embedded `tenant_id`
- Trigger uses token context to assign tenant
- Pros: No ambiguity, explicit admin control
- Cons: Larger refactor, breaks self-serve signup

### Recommendation
**Implement Option A** — auto-assign to a configurable default tenant. This maintains self-serve signup while fixing the orphan problem.

---

## Implementation Plan

### 1. Database Schema Changes

#### Add `tenant_settings` Column
In `public.tenant_settings`, add (if not exists):
```sql
ALTER TABLE public.tenant_settings
ADD COLUMN IF NOT EXISTS
  default_tenant_for_new_users uuid REFERENCES public.tenants(id) ON DELETE SET NULL;
```

**Rationale:** Each tenant can choose its own default, enabling multi-org scenarios.

#### Create `orphaned_user_assignments` Audit Table (Optional)
Track all auto-assignments for compliance:
```sql
CREATE TABLE public.orphaned_user_assignments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  assigned_role text NOT NULL DEFAULT 'technician',
  assigned_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_at   timestamptz NOT NULL DEFAULT now(),
  reason        text,
  is_active     boolean NOT NULL DEFAULT true
);
CREATE INDEX orphaned_user_assignments_user_idx ON public.orphaned_user_assignments(user_id);
CREATE INDEX orphaned_user_assignments_tenant_idx ON public.orphaned_user_assignments(assigned_tenant_id);
COMMENT ON TABLE public.orphaned_user_assignments IS 'Audit trail of manual tenant assignments for previously orphaned users.';
ALTER TABLE public.orphaned_user_assignments ENABLE ROW LEVEL SECURITY;
-- RLS: same as tenant_members
```

### 2. Trigger Update

#### Modify `handle_new_user()` (0001_profiles_and_recovery_codes.sql equivalent)

Replace the existing function with:
```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text := 'user';
  v_admin_emails text[] := ARRAY['dev@eq.solutions'];
  v_default_tenant_id uuid;
BEGIN
  -- Determine profile role
  IF new.email = ANY(v_admin_emails) THEN
    v_role := 'admin';
  END IF;

  -- Create profile
  INSERT INTO public.profiles (id, email, full_name, role, is_active)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'full_name', ''),
    v_role,
    true
  );

  -- Try to assign user to default tenant from tenant_settings
  -- (We use the first tenant's default; in future this could be parameterized per signup context)
  SELECT ts.default_tenant_for_new_users
  INTO v_default_tenant_id
  FROM public.tenant_settings ts
  WHERE ts.default_tenant_for_new_users IS NOT NULL
  LIMIT 1;

  -- If a default tenant is configured, auto-create tenant_members row
  IF v_default_tenant_id IS NOT NULL THEN
    INSERT INTO public.tenant_members (user_id, tenant_id, role, is_active)
    VALUES (new.id, v_default_tenant_id, 'technician', true)
    ON CONFLICT (tenant_id, user_id) DO NOTHING;
  END IF;

  RETURN new;
END;
$$;
```

**Why this works:**
- If `default_tenant_for_new_users` is NULL → old behaviour (no auto-assignment)
- If set → new user gets auto-assigned with `'technician'` role (lowest write privilege)
- `ON CONFLICT DO NOTHING` prevents race conditions if trigger fires twice

---

### 3. Backfill for Existing Orphaned Users

Create a migration step that:
1. Identifies profiles without tenant_members: `SELECT p.id FROM profiles p LEFT JOIN tenant_members tm ON p.id = tm.user_id WHERE tm.id IS NULL`
2. Provides a **manual admin action** (not auto-backfill) to:
   - Show orphaned users list in `/admin/users` with "Assign to Tenant" button
   - On click → modal to pick tenant + role, then insert `tenant_members` row and log to `orphaned_user_assignments`
3. Alternative: Provide a CLI/Edge Function for bulk assignment (for testing/batch operations)

**No automatic backfill** — requires explicit admin approval for compliance.

---

### 4. UI Changes

#### New Admin Page: `/admin/users` (or expand existing)
- Show all `profiles` rows with their `tenant_members` status
- If user has zero memberships → "Unassigned" badge
- Action button: "Assign to Tenant" → modal with:
  - Dropdown: Select tenant
  - Dropdown: Select role (technician, supervisor, admin)
  - Reason field (optional, logs to `orphaned_user_assignments`)
  - Submit → inserts `tenant_members` row + logs audit

#### Update `/admin/reports/` (Settings)
- Add section: "Default Tenant for New Signups"
- Dropdown: (None) | List of active tenants
- Save → updates `tenant_settings.default_tenant_for_new_users`

---

### 5. Layout & Guards

#### `app/(app)/layout.tsx` (Already Handles This)
No changes needed — the "No tenant assigned" screen (lines 29–55) is already correct.

#### `lib/actions/auth.ts` (requireUser Helper)
Current code at lines 10–31 already:
- Queries `tenant_members`
- Throws `'No tenant membership.'` if empty
- Server actions using `requireUser()` are protected

**No changes needed** — already safe.

---

## Migration Outline

**Migration 0046: `auto_assign_tenants`**

```sql
-- Migration: 0046_auto_assign_tenants
-- Purpose: Add default tenant assignment on signup, audit table for orphans
-- Rollback: Reverse the trigger, drop audit table, drop setting column

BEGIN;

-- 1. Add setting column to tenant_settings
ALTER TABLE public.tenant_settings
ADD COLUMN IF NOT EXISTS default_tenant_for_new_users uuid
  REFERENCES public.tenants(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.tenant_settings.default_tenant_for_new_users
IS 'If set, new signups are auto-assigned to this tenant with technician role.';

-- 2. Create audit table (optional but recommended)
CREATE TABLE IF NOT EXISTS public.orphaned_user_assignments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  assigned_role     text NOT NULL DEFAULT 'technician'
    CHECK (assigned_role IN ('super_admin','admin','supervisor','technician','read_only')),
  assigned_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_at       timestamptz NOT NULL DEFAULT now(),
  reason            text,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orphaned_user_assignments_user_idx
  ON public.orphaned_user_assignments(user_id);
CREATE INDEX orphaned_user_assignments_tenant_idx
  ON public.orphaned_user_assignments(assigned_tenant_id);
CREATE TRIGGER orphaned_user_assignments_set_updated_at
  BEFORE UPDATE ON public.orphaned_user_assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.orphaned_user_assignments ENABLE ROW LEVEL SECURITY;

-- RLS: Users can view assignments they were part of; admins can see all
CREATE POLICY orphaned_user_assignments_select
  ON public.orphaned_user_assignments
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid()) OR
    assigned_by = (SELECT auth.uid()) OR
    public.is_super_admin()
  );

CREATE POLICY orphaned_user_assignments_insert
  ON public.orphaned_user_assignments
  FOR INSERT TO authenticated
  WITH CHECK (
    assigned_by = (SELECT auth.uid()) OR
    public.is_super_admin()
  );

CREATE POLICY orphaned_user_assignments_update
  ON public.orphaned_user_assignments
  FOR UPDATE TO authenticated
  USING (
    assigned_by = (SELECT auth.uid()) OR
    public.is_super_admin()
  )
  WITH CHECK (
    assigned_by = (SELECT auth.uid()) OR
    public.is_super_admin()
  );

-- 3. Update handle_new_user() function
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text := 'user';
  v_admin_emails text[] := ARRAY['dev@eq.solutions'];
  v_default_tenant_id uuid;
BEGIN
  IF new.email = ANY(v_admin_emails) THEN
    v_role := 'admin';
  END IF;

  INSERT INTO public.profiles (id, email, full_name, role, is_active)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'full_name', ''),
    v_role,
    true
  );

  SELECT ts.default_tenant_for_new_users
  INTO v_default_tenant_id
  FROM public.tenant_settings ts
  WHERE ts.default_tenant_for_new_users IS NOT NULL
  LIMIT 1;

  IF v_default_tenant_id IS NOT NULL THEN
    INSERT INTO public.tenant_members (user_id, tenant_id, role, is_active)
    VALUES (new.id, v_default_tenant_id, 'technician', true)
    ON CONFLICT (tenant_id, user_id) DO NOTHING;
  END IF;

  RETURN new;
END;
$$;

COMMIT;
```

---

## Backfill Strategy

### Phase 1: Identify Orphans
Manual query (run once before deploying):
```sql
SELECT p.id, p.email, p.created_at
FROM public.profiles p
LEFT JOIN public.tenant_members tm ON p.id = tm.user_id
WHERE tm.id IS NULL
ORDER BY p.created_at DESC;
```

### Phase 2: Manual Assignment (via UI)
1. Admin visits `/admin/users`
2. Sees "Unassigned" users in a separate section
3. Clicks "Assign to Tenant" per user
4. Selects tenant + role, submits
5. System inserts `tenant_members` row + logs to `orphaned_user_assignments`

### Phase 3: Verify
Query to confirm all profiles now have at least one membership:
```sql
SELECT COUNT(*) as orphaned_count
FROM public.profiles p
LEFT JOIN public.tenant_members tm ON p.id = tm.user_id
WHERE tm.id IS NULL;
-- Expected: 0
```

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| **Auto-assign to wrong tenant** | Medium | High | Make `default_tenant_for_new_users` nullable & default NULL; require explicit admin config |
| **Trigger race condition** | Low | Medium | Use `ON CONFLICT DO NOTHING` in INSERT; test concurrency |
| **Orphaned audit records** | Low | Low | Audit table only records manual assignments; auto-assignments don't create entries (self-documenting) |
| **Existing orphans not backfilled** | Medium | Medium | Provide admin UI for backfill; document manual step; no auto-backfill to preserve audit trail |
| **MFA + Tenant Assignment** | Low | Low | MFA operates on `auth.users` level, unaffected by `tenant_members` logic |

---

## Test Plan

### Unit: Trigger Behaviour
- [ ] Signup with `default_tenant_for_new_users = NULL` → no `tenant_members` row created
- [ ] Signup with `default_tenant_for_new_users = UUID` → `tenant_members` row created with correct tenant & 'technician' role
- [ ] Signup where admin email → `profiles.role = 'admin'`, but `tenant_members.role = 'technician'`
- [ ] Signup with duplicate email → no error, idempotent

### Integration: Layout
- [ ] Orphaned user login → sees "No tenant assigned" screen
- [ ] Auto-assigned user login → sees app normally (correct tenant in sidebar)
- [ ] User with multiple memberships → uses earliest-created (deterministic)

### Manual: Admin UI
- [ ] `/admin/users` shows unassigned users with badge
- [ ] "Assign to Tenant" button works, creates `tenant_members` row
- [ ] Audit log entry created in `orphaned_user_assignments`
- [ ] Re-login as assigned user → app accessible

### Edge Cases
- [ ] User in 2+ tenants, both unassigned → layout picks first by creation date
- [ ] Delete `default_tenant_for_new_users` setting → new signups go unassigned
- [ ] Orphan user manually invited via admin action → `tenant_members` row inserted correctly

---

## Deployment Checklist

- [ ] Pre-mortem: Name 3 risks, state mitigations (see Risk Assessment)
- [ ] Code review of migration + trigger changes
- [ ] Run migration on branch database; verify RLS advisors pass
- [ ] Deploy to `demo` branch; test signup flow
- [ ] Merge to `main` (auto-deploys to production)
- [ ] Update `.env.example` with docs (no new secrets)
- [ ] Update CHANGELOG.md with summary
- [ ] Verify existing users unaffected:
  - Existing `tenant_members` rows unchanged
  - Existing `profiles` rows unchanged
  - RLS policies unchanged (audit table wrapped in RLS)
- [ ] Post-deployment: Backfill orphaned users via admin UI (manual process)

---

## Files Affected

### New Files
- `supabase/migrations/0046_auto_assign_tenants.sql` (migration)

### Modified Files
- `app/(app)/admin/users/page.tsx` (new page showing unassigned users)
- `app/(app)/admin/users/actions.ts` (server action for assign-to-tenant)
- `app/(app)/admin/settings/page.tsx` (or similar) — add "Default Tenant" dropdown

### Unchanged (Already Correct)
- `app/(app)/layout.tsx` — already shows "No tenant assigned" screen
- `lib/actions/auth.ts` (requireUser) — already safe
- `lib/tenant/getTenantSettings.ts` — already safe

---

## Success Criteria

1. ✓ New users auto-assigned if default tenant configured
2. ✓ New users unassigned if default tenant is null (explicit opt-out)
3. ✓ Existing orphaned users can be backfilled via admin UI
4. ✓ No breaking changes to existing signup/auth flow
5. ✓ `tsc --noEmit` passes (0 errors)
6. ✓ All RLS advisors pass after migration
7. ✓ Backfill audit trail complete and transparent

---

## Future Enhancements

- **Invitation links:** Support `?tenant_id=...&role=...` in signup URLs (requires invite table + email validation)
- **Multi-tenant selection:** During signup, show available tenants + pick one (requires tenant list visibility)
- **Admin bulk operations:** CSV upload to assign many orphaned users at once
- **Tenant transfer:** Allow super_admin to move users between tenants (with audit)
