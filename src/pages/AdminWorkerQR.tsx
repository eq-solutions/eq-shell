// Admin panel: QR code + join link for workers to self-onboard into EQ Cards.
//
// Workers scan the QR or visit the join URL on their phone, verify via
// phone OTP, and their EQ Cards wallet activates automatically — no
// admin-issued invite token needed.
//
// Route: /:tenantSlug/admin/workers/qr
// Gated:  admin.invite_user

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Link, useParams } from 'react-router-dom';
import { Gate } from '../permissions/Gate';
import { HubLayout } from '../components/HubLayout';
import { defaultSidebarRecords } from '../lib/sidebarConfig';
import { useSession } from '../session';

const SIDEBAR_RECORDS = defaultSidebarRecords();
const CARDS_BASE = 'https://cards.eq.solutions';

function joinUrl(tenantSlug: string, _orgName?: string): string {
  // Routes to /claim?tenant= so workers enter their phone and the app
  // looks up their pre-existing invite. Falls back to an error screen if
  // no invite is found — keeps open enrollment off by default.
  return `${CARDS_BASE}/claim?tenant=${encodeURIComponent(tenantSlug)}`;
}

function whatsAppMsg(orgName: string, url: string): string {
  return `Hi! Join ${orgName} on EQ Cards and access your licences and credentials from your phone:\n\n${url}`;
}

function AdminWorkerQRInner() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const { session } = useSession();
  const slug = tenantSlug ?? '';
  const orgName = session?.tenant?.name ?? (slug.charAt(0).toUpperCase() + slug.slice(1));
  const url = joinUrl(slug, orgName);

  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void QRCode.toDataURL(url, {
      width: 240,
      margin: 2,
      color: { dark: '#1A1A2E', light: '#FFFFFF' },
    }).then(setQrDataUrl);
  }, [url]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // ignore — link is visible for manual copy
    }
  }


  return (
    <HubLayout sidebarRecords={SIDEBAR_RECORDS}>
      <p style={{ marginBottom: 20 }}>
        <Link to={`/${slug}/admin/workers`} style={{ fontSize: 13 }}>
          ← Back to worker invites
        </Link>
      </p>

      <div className="eq-page__header" style={{ marginBottom: 28 }}>
        <h1 className="eq-page__title">Join QR code</h1>
        <p className="eq-page__lede">
          Workers scan this code on their phone to create their EQ Cards wallet instantly — no invite link needed.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 40, alignItems: 'flex-start', flexWrap: 'wrap' }}>

        {/* QR code */}
        <div
          style={{
            padding: 16,
            border: '1px solid var(--eq-border)',
            borderRadius: 12,
            background: '#fff',
            display: 'inline-flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
          }}
        >
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt={`QR code to join ${orgName} on EQ Cards`}
              style={{ width: 200, height: 200, display: 'block' }}
            />
          ) : (
            <div
              style={{
                width: 200, height: 200,
                background: 'var(--eq-ice)',
                borderRadius: 4,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--eq-grey)',
                fontSize: 13,
              }}
            >
              Generating…
            </div>
          )}
          <p style={{ margin: 0, fontSize: 12, color: 'var(--eq-grey)', textAlign: 'center' }}>
            Scan with any phone camera
          </p>
        </div>

        {/* Link + instructions */}
        <div style={{ flex: 1, minWidth: 260 }}>
          <p
            style={{
              fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
              letterSpacing: '0.06em', color: 'var(--eq-grey)', marginBottom: 8,
            }}
          >
            Join link
          </p>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
            <input
              readOnly
              value={url}
              style={{
                flex: 1, height: 40, padding: '0 10px',
                border: '1px solid var(--eq-border)', borderRadius: 6,
                fontSize: 12, fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
                background: 'var(--eq-bg)', color: 'var(--eq-ink)',
              }}
              onFocus={(e) => e.target.select()}
            />
            <button
              type="button"
              onClick={() => void copyLink()}
              style={{
                height: 40, padding: '0 16px', borderRadius: 6,
                border: '1px solid var(--eq-border)', background: 'transparent',
                color: 'var(--eq-deep)', fontWeight: 600, fontSize: 13,
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>

          {/* Share shortcuts */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(whatsAppMsg(orgName, url))}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '8px 16px', borderRadius: 6, fontSize: 13,
                background: '#25D366', color: '#fff', textDecoration: 'none',
                fontWeight: 500,
              }}
            >
              Share via WhatsApp
            </a>
            <a
              href={`sms:?body=${encodeURIComponent(`Join ${orgName} on EQ Cards: ${url}`)}`}
              style={{
                display: 'inline-flex', alignItems: 'center',
                padding: '8px 16px', borderRadius: 6, fontSize: 13,
                border: '1px solid var(--eq-border)', color: 'var(--eq-ink)',
                textDecoration: 'none', fontWeight: 500,
                background: 'var(--eq-bg)',
              }}
            >
              Text
            </a>
          </div>

          {/* How it works */}
          <div
            style={{
              background: 'var(--eq-ice)',
              border: '1px solid var(--eq-border)',
              borderRadius: 8,
              padding: '14px 16px',
            }}
          >
            <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: 'var(--eq-deep)' }}>
              How it works
            </p>
            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--eq-ink)', lineHeight: 1.7 }}>
              <li>Worker scans the QR code or visits the link</li>
              <li>They enter their Australian mobile number</li>
              <li>They verify with a 6-digit SMS code</li>
              <li>Their wallet activates — licences and credentials ready</li>
            </ol>
            <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--eq-grey)' }}>
              Workers who already have an EQ account sign in automatically.
              New workers create their profile in the onboarding flow.
            </p>
          </div>
        </div>
      </div>
    </HubLayout>
  );
}

export default function AdminWorkerQR() {
  return (
    <Gate
      perm="admin.invite_user"
      fallback={
        <HubLayout sidebarRecords={SIDEBAR_RECORDS}>
          <div className="eq-empty">
            <p className="eq-empty__title">Not allowed</p>
            <p>Only managers can view the join QR code.</p>
          </div>
        </HubLayout>
      }
    >
      <AdminWorkerQRInner />
    </Gate>
  );
}
