// AssetDrawerExtras — asset-only section of the entity detail drawer.
// Renders the equipment's hierarchy (parent + children) and a scannable QR
// label that deep-links back to this asset. Mounted only for entity 'asset'.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';

interface AssetLite {
  asset_id: string;
  name: string | null;
  external_id: string | null;
  asset_type: string | null;
  active: boolean | null;
}

interface RelationsResponse {
  ok: boolean;
  parent: AssetLite | null;
  children: AssetLite[];
}

// What a scan should land on: the equipment list pre-filtered to this item.
// Reuses the existing ?search= handling rather than a bespoke focus route.
function assetSearchHref(tenantSlug: string, row: Record<string, unknown>): string {
  const tag =
    (row.external_id as string | null) ||
    (row.serial_number as string | null) ||
    (row.asset_id as string | null) ||
    '';
  return `/${tenantSlug}/data/asset?search=${encodeURIComponent(tag)}`;
}

function relLabel(a: AssetLite): string {
  return a.name || a.external_id || a.asset_id.slice(0, 8);
}

export function AssetDrawerExtras({
  tenantSlug,
  row,
}: {
  tenantSlug: string;
  row: Record<string, unknown>;
}) {
  const assetId = row.asset_id as string;
  const [rel, setRel] = useState<RelationsResponse | null>(null);
  const [qr, setQr] = useState<string | null>(null);

  // Hierarchy (parent + children).
  useEffect(() => {
    let cancelled = false;
    setRel(null);
    fetch(`/.netlify/functions/asset-relations?id=${encodeURIComponent(assetId)}`, {
      credentials: 'include',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: RelationsResponse | null) => { if (!cancelled && body?.ok) setRel(body); })
      .catch(() => { /* hierarchy is best-effort */ });
    return () => { cancelled = true; };
  }, [assetId]);

  // QR of the deep link.
  const deepLink = `${window.location.origin}${assetSearchHref(tenantSlug, row)}`;
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(deepLink, { margin: 1, width: 160 })
      .then((url) => { if (!cancelled) setQr(url); })
      .catch(() => { if (!cancelled) setQr(null); });
    return () => { cancelled = true; };
  }, [deepLink]);

  const esc = (s: string) =>
    String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const printLabel = () => {
    if (!qr) return;
    const name = (row.name as string | null) || 'Equipment';
    const tag = (row.external_id as string | null) || '';
    const w = window.open('', '_blank', 'width=400,height=480');
    if (!w) return;
    w.document.write(
      `<html><head><title>${esc(name)}</title></head><body style="font-family:sans-serif;text-align:center;padding:24px">` +
      `<img src="${qr}" width="180" height="180" alt="QR" />` +
      `<div style="font-size:16px;font-weight:700;margin-top:12px">${esc(name)}</div>` +
      (tag ? `<div style="font-size:13px;color:#555">${esc(tag)}</div>` : '') +
      `</body></html>`,
    );
    w.document.close();
    w.focus();
    w.print();
  };

  const sectionLabel: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
    letterSpacing: '0.06em', color: '#64748B', margin: '0 0 8px',
  };
  const chip: React.CSSProperties = {
    display: 'inline-block', fontSize: 13, color: '#2986B4',
    padding: '4px 0', textDecoration: 'none',
  };

  const hasHierarchy = rel && (rel.parent || rel.children.length > 0);

  return (
    <div style={{ padding: '12px 24px 0', borderBottom: '1px solid #E2E8F0' }}>
      {/* Hierarchy */}
      {hasHierarchy && (
        <div style={{ marginBottom: 16 }}>
          <p style={sectionLabel}>Hierarchy</p>
          {rel?.parent && (
            <div style={{ marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: '#64748B' }}>Part of </span>
              <Link to={assetSearchHref(tenantSlug, rel.parent as unknown as Record<string, unknown>)} style={chip}>
                {relLabel(rel.parent)} →
              </Link>
            </div>
          )}
          {rel && rel.children.length > 0 && (
            <div>
              <span style={{ fontSize: 12, color: '#64748B' }}>
                {rel.children.length} part{rel.children.length === 1 ? '' : 's'}:
              </span>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {rel.children.map((c) => (
                  <Link key={c.asset_id} to={assetSearchHref(tenantSlug, c as unknown as Record<string, unknown>)} style={chip}>
                    {relLabel(c)}{c.asset_type ? ` · ${c.asset_type}` : ''} →
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* QR label */}
      <div style={{ marginBottom: 16 }}>
        <p style={sectionLabel}>Scan label</p>
        {qr ? (
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <img src={qr} width={96} height={96} alt="Asset QR code" style={{ border: '1px solid #E2E8F0', borderRadius: 6 }} />
            <button type="button" className="eq-btn-ghost" style={{ fontSize: 12 }} onClick={printLabel}>
              Print label
            </button>
          </div>
        ) : (
          <span style={{ fontSize: 12, color: '#64748B' }}>Generating…</span>
        )}
      </div>
    </div>
  );
}
