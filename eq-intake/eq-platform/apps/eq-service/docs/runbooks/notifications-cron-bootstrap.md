# Notifications Cron Bootstrap

**One-time post-deploy task** — required to activate the notifications stack
landed in PRs #77 (Phase A+B) and #78 (Phase C).

Until you complete this, the `notifications-dispatcher` pg_cron job runs
silently every 15 minutes and no-ops because the auth secret isn't set.
Bell + email triggers in-app still work for assigned-to / completed-check
flows, but **no scheduled digests, no pre-due reminders, no customer
emails go out** until step 4 below succeeds.

---

## Steps

### 1. Generate a secret

Anywhere — terminal, online generator, your password manager. 32 hex chars
is plenty.

```bash
openssl rand -hex 32
```

Save it once — you need to paste it in two places.

### 2. Set CRON_SECRET in Netlify

- Netlify dashboard → **eq-solves-service** site → **Site settings**
- **Environment variables** → **Add a variable**
- Key: `CRON_SECRET`
- Value: the hex string from step 1
- Scope: **All deploy contexts**
- Save → trigger a redeploy (Netlify → Deploys → Trigger deploy → Clear
  cache and deploy site) so the env var is in the running build

### 3. Set the same secret in Supabase Vault

Supabase dashboard → **SQL Editor** → run:

```sql
SELECT vault.create_secret('<paste hex string>', 'cron_secret');
```

If a row already exists (re-running this), update instead:

```sql
UPDATE vault.secrets
   SET secret = '<new hex string>'
 WHERE name = 'cron_secret';
```

### 4. Wait for the next 15-min slot

The cron fires at `00 / 15 / 30 / 45` past every hour. Within 15 min of
completing step 3 you should see a successful run.

### 5. Verify the run

```sql
SELECT
  start_time,
  status,
  return_message
FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'notifications-dispatcher')
ORDER BY start_time DESC
LIMIT 5;
```

Expected: `status = 'succeeded'`, `return_message = '1 row'` (the
`SELECT public.dispatch_scheduled_notifications()` returns void, but
postgres reports a row count).

If `status = 'failed'`, the message tells you which side failed:
- `pg_net.http_post` errors → check the API URL in `app_settings` and
  that the Netlify deploy is up
- `vault.decrypted_secrets` lookup errors → the Vault secret name doesn't
  match `cron_secret`

### 6. Verify the API got the call

The Next.js endpoint at `/api/cron/dispatch-notifications` logs each
invocation. Check Netlify function logs:

- Netlify → Functions → look for the most recent `dispatch-notifications`
  invocation
- 200 = good. The response body has `sections.{supervisorDigest,
  preDueReminders, customerMonthly, customerUpcoming}.{eligible, sent,
  errors}` counts.
- 401 = secret mismatch (Netlify ↔ Vault out of sync). Re-do steps 2 + 3
  with matching values.

---

## Manual smoke test

Once secrets are set, you can force-trigger any user's digest without
waiting for their slot:

```bash
curl -X POST https://eq-solves-service.netlify.app/api/cron/dispatch-notifications?force_user_id=<their-uuid> \
  -H "Authorization: Bearer <CRON_SECRET>"
```

Returns the section counts; check the recipient's inbox + bell.

---

## Rotating the secret

If the secret ever needs rotating:
1. Generate a new hex
2. Update Vault (`UPDATE vault.secrets SET secret = ...`)
3. Update Netlify env var
4. Trigger Netlify redeploy

There's no in-flight retry concern — pg_cron + pg_net is fire-and-forget,
and the next 15-min tick will use the new secret cleanly.

---

## Files involved

- `supabase/migrations/0088_notification_preferences.sql` — table + helper
- `supabase/migrations/0089_schedule_notification_cron.sql` — cron job
  definition + `dispatch_scheduled_notifications()` SECURITY DEFINER fn
- `app/api/cron/dispatch-notifications/route.ts` — the endpoint
- `lib/calendar/supervisor-digest.ts` — supervisor digest helper (called
  per-eligible-user from the dispatcher)
- `lib/email/send-customer-monthly-summary.ts` — Phase C email
- `lib/email/send-customer-upcoming-visit.ts` — Phase C email
