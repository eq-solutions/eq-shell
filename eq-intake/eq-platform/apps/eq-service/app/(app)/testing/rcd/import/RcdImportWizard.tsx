'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Upload,
  FileText,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import {
  previewJemenaRcdImportAction,
  commitJemenaRcdImportAction,
  type RcdImportPreviewResult,
  type RcdImportCommitSummary,
} from './actions'
import { checkImportFileSize } from '@/lib/utils/file-size-guard'
import { downloadImportErrorCsv, type ImportErrorRow } from '@/lib/utils/import-error-csv'

/**
 * Jemena RCD xlsx import wizard.
 *
 * Step 1 — Upload a file -> previewJemenaRcdImportAction
 * Step 2 — Review per-board resolution + warnings
 * Step 3 — Commit -> commitJemenaRcdImportAction; show summary
 */
export function RcdImportWizard() {
  const router = useRouter()
  const fileInput = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<RcdImportPreviewResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [commitResult, setCommitResult] = useState<RcdImportCommitSummary | null>(null)
  const [isPending, startTransition] = useTransition()
  const [isCommitting, startCommit] = useTransition()

  function handleChoose(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null
    setPreview(null)
    setCommitResult(null)
    if (picked) {
      const sizeError = checkImportFileSize(picked)
      if (sizeError) {
        setError(sizeError)
        setFile(null)
        if (fileInput.current) fileInput.current.value = ''
        return
      }
    }
    setError(null)
    setFile(picked)
  }

  function handlePreview() {
    if (!file) return
    setError(null)
    setCommitResult(null)
    startTransition(async () => {
      const fd = new FormData()
      fd.append('file', file)
      const result = await previewJemenaRcdImportAction(fd)
      if (!result.success) {
        setError(result.error)
        setPreview(null)
        return
      }
      setPreview(result)
    })
  }

  function handleCommit() {
    if (!file) return
    setError(null)
    startCommit(async () => {
      const fd = new FormData()
      fd.append('file', file)
      const mutationId = cryptoRandomId()
      const result = await commitJemenaRcdImportAction(fd, mutationId)
      if (!result.success) {
        setError(result.error)
        return
      }
      setCommitResult(result.data ?? null)
      router.refresh()
    })
  }

  function handleReset() {
    setFile(null)
    setPreview(null)
    setError(null)
    setCommitResult(null)
    if (fileInput.current) fileInput.current.value = ''
  }

  // Counts surfaced on the commit bar.
  const importableCount = preview
    ? preview.boards.filter(
        (b) =>
          b.resolvedSiteId &&
          b.resolvedAssetId &&
          b.testDate &&
          b.circuitCount > 0 &&
          !b.duplicate,
      ).length
    : 0
  const skippedCount = preview ? preview.boardCount - importableCount : 0

  return (
    <div className="space-y-5">
      {/* Upload strip */}
      <div className="border border-gray-200 rounded-lg bg-white p-4">
        <div className="flex items-center gap-3">
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx"
            onChange={handleChoose}
            className="hidden"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => fileInput.current?.click()}
          >
            <Upload className="w-4 h-4 mr-1.5" />
            {file ? 'Change file' : 'Choose .xlsx'}
          </Button>
          {file && (
            <div className="flex items-center gap-2 text-sm text-eq-ink">
              <FileText className="w-4 h-4 text-eq-sky" />
              <span className="font-medium">{file.name}</span>
              <span className="text-eq-grey">({formatBytes(file.size)})</span>
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            {(preview || commitResult) && (
              <Button variant="secondary" size="sm" onClick={handleReset}>
                Start over
              </Button>
            )}
            <Button size="sm" disabled={!file || isPending} onClick={handlePreview}>
              {isPending ? 'Parsing…' : preview ? 'Re-parse' : 'Preview'}
            </Button>
          </div>
        </div>

        {error && (
          <div className="mt-3 bg-red-50 border border-red-200 rounded-md p-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}
      </div>

      {/* Commit success */}
      {commitResult && (
        <div className="border border-green-200 bg-green-50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="w-5 h-5 text-green-700" />
            <h3 className="text-sm font-bold text-green-900">Import complete</h3>
          </div>
          <div className="text-sm text-green-800 space-y-1">
            <div>
              <strong>{commitResult.testsCreated}</strong> RCD test record
              {commitResult.testsCreated === 1 ? '' : 's'} created
            </div>
            <div>
              <strong>{commitResult.circuitsCreated}</strong> circuit
              {commitResult.circuitsCreated === 1 ? '' : 's'} stored
            </div>
            {commitResult.checksCreated > 0 && (
              <div>
                <strong>{commitResult.checksCreated}</strong> maintenance check
                {commitResult.checksCreated === 1 ? '' : 's'} created and linked
              </div>
            )}
            {commitResult.boardsSkipped > 0 && (
              <div className="text-amber-700">
                <strong>{commitResult.boardsSkipped}</strong> board
                {commitResult.boardsSkipped === 1 ? '' : 's'} skipped (unmatched site/asset, missing date, or duplicate)
              </div>
            )}
            <div className="pt-2 flex gap-4">
              <a
                href="/testing/rcd"
                className="text-eq-deep hover:text-eq-sky underline"
              >
                View RCD test records →
              </a>
              {commitResult.checksCreated > 0 && (
                <a
                  href="/maintenance"
                  className="text-eq-deep hover:text-eq-sky underline"
                >
                  View maintenance checks →
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Preview */}
      {preview && !commitResult && (
        <div className="space-y-4">
          {/* Summary strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Boards parsed" value={String(preview.boardCount)} />
            <Stat label="Total circuits" value={String(preview.totalCircuits)} />
            <Stat label="Importable" value={String(importableCount)} tone="ok" />
            <Stat
              label="Skipped"
              value={String(skippedCount)}
              tone={skippedCount > 0 ? 'warn' : undefined}
            />
          </div>

          {/* Skipped sheets */}
          {preview.skippedSheets.length > 0 && (
            <div className="border border-amber-200 bg-amber-50 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <AlertCircle className="w-4 h-4 text-amber-700" />
                <h4 className="text-xs font-bold text-amber-900 uppercase tracking-wide">
                  {preview.skippedSheets.length} sheet
                  {preview.skippedSheets.length === 1 ? '' : 's'} skipped
                </h4>
              </div>
              <ul className="text-xs text-amber-800 space-y-0.5 list-disc list-inside">
                {preview.skippedSheets.map((s) => (
                  <li key={s.tabName}>
                    <code className="text-amber-900 font-mono">{s.tabName}</code> — {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Parse errors */}
          {preview.parseErrors.length > 0 && (
            <div className="border border-red-200 bg-red-50 rounded-lg p-3">
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-700" />
                  <h4 className="text-xs font-bold text-red-900 uppercase tracking-wide">
                    {preview.parseErrors.length} parse error
                    {preview.parseErrors.length === 1 ? '' : 's'}
                  </h4>
                </div>
                <button
                  type="button"
                  className="text-xs font-semibold text-red-900 underline hover:no-underline"
                  onClick={() => {
                    const rows: ImportErrorRow[] = [
                      ...preview.skippedSheets.map((s) => ({
                        rowRef: s.tabName,
                        context: 'skipped sheet',
                        reason: s.reason,
                      })),
                      ...preview.parseErrors.map((e) => ({
                        rowRef: `${e.tabName}:${e.rowNumber}`,
                        context: e.tabName,
                        reason: e.message,
                      })),
                    ]
                    const base = (file?.name ?? 'rcd-import').replace(/\.xlsx$/i, '')
                    downloadImportErrorCsv(rows, `${base}_errors.csv`)
                  }}
                >
                  Download error report (CSV)
                </button>
              </div>
              <ul className="text-xs text-red-800 space-y-0.5 list-disc list-inside">
                {preview.parseErrors.slice(0, 12).map((e, i) => (
                  <li key={i}>
                    <code className="font-mono text-red-900">
                      {e.tabName}:{e.rowNumber}
                    </code> — {e.message}
                  </li>
                ))}
                {preview.parseErrors.length > 12 && (
                  <li>(+{preview.parseErrors.length - 12} more)</li>
                )}
              </ul>
            </div>
          )}

          {/* Per-board table */}
          <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-eq-ice text-eq-deep">
                <tr>
                  <th className="text-left px-3 py-2 text-[11px] font-bold uppercase tracking-wide">Tab</th>
                  <th className="text-left px-3 py-2 text-[11px] font-bold uppercase tracking-wide">Board</th>
                  <th className="text-left px-3 py-2 text-[11px] font-bold uppercase tracking-wide">Site</th>
                  <th className="text-left px-3 py-2 text-[11px] font-bold uppercase tracking-wide">Date</th>
                  <th className="text-right px-3 py-2 text-[11px] font-bold uppercase tracking-wide">Circuits</th>
                  <th className="text-left px-3 py-2 text-[11px] font-bold uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.boards.map((b) => {
                  const importable =
                    b.resolvedSiteId &&
                    b.resolvedAssetId &&
                    b.testDate &&
                    b.circuitCount > 0 &&
                    !b.duplicate
                  return (
                    <tr
                      key={b.tabName}
                      className={`border-t border-gray-100 ${importable ? '' : 'bg-amber-50/40'}`}
                    >
                      <td className="px-3 py-2 font-mono text-xs text-eq-grey">{b.tabName}</td>
                      <td className="px-3 py-2 font-medium text-eq-ink">
                        {b.boardName}
                        {b.resolvedAssetName && b.resolvedAssetName !== b.boardName && (
                          <span className="ml-1.5 text-xs text-eq-grey">→ {b.resolvedAssetName}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {b.resolvedSiteName ?? (
                          <span className="text-amber-700">{b.siteLabel} (unmatched)</span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {b.testDate ?? <span className="text-amber-700">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{b.circuitCount}</td>
                      <td className="px-3 py-2">
                        {importable ? (
                          <span className="inline-flex items-center gap-1 text-xs text-green-700">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Ready
                          </span>
                        ) : (
                          <div className="space-y-0.5">
                            {b.warnings.map((w, i) => (
                              <div
                                key={i}
                                className="text-xs text-amber-700 flex items-start gap-1"
                              >
                                <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                                {w}
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Commit bar */}
          <div className="sticky bottom-0 bg-white border-t border-gray-200 -mx-4 md:-mx-0 px-4 md:px-0 py-3 flex items-center justify-between gap-3">
            <p className="text-xs text-eq-grey">
              {importableCount > 0
                ? `${importableCount} board${importableCount === 1 ? '' : 's'} ready to import` +
                  (skippedCount > 0
                    ? ` · ${skippedCount} will be skipped (unmatched / missing / duplicate)`
                    : '')
                : 'No boards ready to import — fix the warnings above and re-parse'}
            </p>
            <Button
              size="sm"
              disabled={importableCount === 0 || isCommitting}
              onClick={handleCommit}
            >
              {isCommitting ? 'Importing…' : `Import ${importableCount} test${importableCount === 1 ? '' : 's'}`}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'ok' | 'warn'
}) {
  const colour =
    tone === 'ok' ? 'text-green-700' : tone === 'warn' ? 'text-amber-700' : 'text-eq-sky'
  return (
    <div className="border border-gray-200 rounded-lg bg-white px-3 py-2.5">
      <div className="text-[10px] font-bold text-eq-grey uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-bold ${colour} tabular-nums`}>{value}</div>
    </div>
  )
}

function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
