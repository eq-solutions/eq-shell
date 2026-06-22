// Admin review queue for Cards profiles not yet in Field,
// plus company compliance view (connected workers + credentials).
//
// Gated by admin.review_cards — manager + platform_admin only.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { UserPlus } from 'lucide-react';
import { Button } from '@eq-solutions/ui';
import { Gate } from '../permissions/Gate';
import { HubLayout } from '../components/HubLayout';
import { defaultSidebarRecords } from '../lib/sidebarConfig';

const SIDEBAR_RECORDS = defaultSidebarRecords();
import { Skeleton } from '../components/Skeleton';
import { EqError } from '../components/EqError';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Licence {
  licence_id: string;
  licence_type: string;
  licence_number: string | null;
  expiry_date: string | null;
}

interface PendingStaff {
  staff_id?: string;
  application_id?: string;
  source?: 'invite' | 'application';
  sharing_scope?: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  date_of_birth: string | null;
  created_at: string;
  licences: Licence[];
}

interface Credential {
  id: string;
  credential_type: string;
  licence_number: string | null;
  expiry_date: string | null;
  never_expires: boolean;
  status: string;
}

interface ConnectedWorker {
  membership_id: string;
  user_id: string | null;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
  role: string;
  accepted_at: string | null;
  credentials: Credential[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-AU');
}

function fullName(f: string | null, l: string | null, fallback?: string | null): string {
  return ([f, l].filter(Boolean).join(' ') || fallback) ?? 'Unknown';
}

type CredStatus = 'valid' | 'expiring' | 'expired' | 'no-expiry';

function credStatus(c: Credential): CredStatus {
  if (c.never_expires) return 'no-expiry';
  if (!c.expiry_date) return 'valid';
  const ms = new Date(c.expiry_date).getTime() - Date.now();
  if (ms < 0) return 'expired';
  if (ms < 30 * 86_400_000) return 'expiring';
  return 'valid';
}

const PILL_STYLE: Record<CredStatus, React.CSSProperties> = {
  valid:       { background: '#DCFCE7', color: '#15803D' },
  expiring:    { background: '#FEF3C7', color: '#B45309' },
  expired:     { background: '#FEE2E2', color: '#B91C1C' },
  'no-expiry': { background: '#F1F5F9', color: '#64748B' },
};

// ─── Credential pill ──────────────────────────────────────────────────────────

function CredPill({ cred }: { cred: Credential }) {
  const st = credStatus(cred);
  const expLabel = cred.never_expires ? '∞' : formatDate(cred.expiry_date);
  return (
    <span
      title={`${cred.credential_type}${cred.licence_number ? ` · ${cred.licence_number}` : ''} · ${expLabel}`}
      style={{
        ...PILL_STYLE[st],
        display: 'inline-block',
        fontSize: 11,
        fontWeight: 500,
        padding: '2px 7px',
        borderRadius: 20,
        whiteSpace: 'nowrap',
        lineHeight: '16px',
      }}
    >
      {cred.credential_type} {expLabel}
    </span>
  );
}

// ─── Pending tab ──────────────────────────────────────────────────────────────

function PendingTab({
  pending, err, query, setQuery, busy, actionErr, decide, reload,
}: {
  pending: PendingStaff[] | null;
  err: string | null;
  query: string;
  setQuery: (q: string) => void;
  busy: string | null;
  actionErr: string | null;
  decide: (id: string, action: 'approve' | 'reject', source?: string) => void;
  reload: () => void;
}) {
  const filtered = useMemo(() => {
    if (!pending) return [];
    const q = query.trim().toLowerCase();
    if (!q) return pending;
    return pending.filter(
      (p) =>
        fullName(p.first_name, p.last_name).toLowerCase().includes(q) ||
        (p.email ?? '').toLowerCase().includes(q),
    );
  }, [pending, query]);

  return (
    <>
      {err && <EqError title="Couldn't load pending staff" message={err} onRetry={reload} />}
      {actionErr && (
        <p style={{ color: 'var(--eq-error)', fontSize: 13, marginBottom: 12 }}>{actionErr}</p>
      )}
      {pending !== null && pending.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <input
            type="search"
            placeholder="Search by name or email"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              padding: '6px 12px', border: '1px solid var(--eq-border)',
              borderRadius: 6, fontSize: 13, width: 220, outline: 'none',
            }}
          />
        </div>
      )}
      <div className="eq-table-wrap">
        <table className="eq-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Contact</th>
              <th>Licences</th>
              <th>Submitted</th>
              <th style={{ width: 160 }} />
            </tr>
          </thead>
          <tbody>
            {pending === null && !err ? (
              <tr><td colSpan={5}><Skeleton variant="row" count={4} /></td></tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: 40, color: 'var(--eq-grey)' }}>
                  {query ? 'No matches.' : 'No Cards profiles waiting for review.'}
                </td>
              </tr>
            ) : (
              filtered.map((p) => {
                const rowId = p.application_id ?? p.staff_id ?? '';
                return (
                <tr key={rowId}>
                  <td>
                    <span style={{ fontWeight: 500 }}>
                      {fullName(p.first_name, p.last_name, p.email)}
                    </span>
                    {p.source === 'application' && (
                      <span className="eq-table__mute" style={{ display: 'block', fontSize: 11 }}>
                        Self-signup · {p.sharing_scope === 'full' ? 'Full credentials' : 'Basic profile'}
                      </span>
                    )}
                  </td>
                  <td>
                    <span>{p.email ?? '—'}</span>
                    {p.phone && (
                      <span className="eq-table__mute" style={{ display: 'block', fontSize: 12 }}>
                        {p.phone}
                      </span>
                    )}
                  </td>
                  <td>
                    {p.licences.length === 0 ? (
                      <span className="eq-table__mute">
                        {p.source === 'application' && p.sharing_scope === 'basic' ? 'Not shared' : 'None'}
                      </span>
                    ) : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {p.licences.map((l) => (
                          <span key={l.licence_id} className="eq-pill eq-pill--info">
                            {l.licence_type}
                            {l.expiry_date ? ` · ${formatDate(l.expiry_date)}` : ''}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="eq-table__mute">{formatDate(p.created_at)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <Button
                        variant="primary" size="sm"
                        disabled={busy === rowId}
                        onClick={() => void decide(rowId, 'approve', p.source)}
                      >
                        {busy === rowId ? '…' : 'Add to Field'}
                      </Button>
                      <Button
                        variant="ghost" size="sm"
                        disabled={busy === rowId}
                        onClick={() => void decide(rowId, 'reject', p.source)}
                      >
                        Dismiss
                      </Button>
                    </div>
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ─── Connected tab ────────────────────────────────────────────────────────────

function ConnectedTab({
  connected, err, reload,
}: {
  connected: ConnectedWorker[] | null;
  err: string | null;
  reload: () => void;
}) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!connected) return [];
    const q = query.trim().toLowerCase();
    if (!q) return connected;
    return connected.filter(
      (w) =>
        fullName(w.first_name, w.last_name).toLowerCase().includes(q) ||
        (w.phone ?? '').includes(q),
    );
  }, [connected, query]);

  if (err) return <EqError title="Couldn't load connected workers" message={err} onRetry={reload} />;

  return (
    <>
      {connected !== null && connected.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <input
            type="search"
            placeholder="Search by name or number"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              padding: '6px 12px', border: '1px solid var(--eq-border)',
              borderRadius: 6, fontSize: 13, width: 220, outline: 'none',
            }}
          />
        </div>
      )}
      <div className="eq-table-wrap">
        <table className="eq-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Mobile</th>
              <th>Credentials</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {connected === null ? (
              <tr><td colSpan={4}><Skeleton variant="row" count={4} /></td></tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', padding: 40, color: 'var(--eq-grey)' }}>
                  {query ? 'No matches.' : 'No connected workers yet.'}
                </td>
              </tr>
            ) : (
              filtered.map((w) => (
                <tr key={w.membership_id}>
                  <td>
                    <span style={{ fontWeight: 500 }}>
                      {fullName(w.first_name, w.last_name, w.phone ?? 'Unknown')}
                    </span>
                    {!w.user_id && (
                      <span className="eq-table__mute" style={{ display: 'block', fontSize: 11 }}>
                        Cards account not linked
                      </span>
                    )}
                  </td>
                  <td className="eq-table__mute">{w.phone ?? '—'}</td>
                  <td>
                    {w.credentials.length === 0 ? (
                      <span className="eq-table__mute">No credentials</span>
                    ) : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {w.credentials.map((c) => <CredPill key={c.id} cred={c} />)}
                      </div>
                    )}
                  </td>
                  <td className="eq-table__mute">{formatDate(w.accepted_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {connected !== null && (
        <div style={{ marginTop: 12, display: 'flex', gap: 16, fontSize: 12, color: '#64748B' }}>
          {(['valid', 'expiring', 'expired', 'no-expiry'] as CredStatus[]).map((st) => (
            <span key={st} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ ...PILL_STYLE[st], borderRadius: 4, padding: '1px 6px', fontSize: 11 }}>
                {st === 'no-expiry' ? '∞' : '●'}
              </span>
              {st === 'valid' ? 'Valid' : st === 'expiring' ? 'Expiring ≤30 days' : st === 'expired' ? 'Expired' : 'No expiry'}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function AdminCardsFeedInner() {
  const [tab, setTab] = useState<'pending' | 'connected'>('pending');
  const navigate = useNavigate();
  const { tenantSlug } = useParams<{ tenantSlug: string }>();

  // Pending
  const [pending, setPending] = useState<PendingStaff[] | null>(null);
  const [pendErr, setPendErr] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  // Connected
  const [connected, setConnected] = useState<ConnectedWorker[] | null>(null);
  const [connErr, setConnErr] = useState<string | null>(null);
  const connLoaded = useRef(false);

  const loadPending = async () => {
    setPendErr(null);
    try {
      const res = await fetch('/.netlify/functions/cards-pending-staff', { credentials: 'include' });
      const body = (await res.json()) as { pending?: PendingStaff[]; error?: string };
      if (!res.ok) { setPendErr(body.error ?? 'Failed to load'); return; }
      setPending(body.pending ?? []);
    } catch (e) {
      setPendErr((e as Error).message);
    }
  };

  const loadConnected = async () => {
    setConnErr(null);
    try {
      const res = await fetch('/.netlify/functions/cards-connected-workers', { credentials: 'include' });
      const body = (await res.json()) as { connected?: ConnectedWorker[]; error?: string };
      if (!res.ok) { setConnErr(body.error ?? 'Failed to load'); return; }
      setConnected(body.connected ?? []);
      connLoaded.current = true;
    } catch (e) {
      setConnErr((e as Error).message);
    }
  };

  useEffect(() => { void loadPending(); }, []);

  useEffect(() => {
    if (tab === 'connected' && !connLoaded.current) void loadConnected();
  }, [tab]);

  const decide = async (rowId: string, action: 'approve' | 'reject', source?: string) => {
    setActionErr(null);
    setBusy(rowId);
    try {
      const bodyPayload =
        source === 'application'
          ? { application_id: rowId, action }
          : { staff_id: rowId, action };
      const res = await fetch('/.netlify/functions/cards-approve-staff', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) { setActionErr(body.error ?? 'Something went wrong'); }
      else {
        setPending((prev) => (prev ?? []).filter((p) => {
          const id = p.application_id ?? p.staff_id;
          return id !== rowId;
        }));
      }
    } catch (e) {
      setActionErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const tabBtn = (active: boolean): React.CSSProperties => ({
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: active ? 600 : 400,
    color: active ? '#2986B4' : '#64748B',
    background: 'none',
    border: 'none',
    borderBottom: `2px solid ${active ? '#2986B4' : 'transparent'}`,
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  });

  const badge = (_n: number, active?: boolean): React.CSSProperties => ({
    marginLeft: 6,
    background: active ? '#EAF5FB' : '#F1F5F9',
    color: active ? '#2986B4' : '#64748B',
    borderRadius: 20,
    fontSize: 11,
    fontWeight: 600,
    padding: '1px 7px',
  });

  return (
    <HubLayout sidebarRecords={SIDEBAR_RECORDS}>
      <div
        className="eq-page__header"
        style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 0 }}
      >
        <div>
          <h1 className="eq-page__title">Cards</h1>
          <p className="eq-page__lede">Review and manage worker connections via EQ Cards.</p>
        </div>
        <button
          onClick={() => navigate(`/${tenantSlug}/admin/workers/invite`)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 14px', borderRadius: 6, fontSize: 13, fontWeight: 500,
            background: '#2986B4', color: '#fff', border: 'none', cursor: 'pointer',
          }}
        >
          <UserPlus size={15} />
          Invite worker
        </button>
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--eq-border, #E2E8F0)', marginTop: 16, marginBottom: 20 }}>
        <button style={tabBtn(tab === 'pending')} onClick={() => setTab('pending')}>
          New staff
          {pending !== null && pending.length > 0 && (
            <span style={badge(pending.length, true)}>{pending.length}</span>
          )}
        </button>
        <button style={tabBtn(tab === 'connected')} onClick={() => setTab('connected')}>
          Connected
          {connected !== null && (
            <span style={badge(connected.length)}>{connected.length}</span>
          )}
        </button>
      </div>

      {tab === 'pending' && (
        <PendingTab
          pending={pending}
          err={pendErr}
          query={query}
          setQuery={setQuery}
          busy={busy}
          actionErr={actionErr}
          decide={(id, action, source) => void decide(id, action, source)}
          reload={loadPending}
        />
      )}

      {tab === 'connected' && (
        <ConnectedTab
          connected={connected}
          err={connErr}
          reload={loadConnected}
        />
      )}
    </HubLayout>
  );
}

export default function AdminCardsFeed() {
  return (
    <Gate
      perm="admin.review_cards"
      fallback={
        <HubLayout sidebarRecords={SIDEBAR_RECORDS}>
          <div className="eq-empty">
            <p className="eq-empty__title">Not allowed</p>
            <p>Only managers can review Cards submissions.</p>
          </div>
        </HubLayout>
      }
    >
      <AdminCardsFeedInner />
    </Gate>
  );
}
