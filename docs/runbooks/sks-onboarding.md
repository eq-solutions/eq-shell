# Bringing SKS staff onto EQ

How we get every SKS person — director to apprentice to labour hire — from "never heard of it"
to "signed in and working" with the least possible friction and the most possible trust.

This runbook has three readers. Jump to yours:

- **You're being invited** → [Your first 2 minutes](#your-first-2-minutes)
- **You're running the rollout** (Royce / office admin) → [Running an SKS rollout](#running-an-sks-rollout)
- **You're an executive deciding if this is safe** → [Why this is safe](#why-this-is-safe)

---

## The promise

One login. Set up in two minutes, on a phone, with thumbs. No app store, no passwords to
invent, no IT ticket. It feels as simple as a text message and as safe as your banking app —
because under the hood, it is.

Three rules we never break:

1. **We never send anyone a password.** People set their own. Nothing secret ever sits in an
   inbox or a text where it could leak.
2. **Getting in is one tap.** If a step can be removed, it's removed. The only thing we ask a
   new person to do is pick a PIN.
3. **Safe by default, not by nagging.** The protections are on automatically. Nobody has to
   "remember to be secure."

---

## Your first 2 minutes

*(This is exactly what a new SKS person experiences.)*

1. **A text (or email) arrives** from SKS: "Set up your login — takes 2 minutes," with one link.
2. **Tap the link.** It opens your EQ login. No download, works on any phone.
3. **Pick a PIN** you'll remember (4–12 characters — a number or a short word, your choice).
4. **You're in.** Straight to your SKS apps — your details, your licences, your jobs.
5. **Once, soon after, we'll ask you to add a second step** (for managers and supervisors first).
   It's the same idea as your banking app: a 6-digit code from your phone. Takes 30 seconds to
   set up, then it's automatic.

That's the whole thing. No accounts to create, no email verification loop, no password rules.

> **Forgot your PIN later?** Tap "Forgot PIN" on the sign-in screen, or ask your manager. You
> get a fresh link, set a new PIN, done. Your old PIN stops working the moment you set a new one.

---

## The words we actually send

Plain English. Warm. One action. No jargon. These are the templates — copy, fill the
`{braces}`, send.

### Invite — SMS (the primary channel for field staff)

```
Hi {first_name}, SKS is moving onto EQ for your staff details, licences and jobs.
Set up your login here (about 2 min): {invite_link}
The link works for 7 days. Any issues, ask {admin_first_name}.
```

### Invite — email

```
Subject: Set up your SKS login — about 2 minutes

Hi {first_name},

SKS now uses EQ to keep your details, licences and job info in one place — on your phone or
computer.

To get started, just set a PIN:

   [ Set up my login ]      ← {invite_link}

That's it. You'll be straight in. The link works for 7 days.

If you weren't expecting this, you can ignore this email — nothing happens until you tap the link.

— The team at SKS
```

### Reminder — for anyone who hasn't set up after a few days

```
Hi {first_name}, quick reminder to set up your SKS login — takes 2 minutes: {invite_link}
It expires soon. Shout if you need a hand.
```

### "Add the second step" — when MFA enrolment is due

```
Subject: One quick step to keep your SKS account safe

Hi {first_name},

We're adding a second sign-in step to your account — the same kind your banking app uses. It
takes about 30 seconds to set up and then it's automatic.

Next time you sign in, you'll be guided through it. All you need is your phone.

— The team at SKS
```

### "Forgot PIN" — the link your manager sends

```
Hi {first_name}, here's a link to reset your SKS PIN: {reset_link}
It works for 24 hours. Your current PIN keeps working until you set a new one.
```

**Voice rules for any copy added later:** plain English only. Say "login," "apps," "your details,"
"workspace" — never "tenant," "module," "credentials," "authentication," or "provision." If a
tradie on a worksite wouldn't say the word, don't use it.

---

## Running an SKS rollout

*(For Royce / office admin. End to end, this is a morning's work plus a short pilot.)*

### Step 0 — Lock the role map *(needs a decision before anything else)*

Every person gets one of five roles. This sets what they can see and do.

**The rule: role follows job title.** Anyone whose title is a Manager, Project Manager,
Contracts Manager, or an office / contracts **lead** is a `manager` — they can invite and manage
people. Everyone else maps by band:

| SKS title / band | Role | What it grants |
|---|---|---|
| Directors, GM, Operations Manager, Project / Contracts Managers, office & contracts **leads** | `manager` | Everything, plus inviting and managing other people |
| Site Supervisors, Foremen, Leading Hands | `supervisor` | Team oversight; cannot manage logins |
| Electricians, Technicians, Installers, Estimators, general Office / Admin | `employee` | Standard day-to-day access |
| Apprentices, Trainees | `apprentice` | Standard access, flagged as developing |
| Labour hire, subcontractors, casuals | `labour_hire` | Lowest access, meant to be time-bound |

Note the split in the office: a **lead** is a `manager`; a regular estimator or admin is an
`employee`. When you build the CSV, the only judgement call is "is this person a lead?" — if yes,
`manager`; if no, `employee`.

> **Least-privilege fallback:** if you're unsure about anyone, import them as `employee` and
> promote later in one click. It's always safer to start low and lift than the reverse.

### Step 1 — Build the staff list (CSV)

One row per person:

```csv
email,first_name,role,apps
mark.smith@sks.com.au,Mark,supervisor,"field,cards"
jess.lee@sks.com.au,Jess,employee,"field,cards"
```

- `email` — their work email (this is their identity; must be unique).
- `role` — one of the five above.
- `apps` — which tools to switch on (`field`, `cards`, `service`, `quotes`, `intake`). Most
  field staff need `field,cards`.

### Step 2 — Send the invites (bulk)

Use the **bulk invite** screen (admin → people → invite in bulk). Paste or upload the CSV. The
system:

- creates a one-time, 7-day invite link per person (the link is the only secret, and it's
  single-use and time-boxed),
- sends the email automatically *once Resend is switched on* (see Step 4),
- shows you a result table: invited / already a member / failed.

For each person, **no login or password is created** — they set their own PIN when they tap the
link. You never see or handle anyone's PIN.

### Step 3 — Pilot first (about 5 people)

Before the whole company, run a small group — ideally a manager, a supervisor, and a couple of
field staff.

- Email auto-send may still be off at this point. That's fine: the bulk screen shows each
  invite link — paste it to the pilot people directly via Teams or SMS.
- Confirm each person can: tap link → set PIN → land in their apps → (managers) add the second
  step → open Field and Cards without a second sign-in.

When the pilot group is in and happy, proceed.

### Step 4 — Switch on automatic emails

Set `EQ_EMAIL_PROVIDER=resend` (+ `RESEND_API_KEY`) in the eq-shell Netlify environment. From
then on, invites and PIN-reset links send themselves — no manual pasting. (See
[email.ts](../../netlify/functions/_shared/email.ts) — until this is set, the system safely
falls back to "show the link so you can send it yourself.")

### Step 5 — Full rollout

Run the full CSV through the bulk screen. Watch the result table. Re-send to anyone who hasn't
set up after a few days using the reminder template.

### The second step (MFA) — how it rolls out

The second sign-in step is **already built**. We turn it on gently:

- **Who:** managers and supervisors first. Field, apprentice and labour-hire stay optional so
  nobody's blocked at a worksite.
- **When:** each person gets a **14-day runway from their first sign-in.** After that, they're
  guided through the 30-second setup on their next sign-in. New joiners always get the full
  runway.
- **Heads-up for the current three managers** (Royce, Simon, Mark): they signed in weeks ago,
  so they're past the runway — they'll be asked to set up the second step on their *next* sign-in.
  Give them a nudge first so it's expected, not a surprise.

### Leaving the team (offboarding — do not skip)

When someone leaves SKS:

1. Admin → people → find them → **Deactivate.** Their access stops on their very next click —
   not at the end of the day, immediately.
2. That's it for access. Their record stays for history; nothing is deleted.

Offboarding is as important as onboarding. A clean leaver process is a large part of why an
executive can trust the whole system.

---

## Why this is safe

*(For executives. The same simplicity that helps a tradie is what makes this defensible.)*

- **No shared or emailed passwords, ever.** Each person sets their own PIN through a one-time,
  time-limited link. There is no master password and nothing secret to intercept.
- **A second lock for the people who matter most.** Managers and supervisors use a second
  sign-in step (the banking-app model). It's on by policy, with a short, humane runway — not
  left to individual goodwill.
- **Instant offboarding.** A departing staff member loses access on their next click, company-wide.
- **Everything is recorded.** Sign-ins, invites, resets and role changes are written to an audit
  trail.
- **Locked to SKS.** People only ever see SKS data. A wrong guess at a web address can't expose
  another company's information.
- **Brute-force resistant.** Repeated bad sign-in attempts are rate-limited automatically.
- **One identity, everywhere.** The same login carries a person seamlessly across their apps —
  no separate password per tool, which is itself a security win (fewer passwords, fewer leaks).

The short version: it's easy because the hard parts are handled for you, not because corners
were cut.

---

## What's already built vs what we're adding

Honesty matters here — most of this is done and live.

**Already built and in production:**

| Capability | Where |
|---|---|
| One-time invite links (hashed, 7-day, single-use) | [invite-user.ts](../../netlify/functions/invite-user.ts) |
| Set-your-own-PIN + auto sign-in | [accept-invite.ts](../../netlify/functions/accept-invite.ts) |
| Second sign-in step (enrol / confirm / challenge) | [enroll-totp.ts](../../netlify/functions/enroll-totp.ts), [challenge-totp.ts](../../netlify/functions/challenge-totp.ts) |
| Self-service + admin PIN reset | [shell-request-pin-reset.ts](../../netlify/functions/shell-request-pin-reset.ts), [reset-user-pin.ts](../../netlify/functions/reset-user-pin.ts) |
| Deactivate / reactivate / role change | [edit-user.ts](../../netlify/functions/edit-user.ts) |
| Audit trail, rate limiting | [shell-login.ts](../../netlify/functions/shell-login.ts) |
| SKS data routing (already active) | `scripts/provision-sks-tenant.mjs` (run) |

**Net-new for this rollout (small):**

1. **Bulk invite** — a thin wrapper over `invite-user` (CSV in → result table out) plus a bulk
   panel beside [AdminInviteUser.tsx](../../src/pages/AdminInviteUser.tsx).
2. **Forced second-step enrolment** — a short check in [shell-login.ts](../../netlify/functions/shell-login.ts)
   (after the existing TOTP-challenge block): for `manager` / `supervisor` / `platform_admin`,
   if the second step isn't set up yet and the 14-day runway has passed, route them to the
   existing enrol screen. Anchor the runway on the user's `created_at` (which equals first
   sign-in for invited users). No database change — `totp_enrolled_at` already exists.
3. **Resend email** — config only (Step 4 above).

---

## Troubleshooting

| What you see | Why | Fix |
|---|---|---|
| "This link doesn't work" on tapping an invite | Link expired (7 days), already used, or mistyped | Re-send a fresh invite from the bulk screen |
| Invite email never arrived | `EQ_EMAIL_PROVIDER` not set yet — system is in "show the link" mode | Copy the link from the result table and send it manually, or complete Step 4 |
| Person set up but can't see an app | That app wasn't switched on for them | Admin → edit person → add the app; they sign out and back in |
| Manager not asked for the second step | They're still inside the 14-day runway, or they're not a manager/supervisor | Expected; or check their role |
| "Too many attempts" at sign-in | Rate limit tripped (5 tries / 15 min) | Wait it out; if it's a real person, send a PIN reset |
| Someone left but might still have access | Deactivation not done | Admin → deactivate; takes effect on their next click |

---

## Related

- [onboard-trial-tenant.md](onboard-trial-tenant.md) — standing up a brand-new company (vs adding people to an existing one).
- [invite-user.ts](../../netlify/functions/invite-user.ts) / [accept-invite.ts](../../netlify/functions/accept-invite.ts) — the invite flow this rollout rides on.
- Global voice rules — plain English on every user-facing surface (`~/.claude/CLAUDE.md`).
