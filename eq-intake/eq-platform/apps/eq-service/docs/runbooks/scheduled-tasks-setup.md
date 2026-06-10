# Scheduled tasks — setup runbook

One recurring routine remains to schedule:

- **Weekly UX / data-integrity audit** — runs the validated prompt in `docs/runbooks/weekly-audit.md`

This file holds the **exact prompt and cron expression** to paste into `/schedule` in a normal interactive Claude Code session. Setup time: ~2 minutes.

> **2026-05-15 correction:** the originally scoped *daily Supabase advisor scan* was found to be fully redundant with the existing [.github/workflows/supabase-advisors.yml](../../.github/workflows/supabase-advisors.yml) GitHub Actions workflow (which runs daily at 08:15 UTC, fails CI on ERRORs, summarises WARNs). Don't schedule it.

## What CI already covers — don't duplicate

Before adding any new scheduled routine, check whether one of these is already doing the job:

| Workflow | File | Cadence | What it does |
|---|---|---|---|
| **CI** | [.github/workflows/ci.yml](../../.github/workflows/ci.yml) | Every PR + push to main | `tsc --noEmit` + `npm audit --audit-level=high` |
| **check** | [.github/workflows/check.yml](../../.github/workflows/check.yml) | Every PR + push to main | `tsc --noEmit` + `next build` + `vitest run` (172 unit tests) |
| **Supabase Advisors** | [.github/workflows/supabase-advisors.yml](../../.github/workflows/supabase-advisors.yml) | PRs touching migrations + daily 08:15 UTC + manual dispatch | Pulls security + performance advisors; fails CI on ERROR-level findings |
| **Data Quality** | [.github/workflows/data-quality.yml](../../.github/workflows/data-quality.yml) | PRs touching `audits/**` or migrations + daily 08:30 UTC + manual dispatch | Runs `audits/run.sql` against Supabase; fails CI on ERRORs with `fail_count > 0` |
| **Backup** | [.github/workflows/backup.yml](../../.github/workflows/backup.yml) | (check the file) | Database backup orchestration |

A new `/schedule` task is only justified when **none** of the above covers it.

## Why this runbook exists

Three scheduler tools were tried on 2026-05-14 and all bounced:

| Tool | Why it failed |
|---|---|
| `/schedule` skill | claude.ai remote-auth offline |
| `mcp__scheduled-tasks__create_scheduled_task` | refuses to run in "unsupervised" mode — needs an interactive approval prompt |
| `CronCreate` (with `durable: true`) | runtime ignored the durable flag — created jobs were session-only and died when the conversation ended |

The first two are the real persistent-schedule paths. Either one works in a normal interactive Claude Code window where the approval modal is visible.

## Setup

In a normal Claude Code session at the EQ Solves Service repo root, run `/schedule` and paste the task below. Approve the modal when it appears.

### Task: Weekly UX / data-integrity audit

- **Cron:** `47 8 * * 1` (Monday 08:47 local time — early in the work week)
- **Cost:** ~$3-5 per run × 4 runs/month = ~$12-20/month
- **Why weekly:** the validated runbook produces ~10 findings per pass; weekly is the cadence at which signal stays sharp without becoming noise

**Prompt:**

```text
Run the weekly UX / data-integrity audit for EQ Solves Service.

The validated runbook lives at:
C:\Projects\eq-solves-service\docs\runbooks\weekly-audit.md

Steps

1. Read that runbook in full. It contains calibration context and the exact
   prompt to use.

2. From the runbook, locate the section that starts with "## The prompt" and
   ends at the next "##" heading. That's the audit prompt — copy it verbatim.

3. Spawn a general-purpose subagent with that prompt, working in
   C:\Projects\eq-solves-service\. The audit takes ~10 min and costs ~$3-5.

4. Present the subagent's report verbatim. Do NOT summarise or filter —
   Royce wants the raw findings to triage himself.

5. Append a "## Recommended triage" section with three lines:
   - Fix now: which 1-2 findings (if any) are small enough to land as a
     same-session PR
   - File as issues: which findings warrant GitHub issues with title prefix
     [audit-YYYY-MM-DD][HIGH|MED]
   - Discard: which findings look like false positives

6. Final line: "Audit complete · {N} HIGH · {N} MED · {N} LOW · {duration}".

If the runbook file is missing, output:
"Runbook file missing at expected path — task needs reconfiguration."

Why: UX / data-integrity bugs (silent action failures, stale client state,
missing error feedback) are the bugs static analysis misses but technicians
scream about. The runbook is validated; this just gates it to weekly so
signal doesn't decay.
```

## After setup

Once the task is scheduled:

- List active tasks: in `/schedule`, ask "list my scheduled tasks"
- Update the task's prompt: edit `C:\Users\EQ\.claude\scheduled-tasks\<taskId>\SKILL.md`
- Disable temporarily: in `/schedule`, ask "disable task <name>"
- Delete: in `/schedule`, ask "delete task <name>"

Add a `## History` row when you find the signal is genuinely useful (or kill the schedule if it isn't).

## History

| Date | What happened |
|---|---|
| 2026-05-14 | Scoped + approved two routines (daily advisor scan + weekly audit). All 3 schedule tools blocked the same evening — runbook captures the exact setup for a future interactive session. |
| 2026-05-15 | Discovered the daily Supabase advisor scan was fully redundant with [.github/workflows/supabase-advisors.yml](../../.github/workflows/supabase-advisors.yml). Removed from this runbook. Weekly UX audit remains the only routine still worth scheduling. Added the "What CI already covers" table so future-me doesn't propose duplicates. |
