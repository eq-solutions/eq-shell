<#
.SYNOPSIS
    One-shot: create the three standard Sentry alert rules on the
    eq-solves-service project.

.DESCRIPTION
    Rules created:
      1. "Issue affecting 5+ users in 1h"       — high-frequency real bugs
      2. "Report run approaching 60s cap"        — PR #147 canary fires
      3. "Resolved issue regressed"              — regression catch

    All three email dev@eq.solutions.

.NOTES
    Required token scopes: alerts:write, member:read, project:read.
    If the existing source-map token doesn't have these, create a new
    token at https://eq-solutions.sentry.io/settings/account/api/auth-tokens/

.EXAMPLE
    $env:SENTRY_AUTH_TOKEN = "sntrys_xxx..."
    .\create-sentry-alerts.ps1
#>

$ErrorActionPreference = 'Stop'

if (-not $env:SENTRY_AUTH_TOKEN) {
    Write-Error "Set `$env:SENTRY_AUTH_TOKEN before running. See script header for token-scope requirements."
    exit 1
}

$org = 'eq-solutions'
$project = 'eq-solves-service'
$alertEmail = 'dev@eq.solutions'

# Org is on the EU (Germany) region. Org-scoped API calls must hit the regional
# host, not the global sentry.io. Override via $env:SENTRY_API_BASE if the org
# ever migrates regions.
$apiBase = if ($env:SENTRY_API_BASE) { $env:SENTRY_API_BASE.TrimEnd('/') } else { 'https://de.sentry.io/api/0' }

$headers = @{
    Authorization  = "Bearer $env:SENTRY_AUTH_TOKEN"
    'Content-Type' = 'application/json'
}

function Invoke-SentryApi {
    param(
        [string]$Method,
        [string]$Path,
        $Body = $null
    )
    $uri = "$apiBase$Path"
    $params = @{
        Method  = $Method
        Uri     = $uri
        Headers = $headers
    }
    if ($Body) {
        $params.Body = ($Body | ConvertTo-Json -Depth 10 -Compress)
    }
    try {
        return Invoke-RestMethod @params
    } catch {
        $status = $_.Exception.Response.StatusCode.value__
        $detail = ''
        try { $detail = ($_.ErrorDetails.Message) } catch {}
        if ($status -eq 403) {
            Write-Error "403 Forbidden on $Method $Path. Likely missing token scope. This script needs alerts:write + member:read + project:read. Body: $detail"
        } else {
            Write-Error "$Method $Path failed ($status): $detail"
        }
        exit 1
    }
}

# --- Step 1: resolve the Sentry team assigned to the project -----------------
#
# Originally this resolved an individual member id and used targetType=Member.
# Sentry rejects that with "This user is not part of the project" if the member
# has access via org-owner role rather than team-based project membership.
# Targeting the team avoids that quirk and is the more correct shape anyway —
# alerts go to whoever is on the on-call team, not a named human.

Write-Host "Looking up team assigned to project $project..." -ForegroundColor Cyan
$proj = Invoke-SentryApi -Method Get -Path "/projects/$org/$project/"
if (-not $proj.teams -or $proj.teams.Count -eq 0) {
    Write-Error "Project $project has no teams assigned. Add a team at https://$org.sentry.io/settings/projects/$project/teams/ and re-run."
    exit 1
}
$team = $proj.teams[0]
$teamId = [int64]$team.id
Write-Host "  team = $($team.slug) (id=$teamId)" -ForegroundColor Green

# Sanity-check that $alertEmail exists in the org (kept as a smoke test that
# the recipient address is reachable; not used as a target).
$members = Invoke-SentryApi -Method Get -Path "/organizations/$org/members/"
if (-not ($members | Where-Object { $_.email -eq $alertEmail })) {
    Write-Warning "No Sentry org member found with email $alertEmail. Team-targeted emails will still go to whoever is on the team."
}

# --- Step 2: shared email action ---------------------------------------------

$emailAction = @{
    id               = 'sentry.mail.actions.NotifyEmailAction'
    targetType       = 'Team'
    targetIdentifier = $teamId
}

# --- Step 3: rule payloads ---------------------------------------------------

# Rule 1 — issue affecting 5+ unique users in 1h
# Fires whenever ANY issue (new or existing) crosses the 5-unique-user
# threshold within a rolling 1h window. Action-interval=60 prevents
# re-firing on the same issue within 60 min.
$rule1 = @{
    name        = 'Issue affecting 5+ users in 1h'
    actionMatch = 'all'
    filterMatch = 'all'
    conditions  = @(
        @{
            id       = 'sentry.rules.conditions.event_frequency.EventUniqueUserFrequencyCondition'
            value    = 5
            interval = '1h'
        }
    )
    filters     = @()
    actions     = @($emailAction)
    frequency   = 60
    environment = $null
}

# Rule 2 — report-duration canary (PR #147)
# Fires when an event tagged canary=report_duration arrives at level
# >= warning. EventFrequencyCondition with value=1 means "at least one
# such event landed in the interval" — covers both new and recurring
# canary signals.
$rule2 = @{
    name        = 'Report run approaching 60s cap'
    actionMatch = 'all'
    filterMatch = 'all'
    conditions  = @(
        @{
            id             = 'sentry.rules.conditions.event_frequency.EventFrequencyCondition'
            value          = 1
            interval       = '1h'
            comparisonType = 'count'
        }
    )
    filters     = @(
        @{
            id    = 'sentry.rules.filters.tagged_event.TaggedEventFilter'
            key   = 'canary'
            match = 'eq'
            value = 'report_duration'
        },
        @{
            id    = 'sentry.rules.filters.level.LevelFilter'
            match = 'gte'
            level = '30'  # 30 = warning, 40 = error, 50 = fatal
        }
    )
    actions     = @($emailAction)
    frequency   = 60
    environment = $null
}

# Rule 3 — regression
$rule3 = @{
    name        = 'Resolved issue regressed'
    actionMatch = 'all'
    filterMatch = 'all'
    conditions  = @(
        @{ id = 'sentry.rules.conditions.regression_event.RegressionEventCondition' }
    )
    filters     = @()
    actions     = @($emailAction)
    frequency   = 60
    environment = $null
}

# --- Step 4: create them -----------------------------------------------------

$rules = @($rule1, $rule2, $rule3)
$created = @()

foreach ($rule in $rules) {
    Write-Host "Creating rule: $($rule.name)" -ForegroundColor Cyan
    $result = Invoke-SentryApi -Method Post -Path "/projects/$org/$project/rules/" -Body $rule
    Write-Host "  ✓ id=$($result.id) — $($result.name)" -ForegroundColor Green
    $created += $result
}

Write-Host ''
Write-Host "All $($created.Count) rules created." -ForegroundColor Green
Write-Host "Review at: https://$org.sentry.io/alerts/rules/?project=$project" -ForegroundColor White
