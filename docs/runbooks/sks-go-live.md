# SKS go-live — launch-day execution sheet (Stage 1)

The one page Royce runs to take SKS live on **core.eq.solutions**. This is the
*execution* checklist for the migrated-staff launch. For the why, the role map,
the message templates, and troubleshooting, see
[sks-onboarding.md](sks-onboarding.md) — this sheet assumes that context and just
walks the day.

**Stage 1 = soft launch.** Managers + the migrated staff sign in to core and use
the EQ-native tiles. **Field stays on the existing `sks-nsw-labour.netlify.app`**
app for now — the canonical Field cutover is a later, separate arc. Nothing here
touches the live SKS Field operation.

**Done means:** one real migrated staffer has accepted an invite → set a PIN →
enrolled the second step (QR renders) → reached the hub → opened a working tile.
Every tile shown to SKS either works or is hidden. SKS declared live.

---

## Before you start — what's already true

- Auth hardening, the TOTP-enrol QR fix, and the invite bridge are all **live on
  core**. The QR now renders in-page (no manual key entry needed).
- The migrated SKS staff are already loaded (50 people). The invite bridge reads
  them directly — **no CSV to build.**
- Tiles: Field (→ legacy app), Cards, Quotes, Intake are **ready**. **Service is
  not yet wired for SKS** — confirm it's hidden (see Step 0) so nobody hits a dead
  tile.

---

## Step 0 — Hide the Service tile for SKS *(one-off, before inviting)*

Service isn't provisioned for SKS yet (its sign-in handoff can't place an SKS
person, and there's no SKS Service workspace). Leaving the tile on means a manager
clicks it and lands on an access-denied screen. Hide it until Service is ready:

> **This is a production control-plane change — Royce runs it, or gives the
> explicit go for it to be run.** It's a single, reversible row update.

```sql
-- eq-canonical (jvkn) / schema shell_control — hide the not-yet-wired Service tile for SKS
UPDATE shell_control.module_entitlements
SET enabled = false, updated_at = now()
WHERE tenant_id = '7dee117c-98bd-4d39-af8c-2c81d02a1e85' AND module = 'service';
```

Re-enable (`enabled = true`) once Service carries the tenant in its sign-in token
and SKS has a Service workspace. Until then, leave the other four tiles on.

When inviting in Step 2, **leave Service unchecked** in "Apps each person gets"
(default is Field + Cards, which is correct for field staff).

---

## Step 1 — Managers set up the second step first *(do this before sending invites)*

The three current managers (Royce, Simon, Mark) were created weeks ago, so they're
**past the 14-day runway** — they'll be asked for the second step on their next
sign-in. Get ahead of it so launch day is smooth:

1. Sign in to `core.eq.solutions` as yourself → you land in the SKS hub.
2. Go to **`/sks/settings/2fa`** → **Set up**. A QR code appears on screen.
3. Scan it with any authenticator app (Google Authenticator, Authy, 1Password…),
   enter the 6-digit code to confirm. Done — 30 seconds.
4. **Smoke the doors:** sign out, sign back in with your **PIN** → you should now
   get the 6-digit step. Then sign out and sign in with **Mobile** (phone code) →
   same second step. Both should land you back in the hub.

> **Gotcha — "I signed in and there was no second step."** That's correct *before*
> you enrol: a fresh login inside the runway shows no 2FA. The challenge only fires
> **after** you've enrolled at `/sks/settings/2fa`. Enrol first, then test.

If any door fails to land you in the hub, stop and flag it — don't send invites
until sign-in is clean.

---

## Step 2 — Send the invites

1. Go to **`/sks/admin/users/migrate`** ("Invite migrated staff" — also linked from
   the people list header).
2. The page lists your imported staff with a mapped **Role** (set from each
   person's employment type) and a **Status** badge:
   - **Ready** — will be invited (pre-ticked).
   - **Already in** — already has a login (skipped).
   - **Invite pending** — already has an open invite (skipped).
   - **No email** — can't be invited; surfaced so you can chase an address later.
   - A small ⚠ next to a role means it came from an unusual employment type —
     eyeball those before sending.
3. **"Apps each person gets"** — leave the default **Field + Cards**. Don't tick
   Service (see Step 0).
4. The ready people are pre-selected. Untick anyone you want to hold. Up to **50
   per batch** — if you have more, send 50, then come back for the rest.
5. Click **"Send N invites."** You'll get a result table: Invited / Added / Already
   in / Failed.

Today's expected shape: ~**41 ready**, a couple already in, one pending, a handful
no-email. Sending creates real invite records but **sends no email yet** (email is
intentionally off) — you distribute the links yourself in Step 3.

---

## Step 3 — Distribute the links

On the "Invites sent" screen:

- **"Copy all links"** copies one line per person (`email⇥link`) — paste into a
  spreadsheet to mail-merge, or send each directly.
- Or **"Copy link"** per row to send one at a time (Teams / SMS / email).
- **Links expire in 7 days** and are single-use.

Use the SMS / email wording in
[sks-onboarding.md → "The words we actually send"](sks-onboarding.md#the-words-we-actually-send).
The person taps the link → sets a PIN → they're in. You never see anyone's PIN.

---

## Step 4 — Prove the round trip *(one real person)*

Don't declare live off the manager logins alone. Confirm one **migrated staffer**
(not a manager) goes the whole way:

1. Send yourself or a willing pilot person their invite link.
2. Tap it → set a PIN → land in the SKS hub.
3. Open at least one working tile (Field opens the legacy app and authorises; Cards
   loads past "Authorising…").

If that works, the path is proven for everyone.

---

## Step 5 — Declare live

- Sign-in doors smoke clean (Step 1). ✅
- Invites sent + links distributed (Steps 2–3). ✅
- One real staffer completed the round trip (Step 4). ✅
- Every visible tile works or is hidden (Step 0). ✅

Tell the team SKS is live on core. Watch for a day; re-send to anyone who hasn't
set up after a few days (reminder template in
[sks-onboarding.md](sks-onboarding.md)).

---

## If something's wrong — fast rollback

Everything here is reversible and none of it touches the live SKS Field app:

| Problem | Undo |
|---|---|
| A tile errors for SKS | `UPDATE shell_control.module_entitlements SET enabled=false …` for that module (Step 0 pattern) |
| Sent invites to the wrong people | Delete the pending `user_invites` rows (they're not accepted yet) |
| A bad deploy | Revert the PR — Netlify auto-deploys the revert |

More symptom→fix detail: [sks-onboarding.md → Troubleshooting](sks-onboarding.md#troubleshooting).

---

## Not in Stage 1 *(explicit)*

- **Service tile for SKS** — needs the tenant in its sign-in token + an SKS Service
  workspace. Hidden until then (Step 0).
- **Field on canonical** — SKS Field stays on `sks-nsw-labour.netlify.app`; the
  core Field tile parallel-runs against the legacy app. The canonical cutover is
  its own planned arc (see [FIELD-UNIFICATION-PLAN.md](../FIELD-UNIFICATION-PLAN.md)).
- **Automatic invite emails** — Resend is off by choice; links are distributed
  manually. Turn on later per [sks-onboarding.md → Step 4](sks-onboarding.md#step-4--switch-on-automatic-emails).

## Related

- [sks-onboarding.md](sks-onboarding.md) — the full picture: role map, message
  templates, safety story, troubleshooting.
- [accept-invite.ts](../../netlify/functions/accept-invite.ts) /
  [invite-users-batch.ts](../../netlify/functions/invite-users-batch.ts) — the
  invite flow this sheet rides on.
