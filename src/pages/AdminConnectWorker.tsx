// Admin: connect an EXISTING worker's EQ Cards wallet by phone.
//
// The inverse of "invite a worker" (AdminWorkerInviteForm): instead of creating
// a fresh wallet, the employer asks a tradie who ALREADY has an EQ Cards wallet
// to connect it. Consent-gated — the worker approves in the Cards app, and
// their licences then appear on the employer's team. Privacy-safe: the response
// never reveals whether a wallet exists for the number (no enumeration).
//
// Frontend-direct: uses the canonical Supabase client (createSupabaseClient), so
// the org_access_requests RPCs run with the admin's auth.uid() — is_org_admin()
// and the per-admin throttle are enforced server-side in the RPC.
//
// Route: /:tenantSlug/admin/workers/connect
// Gated:  admin.invite_user

import React, { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@eq-solutions/ui';
import { Gate } from '../permissions/Gate';
import { HubLayout } from '../components/HubLayout';
import { defaultSidebarRecords } from '../lib/sidebarConfig';
import { createSupabaseClient } from '../lib/supabaseJwt';
import { useSession } from '../session';

const SIDEBAR_RECORDS = defaultSidebarRecords();

interface OutgoingRequest {
  request_id: string;
  worker_phone: string;
  status: 'pending' | 'approved' | 'declined' | 'cancelled' | 'fulfilled';
  note: string | null;
  requested_at: string;
  responded_at: string | null;
}

const ERR_MAP: Record<string, string> = {
  not_authorized: 'You need manager access to connect workers.',
  already_member: 'That worker is already connected to your team.',
  invalid_phone: 'Enter a valid Australian mobile — e.g. 0412 345 678.',
  recently_declined: 'This worker declined your request. You can send another after 30 days.',
};

function mapError(message: string | undefined, hint?: string | null): string {
  if (!message) return 'Something went wrong. Please try again.';
  if (hint === 'rate_limited' || message.startsWith('Too many')) {
    return 'Too many connection requests in the last hour. Please try again later.';
  }
  return ERR_MAP[message] ?? message;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

// worker_phone is stored as a normalised suffix (no +61/0). Re-add the leading
// 0 for a 9-digit AU mobile so the admin recognises the number they typed.
function displayPhone(suffix: string): string {
  return /^\d{9}$/.test(suffix) ? `0${suffix}` : suffix;
}

const STATUS_STYLE: Record<OutgoingRequest['status'], { label: string; bg: string; fg: string }> = {
  pending:   { label: 'Pending',   bg: '#FEF3C7', fg: '#92400E' },
  approved:  { label: 'Connected', bg: '#DCFCE7', fg: '#166534' },
  fulfilled: { label: 'Connected', bg: '#DCFCE7', fg: '#166534' },
  declined:  { label: 'Declined',  bg: '#FEE2E2', fg: '#991B1B' },
  cancelled: { label: 'Cancelled', bg: '#F1F5F9', fg: '#64748B' },
};

function AdminConnectWorkerInner() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const { session } = useSession();
  const tenantId = session?.user.tenant_id ?? null;

  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgErr, setOrgErr] = useState<string | null>(null);

  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [requests, setRequests] = useState<OutgoingRequest[] | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);

  const loadRequests = useCallback(async (oid: string) => {
    setListErr(null);
    try {
      const sb = await createSupabaseClient();
      const { data, error } = await sb.rpc('eq_cards_list_outgoing_requests', { p_org_id: oid });
      if (error) { setListErr(mapError(error.message, error.hint)); return; }
      setRequests((data as OutgoingRequest[] | null) ?? []);
    } catch (e) {
      setListErr((e as Error).message);
    }
  }, []);

  // Resolve the org for this tenant (organisations_read RLS is public to authed),
  // then load existing requests — both inside one async effect so the initial
  // fetch isn't a separate setState-in-effect.
  useEffect(() => {
    let active = true;
    void (async () => {
      if (!tenantId) return;
      try {
        const sb = await createSupabaseClient();
        const { data, error } = await sb
          .from('organisations')
          .select('id')
          .eq('tenant_id', tenantId)
          .maybeSingle();
        if (!active) return;
        if (error || !data) { setOrgErr('Could not resolve your organisation.'); return; }
        const oid = (data as { id: string }).id;
        setOrgId(oid);
        await loadRequests(oid);
      } catch {
        if (active) setOrgErr('Could not resolve your organisation.');
      }
    })();
    return () => { active = false; };
  }, [tenantId, loadRequests]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setOk(null);
    if (!orgId) { setErr('Organisation not ready — try again in a moment.'); return; }
    if (!phone.trim()) { setErr('Enter the worker’s mobile number.'); return; }
    setBusy(true);
    try {
      const sb = await createSupabaseClient();
      const { error } = await sb.rpc('eq_cards_request_worker_access', {
        p_org_id: orgId,
        p_phone: phone.trim(),
        p_note: note.trim() || null,
      });
      if (error) { setErr(mapError(error.message, error.hint)); return; }
      setOk('Request sent. They’ll see it in EQ Cards and can approve from there.');
      setPhone('');
      setNote('');
      await loadRequests(orgId);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel(requestId: string) {
    if (!orgId) return;
    setListErr(null);
    try {
      const sb = await createSupabaseClient();
      const { error } = await sb.rpc('eq_cards_cancel_access_request', { p_request_id: requestId });
      if (error) { setListErr(mapError(error.message, error.hint)); return; }
      await loadRequests(orgId);
    } catch (e) {
      setListErr((e as Error).message);
    }
  }

  return (
    <ConnectShell>
      <div className="eq-page__header">
        <h1 className="eq-page__title">Connect an existing worker</h1>
        <p className="eq-page__lede">
          For a tradie who already has an EQ Cards wallet. Enter their mobile and they’ll get a
          request in the app — once they approve, their licences appear on your team. We never
          reveal whether a number has a wallet.
        </p>
        <p style={{ marginTop: 4, fontSize: 13 }}>
          Setting up a brand-new worker?{' '}
          <Link to={`/${tenantSlug}/admin/workers/invite`}>Invite a worker instead →</Link>
        </p>
      </div>

      {orgErr && (
        <div className="eq-err" role="alert" style={{ marginBottom: 16, maxWidth: 520 }}>
          {orgErr}
        </div>
      )}

      <form onSubmit={onSubmit} style={{ maxWidth: 520 }}>
        <div style={{ marginBottom: 20 }}>
          <label htmlFor="cw-phone" style={labelStyle}>Mobile *</label>
          <input
            id="cw-phone"
            type="tel"
            required
            autoComplete="off"
            placeholder="0412 345 678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={busy || !orgId}
            style={inputStyle}
          />
          <p style={{ fontSize: 12, color: 'var(--eq-grey)', margin: '6px 0 0' }}>
            Australian mobile. Matched to their existing EQ wallet — nothing is created if there’s no match.
          </p>
        </div>

        <div style={{ marginBottom: 24 }}>
          <label htmlFor="cw-note" style={labelStyle}>Note (optional)</label>
          <input
            id="cw-note"
            type="text"
            placeholder="e.g. Connecting you for the Westfield job"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={busy || !orgId}
            style={inputStyle}
          />
          <p style={{ fontSize: 12, color: 'var(--eq-grey)', margin: '6px 0 0' }}>
            Shown to the worker with the request so they know who you are.
          </p>
        </div>

        <Button type="submit" variant="primary" disabled={busy || !orgId || !phone.trim()}>
          {busy ? 'Sending request…' : 'Send connection request'}
        </Button>

        {err && (
          <div className="eq-err" role="alert" style={{ marginTop: 16 }}>{err}</div>
        )}
        {ok && (
          <div
            role="status"
            style={{
              marginTop: 16, padding: '10px 14px', borderRadius: 8,
              background: 'var(--eq-ice)', border: '1px solid var(--eq-border)',
              fontSize: 13, color: 'var(--eq-ink)',
            }}
          >
            {ok}
          </div>
        )}
      </form>

      {/* Outgoing requests */}
      <div style={{ marginTop: 32, maxWidth: 640 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 12px' }}>Connection requests</h2>
        {listErr && (
          <div className="eq-err" role="alert" style={{ marginBottom: 12 }}>{listErr}</div>
        )}
        {requests === null ? (
          <p style={{ fontSize: 13, color: 'var(--eq-grey)' }}>Loading…</p>
        ) : requests.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--eq-grey)' }}>
            No requests yet. Send one above to connect an existing wallet holder.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {requests.map((r) => {
              const st = STATUS_STYLE[r.status];
              return (
                <div
                  key={r.request_id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 14px', border: '1px solid var(--eq-border)',
                    borderRadius: 8, background: 'var(--eq-bg)',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: 14 }}>{displayPhone(r.worker_phone)}</div>
                    <div style={{ fontSize: 12, color: 'var(--eq-grey)' }}>
                      Requested {fmtDate(r.requested_at)}
                      {r.note ? ` · ${r.note}` : ''}
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: 12, fontWeight: 600, padding: '2px 10px',
                      borderRadius: 20, background: st.bg, color: st.fg, whiteSpace: 'nowrap',
                    }}
                  >
                    {st.label}
                  </span>
                  {r.status === 'pending' && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => void cancel(r.request_id)}>
                      Cancel
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </ConnectShell>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', height: 40, padding: '0 12px',
  border: '1px solid var(--gray-300)', borderRadius: 6,
  background: 'var(--eq-bg)', color: 'var(--eq-ink)', fontSize: 14,
};

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 600,
  color: 'var(--eq-grey)', textTransform: 'uppercase',
  letterSpacing: '0.06em', marginBottom: 8,
};

function ConnectShell({ children }: { children: React.ReactNode }) {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  return (
    <HubLayout sidebarRecords={SIDEBAR_RECORDS}>
      <p style={{ marginBottom: 16 }}>
        <Link to={`/${tenantSlug}/admin/workers`} style={{ fontSize: 13 }}>
          ← Back to worker invites
        </Link>
      </p>
      {children}
    </HubLayout>
  );
}

export default function AdminConnectWorker() {
  return (
    <Gate
      perm="admin.invite_user"
      fallback={
        <ConnectShell>
          <div className="eq-empty">
            <p className="eq-empty__title">Not allowed</p>
            <p>Only managers can connect workers.</p>
          </div>
        </ConnectShell>
      }
    >
      <AdminConnectWorkerInner />
    </Gate>
  );
}
