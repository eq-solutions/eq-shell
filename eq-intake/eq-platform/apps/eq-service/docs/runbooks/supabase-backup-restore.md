# Runbook — Supabase backup restoration drill

**Owner:** Royce
**Cadence:** Quarterly (first week of each quarter)
**Last drill:** _not yet run_
**Next drill due:** 2026-07-06 (start of Q1 FY27)
**Estimated time:** 60–90 minutes end to end
**Severity if this fails in a real incident:** Critical — the whole product is unavailable until restore succeeds.

---

## Why this runbook exists

Supabase takes automatic daily backups of the project database, but a backup is not a backup until it has been restored successfully at least once. This runbook proves, on a recurring basis, that:

1. The backups are actually there.
2. We know how to restore one without reading documentation under pressure.
3. The resulting database is structurally sound (RLS intact, migrations aligned, audits clean).
4. The restore can complete inside the recovery time objective (RTO) we commit to.

**RTO target:** 4 hours from decision-to-restore to app-back-online.
**RPO target:** 24 hours of data loss in the worst case (Supabase daily backup cadence on the current plan).

If a drill reveals either target is unachievable, that's a finding that goes in the post-drill section of this file and an issue opened on the repo.

---

## What this runbook is NOT

- **Not a production restore procedure.** Do not copy these steps and run them against `urjhmkhbgaxrofurpbgc` unless there is an actual incident. The drill always runs against a **Supabase branch** or a **separate throwaway project**, never the live project.
- **Not a substitute for point-in-time recovery.** PITR is a paid add-on. If the project moves to the paid plan, this runbook needs a section added for PITR specifically.
- **Not a data export procedure.** For one-off exports (customer churn, accountant requests) use `pg_dump` directly — that's a different workflow.

---

## Pre-flight checklist

Before starting the drill, confirm:

- [ ] You have `SUPABASE_ACCESS_TOKEN` (personal access token) available locally. Do **not** commit it.
- [ ] You have `supabase` CLI installed and logged in (`supabase login`).
- [ ] You have a current checkout of `eq-solves-service` on `main` at a clean working tree.
- [ ] The production project ref is `urjhmkhbgaxrofurpbgc` — note it but **do not target it for writes**.
- [ ] You have permission to create a Supabase branch or a new throwaway project in the EQ Solutions org.
- [ ] You have 90 minutes of uninterrupted time. A half-finished drill is worse than no drill.

---

## Procedure

### Step 1 — Confirm a recent backup exists

```powershell
# Open the Supabase dashboard:
Start-Process "https://supabase.com/dashboard/project/urjhmkhbgaxrofurpbgc/database/backups"
```

Expected: at least one daily backup listed, the most recent within the last 24 hours. Note the timestamp of the backup you intend to restore from — you'll record it in the post-drill summary.

If no backup exists, **stop the drill** and raise an incident immediately — the backup schedule itself is broken, which is a much bigger problem than the drill.

### Step 2 — Create a target project for the restore

We never restore into production. Two options:

**Option A — Supabase branch (preferred, free tier compatible):**

```powershell
# From the eq-solves-service repo root
cd C:\Projects\eq-solves-service
supabase branches create drill-YYYYMMDD --project-ref urjhmkhbgaxrofurpbgc
```

Branches inherit migrations and seed data from main but start empty of real rows. This is fine — the restore step below replaces the contents.

**Option B — Fresh throwaway project:**

```powershell
# Only if branches are unavailable
# Create via dashboard: https://supabase.com/dashboard/new
# Region: same as production (ap-southeast-2)
# Name: eq-drill-YYYYMMDD
# Tier: free
```

Record the project ref of whichever target you chose.

### Step 3 — Download the backup

```powershell
# Set the target ref (the drill target, NOT urjhmkhbgaxrofurpbgc)
$env:DRILL_REF = "<ref from step 2>"
$env:PROD_REF  = "urjhmkhbgaxrofurpbgc"

# From the dashboard, download the most recent daily backup .sql.gz
# File will land in C:\Users\<you>\Downloads\
# Rename it for clarity
Move-Item `
  "C:\Users\$env:USERNAME\Downloads\db-backup-*.sql.gz" `
  "C:\Projects\eq-solves-service\drill-backup-$(Get-Date -Format yyyyMMdd).sql.gz"
```

### Step 4 — Restore into the drill target

```powershell
# Get the drill target's connection string from the dashboard
# Settings → Database → Connection string → URI
$env:DRILL_DB_URL = "postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres"

# Gunzip and pipe into psql
gzip -d -c "C:\Projects\eq-solves-service\drill-backup-$(Get-Date -Format yyyyMMdd).sql.gz" | `
  psql $env:DRILL_DB_URL
```

Watch for errors. A healthy restore produces mostly `CREATE`, `ALTER`, and `COPY` lines and finishes without ROLLBACK.

### Step 5 — Sanity-check the restored database

Run the data-quality audit against the drill target:

```powershell
$env:SUPABASE_ACCESS_TOKEN = "sbp_..."  # your PAT
Get-Content "C:\Projects\eq-solves-service\audits\run.sql" | ConvertTo-Json -Compress | `
  ForEach-Object { "{`"query`": $_}" } | Out-File -Encoding utf8 payload.json
curl.exe -sS -X POST `
  -H "Authorization: Bearer $env:SUPABASE_ACCESS_TOKEN" `
  -H "Content-Type: application/json" `
  --data "@payload.json" `
  "https://api.supabase.com/v1/projects/$env:DRILL_REF/database/query" `
  -o drill-audit.json
Get-Content drill-audit.json | jq '.'
Remove-Item payload.json
```

Expected: zero `ERROR`-level failures. `WARN`-level failures should match the current `audits/baseline-*.md` from production — a meaningful divergence is a finding.

Spot-checks from the dashboard SQL editor against the drill target:

```sql
-- Table count — should match production ±0
select count(*) from information_schema.tables where table_schema = 'public';

-- RLS coverage — should be 100%
select count(*) from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
-- Expected: 0

-- Migration alignment
select version from supabase_migrations.schema_migrations order by version desc limit 5;
-- Expected: latest matches what `supabase migration list` shows locally
```

### Step 6 — Smoke test the app against the drill target

```powershell
cd C:\Projects\eq-solves-service
# DO NOT overwrite .env.local — copy it aside first
Copy-Item .env.local .env.local.pre-drill
# Point .env.local at the drill target
# Edit NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to the drill values
npm run dev
# Open http://localhost:3000
# Log in. Confirm: sites list, assets list, ACB/NSX test pages, /reports page all load
```

Expected: the app functions identically to production, minus the last 24 hours of activity.

**Critical:** when finished, restore the production `.env.local`:

```powershell
Copy-Item .env.local.pre-drill .env.local -Force
Remove-Item .env.local.pre-drill
```

### Step 7 — Tear down

```powershell
# Option A (branch) — delete the branch
supabase branches delete drill-YYYYMMDD --project-ref $env:PROD_REF

# Option B (throwaway project) — delete via dashboard
Start-Process "https://supabase.com/dashboard/project/$env:DRILL_REF/settings/general"
# Scroll to "Delete project"

# Local cleanup
Remove-Item "C:\Projects\eq-solves-service\drill-backup-*.sql.gz"
Remove-Item "C:\Projects\eq-solves-service\drill-audit.json"
```

### Step 8 — Record the drill

Add a row to the **Drill log** section below. Open an issue on the repo for any finding worth tracking.

---

## Drill log

| Date | Backup timestamp restored | Target | Outcome | Elapsed | Findings | Operator |
|---|---|---|---|---|---|---|
| _example_ | 2026-07-05 02:00 UTC | branch `drill-20260706` | ✅ clean restore, audits pass | 52 min | none | Royce |

_(Fill this in after each drill. Never delete old rows.)_

---

## Known hazards

- **Free-tier branch restore limit.** Branches on the free tier have a row count cap. A full production restore may exceed it once the dataset grows. If this happens, switch to Option B (throwaway project) and raise a ticket to evaluate the paid branching plan.
- **Auth schema in the backup.** The backup contains `auth.users`, which means emails and password hashes end up in the drill target. Treat the drill target as **production-grade sensitive** until it is deleted. Do not share its URL.
- **`.env.local` mix-up.** The most dangerous step in this runbook is Step 6 — pointing the dev server at the drill target. If you forget to restore `.env.local`, you'll be developing against a throwaway project and wondering why nothing saves. The `.env.local.pre-drill` copy is the safety net; don't skip it.
- **Service-role key exposure.** The backup download URL from the dashboard is signed and short-lived. Do not paste it in Slack, Claude chats, or commit messages.

---

## Escalation

If the drill fails at any step:

1. **Abort the drill.** Do not keep going to "see how far it gets".
2. **Record what failed** in the Drill log above and open a repo issue with label `backup-restore`.
3. If the failure suggests the real production backups are unrecoverable, **open a Supabase support ticket immediately** — this is a P0 for the business.
4. Tag Royce in the issue before closing out for the day.

---

## Change log

- 2026-04-16 — Initial runbook created as part of roadmap item 14. Not yet drilled.
