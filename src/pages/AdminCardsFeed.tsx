// Admin review queue for Cards profiles not yet in Field.
//
// Gated by admin.review_cards — manager + platform_admin only.
// Table layout + name/email search matches the AdminUserList pattern.

import { useEffect, useMemo, useState } from 'react';
import { Gate } from '../permissions/Gate';
import { Topbar } from '../components/Topbar';
import { Skeleton } from '../components/Skeleton';
import { EqError } from '../components/EqError';

interface Licence {
  licence_id: string;
  licence_type: string;
  licence_number: string | null;
  expiry_date: string | null;
}

interface PendingStaff {
  staff_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  date_of_birth: string | null;
  created_at: string;
  licences: Licence[];
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-AU');
}

function fullName(s: PendingStaff): string {
  return ([s.first_name, s.last_name].filter(Boolean).join(' ') || s.email) ?? 'Unknown';
}

function AdminCardsFeedInner() {
  const [pending, setPending] = useState<PendingStaff[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null); // staff_id of in-flight action

  const load = async () => {
    setErr(null);
    try {
      const res = await fetch('/.netlify/functions/cards-pending-staff', {
        credentials: 'include',
      });
      const body = (await res.json()) as { pending?: PendingStaff[]; error?: string };
      if (!res.ok) { setErr(body.error ?? 'Failed to load'); return; }
      setPending(body.pending ?? []);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const decide = async (staffId: string, action: 'approve' | 'reject') => {
    setActionErr(null);
    setBusy(staffId);
    try {
      const res = await fetch('/.netlify/functions/cards-approve-staff', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staff_id: staffId, action }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) { setActionErr(body.error ?? 'Something went wrong'); }
      else { setPending((prev) => (prev ?? []).filter((p) => p.staff_id !== staffId)); }
    } catch (e) {
      setActionErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    if (!pending) return [];
    const q = query.trim().toLowerCase();
    if (!q) return pending;
    return pending.filter(
      (p) =>
        fullName(p).toLowerCase().includes(q) ||
        (p.email ?? '').toLowerCase().includes(q),
    );
  }, [pending, query]);

  return (
    <>
      <Topbar />
      <main className="eq-page">
        <div className="eq-page__header" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div>
            <h1 className="eq-page__title">New staff</h1>
            <p className="eq-page__lede">
              Cards profiles not yet added to Field.
              {pending !== null && (
                <span style={{ marginLeft: 6, color: 'var(--eq-grey)' }}>
                  {pending.length} pending
                </span>
              )}
            </p>
          </div>
          {pending !== null && pending.length > 0 && (
            <input
              type="search"
              placeholder="Search by name or email"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{
                padding: '6px 12px',
                border: '1px solid var(--eq-border)',
                borderRadius: 6,
                fontSize: 13,
                width: 220,
                outline: 'none',
              }}
            />
          )}
        </div>

        {err && <EqError title="Couldn't load pending staff" message={err} onRetry={load} />}

        {actionErr && (
          <p style={{ color: 'var(--eq-error)', fontSize: 13, marginBottom: 12 }}>
            {actionErr}
          </p>
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
                <tr>
                  <td colSpan={5}>
                    <Skeleton variant="row" count={4} />
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: 40, color: 'var(--eq-grey)' }}>
                    {query ? 'No matches.' : 'No Cards profiles waiting for review.'}
                  </td>
                </tr>
              ) : (
                filtered.map((p) => (
                  <tr key={p.staff_id}>
                    <td>
                      <span style={{ fontWeight: 500 }}>{fullName(p)}</span>
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
                        <span className="eq-table__mute">None</span>
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
                        <button
                          className="eq-btn-primary"
                          style={{ padding: '4px 12px', fontSize: 13 }}
                          disabled={busy === p.staff_id}
                          onClick={() => void decide(p.staff_id, 'approve')}
                        >
                          {busy === p.staff_id ? '…' : 'Add to Field'}
                        </button>
                        <button
                          className="eq-btn-ghost"
                          style={{ padding: '4px 12px', fontSize: 13 }}
                          disabled={busy === p.staff_id}
                          onClick={() => void decide(p.staff_id, 'reject')}
                        >
                          Dismiss
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}

export default function AdminCardsFeed() {
  return (
    <Gate
      perm="admin.review_cards"
      fallback={
        <>
          <Topbar />
          <main className="eq-page">
            <div className="eq-empty">
              <p className="eq-empty__title">Not allowed</p>
              <p>Only managers can review Cards submissions.</p>
            </div>
          </main>
        </>
      }
    >
      <AdminCardsFeedInner />
    </Gate>
  );
}
