# push-eq.ps1 - safe git push helper for eq-solves-service
#
# Why this exists:
#   The working tree is touched by several processes - Cowork sessions,
#   coworkr-svc file sync, editors, occasional AV scans. Any of them can
#   leave .git/index.lock behind when they exit badly, and when a second
#   process pushes to origin while you're composing a commit locally, a
#   plain `git push` gets rejected ("fetch first").
#
#   This script wraps the add -> commit -> push flow with:
#     1. Stale-lock auto-clear (safe: only if no git.exe is actually running
#        AND the lock file is older than 3 seconds)
#     2. Auto pull --rebase if the remote has moved since your last fetch
#     3. Clear, loud errors when something genuinely needs your attention
#
# Usage:
#   .\scripts\push-eq.ps1 -Message "fix(auth): something" -Paths @(
#       'app/(auth)/auth/callback/route.ts',
#       'app/(auth)/auth/signin/page.tsx'
#   )
#
#   Or for a bare "push whatever's staged":
#   .\scripts\push-eq.ps1 -PushOnly
#
# Notes:
#   - Paths containing parens MUST be single-quoted in PowerShell or the
#     shell parses them as subexpressions. The script uses -Paths as a
#     string array to avoid this.
#   - Never runs `git push --force`. If the remote has diverged in a way
#     rebase can't handle, it stops and tells you.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$Message,

    [Parameter(Mandatory = $false)]
    [string[]]$Paths = @(),

    [Parameter(Mandatory = $false)]
    [switch]$PushOnly,

    [Parameter(Mandatory = $false)]
    [string]$Remote = 'origin',

    [Parameter(Mandatory = $false)]
    [string]$Branch = 'main'
)

$ErrorActionPreference = 'Stop'

function Write-Step { param([string]$Text) Write-Host "`n==> $Text" -ForegroundColor Cyan }
function Write-OK   { param([string]$Text) Write-Host "[ok] $Text" -ForegroundColor Green }
function Write-Warn { param([string]$Text) Write-Host "[warn] $Text" -ForegroundColor Yellow }
function Write-Err  { param([string]$Text) Write-Host "[error] $Text" -ForegroundColor Red }

function Clear-StaleLock {
    # Clears ALL stale .git/*.lock files - index.lock, HEAD.lock,
    # refs/heads/<branch>.lock, packed-refs.lock, config.lock, etc.
    # Cowork sessions, coworkr-svc, editors, and AV scans can each leave
    # different lock files behind, and a single-file clear (the original
    # implementation) just kicks the can to the next lock the next process
    # tries to take.

    $gitDir = Join-Path (Get-Location) '.git'
    if (-not (Test-Path $gitDir)) { return }

    $locks = Get-ChildItem -Path $gitDir -Filter '*.lock' -Recurse -Force -File -ErrorAction SilentlyContinue
    if (-not $locks) { return }

    # If a real git.exe is running, leave everything alone.
    $gitProcs = Get-Process -Name git -ErrorAction SilentlyContinue
    if ($gitProcs) {
        Write-Warn "Lock files exist AND a git.exe process is running (PID $($gitProcs.Id -join ', ')). Waiting..."
        Start-Sleep -Seconds 3
        $gitProcs = Get-Process -Name git -ErrorAction SilentlyContinue
        if ($gitProcs) {
            throw "git.exe is still running (PID $($gitProcs.Id -join ', ')). Refusing to remove $($locks.Count) lock file(s)."
        }
        # git.exe gone - re-list locks (some may have been cleaned up)
        $locks = Get-ChildItem -Path $gitDir -Filter '*.lock' -Recurse -Force -File -ErrorAction SilentlyContinue
        if (-not $locks) { return }
    }

    foreach ($lock in $locks) {
        $ageSeconds = ((Get-Date) - $lock.LastWriteTime).TotalSeconds
        if ($ageSeconds -lt 2) {
            # Brand new - give it a moment in case another tool is writing
            Start-Sleep -Seconds 2
            if (-not (Test-Path $lock.FullName)) { continue }
        }
        $rel = $lock.FullName.Substring($gitDir.Length + 1)
        Write-Warn "Removing stale .git/$rel (age $([int]$ageSeconds)s, no git.exe running)"
        try {
            Remove-Item -LiteralPath $lock.FullName -Force -ErrorAction Stop
        } catch {
            Write-Warn "Could not remove $rel - $($_.Exception.Message)"
        }
    }
    Write-OK 'Locks cleared.'
}

function Invoke-GitSafe {
    # NOTE: do NOT name the param $Args - that's a PowerShell automatic variable
    # and it will be silently replaced with the function's unbound-args array
    # (which is empty when callers splat explicitly), so `git @Args` becomes
    # `git` with no args and git just prints its usage text.
    param([string[]]$GitArgs)
    Clear-StaleLock
    & git @GitArgs
    if ($LASTEXITCODE -ne 0) {
        throw "git $($GitArgs -join ' ') failed with exit code $LASTEXITCODE"
    }
}

# -------------------- main --------------------

if (-not (Test-Path '.git')) {
    Write-Err 'Not inside a git repository. Run this from the repo root.'
    exit 1
}

try {
    Clear-StaleLock

    # 1. Fetch to see where the remote is
    Write-Step "Fetching $Remote/$Branch"
    Invoke-GitSafe @('fetch', $Remote, $Branch)

    # 2. If the remote is ahead, rebase local on top before touching anything
    $localHash  = (& git rev-parse "$Branch").Trim()
    $remoteHash = (& git rev-parse "$Remote/$Branch").Trim()
    $baseHash   = (& git merge-base $Branch "$Remote/$Branch").Trim()

    if ($remoteHash -ne $localHash -and $remoteHash -ne $baseHash) {
        Write-Step "Remote has moved - rebasing onto $Remote/$Branch"
        Invoke-GitSafe @('pull', '--rebase', $Remote, $Branch)
        Write-OK 'Rebase complete.'
    } else {
        Write-OK 'Local is up-to-date with remote (or ahead).'
    }

    # 3. Stage + commit (unless -PushOnly)
    if (-not $PushOnly) {
        if (-not $Message) {
            Write-Err 'Provide -Message (or use -PushOnly if everything is already committed).'
            exit 2
        }
        if ($Paths.Count -eq 0) {
            Write-Err 'Provide -Paths @("file1", "file2") to stage, or use -PushOnly.'
            exit 2
        }

        Write-Step "Staging $($Paths.Count) path(s)"
        $stageArgs = @('add') + $Paths
        Invoke-GitSafe $stageArgs

        # Only commit if something is actually staged
        $staged = (& git diff --cached --name-only)
        if (-not $staged) {
            Write-Warn 'Nothing staged after add - skipping commit.'
        } else {
            Write-Step 'Committing'
            Invoke-GitSafe @('commit', '-m', $Message)
            Write-OK 'Commit created.'
        }
    }

    # 4. Push
    Write-Step "Pushing to $Remote/$Branch"
    Invoke-GitSafe @('push', $Remote, $Branch)
    Write-OK 'Pushed.'
}
catch {
    Write-Err $_.Exception.Message
    Write-Host ''
    Write-Host 'If this is a merge conflict, resolve it manually in VS Code, then run:' -ForegroundColor Yellow
    Write-Host '    git add <resolved-files>' -ForegroundColor Yellow
    Write-Host '    git rebase --continue' -ForegroundColor Yellow
    Write-Host '    git push origin main' -ForegroundColor Yellow
    exit 1
}
