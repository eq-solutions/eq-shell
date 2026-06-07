// Platform-admin worker-linker page (/_platform/workers).
//
// For each canonical worker (public.workers on jvkn) that has accepted a
// Shell invite, their workers.user_id should be set to the matching
// shell_control.users.id. This page drives the link-workers function that
// performs the match (by phone or email) and optionally writes the update.
//
// Dry-run first: the button previews the match without writing. Confirm
// shows a second "Apply" button to commit. This prevents accidental bulk
// writes by a mis-click.

import { useState } from 'react';
import { Loader2, RefreshCw, Link2, Play } from 'lucide-react';
import { Button } from '@eq-solutions/ui';
import { useSession } from '../session';
import { PlatformLayout } from '../components/PlatformLayout';
import { EqError } from '../components/EqError';

interface LinkResult {
  ok: boolean;
  dry_run: boolean;
  linked: number;
  already_linked: number;
  no_match: number;
  errors: Array<{ worker_id: string; message: string }>;
}

async function callLinkWorkers(dryRun: boolean): Promise<LinkResult> {
  const res = await fetch('/.netlify/functions/link-workers', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dry_run: dryRun }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<LinkResult>;
}

export default function AdminWorkersPage() {
  const { session } = useSession();
  const [result, setResult] = useState<LinkResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  if (!session?.user.is_platform_admin) {
    return (
      <PlatformLayout>
        <div className="eq-page__header">
          <h1 className="eq-page__title">Not allowed</h1>
          <p className="eq-page__lede">This page is restricted to platform administrators.</p>
        </div>
      </PlatformLayout>
    );
  }

  const run = async (dryRun: boolean) => {
    setErr(null);
    setRunning(true);
    try {
      const r = await callLinkWorkers(dryRun);
      setResult(r);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const hasPendingApply = result?.dry_run && result.linked > 0;

  return (
    <PlatformLayout>
      <div className="eq-page__header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <h1 className="eq-page__title" style={{ margin: 0 }}>Worker links</h1>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              variant="ghost"
              onClick={() => void run(true)}
              disabled={running}
              title="Preview matches without writing"
              style={{ gap: 6 }}
            >
              {running ? <Loader2 size={14} className="eq-spin" /> : <RefreshCw size={14} />}
              Dry run
            </Button>
            {hasPendingApply && (
              <Button
                variant="primary"
                onClick={() => void run(false)}
                disabled={running}
                title="Apply matched links to the database"
                style={{ gap: 6 }}
              >
                {running ? <Loader2 size={14} className="eq-spin" /> : <Play size={14} />}
                Apply {result.linked} link{result.linked !== 1 ? 's' : ''}
              </Button>
            )}
            {!hasPendingApply && (
              <Button
                variant="primary"
                onClick={() => void run(false)}
                disabled={running}
                style={{ gap: 6 }}
              >
                {running ? <Loader2 size={14} className="eq-spin" /> : <Link2 size={14} />}
                Sync worker links
              </Button>
            )}
          </div>
        </div>
        <p className="eq-page__lede" style={{ marginTop: 4 }}>
          Match workers to their Shell accounts by phone or email and write the link.
          Use "Dry run" to preview before applying.
        </p>
      </div>

      {err && <EqError title="Failed" message={err} onRetry={() => void run(true)} />}

      {result && (
        <div>
          {/* Summary row */}
          <div
            style={{
              display: 'flex',
              gap: 16,
              marginBottom: 24,
              flexWrap: 'wrap',
            }}
          >
            <StatCard
              label={result.dry_run ? 'Would link' : 'Linked'}
              value={result.linked}
              ok={result.linked > 0}
            />
            <StatCard label="Already linked" value={result.already_linked} />
            <StatCard
              label="No match"
              value={result.no_match}
              warn={result.no_match > 0}
            />
            <StatCard
              label="Errors"
              value={result.errors.length}
              warn={result.errors.length > 0}
            />
          </div>

          {result.dry_run && result.linked > 0 && (
            <p style={{ fontSize: 13, color: 'var(--eq-ink-60)', marginBottom: 16 }}>
              Preview only — click "Apply" to write these links to the database.
            </p>
          )}

          {!result.dry_run && result.linked > 0 && (
            <p style={{ fontSize: 13, color: 'var(--eq-ok, #16a34a)', marginBottom: 16 }}>
              {result.linked} worker{result.linked !== 1 ? 's' : ''} linked successfully.
            </p>
          )}

          {result.no_match > 0 && (
            <p style={{ fontSize: 13, color: 'var(--eq-ink-60)', marginBottom: 16 }}>
              {result.no_match} worker{result.no_match !== 1 ? 's' : ''} could not be matched
              — they may not have accepted a Shell invite yet.
            </p>
          )}

          {result.errors.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Errors</h2>
              <table className="eq-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>Worker ID</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {result.errors.map((e) => (
                    <tr key={e.worker_id}>
                      <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{e.worker_id}</td>
                      <td style={{ color: 'var(--eq-err)', fontSize: 13 }}>{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {!result && !running && !err && (
        <p style={{ fontSize: 13, color: 'var(--eq-ink-40)' }}>
          Run a dry run to see which workers can be matched to Shell accounts.
        </p>
      )}
    </PlatformLayout>
  );
}

interface StatCardProps {
  label: string;
  value: number;
  ok?: boolean;
  warn?: boolean;
}

function StatCard({ label, value, ok, warn }: StatCardProps) {
  const color = ok
    ? 'var(--eq-ok, #16a34a)'
    : warn
    ? 'var(--eq-err, #dc2626)'
    : 'var(--eq-ink, #1A1A2E)';

  return (
    <div
      className="eq-card"
      style={{ padding: '16px 20px', minWidth: 120, flex: '0 0 auto' }}
    >
      <div style={{ fontSize: 24, fontWeight: 700, color, lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: 'var(--eq-ink-60)', marginTop: 4 }}>{label}</div>
    </div>
  );
}
