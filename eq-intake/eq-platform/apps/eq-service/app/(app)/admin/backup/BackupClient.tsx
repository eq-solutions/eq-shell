'use client'

/**
 * BackupClient — UI for /admin/backup.
 *
 * Two stacked cards:
 *   1. Download — fetches /api/admin/backup as a Blob and triggers a save.
 *      Filename comes from the Content-Disposition header so the server
 *      owns the timestamp convention.
 *   2. Preview — accepts a backup .zip via <input type="file"/>, unpacks
 *      it with JSZip in the browser, parses each entity JSON, and shows
 *      counts + the first 5 rows per entity. No server call. No write.
 */

import { useState } from 'react'
import JSZip from 'jszip'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Download, FileJson, AlertCircle, CheckCircle2, Upload } from 'lucide-react'

type EntityPreview = {
  entity: string
  count: number
  schemaId?: string
  schemaVersion?: string
  note?: string
  sampleRows: unknown[]
  error?: string
}

type ManifestPreview = {
  tenantId: string
  exportedAt: string
  exportedBy?: string
  consistency?: string
  generator?: string
}

export function BackupClient() {
  return (
    <div className="space-y-6">
      <DownloadCard />
      <PreviewCard />
    </div>
  )
}

// ── Download ────────────────────────────────────────────────────────

function DownloadCard() {
  const [busy, setBusy] = useState(false)
  const [lastDownload, setLastDownload] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleDownload() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/backup', { credentials: 'include' })
      if (!res.ok) {
        const text = await res.text()
        let message = text
        try {
          const parsed = JSON.parse(text)
          if (parsed?.error) message = parsed.error
        } catch {
          // body wasn't JSON, fall through with raw text
        }
        throw new Error(message || `Backup failed with status ${res.status}`)
      }

      // Server sets Content-Disposition: attachment; filename="..."
      // — pull the filename so the user gets the same name we'd give it.
      const dispositionHeader = res.headers.get('Content-Disposition') ?? ''
      const filenameMatch = dispositionHeader.match(/filename="([^"]+)"/)
      const filename = filenameMatch?.[1] ?? `eq-service-backup-${Date.now()}.zip`

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      setLastDownload(`${filename} (${formatBytes(blob.size)})`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backup failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <div className="flex items-start gap-4 p-5">
        <div className="w-10 h-10 rounded-md bg-eq-ice flex items-center justify-center text-eq-deep">
          <Download className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-eq-ink">Download backup</h2>
          <p className="text-sm text-eq-grey mt-1">
            Bundles every customer, site, asset, maintenance check, test, defect
            and related record for this workspace into a single ZIP file.
            Stash it on your own storage — the file is not retained on the
            server.
          </p>

          {lastDownload && (
            <div className="mt-3 flex items-center gap-2 text-xs text-emerald-700">
              <CheckCircle2 className="w-4 h-4" />
              <span>Downloaded: {lastDownload}</span>
            </div>
          )}
          {error && (
            <div className="mt-3 flex items-start gap-2 text-xs text-red-700">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="mt-4">
            <Button onClick={handleDownload} loading={busy} disabled={busy}>
              {busy ? 'Preparing backup…' : 'Download backup ZIP'}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  )
}

// ── Preview ─────────────────────────────────────────────────────────

function PreviewCard() {
  const [manifest, setManifest] = useState<ManifestPreview | null>(null)
  const [entities, setEntities] = useState<EntityPreview[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    setError(null)
    setManifest(null)
    setEntities([])
    setFileName(file.name)

    try {
      const buffer = await file.arrayBuffer()
      const zip = await JSZip.loadAsync(buffer)

      // Manifest is the index of truth; if it's missing we still try to
      // enumerate every .json in the ZIP.
      const manifestFile = zip.file('manifest.json')
      let manifestData: Record<string, unknown> | null = null
      if (manifestFile) {
        const raw = await manifestFile.async('string')
        manifestData = JSON.parse(raw)
        setManifest({
          tenantId: String(manifestData?.tenant_id ?? ''),
          exportedAt: String(manifestData?.exported_at ?? ''),
          exportedBy: manifestData?.exported_by
            ? String(manifestData.exported_by)
            : undefined,
          consistency: manifestData?.consistency
            ? String(manifestData.consistency)
            : undefined,
          generator: manifestData?.generator
            ? String(manifestData.generator)
            : undefined,
        })
      }

      const previews: EntityPreview[] = []
      const jsonFiles = Object.keys(zip.files).filter(
        (name) => name.endsWith('.json') && name !== 'manifest.json',
      )

      for (const name of jsonFiles.sort()) {
        const entry = zip.file(name)
        if (!entry) continue
        const entity = name.replace(/\.json$/, '')
        try {
          const raw = await entry.async('string')
          const parsed = JSON.parse(raw)
          const rows = Array.isArray(parsed?.rows) ? parsed.rows : []
          previews.push({
            entity,
            count: typeof parsed?.count === 'number' ? parsed.count : rows.length,
            schemaId: parsed?.schema_id,
            schemaVersion: parsed?.schema_version,
            note: parsed?.note,
            sampleRows: rows.slice(0, 5),
          })
        } catch (err) {
          previews.push({
            entity,
            count: 0,
            sampleRows: [],
            error: err instanceof Error ? err.message : 'Could not parse file',
          })
        }
      }
      setEntities(previews)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not read the backup ZIP — is the file complete?',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <div className="p-5">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-md bg-eq-ice flex items-center justify-center text-eq-deep">
            <Upload className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-eq-ink">Preview a backup</h2>
            <p className="text-sm text-eq-grey mt-1">
              Drop in a backup ZIP to see what's inside. Read-only — nothing
              gets written back. Useful for confirming a backup is complete
              before you trust it.
            </p>

            <div className="mt-4">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <span className="inline-flex items-center justify-center font-semibold rounded-md h-10 px-4 text-sm bg-white text-eq-deep border border-eq-deep hover:bg-eq-ice transition-colors">
                  Choose backup file…
                </span>
                <input
                  type="file"
                  accept=".zip,application/zip"
                  className="hidden"
                  onChange={handleFile}
                  disabled={busy}
                />
                {fileName && (
                  <span className="text-xs text-eq-grey">{fileName}</span>
                )}
              </label>
            </div>

            {busy && (
              <p className="mt-3 text-xs text-eq-grey">Reading backup…</p>
            )}
            {error && (
              <div className="mt-3 flex items-start gap-2 text-xs text-red-700">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
        </div>

        {manifest && (
          <div className="mt-5 border-t border-eq-line pt-4">
            <h3 className="text-xs uppercase tracking-wider text-eq-grey">
              Manifest
            </h3>
            <dl className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
              <div className="flex gap-2">
                <dt className="text-eq-grey">Workspace</dt>
                <dd className="text-eq-ink font-mono text-xs">
                  {manifest.tenantId.slice(0, 8)}…
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-eq-grey">Captured</dt>
                <dd className="text-eq-ink">{formatTimestamp(manifest.exportedAt)}</dd>
              </div>
              {manifest.exportedBy && (
                <div className="flex gap-2">
                  <dt className="text-eq-grey">By user</dt>
                  <dd className="text-eq-ink font-mono text-xs">
                    {manifest.exportedBy.slice(0, 8)}…
                  </dd>
                </div>
              )}
              {manifest.generator && (
                <div className="flex gap-2">
                  <dt className="text-eq-grey">Generator</dt>
                  <dd className="text-eq-ink">{manifest.generator}</dd>
                </div>
              )}
            </dl>
            {manifest.consistency && (
              <p className="mt-2 text-xs text-eq-grey">
                Consistency: {manifest.consistency}
              </p>
            )}
          </div>
        )}

        {entities.length > 0 && (
          <div className="mt-5 border-t border-eq-line pt-4 space-y-3">
            <h3 className="text-xs uppercase tracking-wider text-eq-grey">
              Entities ({entities.length})
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {entities.map((ent) => (
                <EntityRow key={ent.entity} preview={ent} />
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}

function EntityRow({ preview }: { preview: EntityPreview }) {
  const [open, setOpen] = useState(false)
  const isStub = !!preview.note && preview.count === 0
  return (
    <div className="border border-eq-line rounded-md bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-eq-ice/50 transition-colors"
      >
        <span className="flex items-center gap-2 min-w-0">
          <FileJson className="w-4 h-4 text-eq-deep shrink-0" />
          <span className="text-sm font-medium text-eq-ink truncate">
            {preview.entity}
          </span>
          {isStub && (
            <span className="text-[10px] uppercase tracking-wider text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
              stub
            </span>
          )}
          {preview.error && (
            <span className="text-[10px] uppercase tracking-wider text-red-700 bg-red-50 px-1.5 py-0.5 rounded">
              error
            </span>
          )}
        </span>
        <span className="text-xs text-eq-grey ml-2 shrink-0">
          {preview.count.toLocaleString()} {preview.count === 1 ? 'row' : 'rows'}
        </span>
      </button>
      {open && (
        <div className="border-t border-eq-line px-3 py-2 text-xs">
          {preview.error ? (
            <p className="text-red-700">{preview.error}</p>
          ) : preview.sampleRows.length === 0 ? (
            <p className="text-eq-grey italic">
              {preview.note ?? 'No rows captured.'}
            </p>
          ) : (
            <>
              <p className="text-eq-grey mb-1">
                Showing first {preview.sampleRows.length} of{' '}
                {preview.count.toLocaleString()}
                {preview.schemaId && (
                  <span className="ml-2 font-mono text-[10px]">
                    {preview.schemaId}
                  </span>
                )}
              </p>
              <pre className="bg-eq-ice/50 border border-eq-line rounded p-2 overflow-x-auto text-[10px] leading-snug">
                {JSON.stringify(preview.sampleRows, null, 2)}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Formatting helpers ─────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatTimestamp(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString()
}
