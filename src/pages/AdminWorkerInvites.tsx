// Admin panel: list of worker invites for this tenant.
//
// Shows name, phone, status (pending / claimed / expired), sent date,
// expiry, and a copy-link / resend action.
//
// Route: /:tenantSlug/admin/workers
// Gated:  admin.invite_user

import { useEffect, useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@eq-solutions/ui';
import { Gate } from '../permissions/Gate';
import { HubLayout } from '../components/HubLayout';
import { defaultSidebarRecords } from '../lib/sidebarConfig';
import { Skeleton } from '../components/Skeleton';
import { EqError } from '../components/EqError';

const SIDEBAR_RECORDS = defaultSidebarRecords();

type InviteStatus = 'claimed' | 'expired' | 'pending';

interface WorkerInvite {
  id: string;
  token: string;
  worker_id: string | null;
  created_at: string;
  expires_at: string;
  claimed_at: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  status: InviteStatus;
  claim_url: string;
}

const STATUS_STYLES: Record<InviteStatus, React.CSSProperties> = {
  pending:  { background: '#EAF5FB', color: '#2986B4', border: '1px solid #BDE3F5' },
  claimed:  { background: '#F0FDF4', color: '#16a34a', border: '1px solid #BBF7D0' },
  expired:  { background: '#FFF7ED', color: '#c2410c', border: '1px solid #FED7AA' },
};

function statusLabel(s: InviteStatus) {
  return s === 'pending' ? 'Pending' : s === 'claimed' ? 'Claimed' : 'Expired';
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function workerName(inv: WorkerInvite): string {
  const f = inv.first_name ?? '';
  const l = inv.last_name  ?? '';
  return [f, l].filter(Boolean).join(' ') || '—';
}

function AdminWorkerInvitesInner() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const [invites, setInvites] = useState<WorkerInvite[] | null>(null);
  const [err, setErr]         = useState<string | null>(null);
  const [copiedId, setCopiedId]   = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resendErr, setResendErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await fetch('/.netlify/functions/list-worker-invites', {
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setErr(body.error ?? `Server error ${res.status}`);
        return;
      }
      const body = (await res.json()) as { invites: WorkerInvite[] };
      setInvites(body.invites);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function copyLink(inv: WorkerInvite) {
    try {
      await navigator.clipboard.writeText(inv.claim_url);
      setCopiedId(inv.id);
      setTimeout(() => setCopiedId(null), 2500);
    } catch {
      // ignore — link is visible in the row
    }
  }

  async function resend(inv: WorkerInvite) {
    if (!inv.worker_id) return;
    setResendErr(null);
    setResendingId(inv.id);
    try {
      const res = await fetch('/.netlify/functions/resend-worker-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ worker_id: inv.worker_id }),
      });
      const body = (await res.json()) as { ok?: boolean; claim_url?: string; error?: string };
      if (!res.ok || !body.ok) {
        setResendErr(body.error ?? `Error ${res.status}`);
      } else {
        // Reload the list so the new invite appears
        await load();
      }
    } catch (e) {
      setResendErr((e as Error).message);
    } finally {
      setResendingId(null);
    }
  }

  if (err) {
    return (
      <PageShell>
        <EqError title="Could not load invites" message={err} onRetry={load} />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div
        className="eq-page__header"
        style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 24 }}
      >
        <div>
          <h1 className="eq-page__title">Worker invites</h1>
          <p className="eq-page__lede">
            Activation links for EQ Cards. Share with workers so they can access their wallet.
          </p>
        </div>
        <Link to={`/${tenantSlug}/admin/workers/invite`}>
          <Button variant="primary" size="sm">Invite worker</Button>
        </Link>
      </div>

      {resendErr && (
        <div className="eq-err" role="alert" style={{ marginBottom: 16 }}>
          Resend failed: {resendErr}
        </div>
      )}

      {invites === null ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[1, 2, 3].map((n) => <Skeleton key={n} variant="row" />)}
        </div>
      ) : invites.length === 0 ? (
        <div className="eq-empty">
          <p className="eq-empty__title">No invites yet</p>
          <p>
            Create your first invite to give a worker access to EQ Cards.{' '}
            <Link to={`/${tenantSlug}/admin/workers/invite`}>Invite a worker →</Link>
          </p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--eq-border)' }}>
                {['Name', 'Phone', 'Status', 'Sent', 'Expires / Claimed', ''].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: 'left', padding: '8px 12px',
                      fontSize: 11, fontWeight: 600,
                      color: 'var(--eq-grey)', textTransform: 'uppercase', letterSpacing: '0.06em',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invites.map((inv) => (
                <tr
                  key={inv.id}
                  style={{ borderBottom: '1px solid var(--eq-border)' }}
                >
                  <td style={cellStyle}>{workerName(inv)}</td>
                  <td style={cellStyle}>
                    <span style={{ fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 13 }}>
                      {inv.phone ?? '—'}
                    </span>
                  </td>
                  <td style={cellStyle}>
                    <span
                      style={{
                        ...STATUS_STYLES[inv.status],
                        padding: '2px 8px', borderRadius: 4,
                        fontSize: 12, fontWeight: 500,
                      }}
                    >
                      {statusLabel(inv.status)}
                    </span>
                  </td>
                  <td style={cellStyle}>{fmtDate(inv.created_at)}</td>
                  <td style={cellStyle}>
                    {inv.status === 'claimed' && inv.claimed_at
                      ? fmtDate(inv.claimed_at)
                      : fmtDate(inv.expires_at)}
                  </td>
                  <td style={{ ...cellStyle, textAlign: 'right' }}>
                    {inv.status === 'pending' && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => copyLink(inv)}
                        style={{ marginRight: 8 }}
                      >
                        {copiedId === inv.id ? 'Copied!' : 'Copy link'}
                      </Button>
                    )}
                    {(inv.status === 'expired' || inv.status === 'pending') && inv.worker_id && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={resendingId === inv.id}
                        onClick={() => resend(inv)}
                      >
                        {resendingId === inv.id ? 'Sending…' : 'Resend'}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  );
}

const cellStyle: React.CSSProperties = { padding: '10px 12px', verticalAlign: 'middle' };

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <HubLayout sidebarRecords={SIDEBAR_RECORDS}>
      {children}
    </HubLayout>
  );
}

export default function AdminWorkerInvites() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  return (
    <Gate
      perm="admin.invite_user"
      fallback={
        <PageShell>
          <div className="eq-empty">
            <p className="eq-empty__title">Not allowed</p>
            <p>Only managers can view worker invites.</p>
          </div>
        </PageShell>
      }
    >
      <AdminWorkerInvitesInner />
    </Gate>
  );
}
