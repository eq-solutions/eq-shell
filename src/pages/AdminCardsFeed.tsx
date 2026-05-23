// Admin review queue for Cards profiles not yet in Field.
//
// Gated by admin.review_cards — manager + platform_admin only.
// Calls cards-pending-staff (GET) to list profiles awaiting review,
// then cards-approve-staff (POST) to approve or reject each one.
//
// On approve: a people row + qualifications rows are written to Field.
// On reject:  the person is marked rejected and removed from the queue.

import { useEffect, useState } from 'react';
import { Gate } from '../permissions/Gate';
import { Topbar } from '../components/Topbar';
import { Skeleton } from '../components/Skeleton';
import { EqError } from '../components/EqError';

interface Licence {
  licence_id: string;
  licence_type: string;
  licence_number: string | null;
  issuing_authority: string | null;
  state: string | null;
  issue_date: string | null;
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
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-AU');
}

function fullName(s: PendingStaff): string {
  return ([s.first_name, s.last_name].filter(Boolean).join(' ') || s.email) ?? 'Unknown';
}

function StaffCard({
  person,
  onDecision,
}: {
  person: PendingStaff;
  onDecision: (id: string, action: 'approve' | 'reject') => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  const decide = async (action: 'approve' | 'reject') => {
    setBusy(true);
    await onDecision(person.staff_id, action);
    setBusy(false);
  };

  return (
    <div
      style={{
        border: '1px solid var(--eq-border)',
        borderRadius: 8,
        padding: 20,
        marginBottom: 12,
        background: 'var(--eq-white)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontWeight: 600, fontSize: 15, margin: '0 0 2px' }}>{fullName(person)}</p>
          <p style={{ color: 'var(--eq-grey)', fontSize: 13, margin: '0 0 8px' }}>
            {person.email ?? '—'} · {person.phone ?? '—'} · DOB {formatDate(person.date_of_birth)}
          </p>

          {person.licences.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {person.licences.map((l) => (
                <span
                  key={l.licence_id}
                  style={{
                    background: 'var(--eq-ice)',
                    borderRadius: 4,
                    padding: '3px 8px',
                    fontSize: 12,
                    color: 'var(--eq-ink)',
                  }}
                >
                  <strong>{l.licence_type}</strong>
                  {l.licence_number ? ` · ${l.licence_number}` : ''}
                  {l.expiry_date ? ` · exp ${formatDate(l.expiry_date)}` : ''}
                </span>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: 12, color: 'var(--eq-grey)', margin: 0 }}>No licences recorded</p>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button
            className="eq-btn-primary"
            style={{ padding: '6px 14px', fontSize: 13 }}
            disabled={busy}
            onClick={() => void decide('approve')}
          >
            {busy ? '…' : 'Add to Field'}
          </button>
          <button
            className="eq-btn-ghost"
            style={{ padding: '6px 14px', fontSize: 13 }}
            disabled={busy}
            onClick={() => void decide('reject')}
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

function AdminCardsFeedInner() {
  const [pending, setPending] = useState<PendingStaff[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);

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
    try {
      const res = await fetch('/.netlify/functions/cards-approve-staff', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staff_id: staffId, action }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) { setActionErr(body.error ?? 'Something went wrong'); return; }
      // Remove from local list immediately.
      setPending((prev) => (prev ?? []).filter((p) => p.staff_id !== staffId));
    } catch (e) {
      setActionErr((e as Error).message);
    }
  };

  useEffect(() => { void load(); }, []);

  return (
    <>
      <Topbar />
      <main className="eq-page">
        <div className="eq-page__header">
          <h1 className="eq-page__title">Cards — pending review</h1>
          <p className="eq-page__lede">
            Staff who've submitted their details in EQ Cards but haven't been added to Field yet.
            Approve to create their Field profile; dismiss to skip them.
          </p>
        </div>

        {err && <EqError title="Couldn't load pending staff" message={err} onRetry={load} />}
        {actionErr && (
          <p style={{ color: 'var(--eq-error)', fontSize: 13, marginBottom: 12 }}>{actionErr}</p>
        )}

        {pending === null && !err && <Skeleton variant="row" count={3} />}

        {pending !== null && pending.length === 0 && (
          <div className="eq-empty">
            <p className="eq-empty__title">All up to date</p>
            <p>No Cards profiles waiting for review.</p>
          </div>
        )}

        {pending !== null &&
          pending.map((p) => (
            <StaffCard key={p.staff_id} person={p} onDecision={decide} />
          ))}
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
