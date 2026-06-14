import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

interface LineItem {
  description: string;
  quantity: number;
  unit: string | null;
  unit_rate: number;
  line_total: number;
  category: string;
}

interface PortalQuote {
  quote_number: string;
  project_name: string | null;
  scope_of_works: string | null;
  subtotal_cents: number;
  gst_cents: number;
  total_cents: number;
  sent_at: string | null;
  estimator_name: string | null;
  attn_name: string | null;
  attn_first_name: string | null;
  line_items: LineItem[];
}

interface PortalCustomer {
  company_name: string | null;
  abn: string | null;
  phone: string | null;
  email: string | null;
}

interface PortalData {
  link_id: string;
  token: string;
  accepted_at: string | null;
  declined_at: string | null;
  quote: PortalQuote;
  customer: PortalCustomer;
}

type PageState =
  | { type: 'loading' }
  | { type: 'error'; message: string }
  | { type: 'loaded'; data: PortalData }
  | { type: 'accepted' }
  | { type: 'declined' };

const CAT_ORDER = ['labour', 'material', 'subcontractor', 'one_off', ''];
const CAT_LABELS: Record<string, string> = {
  labour: 'Labour',
  material: 'Materials',
  subcontractor: 'Subcontractors',
  one_off: 'One-off',
  '': 'Other',
};

function fmt(cents: number): string {
  return (cents / 100).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
}

export default function QuotePortal() {
  const { tenantSlug, token } = useParams<{ tenantSlug: string; token: string }>();
  const [state, setState] = useState<PageState>({ type: 'loading' });
  const [clientName, setClientName] = useState('');
  const [clientNote, setClientNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showDeclineForm, setShowDeclineForm] = useState(false);

  useEffect(() => {
    if (!tenantSlug || !token) { setState({ type: 'error', message: 'Invalid link.' }); return; }
    void fetch(`/.netlify/functions/quote-portal?tenant=${encodeURIComponent(tenantSlug)}&token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const json = await res.json() as { ok: boolean; data?: PortalData; error?: string };
        if (!json.ok) {
          const msg = json.error === 'link_not_found' ? 'This link is not valid or has expired.'
                    : json.error === 'link_expired'   ? 'This quote link has expired.'
                    : 'Could not load quote. Please try again.';
          setState({ type: 'error', message: msg });
        } else {
          setState({ type: 'loaded', data: json.data! });
        }
      })
      .catch(() => setState({ type: 'error', message: 'Network error. Please try again.' }));
  }, [tenantSlug, token]);

  const respond = async (decision: 'accept' | 'decline') => {
    if (!tenantSlug || !token || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch('/.netlify/functions/quote-accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant: tenantSlug,
          token,
          decision,
          client_name: clientName.trim() || null,
          client_note: clientNote.trim() || null,
        }),
      });
      const json = await res.json() as { ok: boolean; error?: string };
      if (json.ok) {
        setState(decision === 'accept' ? { type: 'accepted' } : { type: 'declined' });
      } else {
        const msg = json.error === 'already_responded' ? 'This quote has already been responded to.'
                  : json.error === 'link_expired'      ? 'This link has expired.'
                  : 'Something went wrong. Please try again.';
        alert(msg);
      }
    } catch {
      alert('Network error. Please try again.');
    }
    setSubmitting(false);
  };

  if (state.type === 'loading') {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <p style={{ color: '#666', textAlign: 'center' }}>Loading quote…</p>
        </div>
      </div>
    );
  }

  if (state.type === 'error') {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={styles.logo}>SKS Technologies</div>
          <p style={{ color: '#c0392b', marginTop: 12 }}>{state.message}</p>
        </div>
      </div>
    );
  }

  if (state.type === 'accepted') {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={styles.logo}>SKS Technologies</div>
          <div style={{ textAlign: 'center', marginTop: 24 }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✓</div>
            <h2 style={{ color: '#1F335C', marginBottom: 8 }}>Quote Accepted</h2>
            <p style={{ color: '#555' }}>Thank you. We'll be in touch shortly to progress the work.</p>
          </div>
        </div>
      </div>
    );
  }

  if (state.type === 'declined') {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={styles.logo}>SKS Technologies</div>
          <div style={{ textAlign: 'center', marginTop: 24 }}>
            <h2 style={{ color: '#1F335C', marginBottom: 8 }}>Quote Declined</h2>
            <p style={{ color: '#555' }}>Thank you for letting us know. We'll follow up if you'd like to discuss alternatives.</p>
          </div>
        </div>
      </div>
    );
  }

  const { data } = state;
  const q = data.quote;
  const c = data.customer;
  const alreadyResponded = !!(data.accepted_at || data.declined_at);

  // Group line items by category
  const grouped = new Map<string, LineItem[]>();
  for (const cat of CAT_ORDER) grouped.set(cat, []);
  for (const li of (q.line_items ?? [])) {
    const key = CAT_ORDER.includes(li.category) ? li.category : '';
    grouped.get(key)!.push(li);
  }

  const sentDate = q.sent_at
    ? new Date(q.sent_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
    : '';

  const attn = [q.attn_first_name, q.attn_name].filter(Boolean).join(' ');

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        {/* Header */}
        <div style={styles.header}>
          <div>
            <div style={styles.logo}>SKS Technologies</div>
            <div style={{ fontSize: 12, color: '#777', marginTop: 2 }}>Electrical &amp; Data Services</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#1F335C' }}>Quote {q.quote_number}</div>
            {sentDate && <div style={{ fontSize: 12, color: '#777', marginTop: 2 }}>{sentDate}</div>}
          </div>
        </div>

        {/* Attention */}
        <div style={{ marginBottom: 16, fontSize: 14, color: '#333' }}>
          {attn && <div><strong>Attention:</strong> {attn}</div>}
          {c.company_name && <div>{c.company_name}</div>}
        </div>

        {/* Project */}
        {q.project_name && (
          <div style={{ marginBottom: 12 }}>
            <span style={styles.label}>RE:</span>{' '}
            <strong style={{ color: '#1F335C' }}>{q.project_name}</strong>
          </div>
        )}

        {/* Scope */}
        {q.scope_of_works && (
          <div style={{ marginBottom: 16 }}>
            <div style={styles.sectionTitle}>Scope of Works</div>
            <p style={{ fontSize: 13, lineHeight: 1.6, color: '#333', whiteSpace: 'pre-wrap' }}>{q.scope_of_works}</p>
          </div>
        )}

        {/* Line items */}
        <div style={styles.sectionTitle}>Pricing</div>
        <div style={{ overflowX: 'auto', marginBottom: 12 }}>
          <table style={styles.table}>
            <thead>
              <tr style={{ background: '#1F335C', color: '#fff' }}>
                <th style={{ ...styles.th, width: '46%', textAlign: 'left' }}>Description</th>
                <th style={{ ...styles.th, textAlign: 'right', width: '10%' }}>Qty</th>
                <th style={{ ...styles.th, width: '8%' }}>Unit</th>
                <th style={{ ...styles.th, textAlign: 'right', width: '14%' }}>Rate</th>
                <th style={{ ...styles.th, textAlign: 'right', width: '14%' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {CAT_ORDER.map((cat) => {
                const items = grouped.get(cat) ?? [];
                if (items.length === 0) return null;
                return [
                  <tr key={`cat-${cat}`}>
                    <td colSpan={5} style={styles.catRow}>{CAT_LABELS[cat] ?? cat}</td>
                  </tr>,
                  ...items.map((li, i) => (
                    <tr key={`${cat}-${i}`} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={styles.td}>{li.description}</td>
                      <td style={{ ...styles.td, textAlign: 'right' }}>
                        {li.quantity % 1 === 0 ? li.quantity.toFixed(0) : li.quantity.toFixed(2)}
                      </td>
                      <td style={styles.td}>{li.unit ?? ''}</td>
                      <td style={{ ...styles.td, textAlign: 'right' }}>{fmt(li.unit_rate * 100)}</td>
                      <td style={{ ...styles.td, textAlign: 'right', fontWeight: 500 }}>{fmt(li.line_total * 100)}</td>
                    </tr>
                  )),
                ];
              })}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
          <table style={{ width: 240, fontSize: 13, borderCollapse: 'collapse' }}>
            <tbody>
              <tr>
                <td style={{ padding: '4px 8px', color: '#555' }}>Subtotal (ex GST)</td>
                <td style={{ padding: '4px 8px', textAlign: 'right' }}>{fmt(q.subtotal_cents)}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 8px', color: '#555' }}>GST (10%)</td>
                <td style={{ padding: '4px 8px', textAlign: 'right' }}>{fmt(q.gst_cents)}</td>
              </tr>
              <tr style={{ background: '#1F335C', color: '#fff', fontWeight: 700 }}>
                <td style={{ padding: '6px 8px', borderRadius: '0 0 0 4px' }}>Total (inc GST)</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', borderRadius: '0 0 4px 0' }}>{fmt(q.total_cents)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Already responded */}
        {alreadyResponded && (
          <div style={{ background: data.accepted_at ? '#e8f5e9' : '#fce4ec', border: `1px solid ${data.accepted_at ? '#81c784' : '#f48fb1'}`, borderRadius: 6, padding: '12px 16px', marginBottom: 16, color: data.accepted_at ? '#2e7d32' : '#880e4f', fontWeight: 500 }}>
            {data.accepted_at ? `You accepted this quote on ${new Date(data.accepted_at).toLocaleDateString('en-AU')}.` : `You declined this quote on ${new Date(data.declined_at!).toLocaleDateString('en-AU')}.`}
          </div>
        )}

        {/* Accept / Decline buttons */}
        {!alreadyResponded && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 13, color: '#555', marginBottom: 12 }}>
              Please review the above and let us know if you'd like to proceed.
            </div>

            {/* Name field */}
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 12, color: '#555', display: 'block', marginBottom: 4 }}>Your name (optional)</label>
              <input
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="e.g. Jane Smith"
                style={styles.input}
              />
            </div>

            {/* Decline note (shown when decline form open) */}
            {showDeclineForm && (
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 12, color: '#555', display: 'block', marginBottom: 4 }}>Reason (optional)</label>
                <textarea
                  value={clientNote}
                  onChange={(e) => setClientNote(e.target.value)}
                  placeholder="e.g. Over budget, going with another supplier"
                  rows={3}
                  style={{ ...styles.input, resize: 'vertical' }}
                />
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void respond('accept')}
                style={styles.btnAccept}
              >
                {submitting ? '…' : 'Accept Quote'}
              </button>
              {!showDeclineForm ? (
                <button
                  type="button"
                  onClick={() => setShowDeclineForm(true)}
                  style={styles.btnDecline}
                >
                  Decline
                </button>
              ) : (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void respond('decline')}
                  style={styles.btnDecline}
                >
                  {submitting ? '…' : 'Confirm Decline'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 12, fontSize: 11, color: '#aaa', display: 'flex', justifyContent: 'space-between' }}>
          <span>SKS Technologies Pty Ltd</span>
          <span>NSW Electrical Contractor</span>
        </div>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    background: '#f0f4f8',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    padding: '32px 16px',
  } as React.CSSProperties,
  card: {
    background: '#fff',
    borderRadius: 8,
    boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
    padding: '32px 36px',
    maxWidth: 820,
    width: '100%',
  } as React.CSSProperties,
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottom: '2px solid #1F335C',
    paddingBottom: 16,
    marginBottom: 20,
  } as React.CSSProperties,
  logo: {
    fontSize: 20,
    fontWeight: 700,
    color: '#1F335C',
    letterSpacing: '-0.3px',
  } as React.CSSProperties,
  label: {
    fontSize: 12,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.4px',
    color: '#1F335C',
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    color: '#1F335C',
    marginBottom: 6,
    marginTop: 4,
  } as React.CSSProperties,
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: 13,
  } as React.CSSProperties,
  th: {
    padding: '6px 8px',
    fontSize: 11,
    fontWeight: 600,
  } as React.CSSProperties,
  td: {
    padding: '5px 8px',
    verticalAlign: 'top',
    color: '#333',
  } as React.CSSProperties,
  catRow: {
    background: '#f0f4f8',
    color: '#1F335C',
    fontWeight: 600,
    fontSize: 11,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.3px',
    padding: '4px 8px',
  } as React.CSSProperties,
  input: {
    width: '100%',
    padding: '8px 10px',
    border: '1px solid #d1d5db',
    borderRadius: 4,
    fontSize: 13,
    outline: 'none',
    fontFamily: 'inherit',
  } as React.CSSProperties,
  btnAccept: {
    background: '#1F335C',
    color: '#fff',
    border: 'none',
    borderRadius: 5,
    padding: '10px 20px',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  } as React.CSSProperties,
  btnDecline: {
    background: '#fff',
    color: '#6b7280',
    border: '1px solid #d1d5db',
    borderRadius: 5,
    padding: '10px 20px',
    fontSize: 14,
    cursor: 'pointer',
    fontFamily: 'inherit',
  } as React.CSSProperties,
};
