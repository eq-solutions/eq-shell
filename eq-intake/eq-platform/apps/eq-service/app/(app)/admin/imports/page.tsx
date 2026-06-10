/**
 * EQ Solves Service
 * © 2026 EQ, a registered business name of CDC Solutions Pty Ltd
 * Proprietary and confidential.
 *
 * /admin/imports — single place to find every import flow in the app.
 *
 * Replaces the previous "hunt across /maintenance/import,
 * /testing/rcd/import, /contract-scope, /commercials/contract-scopes/import
 * and the ACB toolbar button" experience. Each tile links to the
 * existing wizard / surface; the audit-log table at the bottom shows the
 * last 50 imports so the user can see what was last imported by whom.
 *
 * Server component. Reads audit_logs directly. Tenant-scoped via RLS.
 * No role gate at the page level — matches existing /admin/* behaviour,
 * the destination pages each enforce their own role check.
 */
import Link from 'next/link'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { Card } from '@/components/ui/Card'
import { createClient } from '@/lib/supabase/server'
import { ClipboardList, Zap, Activity, FileSpreadsheet, FileText, Upload } from 'lucide-react'

export const dynamic = 'force-dynamic'

type ImportTile = {
  label: string
  href: string
  description: string
  icon: typeof Zap
  /** Audit-log heuristics — match on action+entity_type to pull a last-run timestamp. */
  audit: {
    actions: string[]
    entityTypes: string[]
    summaryKeyword?: string
  }
  /**
   * Re-import safe — i.e. the wizard wraps in withIdempotency or the
   * commit is a wipe-and-replace. Soft signal to set the user's
   * expectations.
   */
  replaySafe: boolean
}

const IMPORT_TILES: ImportTile[] = [
  {
    label: 'Maintenance — Equinix Delta WO',
    href: '/maintenance/import',
    description: 'Monthly Maximo Delta work-order workbook(s). Single file or consolidated multi-file.',
    icon: ClipboardList,
    audit: { actions: ['create'], entityTypes: ['maintenance_check'], summaryKeyword: 'Delta' },
    replaySafe: true,
  },
  {
    label: 'ACB — Asset Collection',
    href: '/testing/acb',
    description: 'Round-trip Excel: export pre-filled, fill offline, import back. Bulk-fills Step 1 breaker identification.',
    icon: Zap,
    audit: { actions: ['import', 'update'], entityTypes: ['acb_test'], summaryKeyword: 'collection' },
    replaySafe: false,
  },
  {
    label: 'RCD — Jemena multi-tab workbook',
    href: '/testing/rcd/import',
    description: 'One-time bootstrap from the 2025 Jemena RCD workbook. Year 2+ visits clone from the last visit.',
    icon: Activity,
    audit: { actions: ['create'], entityTypes: ['rcd_test'], summaryKeyword: 'RCD' },
    replaySafe: true,
  },
  {
    label: 'Contract Scope — CSV',
    href: '/contract-scope',
    description: 'Bulk import scope items. Customer / site resolved by name.',
    icon: FileText,
    audit: { actions: ['import', 'create'], entityTypes: ['contract_scope'] },
    replaySafe: false,
  },
  {
    label: 'Commercial Sheet — DELTA ELCOM',
    href: '/commercials/contract-scopes/import',
    description: 'Equinix per-site commercial workbook. Wipe-and-replace import; atomic via RPC.',
    icon: FileSpreadsheet,
    audit: { actions: ['create', 'update'], entityTypes: ['contract_scope'], summaryKeyword: 'commercial' },
    replaySafe: true,
  },
]

type AuditRow = {
  id: string
  user_id: string | null
  action: string
  entity_type: string
  summary: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso ?? '—'
  return d.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })
}

function lastRunForTile(rows: AuditRow[], tile: ImportTile): AuditRow | undefined {
  return rows.find((r) => {
    if (!tile.audit.actions.includes(r.action)) return false
    if (!tile.audit.entityTypes.includes(r.entity_type)) return false
    if (tile.audit.summaryKeyword) {
      return (r.summary ?? '').toLowerCase().includes(tile.audit.summaryKeyword.toLowerCase())
    }
    return true
  })
}

export default async function ImportsHubPage() {
  const supabase = await createClient()

  // Pull all plausible import-related audit rows in one query. We don't
  // strictly know which entity_types map to which importers, so cast a
  // wide net and filter client-side per tile. 200-row cap keeps the
  // page snappy and is more than enough for "last 50" + per-tile lookup.
  const { data: auditRowsRaw } = await supabase
    .from('audit_logs')
    .select('id, user_id, action, entity_type, summary, metadata, created_at')
    .in('entity_type', ['maintenance_check', 'acb_test', 'rcd_test', 'contract_scope', 'import_session'])
    .order('created_at', { ascending: false })
    .limit(200)
  const auditRows: AuditRow[] = (auditRowsRaw ?? []) as AuditRow[]

  // Resolve user names for the recent table. RLS-friendly: profiles
  // table is tenant-scoped already.
  const userIds = Array.from(new Set(auditRows.map((r) => r.user_id).filter((v): v is string => v !== null)))
  const { data: profilesRaw } = userIds.length > 0
    ? await supabase.from('profiles').select('id, full_name, email').in('id', userIds)
    : { data: [] as Array<{ id: string; full_name: string | null; email: string | null }> }
  const profileById = new Map(
    (profilesRaw ?? []).map((p) => [p.id, p.full_name || p.email || p.id.slice(0, 8)]),
  )

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[
          { label: 'Home', href: '/dashboard' },
          { label: 'Admin', href: '/admin' },
          { label: 'Imports' },
        ]} />
        <h1 className="text-2xl font-bold text-eq-ink mt-2">Imports</h1>
        <p className="text-sm text-eq-grey mt-1">
          Every import flow in one place. Tiles show when each one was last run.
        </p>
      </div>

      {/* Tile grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {IMPORT_TILES.map((tile) => {
          const last = lastRunForTile(auditRows, tile)
          const Icon = tile.icon
          return (
            <Link
              key={tile.href}
              href={tile.href}
              className="group flex flex-col gap-2 p-5 bg-white border border-eq-line rounded-xl hover:border-eq-sky transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-md bg-eq-ice flex items-center justify-center text-eq-deep group-hover:bg-eq-sky group-hover:text-white transition-colors">
                  <Icon className="w-5 h-5" />
                </div>
                <span className="text-sm font-semibold text-eq-ink">{tile.label}</span>
              </div>
              <p className="text-xs text-eq-grey">{tile.description}</p>
              <div className="flex items-center justify-between text-[11px] mt-1 pt-2 border-t border-eq-line">
                <span className="text-eq-grey">
                  Last run: <span className="text-eq-ink">{last ? formatDateTime(last.created_at) : 'Never'}</span>
                </span>
                <span
                  className={`uppercase tracking-wider text-[10px] px-1.5 py-0.5 rounded ${
                    tile.replaySafe
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-amber-50 text-amber-700'
                  }`}
                  title={tile.replaySafe
                    ? 'Wrapped in withIdempotency or wipe-and-replace — re-uploading the same file is safe.'
                    : 'Per-row updates without idempotency — re-upload may double-write or overwrite later edits.'
                  }
                >
                  {tile.replaySafe ? 'Re-import safe' : 'Re-import: check first'}
                </span>
              </div>
            </Link>
          )
        })}
      </div>

      {/* Recent imports table */}
      <Card>
        <div className="p-5">
          <h2 className="text-base font-semibold text-eq-ink">Recent imports</h2>
          <p className="text-xs text-eq-grey mt-1">
            Last 50 import events across every flow above. Click through to the wizard to re-run.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-eq-grey border-b border-eq-line">
                  <th className="py-2 pr-3">When</th>
                  <th className="py-2 pr-3">Who</th>
                  <th className="py-2 pr-3">What</th>
                  <th className="py-2 pr-3">Summary</th>
                </tr>
              </thead>
              <tbody>
                {auditRows.slice(0, 50).map((row) => (
                  <tr key={row.id} className="border-b border-eq-line/60 last:border-b-0 hover:bg-eq-ice/30">
                    <td className="py-2 pr-3 text-eq-ink whitespace-nowrap text-xs">{formatDateTime(row.created_at)}</td>
                    <td className="py-2 pr-3 text-eq-grey text-xs">
                      {row.user_id ? (profileById.get(row.user_id) ?? row.user_id.slice(0, 8)) : 'system'}
                    </td>
                    <td className="py-2 pr-3">
                      <span className="text-[11px] font-mono text-eq-deep bg-eq-ice px-1.5 py-0.5 rounded">
                        {row.entity_type}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-eq-ink text-xs">{row.summary ?? '—'}</td>
                  </tr>
                ))}
                {auditRows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-eq-grey text-xs italic">
                      No imports recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Card>
    </div>
  )
}
