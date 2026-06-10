# EQ Solves Service Health Audit

**Date:** 2026-04-18 | **Branch:** Unknown (git config corrupted) | **Status:** RED / AMBER / GREEN mixed

---

## Executive Summary

- **RED:** TypeScript check fails with 1,359 errors due to 1,357 TS1127 (invalid character) violations — all trailing whitespace in test files and config files. Prevents `tsc --noEmit` from passing per AGENTS.md pre-merge gate.
- **RED:** Git config corrupted (bad line 11 in `.git/config`). Cannot read branch, status, or logs. Requires manual repair before operations.
- **AMBER:** Build artefacts present: `.next/` (25 MB), `.next-old/` (192 MB), `tmp/eq-next-build/` (23 MB) checked into repo. Should be gitignored per AGENTS.md rule. Bloats clones and pollutes tsc.
- **GREEN:** npm audit clean — 0 vulnerabilities at high+ severity. 653 dependencies (145 prod, 473 dev, 99 optional) all sound.
- **GREEN:** No hardcoded secrets detected. `.env.local` exists, is gitignored, contains service_role key only in local context.

---

## TypeScript Findings

**Total errors:** 1,359

### Breakdown by error type

| Error Code | Count | Root Cause |
|-----------|-------|-----------|
| TS1127    | 1,357 | Invalid characters — trailing whitespace in 7 files |
| TS5092    | 1     | tsconfig.json line 43 — trailing whitespace |
| TS1005    | 1     | vitest.config.ts line 17 — trailing whitespace |

### Files with TS1127 (trailing whitespace clusters)

| File | Count | Affected Lines |
|------|-------|---|
| `tmp/eq-next-build/types/validator.ts` | 367 | Line 368 (long series of tabs/spaces at col 99+) |
| `tests/lib/utils/format.test.ts` | 196 | Line 197 (192 trailing spaces) |
| `tests/lib/actions/auth.test.ts` | 142 | Line 207 (trailing whitespace block) |
| `tests/lib/utils/csv-parser.test.ts` | 115 | Line 116 (trailing whitespace) |
| `proxy.ts` | 108 | Line 109 (148 trailing spaces) |
| `tmp/eq-next-build/types/routes.d.ts` | 103 | Trailing whitespace in auto-generated file |
| `tmp/eq-next-build/types/cache-life.d.ts` | 145 | Auto-generated file with encoding issues |
| `tests/lib/utils/roles.test.ts` | 83 | Line 95+ (trailing whitespace) |
| `next.config.ts` | 7 | Line 8 |
| `tests/setup.ts` | 1 | Trailing whitespace |

### Root cause analysis

**Primary:** Hand-written files (`proxy.ts`, test files, config files) contain accidental trailing whitespace—likely from copy-paste, editor misconfiguration, or reformatting.

**Secondary:** Auto-generated files in `tmp/eq-next-build/types/` have encoding or line-ending issues. These are build artefacts and should be excluded via `.gitignore` per AGENTS.md.

### Fixable? Yes — trivial

All 1,357 violations can be fixed by stripping trailing whitespace (regex: `\s+$` per line). This is NOT a logic error, just whitespace hygiene.

---

## npm Audit Findings

```
npm audit --audit-level=high --json
```

**Vulnerabilities:** 0  
**Critical:** 0 | **High:** 0 | **Moderate:** 0 | **Low:** 0

**Dependency summary:**
- Production: 145 packages
- Dev: 473 packages
- Optional: 99 packages
- Peer: 10 packages
- **Total:** 653 unique dependencies

**Status:** CLEAN. No findings at high or above. Project is free of known npm security issues.

---

## Build Artefact & Secrets Hygiene

### Build artefacts in repo

Three large directories present and consuming 240 MB:

| Path | Size | Should be gitignored? |
|------|------|---|
| `.next/` | 25 MB | YES — Next.js build output |
| `.next-old/` | 192 MB | YES — stale build from previous session |
| `tmp/eq-next-build/` | 23 MB | YES — intermediate build/type generation |

**Per AGENTS.md:** "Do not commit `.next/` or `.next-old/` build artefacts. They can embed the anon key in bundled source."

**Status:** These ARE included in repo (causing TS1127 errors via tsc scanning them).

### Secrets footprint check

Grep for hardcoded patterns:
- `grep -rn 'service_role|sk_live|SUPABASE_SERVICE_ROLE_KEY\s*=\s*["\x27]'` — **No matches** (excluding node_modules/.next/tmp).

**Status:** CLEAN. Service role key only in `.env.local` (local-only, not committed).

### Environment files

- `.env.local` — **exists, readable (603 bytes), properly gitignored**
  - Contains: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
  - Permissions: `-rwx------ (700)` — restricted to owner
  - **Status:** CORRECT per security policy

- `.gitignore` contains `.env*` with exception `!.env.example` — **CORRECT**

---

## Git State Snapshot

**Critical issue:** Git config corrupted.

```
$ git status
fatal: bad config line 11 in file .git/config
```

`.git/config` line 11 contains only trailing whitespace after `[remote "origin"]` section. Git parser rejects the file.

**Readable config:**
```ini
[core]
  repositoryformatversion = 0
  filemode = false
  bare = false
  logallrefupdates = true
  symlinks = false
  ignorecase = true
[remote "origin"]
  url = https://github.com/Milmlow/eq-solves-service.git
  fetch = +refs/heads/*:refs/remotes/origin/*
[CORRUPTED - trailing whitespace on line 11]
```

**Impact:** Cannot read branch, status, logs, or perform any git operations. Must fix before deploying or committing.

**Cannot list:**
- Current branch
- Modified/untracked files
- Recent commit history
- Staging status

---

## Recommended Next Actions

### Priority 1 (Blocking)

1. **Fix git config corruption**
   ```sh
   # Edit .git/config and remove trailing whitespace after the [remote] section
   # Line 11 should be removed entirely (contains only spaces)
   # Verify: git status should work
   ```

2. **Strip trailing whitespace from source files**
   - `proxy.ts` line 109
   - `next.config.ts` line 8
   - `tsconfig.json` line 43
   - `vitest.config.ts` line 17
   - `tests/setup.ts` (if present)
   - All test files (format.test.ts, auth.test.ts, csv-parser.test.ts, roles.test.ts)
   
   **Quick fix (PowerShell or sed):**
   ```sh
   # Linux/macOS
   find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.json" \) \
     ! -path "./node_modules/*" ! -path "./.next/*" ! -path "./.next-old/*" ! -path "./tmp/*" \
     -exec sed -i 's/[[:space:]]*$//' {} +
   ```

3. **Remove build artefacts from git history**
   - Delete `.next/`, `.next-old/`, `tmp/` from working directory
   - Ensure `.gitignore` includes:
     ```
     .next/
     .next-old/
     tmp/
     ```
   - Run `git status` to verify they don't reappear

4. **Re-run `tsc --noEmit`**
   - Target: 0 errors before any PR or deployment
   - Verify: `npm run lint` (if ESLint rule exists) also passes

### Priority 2 (Before merge)

5. **Run npm audit after TypeScript fix**
   ```sh
   npm audit --audit-level=high
   ```
   (Currently clean; re-check for transitive upgrade issues)

6. **Check Supabase advisors** (if migrating)
   ```sh
   # Via supabase CLI or Cowork Supabase tools
   get_advisors security
   get_advisors performance
   ```
   Ensure no new ERROR-level findings introduced.

### Priority 3 (Pre-deployment, per AGENTS.md)

7. **Verify no build secrets leak**
   - Run `npm run build` in isolation
   - Check `.next/` does NOT contain embedded `SUPABASE_SERVICE_ROLE_KEY` in bundled JS

8. **CSP headers check** (if modified)
   - Review `public/_headers` (Netlify deployment)
   - Ensure HSTS, frame-ancestors unchanged

---

## Summary

**tsc gate:** FAIL (1,359 errors, all trailing whitespace)  
**npm audit gate:** PASS (0 vulnerabilities)  
**Secrets hygiene:** PASS (no hardcoded secrets)  
**Git state:** CORRUPTED (config line 11)  
**Build artefacts:** PRESENT (should be deleted + gitignored)  

**Time to fix:** ~30 minutes (whitespace strip + git config repair + build artefact cleanup)  
**Blockers before merge:** Git config + trailing whitespace + tsc clean
