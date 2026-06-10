# MFA Challenge Loop Fix Specification

**Date:** 2026-04-18  
**Status:** Draft for Royce review (auth-path change, no code applied)  
**Risk Level:** High (auth system)

---

## Problem Statement

Users with enrolled TOTP MFA factors become stuck in an infinite redirect loop between `/auth/signin` and `/auth/mfa`:

1. User signs in with email/password at `/auth/signin`
2. `signInAction()` succeeds → redirects to `/dashboard` (via `next` param)
3. `proxy.ts` intercepts the request, detects `aal.currentLevel === 'aal1'` + `aal.nextLevel === 'aal2'` (factor enrolled but not verified this session)
4. Middleware redirects to `/auth/mfa`
5. User enters their 6-digit code in `MfaChallengeForm`
6. `mfaChallengeVerifyAction()` calls `supabase.auth.mfa.challenge()` and `supabase.auth.mfa.verify()`
7. **BUG:** If `verify()` succeeds, the action calls `redirect('/dashboard')` BUT the session cookie in the response is **never read back into the next request**
8. Next request hits `proxy.ts` again with the **same** `aal.currentLevel === 'aal1'` (cookie unchanged)
9. Middleware redirects to `/auth/mfa` again → loop

**User-observable symptom:** "I enter my MFA code and it says it works, but then it sends me back to the same 2FA page."

---

## Root Cause Analysis

The loop is caused by a **session cookie synchronization failure** between the MFA challenge/verify call and the subsequent request:

### File: `/sessions/youthful-peaceful-fermi/mnt/eq-solves-service/app/(auth)/auth/mfa/actions.ts`

**Lines 19-29:** MFA challenge verification
```typescript
const challenge = await supabase.auth.mfa.challenge({ factorId: totp.id })
if (challenge.error) return { error: challenge.error.message }

const verify = await supabase.auth.mfa.verify({
  factorId: totp.id,
  challengeId: challenge.data.id,
  code,
})
if (verify.error) return { error: verify.error.message }

redirect('/dashboard')  // <-- Line 29: redirect happens AFTER verify
```

**Issue:** The `verify()` call elevates the session from AAL1 → AAL2 **at the Supabase Auth server**, but the server-side Supabase client (`createClient()` from `/lib/supabase/server`) is created fresh for each request. The elevated session token is returned by Supabase to the client via Set-Cookie headers, but:

1. The server action runs in the same request-response cycle
2. `redirect()` is called before the Next.js response is finalized  
3. The Set-Cookie response headers from `verify()` **may not propagate to the browser** if `redirect()` immediately generates a 3xx response

### File: `/sessions/youthful-peaceful-fermi/mnt/eq-solves-service/lib/supabase/middleware.ts`

**Lines 11-53:** Session refresh
```typescript
export async function updateSession(request: NextRequest) {
  // ...creates a new Supabase client
  // ...calls supabase.auth.getUser() on line 38
  // ...fetches AAL on lines 46-50
  return { response, supabase, user, aal }
}
```

On the **next request after redirect**, this middleware is called, and it reads the **request cookies** to reconstruct the session. If the browser never received the Set-Cookie from the `verify()` response, the cookies are stale (still AAL1), so `getAuthenticatorAssuranceLevel()` returns AAL1 again.

### File: `/sessions/youthful-peaceful-fermi/mnt/eq-solves-service/proxy.ts`

**Lines 48-55:** AAL enforcement gate
```typescript
if (aal.currentLevel === 'aal1' && aal.nextLevel === 'aal2' && !isAalExempt) {
  const url = request.nextUrl.clone()
  url.pathname = '/auth/mfa'
  return NextResponse.redirect(url)
}
```

Since `aal.currentLevel` is still 'aal1' on the next request, the user is redirected back to `/auth/mfa` → **loop**.

### Why the Workaround Works

The workaround (delete MFA factors + sessions) breaks the loop because:
- Deleting the factor makes `aal.nextLevel === 'aal1'` (no factor enrolled)
- User is no longer redirected by the AAL enforcement gate
- User can sign in again and re-enrol MFA cleanly

---

## Proposed Fix

The root cause is that `redirect()` in a server action may not preserve Set-Cookie headers from prior Supabase API calls. **Fix options:**

### Option A: Ensure Set-Cookie headers propagate (RECOMMENDED)

In `/sessions/youthful-peaceful-fermi/mnt/eq-solves-service/app/(auth)/auth/mfa/actions.ts`, explicitly wait for the Supabase client to finalize its cookie updates before redirecting:

```typescript
export async function mfaChallengeVerifyAction(formData: FormData) {
  const code = String(formData.get('code') || '').trim()
  if (!code) return { error: 'Code required.' }

  const supabase = await createClient()
  const { data: factors, error: fErr } = await supabase.auth.mfa.listFactors()
  if (fErr) return { error: fErr.message }

  const totp = factors?.totp?.find((f) => f.status === 'verified')
  if (!totp) return { error: 'No verified authenticator on file.' }

  const challenge = await supabase.auth.mfa.challenge({ factorId: totp.id })
  if (challenge.error) return { error: challenge.error.message }

  const verify = await supabase.auth.mfa.verify({
    factorId: totp.id,
    challengeId: challenge.data.id,
    code,
  })
  if (verify.error) return { error: verify.error.message }

  // PROPOSED: Refresh the session to ensure cookies are updated in the response
  // before calling redirect().
  await supabase.auth.getUser()
  
  redirect('/dashboard')
}
```

**Rationale:** Calling `getUser()` again ensures the Supabase SSR client flushes any pending Set-Cookie operations to the response before `redirect()` is invoked.

**Risk:** Low. `getUser()` is a no-op if already authenticated; it just ensures the cookie update is committed.

---

### Option B: Return success and redirect client-side

Alternative: return a success flag and let the client-side form redirect via `router.push()`:

```typescript
// In mfa/actions.ts
export async function mfaChallengeVerifyAction(formData: FormData) {
  // ... verify code ...
  
  // Don't call redirect() here; return success instead.
  return { ok: true }
}

// In mfa/MfaChallengeForm.tsx
function onSubmit(formData: FormData) {
  setError(undefined)
  startTransition(async () => {
    const res = mode === 'totp'
      ? await mfaChallengeVerifyAction(formData)
      : await mfaRecoveryAction(formData)
    if (res?.error) setError(res.error)
    else if (res?.ok) router.push('/dashboard')  // client-side redirect
  })
}
```

**Rationale:** The browser can ensure the Set-Cookie is processed before navigating.

**Risk:** Medium. Breaks the pattern of server action `redirect()` usage. `mfaRecoveryAction()` still calls `redirect()`, creating inconsistency.

---

### Option C: Explicit response header manipulation (not recommended)

Manually manage the Set-Cookie response within the server action—requires low-level Next.js API access that is not stable in Next 16.

---

## Recommendation

**Go with Option A.** It is:
- Minimal (1 line addition)
- Preserves the existing code flow and security patterns
- Guaranteed to work because `getUser()` calls are idempotent
- Consistent with the rest of the codebase

---

## Risk Assessment

### What Could Break

1. **Non-MFA users:** Should not be affected. The fix is MFA-specific and only runs in the `/auth/mfa` action.

2. **Password reset flow:** Uses `/auth/reset-password` and `/auth/callback`, not affected by MFA actions.

3. **MFA enrollment flow:** `/auth/enroll-mfa/actions.ts` line 69 also calls `redirect()` but it comes after `verify()` at line 47-52. Apply the same fix there for consistency:
   ```typescript
   // After verify() succeeds on line 52, before redirect on line 70:
   await supabase.auth.getUser()
   redirect('/auth/reset-password')  // recovery code flow redirect
   ```
   Actually, line 70 redirects to `/auth/enroll-mfa` (recovery code resets enrollment), not `/dashboard`. Check if this path also needs the fix by testing recovery code flow.

4. **Session invalidation:** Users with stale MFA sessions may temporarily get re-routed to `/auth/mfa` before the cookie updates, but this is the current behavior, not a regression.

5. **Performance:** One extra `getUser()` call per MFA verification. Negligible (sub-100ms).

---

## Test Plan

**Manual testing (required before merge):**

### Test 1: TOTP Challenge Success

1. Create a test user with enrolled TOTP factor
2. Sign in with email/password
3. You should be redirected to `/auth/mfa`
4. Enter the 6-digit code from your authenticator app (use a test TOTP secret or manual entry)
5. **Expected:** Redirected to `/dashboard` and stay there (no redirect loop)
6. **Verify:** Open dev tools → Network tab, check that:
   - POST to `/auth/mfa` returns a Set-Cookie header for `sb-*-auth-token` or similar
   - Next request to `/dashboard` includes that cookie in the Cookie header
   - Proxy doesn't redirect back to `/auth/mfa`

### Test 2: TOTP Challenge Failure (Wrong Code)

1. Repeat Test 1 but enter an incorrect code
2. **Expected:** Error message displayed, user stays on `/auth/mfa`
3. **Verify:** No Set-Cookie in the 400 response (because verify failed)

### Test 3: Recovery Code Path

1. Create a test user with enrolled TOTP factor
2. Sign in, reach `/auth/mfa`
3. Click "Use a recovery code instead"
4. Enter a valid recovery code
5. **Expected:** Redirected to `/auth/enroll-mfa` (for re-enrollment)
6. Complete MFA enrollment
7. **Expected:** Redirected to `/dashboard`
8. **Verify:** No loop on the `/auth/enroll-mfa` → `/dashboard` transition

### Test 4: Demo User (No MFA)

1. Sign in with `demo@eqsolves.com.au`
2. **Expected:** Redirected directly to `/dashboard` (proxy.ts line 39 bypasses MFA)
3. **Verify:** No redirect to `/auth/mfa`

### Test 5: Multiple MFA Sessions (Parallel Browsers)

1. Open two browser tabs
2. Sign in to tab A, complete TOTP on `/auth/mfa`
3. Tab A: **Expected** redirected to `/dashboard`
4. Sign in to tab B with a different browser session
5. Tab B: Complete TOTP challenge
6. **Expected:** Both tabs stay logged in to `/dashboard` without loop

---

## Rollback Plan

If the fix causes regressions:

1. **Revert the single-line change:**
   ```bash
   git revert <commit-hash>
   ```

2. **Tell affected users:** "If you're stuck on the 2FA page, sign out and delete your MFA factors, then re-enrol."

3. **Root-cause investigation:** Examine Supabase Auth JS SDK version in `package.json`. The SSR cookie handling was updated in `@supabase/auth-js@0.1.x` → `0.2.x`. May need to upgrade the SDK or work around its cookie handling with `updateSession()` middleware tweaks.

---

## Open Questions / Runtime Investigation Needed

1. **Does `getUser()` actually commit Set-Cookie headers?**
   - The Supabase SSR client uses a `setAll()` callback (see `middleware.ts` lines 22-30) to propagate cookies to the Next.js response
   - Calling `getUser()` should trigger this callback if the session changed
   - **To verify:** Add a console.log in the setAll callback and test; or inspect the Set-Cookie headers in the actual response

2. **Why isn't `redirect()` preserving Set-Cookie from prior calls?**
   - Next.js server actions may generate a response immediately after the action completes
   - Any Set-Cookie headers set by `supabase.auth.mfa.verify()` should be copied by `createClient()`'s cookie middleware, but there may be a timing race
   - **To verify:** Check if the Set-Cookie is present in the `/auth/mfa` POST response (it should be)

3. **Is this a known issue with Supabase SSR in Next 16?**
   - Supabase docs may have updated examples for Next 16 that address this
   - **To verify:** Check the Supabase Auth JS SDK changelog and Next.js 16 migration guide

4. **Does the fix work for `mfaRecoveryAction()` too?**
   - Line 70 of `enroll-mfa/actions.ts` also calls `redirect()` after MFA operations
   - Should apply the same fix there

---

## Implementation Checklist

- [ ] Apply Option A fix to `app/(auth)/auth/mfa/actions.ts` (add 1 line before redirect on line 29)
- [ ] Apply same fix to `app/(auth)/auth/enroll-mfa/actions.ts` before redirect on line 70
- [ ] Run Test 1–5 manually in dev environment
- [ ] Verify Set-Cookie headers in Network tab (dev tools)
- [ ] Check `npm audit --audit-level=high` for Supabase auth-js version
- [ ] Run `tsc --noEmit` for type safety
- [ ] Get Royce approval before merging
- [ ] Merge to a branch, run Netlify preview, test in preview environment
- [ ] Merge to main only after Royce sign-off

---

## Files to Modify

- `/sessions/youthful-peaceful-fermi/mnt/eq-solves-service/app/(auth)/auth/mfa/actions.ts` (line 29)
- `/sessions/youthful-peaceful-fermi/mnt/eq-solves-service/app/(auth)/auth/enroll-mfa/actions.ts` (line 70)

## Related Files (Reference, Do Not Modify)

- `proxy.ts` — AAL enforcement logic (understand the redirect decision)
- `lib/supabase/middleware.ts` — Session refresh (understand cookie handling)
- `app/(auth)/auth/mfa/MfaChallengeForm.tsx` — Client form (no changes needed)
- `app/auth/signout/route.ts` — Signout handler (reference for flow)
