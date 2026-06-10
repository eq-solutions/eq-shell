'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Upload,
  FileText,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  Check,
  Plus,
  SkipForward,
  Search,
  X,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import {
  previewDeltaImportAction,
  commitDeltaImportAction,
  commitConsolidatedDeltaImportAction,
  listJobPlansForImportAction,
  listAssetsForSiteAction,
  type CommitSummary,
  type GroupResolution,
  type PreviewGroup,
  type PreviewResult,
  type RowResolution,
} from './actions'
import { events as analyticsEvents } from '@/lib/analytics'
import { checkImportFileSizes } from '@/lib/utils/file-size-guard'

// ── Resolution state — keyed by group.key ───────────────────────────────

type ResolutionsMap = Record<string, GroupResolution>

// ── Row resolution state — keyed by `${group.key}:${rowNumber}` ─────────

type RowResolutionsMap = Record<string, RowResolution>

/** Lightweight asset row for the Link combobox. */
interface AssetOption {
  id: string
  name: string
  maximoId: string | null
  location: string | null
}

/** Lightweight plan row for the combobox. */
interface JobPlanOption {
  id: string
  code: string | null
  name: string
  type: string | null
}

/**
 * One staged file in the wizard. Each file goes through its own preview
 * call; results are combined client-side into a single virtual PreviewResult
 * that the existing Preview sub-component renders unchanged.
 */
interface FileEntry {
  id: string
  file: File
  preview: PreviewResult | null
  parseError: string | null
}

/**
 * Delta WO import wizard.
 *
 * Step 1: choose one or more .xlsx files → call `previewDeltaImportAction`
 *         per file (sequential), combine results into one preview view
 * Step 2: show combined preview — unresolved items, groups, per-asset detail
 * Step 3: commit per-file (sequential) — currently creates one
 *         maintenance_check per file's groups. Phase 2 will add a
 *         "Consolidate into one check" toggle that creates a single
 *         multi-plan check spanning all files.
 */
export function ImportWizard() {
  const router = useRouter()
  const fileInput = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<FileEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [commitResult, setCommitResult] = useState<CommitSummary | null>(null)
  const [resolutions, setResolutions] = useState<ResolutionsMap>({})
  const [rowResolutions, setRowResolutions] = useState<RowResolutionsMap>({})
  const [isPending, startTransition] = useTransition()
  const [isCommitting, startCommit] = useTransition()
  // Consolidation toggle — when on, all files commit into ONE check
  // (job_plan_id null, custom_name). Defaults from same-site detection
  // below: true when all files share a site, false + disabled otherwise.
  const [consolidate, setConsolidate] = useState(true)
  // User-editable name for the consolidated check. Auto-suggested from
  // site + period + plan codes once the preview lands; user can edit.
  const [consolidatedName, setConsolidatedName] = useState('')
  // Has the user manually edited the name? If true, don't overwrite from
  // the auto-suggester when groups change.
  const [nameEdited, setNameEdited] = useState(false)

  // Combined preview: aggregate all per-file PreviewResults into one virtual
  // PreviewResult so the existing Preview sub-component renders all groups
  // together. Available only when every staged file has a successful preview.
  const combinedPreview: PreviewResult | null = useMemo(() => {
    if (files.length === 0) return null
    if (!files.every((f) => f.preview)) return null

    const allGroups: PreviewGroup[] = []
    const allParseErrors: { rowNumber: number; message: string }[] = []
    const unresolvedSites = new Set<string>()
    const unresolvedPlans = new Set<string>()
    let totalRows = 0

    for (const fe of files) {
      const p = fe.preview
      if (!p) continue
      totalRows += p.parsedRowCount
      for (const e of p.parseErrors) allParseErrors.push(e)
      for (const c of p.unresolvedSiteCodes) unresolvedSites.add(c)
      for (const c of p.unresolvedJobPlanCodes) unresolvedPlans.add(c)
      // Group keys naturally partition by file because they include
      // siteCode + jobPlanCode + frequencySuffix and each file is a
      // single-classification Maximo export. No collision risk.
      for (const g of p.groups) allGroups.push(g)
    }

    return {
      success: true,
      filename: files.length === 1 ? files[0].file.name : `${files.length} files`,
      parsedRowCount: totalRows,
      parseErrors: allParseErrors,
      groups: allGroups,
      unresolvedJobPlanCodes: Array.from(unresolvedPlans),
      unresolvedSiteCodes: Array.from(unresolvedSites),
    }
  }, [files])

  // Map: group.key → source filename. Built alongside combinedPreview so the
  // Preview sub-component can render a "from <file>" badge per group when
  // there are 2+ files staged. Empty map = badges suppressed.
  const sourceByGroupKey = useMemo(() => {
    const m = new Map<string, string>()
    if (files.length < 2) return m
    for (const fe of files) {
      const p = fe.preview
      if (!p) continue
      for (const g of p.groups) m.set(g.key, fe.file.name)
    }
    return m
  }, [files])

  const allFilesParsed = files.length > 0 && files.every((f) => f.preview)
  const anyParseError = files.some((f) => f.parseError)

  // Same-site detection (used to enable/disable the Consolidate toggle).
  const distinctSiteCodes = useMemo(() => {
    const s = new Set<string>()
    if (combinedPreview) for (const g of combinedPreview.groups) s.add(g.siteCode)
    return s
  }, [combinedPreview])
  const sameSite = distinctSiteCodes.size === 1
  const canConsolidate = allFilesParsed && sameSite && files.length > 1

  // Auto-suggest consolidated check name from preview metadata.
  const suggestedConsolidatedName = useMemo(() => {
    if (!combinedPreview || combinedPreview.groups.length === 0) return ''
    const siteCode = Array.from(distinctSiteCodes)[0] ?? ''
    if (!siteCode) return ''
    // Pick the earliest startDate across groups for the period label.
    let earliest: Date | null = null
    for (const g of combinedPreview.groups) {
      const d = new Date(g.startDate)
      if (!earliest || d < earliest) earliest = d
    }
    const period = earliest
      ? earliest.toLocaleString('en-AU', { month: 'long', year: 'numeric' })
      : ''
    const planCodes = Array.from(
      new Set(combinedPreview.groups.map((g) => g.jobPlanCode)),
    ).slice(0, 6)
    return `${siteCode} — ${period} — Combined: ${planCodes.join(', ')}`
  }, [combinedPreview, distinctSiteCodes])

  // Keep consolidatedName in sync with suggestion until user edits.
  useEffect(() => {
    if (!nameEdited && suggestedConsolidatedName) {
      setConsolidatedName(suggestedConsolidatedName)
    }
  }, [suggestedConsolidatedName, nameEdited])

  // When same-site flips false (mixed sites), force consolidate off and disable.
  useEffect(() => {
    if (!sameSite && consolidate) setConsolidate(false)
  }, [sameSite, consolidate])

  function handleChoose(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    if (picked.length === 0) return
    const sizeError = checkImportFileSizes(picked)
    if (sizeError) {
      setError(sizeError)
      if (fileInput.current) fileInput.current.value = ''
      return
    }
    const newEntries: FileEntry[] = picked.map((f) => ({
      id: cryptoRandomId(),
      file: f,
      preview: null,
      parseError: null,
    }))
    setFiles((prev) => [...prev, ...newEntries])
    setError(null)
    setCommitResult(null)
    setResolutions({})
    setRowResolutions({})
    if (fileInput.current) fileInput.current.value = ''
  }

  function removeFile(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id))
    // Resolutions are keyed by group.key — when files change, drop them all
    // rather than try to figure out which keys belonged to which file.
    setResolutions({})
    setRowResolutions({})
    setCommitResult(null)
    setError(null)
  }

  function handlePreview() {
    if (files.length === 0) return
    setError(null)
    setCommitResult(null)
    setResolutions({})
    setRowResolutions({})
    analyticsEvents.deltaImportStarted()
    startTransition(async () => {
      // Sequential parse — each file independently. Cheaper to debug than
      // Promise.all and the parse cost is low (Maximo exports are small).
      const updated: FileEntry[] = []
      for (const fe of files) {
        const fd = new FormData()
        fd.append('file', fe.file)
        const result = await previewDeltaImportAction(fd)
        if (!result.success) {
          updated.push({ ...fe, preview: null, parseError: result.error })
        } else {
          updated.push({ ...fe, preview: result, parseError: null })
        }
      }
      setFiles(updated)
    })
  }

  function handleCommit() {
    if (!combinedPreview) return
    setError(null)

    // Branch: consolidate path → single new server action with ALL files.
    // Separate path → existing per-file loop.
    if (consolidate && canConsolidate) {
      if (!consolidatedName.trim()) {
        setError('Please enter a name for the consolidated check.')
        return
      }
      startCommit(async () => {
        const fd = new FormData()
        files.forEach((fe, idx) => fd.append(`file_${idx}`, fe.file))
        fd.append('customName', consolidatedName.trim())
        if (Object.keys(resolutions).length > 0) {
          fd.append('resolutions', JSON.stringify(resolutions))
        }
        if (Object.keys(rowResolutions).length > 0) {
          fd.append('rowResolutions', JSON.stringify(rowResolutions))
        }
        const mutationId = cryptoRandomId()
        const result = await commitConsolidatedDeltaImportAction(fd, mutationId)
        if (!result.success) {
          setError(result.error)
          return
        }
        const summary = result.data
        if (summary) {
          setCommitResult(summary)
          analyticsEvents.deltaImportCommitted({
            rows_linked: summary.rowsLinked ?? 0,
            rows_created: summary.rowsCreated ?? 0,
            rows_skipped: summary.rowsSkipped ?? 0,
          })
        }
        router.refresh()
      })
      return
    }

    // Separate path: aggregate summary across per-file commits.
    startCommit(async () => {
      const aggregate: CommitSummary = {
        checksCreated: 0,
        checkAssetsCreated: 0,
        checkItemsCreated: 0,
        rowsLinked: 0,
        rowsCreated: 0,
        rowsSkipped: 0,
        groupsCreated: [],
      }
      const errors: string[] = []

      for (const fe of files) {
        const p = fe.preview
        if (!p) continue

        // Filter resolutions to keys that belong to this file's groups so
        // the per-file commit only sees its own resolutions.
        const fileGroupKeys = new Set(p.groups.map((g) => g.key))
        const fileResolutions: ResolutionsMap = {}
        for (const [k, v] of Object.entries(resolutions)) {
          if (fileGroupKeys.has(k)) fileResolutions[k] = v
        }
        const fileRowResolutions: RowResolutionsMap = {}
        for (const [k, v] of Object.entries(rowResolutions)) {
          // Row resolution keys are `${groupKey}:${rowNumber}`.
          const groupKey = k.split(':')[0]
          if (groupKey && fileGroupKeys.has(groupKey)) fileRowResolutions[k] = v
        }

        const fd = new FormData()
        fd.append('file', fe.file)
        if (Object.keys(fileResolutions).length > 0) {
          fd.append('resolutions', JSON.stringify(fileResolutions))
        }
        if (Object.keys(fileRowResolutions).length > 0) {
          fd.append('rowResolutions', JSON.stringify(fileRowResolutions))
        }
        const mutationId = cryptoRandomId()
        const result = await commitDeltaImportAction(fd, mutationId)
        if (!result.success) {
          errors.push(`${fe.file.name}: ${result.error}`)
          continue
        }
        const summary = result.data
        if (summary) {
          aggregate.checksCreated += summary.checksCreated
          aggregate.checkAssetsCreated += summary.checkAssetsCreated
          aggregate.checkItemsCreated += summary.checkItemsCreated
          aggregate.rowsLinked += summary.rowsLinked
          aggregate.rowsCreated += summary.rowsCreated
          aggregate.rowsSkipped += summary.rowsSkipped
          aggregate.groupsCreated.push(...summary.groupsCreated)
          analyticsEvents.deltaImportCommitted({
            rows_linked: summary.rowsLinked ?? 0,
            rows_created: summary.rowsCreated ?? 0,
            rows_skipped: summary.rowsSkipped ?? 0,
          })
        }
      }

      if (errors.length > 0) {
        setError(`${errors.length} file(s) failed: ${errors.join('; ')}`)
      }
      if (aggregate.checksCreated > 0) {
        setCommitResult(aggregate)
      }
      router.refresh()
    })
  }

  function handleReset() {
    setFiles([])
    setError(null)
    setCommitResult(null)
    setResolutions({})
    setRowResolutions({})
    setConsolidate(true)
    setConsolidatedName('')
    setNameEdited(false)
    if (fileInput.current) fileInput.current.value = ''
  }

  function setResolution(groupKey: string, resolution: GroupResolution | null) {
    setResolutions((prev) => {
      if (!resolution) {
        const { [groupKey]: _drop, ...rest } = prev
        return rest
      }
      return { ...prev, [groupKey]: resolution }
    })
  }

  function setRowResolution(rowKey: string, resolution: RowResolution | null) {
    setRowResolutions((prev) => {
      if (!resolution) {
        const { [rowKey]: _drop, ...rest } = prev
        return rest
      }
      return { ...prev, [rowKey]: resolution }
    })
  }

  return (
    <div className="space-y-5">
      {/* Upload strip */}
      <div className="border border-gray-200 rounded-lg bg-white p-4">
        <div className="flex items-center gap-3">
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx"
            multiple
            onChange={handleChoose}
            className="hidden"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => fileInput.current?.click()}
          >
            <Upload className="w-4 h-4 mr-1.5" />
            {files.length > 0 ? 'Add more files' : 'Choose .xlsx file(s)'}
          </Button>

          <div className="ml-auto flex items-center gap-2">
            {(combinedPreview || commitResult || files.length > 0) && (
              <Button variant="secondary" size="sm" onClick={handleReset}>
                Start over
              </Button>
            )}
            <Button
              size="sm"
              disabled={files.length === 0 || isPending}
              onClick={handlePreview}
            >
              {isPending ? 'Parsing…' : allFilesParsed ? 'Re-parse all' : `Preview ${files.length} file${files.length === 1 ? '' : 's'}`}
            </Button>
          </div>
        </div>

        {/* Stage list — one row per file */}
        {files.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {files.map((fe) => (
              <div
                key={fe.id}
                className="flex items-center gap-2 text-sm py-1.5 px-2 rounded-md hover:bg-gray-50 group"
              >
                <FileText className="w-4 h-4 text-eq-sky shrink-0" />
                <span className="font-medium text-eq-ink truncate">{fe.file.name}</span>
                <span className="text-xs text-eq-grey shrink-0">({formatBytes(fe.file.size)})</span>
                <div className="ml-auto flex items-center gap-2 shrink-0">
                  {isPending && !fe.preview && !fe.parseError && (
                    <Loader2 className="w-3.5 h-3.5 text-eq-grey animate-spin" />
                  )}
                  {fe.preview && (
                    <span className="inline-flex items-center gap-1 text-xs text-green-700">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {fe.preview.parsedRowCount} row{fe.preview.parsedRowCount === 1 ? '' : 's'}
                    </span>
                  )}
                  {fe.parseError && (
                    <span
                      className="inline-flex items-center gap-1 text-xs text-red-700"
                      title={fe.parseError}
                    >
                      <AlertCircle className="w-3.5 h-3.5" />
                      Parse error
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeFile(fe.id)}
                    className="text-eq-grey hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-label={`Remove ${fe.file.name}`}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {anyParseError && (
          <div className="mt-3 bg-amber-50 border border-amber-200 rounded-md p-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800">
              One or more files failed to parse — hover the error badge for detail, or remove the file and continue.
            </p>
          </div>
        )}

        {error && (
          <div className="mt-3 bg-red-50 border border-red-200 rounded-md p-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}
      </div>

      {/* Consolidate-into-one-check toggle (Phase 2) */}
      {combinedPreview && combinedPreview.groups.length > 0 && !commitResult && files.length > 1 && (
        <div className="border border-gray-200 rounded-lg bg-white p-4 space-y-3">
          <div className="flex items-start gap-3">
            <input
              id="consolidate-toggle"
              type="checkbox"
              checked={consolidate && canConsolidate}
              disabled={!canConsolidate}
              onChange={(e) => setConsolidate(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-gray-300 text-eq-sky focus:ring-eq-sky disabled:opacity-50"
            />
            <div className="flex-1">
              <label
                htmlFor="consolidate-toggle"
                className={`text-sm font-medium ${canConsolidate ? 'text-eq-ink cursor-pointer' : 'text-eq-grey'}`}
              >
                Consolidate {files.length} files into one check
              </label>
              <p className="text-xs text-eq-grey mt-0.5">
                {canConsolidate
                  ? 'Creates a single maintenance check covering all work orders across these files. Each asset still gets its job-plan-specific tasks.'
                  : !sameSite
                    ? `Disabled — files target different sites (${Array.from(distinctSiteCodes).join(', ')}). Consolidation requires one site.`
                    : 'Disabled — only one file uploaded.'}
              </p>
            </div>
          </div>

          {consolidate && canConsolidate && (
            <div className="ml-7">
              <label htmlFor="consolidated-name" className="block text-xs font-medium text-eq-ink mb-1">
                Consolidated check name
              </label>
              <input
                id="consolidated-name"
                type="text"
                value={consolidatedName}
                onChange={(e) => {
                  setConsolidatedName(e.target.value)
                  setNameEdited(true)
                }}
                placeholder={suggestedConsolidatedName}
                className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:border-eq-sky"
              />
              {nameEdited && (
                <button
                  type="button"
                  onClick={() => { setNameEdited(false); setConsolidatedName(suggestedConsolidatedName) }}
                  className="text-xs text-eq-sky hover:underline mt-1"
                >
                  Reset to suggested
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Commit result takes precedence over preview */}
      {commitResult && (
        <CommitSuccess summary={commitResult} onDone={handleReset} />
      )}

      {/* Preview — combined across all staged files */}
      {combinedPreview && !commitResult && (
        <Preview
          preview={combinedPreview}
          sourceByGroupKey={sourceByGroupKey}
          resolutions={resolutions}
          setResolution={setResolution}
          rowResolutions={rowResolutions}
          setRowResolution={setRowResolution}
          onCommit={handleCommit}
          isCommitting={isCommitting}
        />
      )}
    </div>
  )
}

function cryptoRandomId(): string {
  // Prefer the browser's crypto.randomUUID where available; fall back to a
  // timestamp + random suffix. Only called from a client component.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

// ── Preview sub-component ───────────────────────────────────────────────

function Preview({
  preview,
  sourceByGroupKey,
  resolutions,
  setResolution,
  rowResolutions,
  setRowResolution,
  onCommit,
  isCommitting,
}: {
  preview: PreviewResult
  sourceByGroupKey?: Map<string, string>
  resolutions: ResolutionsMap
  setResolution: (groupKey: string, resolution: GroupResolution | null) => void
  rowResolutions: RowResolutionsMap
  setRowResolution: (rowKey: string, resolution: RowResolution | null) => void
  onCommit: () => void
  isCommitting: boolean
}) {
  // Lazy-load the full tenant plan list once, on first need. The combobox
  // filters locally so typing is instant and we don't re-fetch per keystroke.
  const [plans, setPlans] = useState<JobPlanOption[] | null>(null)
  const [plansError, setPlansError] = useState<string | null>(null)
  const [plansLoading, setPlansLoading] = useState(false)

  // Per-site asset lists — cached so the Link picker doesn't refetch.
  const [assetsBySite, setAssetsBySite] = useState<Record<string, AssetOption[]>>({})
  const [assetsSiteLoading, setAssetsSiteLoading] = useState<Record<string, boolean>>({})
  const [assetsSiteError, setAssetsSiteError] = useState<Record<string, string>>({})

  // Show only rows / groups that still need a human decision.
  const [showOnlyReview, setShowOnlyReview] = useState(false)

  async function ensurePlansLoaded(): Promise<void> {
    if (plans || plansLoading) return
    setPlansLoading(true)
    setPlansError(null)
    const result = await listJobPlansForImportAction()
    setPlansLoading(false)
    if (!result.success) {
      setPlansError(result.error)
      return
    }
    setPlans(result.plans)
  }

  async function ensureAssetsLoadedForSite(siteId: string): Promise<void> {
    if (assetsBySite[siteId] || assetsSiteLoading[siteId]) return
    setAssetsSiteLoading((m) => ({ ...m, [siteId]: true }))
    setAssetsSiteError((m) => {
      const { [siteId]: _drop, ...rest } = m
      return rest
    })
    const result = await listAssetsForSiteAction(siteId)
    setAssetsSiteLoading((m) => ({ ...m, [siteId]: false }))
    if (!result.success) {
      setAssetsSiteError((m) => ({ ...m, [siteId]: result.error }))
      return
    }
    setAssetsBySite((m) => ({ ...m, [siteId]: result.assets }))
  }

  // ── Group-level status ─────────────────────────────────────────────
  // A group is "settled" for commit when:
  //   - it already resolves (matchSource in exact|alias), OR
  //   - the user has a resolution (any of accept/nominate/create/skip)
  // Groups where the user chose 'skip' are excluded from totals/commit.
  const workingGroups = preview.groups.filter(
    (g) => resolutions[g.key]?.action !== 'skip',
  )
  const skippedCount = preview.groups.length - workingGroups.length

  const totalAssets = workingGroups.reduce((n, g) => n + g.assetCount, 0)
  const matchedAssets = workingGroups.reduce((n, g) => n + g.matchedAssetCount, 0)
  const unmatchedAssets = totalAssets - matchedAssets
  const duplicateWOs = workingGroups.reduce((n, g) => n + g.duplicateWorkOrderCount, 0)

  const needsResolution = (g: PreviewGroup): boolean =>
    g.matchSource === 'fuzzy' || g.matchSource === 'none'

  // How many rows in a group are unresolved (unmatched AND no row resolution).
  function unresolvedRowCount(g: PreviewGroup): number {
    let n = 0
    for (const a of g.assets) {
      if (a.resolvedAssetId) continue
      const key = `${g.key}:${a.rowNumber}`
      if (!rowResolutions[key]) n++
    }
    return n
  }

  // How many unmatched rows in this group have been decided (link/create/skip).
  function resolvedRowCount(g: PreviewGroup): number {
    let n = 0
    for (const a of g.assets) {
      if (a.resolvedAssetId) continue
      const key = `${g.key}:${a.rowNumber}`
      if (rowResolutions[key]) n++
    }
    return n
  }

  const totalRowsToReview = workingGroups.reduce(
    (n, g) => n + unresolvedRowCount(g),
    0,
  )
  const totalRowsResolved = workingGroups.reduce(
    (n, g) => n + resolvedRowCount(g),
    0,
  )

  // Count skipped rows across working groups (row-level skip).
  const totalRowsSkipped = workingGroups.reduce((n, g) => {
    let c = 0
    for (const a of g.assets) {
      const key = `${g.key}:${a.rowNumber}`
      if (rowResolutions[key]?.action === 'skip') c++
    }
    return n + c
  }, 0)

  // A group can commit when: site is resolved, frequency is known, maintenance plan
  // either auto-matches or user-resolved (accept/nominate/create), no dup WOs,
  // and every unmatched row either auto-resolves or has a row resolution.
  const unresolvedAfterUserChoice = workingGroups.filter((g) => {
    const r = resolutions[g.key]
    const planSettled = !needsResolution(g) || (r && r.action !== 'skip')
    const siteOk = !!g.siteId
    const freqOk = !!g.frequency
    const rowsOk = unresolvedRowCount(g) === 0
    const woOk = g.duplicateWorkOrderCount === 0
    return !(planSettled && siteOk && freqOk && rowsOk && woOk)
  }).length

  const canCommit =
    preview.parseErrors.length === 0 &&
    preview.unresolvedSiteCodes.length === 0 &&
    workingGroups.length > 0 &&
    unresolvedAfterUserChoice === 0

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Stat label="Rows parsed" value={preview.parsedRowCount.toString()} />
        <Stat
          label="Groups"
          value={
            skippedCount > 0
              ? `${workingGroups.length} / ${preview.groups.length}`
              : preview.groups.length.toString()
          }
          tone={skippedCount > 0 ? 'warn' : 'neutral'}
        />
        <Stat
          label="Assets matched"
          value={`${matchedAssets} / ${totalAssets}`}
          tone={unmatchedAssets > 0 ? 'warn' : 'ok'}
        />
        <Stat
          label="Duplicate WO#s"
          value={duplicateWOs.toString()}
          tone={duplicateWOs > 0 ? 'warn' : 'ok'}
        />
        <Stat
          label="Rows to review"
          value={
            totalRowsResolved > 0 || totalRowsSkipped > 0
              ? `${totalRowsToReview} (of ${totalRowsToReview + totalRowsResolved} · ${totalRowsSkipped} skipped)`
              : totalRowsToReview.toString()
          }
          tone={totalRowsToReview > 0 ? 'warn' : 'ok'}
        />
        <Stat
          label="Groups needing review"
          value={unresolvedAfterUserChoice.toString()}
          tone={unresolvedAfterUserChoice > 0 ? 'warn' : 'ok'}
        />
      </div>

      {/* Review-only filter */}
      <div className="flex items-center gap-3 text-xs">
        <label className="inline-flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showOnlyReview}
            onChange={(e) => setShowOnlyReview(e.target.checked)}
            className="accent-eq-sky"
          />
          <span className="text-eq-ink">
            Show only items that need review{' '}
            <span className="text-eq-grey">
              (hide auto-matched rows and settled groups)
            </span>
          </span>
        </label>
        {showOnlyReview && totalRowsToReview === 0 && unresolvedAfterUserChoice === 0 && (
          <span className="text-green-700 inline-flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Nothing left to review — ready to commit.
          </span>
        )}
      </div>

      {/* Parse errors */}
      {preview.parseErrors.length > 0 && (
        <Banner tone="error" icon={<AlertCircle className="w-4 h-4" />}>
          <p className="font-medium mb-1">
            {preview.parseErrors.length} row{preview.parseErrors.length === 1 ? '' : 's'} failed to parse —
            fix the sheet and re-upload.
          </p>
          <ul className="list-disc pl-5 space-y-0.5 text-xs">
            {preview.parseErrors.slice(0, 6).map((e, i) => (
              <li key={i}>
                Row {e.rowNumber}: {e.message}
              </li>
            ))}
            {preview.parseErrors.length > 6 && (
              <li className="text-eq-grey">…and {preview.parseErrors.length - 6} more</li>
            )}
          </ul>
        </Banner>
      )}

      {/* Unresolved sites */}
      {preview.unresolvedSiteCodes.length > 0 && (
        <Banner tone="warn" icon={<AlertTriangle className="w-4 h-4" />}>
          <p className="font-medium mb-1">
            Site code{preview.unresolvedSiteCodes.length === 1 ? '' : 's'} not found in EQ:{' '}
            <span className="font-mono">{preview.unresolvedSiteCodes.join(', ')}</span>
          </p>
          <p className="text-xs text-eq-grey">
            Create the site(s) in{' '}
            <Link href="/sites" className="underline hover:text-eq-deep">
              Sites
            </Link>{' '}
            with the matching <code>code</code>, then re-upload.
          </p>
        </Banner>
      )}

      {/* Unresolved maintenance plan codes — hide once the user has resolved every group */}
      {preview.unresolvedJobPlanCodes.length > 0 &&
        preview.groups.some(
          (g) =>
            (g.matchSource === 'fuzzy' || g.matchSource === 'none') && !resolutions[g.key],
        ) && (
        <Banner tone="warn" icon={<AlertTriangle className="w-4 h-4" />}>
          <p className="font-medium mb-1">
            {preview.unresolvedJobPlanCodes.length} maintenance plan code
            {preview.unresolvedJobPlanCodes.length === 1 ? '' : 's'} not found:{' '}
            <span className="font-mono">{preview.unresolvedJobPlanCodes.join(', ')}</span>
          </p>
          <p className="text-xs text-eq-grey">
            Check for fuzzy-match suggestions below, or add the missing plans in{' '}
            <Link href="/job-plans" className="underline hover:text-eq-deep">
              Maintenance Plans
            </Link>
            . After the next import you'll be prompted to create an alias.
          </p>
        </Banner>
      )}

      {/* Group list */}
      <div className="space-y-2">
        <h2 className="text-sm font-bold text-eq-grey uppercase tracking-wide">
          {workingGroups.length} Maintenance Check{workingGroups.length === 1 ? '' : 's'} to be created
          {skippedCount > 0 && (
            <span className="ml-2 text-eq-grey/80 normal-case font-normal">
              ({skippedCount} skipped)
            </span>
          )}
        </h2>
        {(() => {
          // When showOnlyReview is on, hide groups that have nothing to review —
          // no unresolved plan AND no unresolved rows AND no dup WOs.
          const visible = preview.groups.filter((g) => {
            if (!showOnlyReview) return true
            const r = resolutions[g.key]
            if (r?.action === 'skip') return false
            const planNeedsChoice = needsResolution(g) && !r
            const rowsNeedChoice = unresolvedRowCount(g) > 0
            const dupWO = g.duplicateWorkOrderCount > 0
            return planNeedsChoice || rowsNeedChoice || dupWO
          })

          if (visible.length === 0 && showOnlyReview) {
            return (
              <p className="text-xs text-eq-grey italic">
                All groups and rows are resolved. Uncheck &ldquo;Show only items that need review&rdquo;
                to see the full list.
              </p>
            )
          }

          return visible.map((g) => (
            <GroupCard
              key={g.key}
              group={g}
              sourceFilename={sourceByGroupKey?.get(g.key) ?? null}
              resolution={resolutions[g.key] ?? null}
              setResolution={(r) => setResolution(g.key, r)}
              plans={plans}
              plansLoading={plansLoading}
              plansError={plansError}
              onRequestPlans={ensurePlansLoaded}
              rowResolutions={rowResolutions}
              setRowResolution={setRowResolution}
              assetsForSite={g.siteId ? (assetsBySite[g.siteId] ?? null) : null}
              assetsLoading={g.siteId ? !!assetsSiteLoading[g.siteId] : false}
              assetsError={g.siteId ? (assetsSiteError[g.siteId] ?? null) : null}
              onRequestAssets={() => g.siteId ? ensureAssetsLoadedForSite(g.siteId) : Promise.resolve()}
              showOnlyReview={showOnlyReview}
            />
          ))
        })()}
      </div>

      {/* Commit bar */}
      <div className="sticky bottom-0 bg-white border-t border-gray-200 -mx-4 md:-mx-0 px-4 md:px-0 py-3 flex items-center justify-between gap-3">
        <p className="text-xs text-eq-grey">
          {canCommit
            ? (() => {
                const parts: string[] = []
                parts.push(
                  `${workingGroups.length} check${workingGroups.length === 1 ? '' : 's'}`,
                )
                if (totalRowsResolved > 0) {
                  const bits: string[] = []
                  const linked = Object.values(rowResolutions).filter((r) => r.action === 'link').length
                  const created = Object.values(rowResolutions).filter((r) => r.action === 'create').length
                  if (linked > 0) bits.push(`${linked} linked`)
                  if (created > 0) bits.push(`${created} to create`)
                  if (totalRowsSkipped > 0) bits.push(`${totalRowsSkipped} skipped`)
                  if (bits.length > 0) parts.push(bits.join(' · '))
                }
                if (skippedCount > 0) parts.push(`${skippedCount} group${skippedCount === 1 ? '' : 's'} skipped`)
                return `Ready to commit — ${parts.join(' · ')}.`
              })()
            : `Resolve the flagged items above before committing${totalRowsToReview > 0 ? ` (${totalRowsToReview} row${totalRowsToReview === 1 ? '' : 's'} need${totalRowsToReview === 1 ? 's' : ''} a decision)` : ''}.`}
        </p>
        <Button
          size="sm"
          disabled={!canCommit || isCommitting}
          onClick={onCommit}
          title={canCommit ? 'Create maintenance checks from this file' : 'Resolve warnings before committing'}
        >
          {isCommitting ? 'Committing…' : 'Commit import'}
        </Button>
      </div>
    </div>
  )
}

// ── Commit success screen ───────────────────────────────────────────────

function CommitSuccess({
  summary,
  onDone,
}: {
  summary: CommitSummary
  onDone: () => void
}) {
  return (
    <div className="space-y-4">
      <Banner tone="ok" icon={<CheckCircle2 className="w-4 h-4" />}>
        <p className="font-medium">
          Imported {summary.checksCreated} maintenance check
          {summary.checksCreated === 1 ? '' : 's'} · {summary.checkAssetsCreated} assets ·{' '}
          {summary.checkItemsCreated} tasks.
        </p>
        {(summary.rowsLinked > 0 || summary.rowsCreated > 0 || summary.rowsSkipped > 0) && (
          <p className="text-xs mt-1">
            Row resolutions applied:
            {summary.rowsLinked > 0 && ` ${summary.rowsLinked} linked ·`}
            {summary.rowsCreated > 0 && ` ${summary.rowsCreated} assets created ·`}
            {summary.rowsSkipped > 0 && ` ${summary.rowsSkipped} skipped`}
          </p>
        )}
      </Banner>

      <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
        <table className="min-w-full text-xs">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr className="text-left text-eq-grey uppercase tracking-wide">
              <th className="px-3 py-2 font-bold">Check</th>
              <th className="px-3 py-2 font-bold">Site</th>
              <th className="px-3 py-2 font-bold">Plan</th>
              <th className="px-3 py-2 font-bold">Frequency</th>
              <th className="px-3 py-2 font-bold">Start</th>
              <th className="px-3 py-2 font-bold text-right">Assets</th>
              <th className="px-3 py-2 font-bold text-right">Tasks</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {summary.groupsCreated.map((g) => (
              <tr key={g.checkId} className="border-t border-gray-100">
                <td className="px-3 py-1.5 text-eq-ink">{g.customName}</td>
                <td className="px-3 py-1.5 font-mono">{g.siteCode}</td>
                <td className="px-3 py-1.5 font-mono">{g.jobPlanCode}</td>
                <td className="px-3 py-1.5 text-eq-grey">{g.frequency}</td>
                <td className="px-3 py-1.5 text-eq-grey">{g.startDate}</td>
                <td className="px-3 py-1.5 text-right">{g.assetCount}</td>
                <td className="px-3 py-1.5 text-right">{g.taskCount}</td>
                <td className="px-3 py-1.5">
                  <Link
                    href={`/maintenance/${g.checkId}`}
                    className="text-eq-sky hover:text-eq-deep underline"
                  >
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" onClick={onDone}>
          Import another file
        </Button>
        <Link href="/maintenance">
          <Button size="sm">Go to Maintenance</Button>
        </Link>
      </div>
    </div>
  )
}

// ── Group card ──────────────────────────────────────────────────────────

function GroupCard({
  group,
  sourceFilename,
  resolution,
  setResolution,
  plans,
  plansLoading,
  plansError,
  onRequestPlans,
  rowResolutions,
  setRowResolution,
  assetsForSite,
  assetsLoading,
  assetsError,
  onRequestAssets,
  showOnlyReview,
}: {
  group: PreviewGroup
  sourceFilename?: string | null
  resolution: GroupResolution | null
  setResolution: (resolution: GroupResolution | null) => void
  plans: JobPlanOption[] | null
  plansLoading: boolean
  plansError: string | null
  onRequestPlans: () => Promise<void>
  rowResolutions: RowResolutionsMap
  setRowResolution: (rowKey: string, resolution: RowResolution | null) => void
  assetsForSite: AssetOption[] | null
  assetsLoading: boolean
  assetsError: string | null
  onRequestAssets: () => Promise<void>
  showOnlyReview: boolean
}) {
  // Auto-expand groups that still have something needing review so the user
  // can act without hunting. Fuzzy/none plan matches OR unresolved rows.
  const unresolvedRowsInGroup = group.assets.filter(
    (a) => !a.resolvedAssetId && !rowResolutions[`${group.key}:${a.rowNumber}`],
  ).length
  const autoExpand =
    group.matchSource === 'fuzzy' ||
    group.matchSource === 'none' ||
    unresolvedRowsInGroup > 0
  const [open, setOpen] = useState(autoExpand)

  const needsResolution =
    group.matchSource === 'fuzzy' || group.matchSource === 'none'
  const isSkipped = resolution?.action === 'skip'

  const hasHardIssue =
    !group.siteId ||
    (needsResolution && !resolution) ||
    !group.frequency ||
    unresolvedRowsInGroup > 0 ||
    group.duplicateWorkOrderCount > 0

  return (
    <div
      className={`border rounded-lg bg-white overflow-hidden ${
        isSkipped
          ? 'border-gray-200 opacity-60'
          : hasHardIssue
            ? 'border-amber-300'
            : 'border-gray-200'
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 p-3 text-left hover:bg-gray-50"
      >
        {open ? (
          <ChevronDown className="w-4 h-4 text-eq-grey shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-eq-grey shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-eq-ink">
              {group.siteCode}
            </span>
            <span className="text-eq-grey">·</span>
            <span className="text-sm font-mono text-eq-deep">{group.jobPlanCode}</span>
            {group.matchSource === 'alias' && (
              <Badge tone="info">alias: {group.jobPlanCodeRaw}</Badge>
            )}
            {group.matchSource === 'fuzzy' && group.fuzzyCandidate && (
              <Badge tone="warn">
                fuzzy: {group.jobPlanCodeRaw} → {group.fuzzyCandidate.code}
              </Badge>
            )}
            {group.matchSource === 'none' && <Badge tone="error">no match</Badge>}
            <ResolutionBadge resolution={resolution} />
            <span className="text-eq-grey">·</span>
            <span className="text-xs text-eq-grey">
              {group.frequency ?? `(unknown: ${group.frequencySuffix})`}
            </span>
            <span className="text-eq-grey">·</span>
            <span className="text-xs text-eq-grey">{group.startDate}</span>
            {sourceFilename && (
              <>
                <span className="text-eq-grey">·</span>
                <span
                  className="inline-flex items-center gap-1 text-xs text-eq-grey font-normal"
                  title={`Source: ${sourceFilename}`}
                >
                  <FileText className="w-3 h-3 shrink-0" />
                  <span className="truncate max-w-[200px]">{sourceFilename}</span>
                </span>
              </>
            )}
          </div>
          <div className="text-xs text-eq-grey mt-0.5">
            {group.assetCount} asset{group.assetCount === 1 ? '' : 's'}
            {group.matchedAssetCount < group.assetCount && (
              <>
                {' · '}
                <span className="text-amber-700">
                  {group.unmatchedAssetCount} unmatched
                </span>
              </>
            )}
            {group.duplicateWorkOrderCount > 0 && (
              <>
                {' · '}
                <span className="text-amber-700">
                  {group.duplicateWorkOrderCount} duplicate WO#
                </span>
              </>
            )}
            {group.jobPlanName && (
              <span className="text-eq-grey"> · {group.jobPlanName}</span>
            )}
          </div>
        </div>

        <StatusIcon
          hasIssue={hasHardIssue}
          resolved={!hasHardIssue && (!!resolution || !needsResolution)}
          skipped={isSkipped}
        />
      </button>

      {open && (
        <div className="border-t border-gray-200 bg-gray-50">
          {/* Group actions — only offered when the plan needs resolution */}
          {needsResolution && (
            <GroupActions
              group={group}
              resolution={resolution}
              setResolution={setResolution}
              plans={plans}
              plansLoading={plansLoading}
              plansError={plansError}
              onRequestPlans={onRequestPlans}
            />
          )}

          {group.issues.length > 0 && (
            <div className="px-4 py-2 bg-amber-50 border-b border-amber-200">
              <ul className="text-xs text-amber-800 space-y-0.5">
                {group.issues.map((issue, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{issue}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="overflow-auto max-h-[32rem]">
            <table className="min-w-full text-xs">
              <thead className="bg-white sticky top-0 z-10 border-b border-gray-200">
                <tr className="text-left text-eq-grey uppercase tracking-wide">
                  <th className="px-3 py-2 font-bold">Row</th>
                  <th className="px-3 py-2 font-bold">WO#</th>
                  <th className="px-3 py-2 font-bold">Maximo ID</th>
                  <th className="px-3 py-2 font-bold">Description</th>
                  <th className="px-3 py-2 font-bold">Location</th>
                  <th className="px-3 py-2 font-bold">EQ Asset</th>
                  <th className="px-3 py-2 font-bold w-1"></th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const visibleRows = group.assets.filter((a) => {
                    if (!showOnlyReview) return true
                    // When filtering: only show rows that still need a decision.
                    if (a.resolvedAssetId) return false
                    if (rowResolutions[`${group.key}:${a.rowNumber}`]) return false
                    return true
                  })
                  if (visibleRows.length === 0) {
                    return (
                      <tr className="border-t border-gray-100 bg-white">
                        <td
                          colSpan={7}
                          className="px-3 py-3 text-center text-eq-grey italic"
                        >
                          No rows need review in this group.
                        </td>
                      </tr>
                    )
                  }
                  return visibleRows.map((a) => {
                    const rowKey = `${group.key}:${a.rowNumber}`
                    const rr = rowResolutions[rowKey] ?? null
                    return (
                      <RowRow
                        key={a.rowNumber}
                        asset={a}
                        rowKey={rowKey}
                        rowResolution={rr}
                        setRowResolution={setRowResolution}
                        assetsForSite={assetsForSite}
                        assetsLoading={assetsLoading}
                        assetsError={assetsError}
                        onRequestAssets={onRequestAssets}
                        siteId={group.siteId}
                      />
                    )
                  })
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Per-row row component ───────────────────────────────────────────────

function RowRow({
  asset,
  rowKey,
  rowResolution,
  setRowResolution,
  assetsForSite,
  assetsLoading,
  assetsError,
  onRequestAssets,
  siteId,
}: {
  asset: {
    rowNumber: number
    workOrder: string
    maximoAssetId: string
    description: string
    location: string | null
    resolvedAssetId: string | null
    resolvedAssetName: string | null
    duplicateWorkOrder: boolean
    warnings: string[]
  }
  rowKey: string
  rowResolution: RowResolution | null
  setRowResolution: (rowKey: string, resolution: RowResolution | null) => void
  assetsForSite: AssetOption[] | null
  assetsLoading: boolean
  assetsError: string | null
  onRequestAssets: () => Promise<void>
  siteId: string | null
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const linked =
    rowResolution?.action === 'link'
      ? assetsForSite?.find((x) => x.id === rowResolution.assetId) ?? null
      : null

  const showActions = !asset.resolvedAssetId
  const bg =
    rowResolution?.action === 'skip'
      ? 'bg-gray-50 text-eq-grey'
      : rowResolution
        ? 'bg-eq-ice/40'
        : !asset.resolvedAssetId
          ? 'bg-amber-50/40'
          : 'bg-white'

  return (
    <>
      <tr className={`border-t border-gray-100 ${bg}`}>
        <td className="px-3 py-1.5 text-eq-grey align-top">{asset.rowNumber}</td>
        <td className="px-3 py-1.5 font-mono align-top">
          {asset.workOrder}
          {asset.duplicateWorkOrder && (
            <span className="ml-1.5 text-amber-700">(dup)</span>
          )}
        </td>
        <td className="px-3 py-1.5 font-mono align-top">{asset.maximoAssetId}</td>
        <td className="px-3 py-1.5 text-eq-ink align-top">{asset.description || '—'}</td>
        <td className="px-3 py-1.5 text-eq-grey align-top">{asset.location ?? '—'}</td>
        <td className="px-3 py-1.5 align-top">
          {asset.resolvedAssetId ? (
            <span className="inline-flex items-center gap-1 text-green-700">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {asset.resolvedAssetName ?? asset.resolvedAssetId}
            </span>
          ) : rowResolution?.action === 'link' && linked ? (
            <span className="inline-flex items-center gap-1 text-green-700">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Linked — {linked.name}
            </span>
          ) : rowResolution?.action === 'link' ? (
            <span className="inline-flex items-center gap-1 text-green-700">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Linked
            </span>
          ) : rowResolution?.action === 'create' ? (
            <span className="inline-flex items-center gap-1 text-eq-deep">
              <Plus className="w-3.5 h-3.5" />
              Will create — {asset.description || asset.maximoAssetId}
            </span>
          ) : rowResolution?.action === 'skip' ? (
            <span className="inline-flex items-center gap-1 text-eq-grey">
              <SkipForward className="w-3.5 h-3.5" />
              Skipped
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-amber-700">
              <AlertTriangle className="w-3.5 h-3.5" />
              no match
            </span>
          )}
        </td>
        <td className="px-3 py-1.5 align-top whitespace-nowrap">
          {showActions && (
            <div className="inline-flex items-center gap-1">
              <RowActionButton
                active={rowResolution?.action === 'link'}
                icon={<Search className="w-3 h-3" />}
                onClick={async () => {
                  if (!siteId) return
                  if (rowResolution?.action === 'link') {
                    setRowResolution(rowKey, null)
                    setPickerOpen(false)
                    return
                  }
                  await onRequestAssets()
                  setPickerOpen(true)
                }}
              >
                Link
              </RowActionButton>
              <RowActionButton
                active={rowResolution?.action === 'create'}
                icon={<Plus className="w-3 h-3" />}
                onClick={() => {
                  if (rowResolution?.action === 'create') {
                    setRowResolution(rowKey, null)
                  } else {
                    setRowResolution(rowKey, { action: 'create' })
                    setPickerOpen(false)
                  }
                }}
              >
                Create
              </RowActionButton>
              <RowActionButton
                active={rowResolution?.action === 'skip'}
                tone="muted"
                icon={<SkipForward className="w-3 h-3" />}
                onClick={() => {
                  if (rowResolution?.action === 'skip') {
                    setRowResolution(rowKey, null)
                  } else {
                    setRowResolution(rowKey, { action: 'skip' })
                    setPickerOpen(false)
                  }
                }}
              >
                Skip
              </RowActionButton>
              {rowResolution && (
                <button
                  type="button"
                  onClick={() => {
                    setRowResolution(rowKey, null)
                    setPickerOpen(false)
                  }}
                  className="ml-1 text-[10px] text-eq-grey hover:text-eq-deep underline"
                >
                  Clear
                </button>
              )}
            </div>
          )}
        </td>
      </tr>
      {pickerOpen && rowResolution?.action !== 'create' && rowResolution?.action !== 'skip' && (
        <tr className="border-t border-gray-100 bg-white">
          <td colSpan={7} className="px-3 py-2">
            <AssetPicker
              assets={assetsForSite}
              loading={assetsLoading}
              error={assetsError}
              selectedId={rowResolution?.action === 'link' ? rowResolution.assetId : null}
              onPick={(assetId) => {
                setRowResolution(rowKey, { action: 'link', assetId })
                setPickerOpen(false)
              }}
              onCancel={() => setPickerOpen(false)}
            />
          </td>
        </tr>
      )}
    </>
  )
}

function RowActionButton({
  active,
  tone = 'primary',
  icon,
  children,
  onClick,
}: {
  active: boolean
  tone?: 'primary' | 'muted'
  icon: React.ReactNode
  children: React.ReactNode
  onClick: () => void
}) {
  const base =
    'inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium transition-colors'
  const cls = active
    ? tone === 'muted'
      ? 'bg-gray-600 text-white border-gray-600'
      : 'bg-eq-sky text-white border-eq-sky'
    : 'bg-white text-eq-ink border-gray-300 hover:border-eq-sky hover:text-eq-deep'
  return (
    <button type="button" onClick={onClick} className={`${base} ${cls}`}>
      {icon}
      {children}
    </button>
  )
}

// ── Asset picker (searchable) ───────────────────────────────────────────

function AssetPicker({
  assets,
  loading,
  error,
  selectedId,
  onPick,
  onCancel,
}: {
  assets: AssetOption[] | null
  loading: boolean
  error: string | null
  selectedId: string | null
  onPick: (assetId: string) => void
  onCancel: () => void
}) {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    if (!assets) return []
    const q = query.trim().toLowerCase()
    if (!q) return assets.slice(0, 100)
    return assets
      .filter((a) => {
        const name = a.name.toLowerCase()
        const mx = (a.maximoId ?? '').toLowerCase()
        const loc = (a.location ?? '').toLowerCase()
        return name.includes(q) || mx.includes(q) || loc.includes(q)
      })
      .slice(0, 100)
  }, [assets, query])

  return (
    <div className="border border-gray-200 rounded-md overflow-hidden">
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-gray-200 bg-white">
        <Search className="w-3.5 h-3.5 text-eq-grey shrink-0" />
        <input
          type="text"
          placeholder="Search asset by name, Maximo ID, or location…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 bg-transparent text-xs text-eq-ink placeholder-eq-grey/70 focus:outline-none"
          autoFocus
        />
        {loading && <span className="text-[10px] text-eq-grey">loading…</span>}
        <button
          type="button"
          onClick={onCancel}
          className="text-[11px] text-eq-grey hover:text-eq-deep inline-flex items-center gap-1"
        >
          <X className="w-3 h-3" /> Cancel
        </button>
      </div>
      {error && (
        <div className="px-3 py-2 text-xs text-red-700 bg-red-50">{error}</div>
      )}
      <div className="max-h-48 overflow-auto bg-white">
        {assets === null ? (
          <div className="px-3 py-3 text-xs text-eq-grey">Loading assets…</div>
        ) : filtered.length === 0 ? (
          <div className="px-3 py-3 text-xs text-eq-grey">
            No matching assets at this site.
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {filtered.map((a) => {
              const isPicked = a.id === selectedId
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => onPick(a.id)}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-eq-ice/50 ${
                      isPicked ? 'bg-eq-ice/70' : ''
                    }`}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-eq-deep shrink-0">
                        {a.maximoId ?? '—'}
                      </span>
                      <span className="text-eq-ink truncate">{a.name}</span>
                      {a.location && (
                        <span className="text-eq-grey text-[10px] ml-auto truncate shrink">
                          {a.location}
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

// ── Tiny primitives ─────────────────────────────────────────────────────

function Stat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'neutral' | 'ok' | 'warn'
}) {
  const toneCls =
    tone === 'ok'
      ? 'text-green-700'
      : tone === 'warn'
        ? 'text-amber-700'
        : 'text-eq-ink'
  return (
    <div className="border border-gray-200 bg-white rounded-md px-3 py-2">
      <p className="text-[10px] text-eq-grey uppercase tracking-wide font-bold">
        {label}
      </p>
      <p className={`text-lg font-bold ${toneCls}`}>{value}</p>
    </div>
  )
}

function Banner({
  tone,
  icon,
  children,
}: {
  tone: 'warn' | 'error' | 'ok'
  icon: React.ReactNode
  children: React.ReactNode
}) {
  const cls =
    tone === 'error'
      ? 'bg-red-50 border-red-200 text-red-800'
      : tone === 'warn'
        ? 'bg-amber-50 border-amber-200 text-amber-800'
        : 'bg-green-50 border-green-200 text-green-800'
  return (
    <div className={`border rounded-md p-3 text-sm ${cls}`}>
      <div className="flex items-start gap-2">
        <span className="shrink-0 mt-0.5">{icon}</span>
        <div className="flex-1">{children}</div>
      </div>
    </div>
  )
}

function Badge({
  tone,
  children,
}: {
  tone: 'info' | 'warn' | 'error' | 'ok' | 'muted'
  children: React.ReactNode
}) {
  const cls =
    tone === 'info'
      ? 'bg-eq-ice text-eq-deep border-eq-sky/30'
      : tone === 'warn'
        ? 'bg-amber-50 text-amber-800 border-amber-200'
        : tone === 'error'
          ? 'bg-red-50 text-red-800 border-red-200'
          : tone === 'ok'
            ? 'bg-green-50 text-green-800 border-green-200'
            : 'bg-gray-100 text-gray-600 border-gray-200'
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 border rounded ${cls}`}
    >
      {children}
    </span>
  )
}

function StatusIcon({
  hasIssue,
  resolved,
  skipped,
}: {
  hasIssue: boolean
  resolved?: boolean
  skipped?: boolean
}) {
  if (skipped) return <SkipForward className="w-4 h-4 text-eq-grey shrink-0" />
  if (resolved) return <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
  if (hasIssue) return <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
  return <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
}

// ── Resolution badge — surfaced on the group header ─────────────────────

function ResolutionBadge({ resolution }: { resolution: GroupResolution | null }) {
  if (!resolution) return null
  switch (resolution.action) {
    case 'accept':
      return <Badge tone="ok">accepted</Badge>
    case 'nominate':
      return <Badge tone="ok">nominated</Badge>
    case 'create':
      return (
        <Badge tone="ok">
          will create <span className="font-mono">{resolution.code}</span>
        </Badge>
      )
    case 'skip':
      return <Badge tone="muted">skipped</Badge>
  }
}

// ── Group actions row ───────────────────────────────────────────────────

function GroupActions({
  group,
  resolution,
  setResolution,
  plans,
  plansLoading,
  plansError,
  onRequestPlans,
}: {
  group: PreviewGroup
  resolution: GroupResolution | null
  setResolution: (resolution: GroupResolution | null) => void
  plans: JobPlanOption[] | null
  plansLoading: boolean
  plansError: string | null
  onRequestPlans: () => Promise<void>
}) {
  // Which inline sub-form is currently showing.
  const [mode, setMode] = useState<'none' | 'nominate' | 'create'>('none')

  // Keep mode in sync with an externally-applied resolution.
  useEffect(() => {
    if (!resolution) setMode('none')
    else if (resolution.action === 'nominate') setMode('nominate')
    else if (resolution.action === 'create') setMode('create')
    else setMode('none')
  }, [resolution])

  const acceptCandidate = group.fuzzyCandidate
  const canAccept = !!acceptCandidate

  return (
    <div className="px-4 py-3 bg-eq-ice/40 border-b border-eq-sky/30 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-bold text-eq-grey uppercase tracking-wide">
          Group actions
        </span>

        {canAccept && (
          <ActionButton
            active={resolution?.action === 'accept'}
            onClick={() => {
              setMode('none')
              setResolution(resolution?.action === 'accept' ? null : { action: 'accept' })
            }}
            icon={<Check className="w-3.5 h-3.5" />}
          >
            Accept "{acceptCandidate!.code}"
          </ActionButton>
        )}

        <ActionButton
          active={resolution?.action === 'nominate'}
          onClick={async () => {
            await onRequestPlans()
            if (resolution?.action === 'nominate') {
              setResolution(null)
              setMode('none')
            } else {
              setMode('nominate')
            }
          }}
          icon={<Search className="w-3.5 h-3.5" />}
        >
          Nominate existing
        </ActionButton>

        <ActionButton
          active={resolution?.action === 'create'}
          onClick={() => {
            if (resolution?.action === 'create') {
              setResolution(null)
              setMode('none')
            } else {
              setMode('create')
            }
          }}
          icon={<Plus className="w-3.5 h-3.5" />}
        >
          Create maintenance plan
        </ActionButton>

        <ActionButton
          active={resolution?.action === 'skip'}
          tone="muted"
          onClick={() => {
            setMode('none')
            setResolution(resolution?.action === 'skip' ? null : { action: 'skip' })
          }}
          icon={<SkipForward className="w-3.5 h-3.5" />}
        >
          Skip group
        </ActionButton>

        {resolution && (
          <button
            type="button"
            onClick={() => {
              setResolution(null)
              setMode('none')
            }}
            className="ml-auto text-[11px] text-eq-grey hover:text-eq-deep underline"
          >
            Clear
          </button>
        )}
      </div>

      {/* Inline sub-forms */}
      {mode === 'nominate' && (
        <PlanCombobox
          plans={plans}
          plansLoading={plansLoading}
          plansError={plansError}
          onRequestPlans={onRequestPlans}
          selectedId={resolution?.action === 'nominate' ? resolution.jobPlanId : null}
          onPick={(planId) => setResolution({ action: 'nominate', jobPlanId: planId })}
        />
      )}

      {mode === 'create' && (
        <CreatePlanInline
          defaultCode={group.jobPlanCodeRaw}
          current={resolution?.action === 'create' ? resolution : null}
          onApply={(code, name, type) =>
            setResolution({ action: 'create', code, name, type: type || null })
          }
          onClear={() => setResolution(null)}
        />
      )}
    </div>
  )
}

// ── Action button ───────────────────────────────────────────────────────

function ActionButton({
  active,
  tone = 'primary',
  icon,
  children,
  onClick,
}: {
  active: boolean
  tone?: 'primary' | 'muted'
  icon: React.ReactNode
  children: React.ReactNode
  onClick: () => void
}) {
  const base =
    'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors'
  const cls = active
    ? tone === 'muted'
      ? 'bg-gray-600 text-white border-gray-600'
      : 'bg-eq-sky text-white border-eq-sky'
    : 'bg-white text-eq-ink border-gray-300 hover:border-eq-sky hover:text-eq-deep'
  return (
    <button type="button" onClick={onClick} className={`${base} ${cls}`}>
      {icon}
      {children}
    </button>
  )
}

// ── Plan combobox (searchable dropdown for Nominate) ────────────────────

function PlanCombobox({
  plans,
  plansLoading,
  plansError,
  onRequestPlans,
  selectedId,
  onPick,
}: {
  plans: JobPlanOption[] | null
  plansLoading: boolean
  plansError: string | null
  onRequestPlans: () => Promise<void>
  selectedId: string | null
  onPick: (planId: string) => void
}) {
  const [query, setQuery] = useState('')

  useEffect(() => {
    void onRequestPlans()
  }, [onRequestPlans])

  const filtered = useMemo(() => {
    if (!plans) return []
    const q = query.trim().toLowerCase()
    if (!q) return plans.slice(0, 50)
    return plans
      .filter((p) => {
        const code = (p.code ?? '').toLowerCase()
        const name = p.name.toLowerCase()
        const type = (p.type ?? '').toLowerCase()
        return code.includes(q) || name.includes(q) || type.includes(q)
      })
      .slice(0, 50)
  }, [plans, query])

  const selected = plans?.find((p) => p.id === selectedId) ?? null

  return (
    <div className="bg-white border border-gray-200 rounded-md overflow-hidden">
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-gray-200">
        <Search className="w-3.5 h-3.5 text-eq-grey shrink-0" />
        <input
          type="text"
          placeholder="Search by code, name, or type…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 bg-transparent text-xs text-eq-ink placeholder-eq-grey/70 focus:outline-none"
          autoFocus
        />
        {plansLoading && <span className="text-[10px] text-eq-grey">loading…</span>}
      </div>

      {plansError && (
        <div className="px-3 py-2 text-xs text-red-700 bg-red-50">{plansError}</div>
      )}

      {selected && (
        <div className="px-3 py-1.5 flex items-center gap-2 bg-eq-ice/70 border-b border-eq-sky/30">
          <Check className="w-3.5 h-3.5 text-green-700" />
          <span className="text-xs">
            <span className="font-mono text-eq-deep">{selected.code ?? '—'}</span>
            <span className="text-eq-grey"> — </span>
            <span className="text-eq-ink">{selected.name}</span>
          </span>
        </div>
      )}

      <div className="max-h-48 overflow-auto">
        {filtered.length === 0 ? (
          <div className="px-3 py-3 text-xs text-eq-grey">
            {plans === null ? 'Loading plans…' : 'No matching plans.'}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {filtered.map((p) => {
              const isPicked = p.id === selectedId
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onPick(p.id)}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-eq-ice/50 ${
                      isPicked ? 'bg-eq-ice/70' : ''
                    }`}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-eq-deep shrink-0">
                        {p.code ?? '—'}
                      </span>
                      <span className="text-eq-ink truncate">{p.name}</span>
                      {p.type && (
                        <span className="text-eq-grey text-[10px] ml-auto truncate shrink">
                          {p.type}
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

// ── Inline "Create new plan" form ───────────────────────────────────────

function CreatePlanInline({
  defaultCode,
  current,
  onApply,
  onClear,
}: {
  defaultCode: string
  current: Extract<GroupResolution, { action: 'create' }> | null
  onApply: (code: string, name: string, type: string) => void
  onClear: () => void
}) {
  const [code, setCode] = useState(current?.code ?? defaultCode)
  const [name, setName] = useState(current?.name ?? '')
  const [type, setType] = useState(current?.type ?? '')

  const dirty =
    !current ||
    current.code !== code.trim() ||
    current.name !== name.trim() ||
    (current.type ?? '') !== type.trim()

  const canApply = code.trim().length > 0 && name.trim().length > 0

  return (
    <div className="bg-white border border-gray-200 rounded-md p-3 space-y-2">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <FieldInput
          label="Code"
          value={code}
          onChange={setCode}
          mono
          placeholder="e.g. LTSWBD"
        />
        <FieldInput
          label="Name"
          value={name}
          onChange={setName}
          placeholder="e.g. Low Tension Switchboard"
        />
        <FieldInput
          label="Type (optional)"
          value={type}
          onChange={setType}
          placeholder="e.g. Annual"
        />
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={!canApply || !dirty}
          onClick={() => onApply(code.trim(), name.trim(), type.trim())}
        >
          {current ? 'Update' : 'Apply'}
        </Button>
        {current && (
          <button
            type="button"
            onClick={onClear}
            className="text-[11px] text-eq-grey hover:text-eq-deep inline-flex items-center gap-1"
          >
            <X className="w-3 h-3" /> Discard
          </button>
        )}
        <p className="ml-auto text-[11px] text-eq-grey">
          A tenant-global plan will be created (no items — add later under Maintenance Plans).
        </p>
      </div>
    </div>
  )
}

function FieldInput({
  label,
  value,
  onChange,
  placeholder,
  mono,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  mono?: boolean
}) {
  return (
    <label className="block">
      <span className="block text-[10px] font-bold text-eq-grey uppercase tracking-wide mb-0.5">
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full px-2 py-1 text-xs border border-gray-300 rounded-md focus:outline-none focus:border-eq-sky ${
          mono ? 'font-mono' : ''
        }`}
      />
    </label>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
