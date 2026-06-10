/**
 * EQ Solves Service
 * © 2026 EQ, a registered business name of CDC Solutions Pty Ltd
 * Proprietary and confidential.
 *
 * /admin/backup — admin-only tenant snapshot download + read-only preview.
 *
 * Two surfaces:
 *   1. Download — single button → /api/admin/backup → ZIP of one JSON per
 *      canonical entity. Browser-only; the user stashes the file wherever
 *      they want (Drive / OneDrive / disk).
 *   2. Preview — drop a backup ZIP and see entity counts + first 5 rows
 *      per entity in-browser. Pure read; no server roundtrip; no write
 *      path. Real restore lives in EQ Intake (deferred).
 */
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { BackupClient } from './BackupClient'

export const dynamic = 'force-dynamic'

export default function BackupPage() {
  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb
          items={[
            { label: 'Home', href: '/dashboard' },
            { label: 'Admin', href: '/admin' },
            { label: 'Backup' },
          ]}
        />
        <h1 className="text-2xl font-bold text-eq-ink mt-2">Backup</h1>
        <p className="text-sm text-eq-grey mt-1">
          Download a snapshot of this workspace as a ZIP file, or open a previous
          backup to inspect its contents.
        </p>
      </div>

      <BackupClient />
    </div>
  )
}
