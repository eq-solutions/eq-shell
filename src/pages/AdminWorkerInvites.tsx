// Admin panel: list of worker invites for this tenant.
//
// Shows name, phone, status (pending / claimed / expired), sent date,
// expiry, and a copy-link / resend action.
//
// Route: /:tenantSlug/admin/workers
// Gated:  admin.invite_user

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Table, type TableColumn, Button } from '@eq-solutions/ui';
import { Gate } from '../permissions/Gate';
import { HubLayout } from '../components/HubLayout';
import { defaultSidebarRecords } from '../lib/sidebarConfig';
import { EqError } from '../components/EqError';

const SIDEBAR_RECORDS = defaultSidebarRecords();

type InviteStatus = 'claimed' | 'active' | 'expired' | 'pending';

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
  email: string | null;
  is_activated: boolean;
  status: InviteStatus;
  claim_url: string;
}

const STATUS_STYLES: Record<InviteStatus, React.CSSProperties> = {
  pending:  { background: '#EAF5FB', color: '#2986B4', border: '1px solid #BDE3F5' },
  active:   { background: '#F5F3FF', color: '#7C3AED', border: '1px solid #DDD6FE' },
  claimed:  { background: '#F0FDF4', color: '#16a34a', border: '1px solid #BBF7D0' },
  expired:  { background: '#FFF7ED', color: '#c2410c', border: '1px solid #FED7AA' },
};

function statusLabel(s: InviteStatus) {
  if (s === 'pending') return 'Pending';
  if (s === 'active')  return 'Active — Cards not done';
  if (s === 'claimed') return 'Claimed';
  return 'Expired';
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
  const [copiedId, setCopiedId]       = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resendErr, setResendErr]     = useState<string | null>(null);
  const [resendResult, setResendResult] = useState<{ worker_id: string; claim_url: string } | null>(null);

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

  const copyLink = useCallback(async (inv: WorkerInvite) => {
    try {
      await navigator.clipboard.writeText(inv.claim_url);
      setCopiedId(inv.id);
      setTimeout(() => setCopiedId(null), 2500);
    } catch {
      // ignore — link is visible in the row
    }
  }, []);

  const resend = useCallback(async (inv: WorkerInvite) => {
    if (!inv.worker_id) return;
    setResendErr(null);
    setResendResult(null);
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
        setResendResult({ worker_id: inv.worker_id, claim_url: body.claim_url ?? '' });
        await load();
      }
    } catch (e) {
      setResendErr((e as Error).message);
    } finally {
      setResendingId(null);
    }
  }, [load]);

  const columns = useMemo<TableColumn<WorkerInvite>[]>(() => [
    {
      key: 'name',
      header: 'Name',
      sortAccessor: (inv) => `${inv.last_name ?? ''} ${inv.first_name ?? ''}`,
      render: (inv) => (
        <div>
          <div style={{ fontWeight: 700, color: '#1A1A2E', fontSize: 13, lineHeight: 1.2 }}>
            {workerName(inv)}
          </div>
          {inv.phone && (
            <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 1, fontFamily: 'ui-monospace, Menlo, Consolas, monospace' }}>
              {inv.phone}
            </div>
          )}
          {inv.email && (
            <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 1 }}>
              {inv.email}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortAccessor: (inv) => inv.status,
      render: (inv) => (
        <span style={{ ...STATUS_STYLES[inv.status], padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 500 }}>
          {statusLabel(inv.status)}
        </span>
      ),
    },
    {
      key: 'sent',
      header: 'Sent',
      sortAccessor: (inv) => inv.created_at,
      render: (inv) => <span style={{ color: '#475569' }}>{fmtDate(inv.created_at)}</span>,
    },
    {
      key: 'expires_claimed',
      header: 'Expires / Claimed',
      sortAccessor: (inv) => inv.claimed_at ?? inv.expires_at,
      render: (inv) => (
        <span style={{ color: '#64748B' }}>
          {inv.claimed_at ? fmtDate(inv.claimed_at) : fmtDate(inv.expires_at)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (inv) => (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {inv.status === 'pending' && (
            <Button type="button" variant="ghost" size="sm" onClick={() => void copyLink(inv)}>
              {copiedId === inv.id ? 'Copied!' : 'Copy link'}
            </Button>
          )}
          {(inv.status === 'expired' || inv.status === 'pending' || inv.status === 'active') && inv.worker_id && (
            <Button type="button" variant="ghost" size="sm" disabled={resendingId === inv.id} onClick={() => void resend(inv)}>
              {resendingId === inv.id ? 'Sending…' : 'Resend'}
            </Button>
          )}
        </div>
      ),
    },
  ], [copiedId, resendingId, copyLink, resend]);

  if (err) {
    return (
      <PageShell>
        <EqError title="Could not load invites" message={err} onRetry={load} />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '16px 24px 0', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.02em', color: '#1A1A2E' }}>Worker invites</h1>
            <p style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>
              {invites === null ? 'Loading…' : `${invites.length} ${invites.length === 1 ? 'invite' : 'invites'}`}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Link
              to={`/${tenantSlug}/admin/workers/qr`}
              style={{
                display: 'inline-flex', alignItems: 'center', height: 36,
                padding: '0 14px', borderRadius: 6, fontSize: 13, fontWeight: 600,
                border: '1px solid var(--eq-border)', color: 'var(--eq-deep)',
                textDecoration: 'none', background: 'transparent',
              }}
            >
              QR code
            </Link>
            <Link
              to={`/${tenantSlug}/admin/workers/connect`}
              style={{
                display: 'inline-flex', alignItems: 'center', height: 36,
                padding: '0 14px', borderRadius: 6, fontSize: 13, fontWeight: 600,
                border: '1px solid var(--eq-border)', color: 'var(--eq-deep)',
                textDecoration: 'none', background: 'transparent',
              }}
            >
              Connect existing
            </Link>
            <Link to={`/${tenantSlug}/admin/workers/invite`}>
              <Button variant="primary" size="sm">Invite worker</Button>
            </Link>
          </div>
        </div>

        {/* Banners */}
        {(resendErr || resendResult) && (
          <div style={{ padding: '12px 24px 0', flexShrink: 0 }}>
            {resendErr && (
              <div className="eq-err" role="alert">Resend failed: {resendErr}</div>
            )}
            {resendResult && (
              <div
                role="status"
                style={{
                  padding: '12px 16px',
                  background: '#F0FDF4', border: '1px solid #BBF7D0',
                  borderRadius: 6, fontSize: 13,
                }}
              >
                <span style={{ fontWeight: 600 }}>New invite link sent.</span>{' '}
                <span style={{ fontFamily: 'ui-monospace, Menlo, Consolas, monospace', wordBreak: 'break-all' }}>
                  {resendResult.claim_url}
                </span>{' '}
                <button
                  type="button"
                  onClick={() => { void navigator.clipboard.writeText(resendResult!.claim_url); }}
                  style={{
                    marginLeft: 8, padding: '2px 8px', borderRadius: 4,
                    border: '1px solid #16a34a', background: 'transparent',
                    color: '#16a34a', fontSize: 12, cursor: 'pointer',
                  }}
                >
                  Copy
                </button>
              </div>
            )}
          </div>
        )}

        {/* Table */}
        <div style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
          <Table
            columns={columns}
            rows={invites ?? []}
            getRowId={(inv) => inv.id}
            loading={invites === null}
            slicers={[
              { key: 'all',     label: 'All' },
              { key: 'pending', label: 'Pending',  filter: (inv) => inv.status === 'pending' },
              { key: 'active',  label: 'Active',   filter: (inv) => inv.status === 'active',  dot: '#7C3AED' },
              { key: 'claimed', label: 'Claimed',  filter: (inv) => inv.status === 'claimed', dot: '#16a34a' },
              { key: 'expired', label: 'Expired',  filter: (inv) => inv.status === 'expired' },
            ]}
            globalSearch={{ placeholder: 'Search invites…' }}
            defaultSort={{ key: 'sent', dir: 'desc' }}
            pagination={{ pageSize: 25 }}
            summary={(v, t) => <>Showing <strong>{v}</strong> of <strong>{t.toLocaleString()}</strong></>}
            emptyMessage="No invites yet — create one to give a worker access to EQ Cards"
          />
        </div>

      </div>
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <HubLayout sidebarRecords={SIDEBAR_RECORDS} fullWidth>
      {children}
    </HubLayout>
  );
}

export default function AdminWorkerInvites() {
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
