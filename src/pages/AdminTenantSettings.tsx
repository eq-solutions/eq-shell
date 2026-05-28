import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSession } from '../session';
import { Gate } from '../permissions/Gate';
import { HubSidebar, HUB_APP_ICONS, type HubApp } from '../components/HubSidebar';
import { Skeleton } from '../components/Skeleton';
import { EqError } from '../components/EqError';
import { createSupabaseClient } from '../lib/supabaseJwt';
import { moduleEnabled } from '../session';

interface ModuleEntitlement {
  module: string;
  enabled: boolean;
}

interface TenantSettings {
  id: string;
  slug: string;
  name: string;
  brand_color: string | null;
  brand_logo_url: string | null;
  field_tenant_slug: string | null;
  active: boolean;
  modules: ModuleEntitlement[];
}

const MODULE_LABELS: Record<string, string> = {
  intake: 'Intake',
  cards: 'Cards',
  field: 'Field',
  quotes: 'Quotes',
  service: 'Service',
};

const HUB_APPS = [
  { key: 'field',   label: 'EQ Field',   to: 'field',   isBeta: false },
  { key: 'service', label: 'EQ Service', to: 'service', isBeta: false },
  { key: 'quotes',  label: 'EQ Quotes',  to: 'quotes',  isBeta: false },
  { key: 'cards',   label: 'EQ Cards',   to: 'cards',   isBeta: true  },
];

function AdminTenantSettingsInner() {
  const { session } = useSession();
  const logoUploadRef = useRef<HTMLInputElement>(null);

  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const [name, setName] = useState('');
  const [brandColor, setBrandColor] = useState('');
  const [brandLogoUrl, setBrandLogoUrl] = useState('');
  const [moduleState, setModuleState] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [logoUploadStatus, setLogoUploadStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'uploading' }
    | { kind: 'success' }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });
  const [fieldTenantSlug, setFieldTenantSlug] = useState<string>('');
  const [colorDetected, setColorDetected] = useState(false);

  const isPlatformAdmin = session?.user.is_platform_admin ?? false;

  const load = async () => {
    setErr(null);
    try {
      const sb = await createSupabaseClient();
      const { data, error } = await sb.rpc('eq_get_tenant_settings');
      if (error) { setErr(error.message); return; }
      const rows = (data as TenantSettings[] | null) ?? [];
      if (rows.length === 0) { setErr('Settings not found.'); return; }
      const s = rows[0];
      setSettings(s);
      setName(s.name);
      setBrandColor(s.brand_color ?? '');
      setBrandLogoUrl(s.brand_logo_url ?? '');
      setFieldTenantSlug(s.field_tenant_slug ?? '');
      const m: Record<string, boolean> = {};
      s.modules.forEach((mod) => { m[mod.module] = mod.enabled; });
      setModuleState(m);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  useEffect(() => { void load(); }, []);

  const ALLOWED_LOGO_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/svg+xml',
    'image/webp',
  ]);

  function extractLogoColor(file: File): Promise<string | null> {
    if (file.type === 'image/svg+xml') return Promise.resolve(null);
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 48;
          canvas.height = 48;
          const ctx = canvas.getContext('2d');
          if (!ctx) { resolve(null); return; }
          ctx.drawImage(img, 0, 0, 48, 48);
          const { data } = ctx.getImageData(0, 0, 48, 48);
          const counts = new Map<string, number>();
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
            if (a < 128) continue;
            if (r > 220 && g > 220 && b > 220) continue;
            if (r < 35 && g < 35 && b < 35) continue;
            const key = `${Math.round(r / 32) * 32},${Math.round(g / 32) * 32},${Math.round(b / 32) * 32}`;
            counts.set(key, (counts.get(key) ?? 0) + 1);
          }
          let best = '', max = 0;
          counts.forEach((n, k) => { if (n > max) { max = n; best = k; } });
          if (!best) { resolve(null); return; }
          const [rv, gv, bv] = best.split(',').map(Number);
          resolve('#' + [rv, gv, bv].map((v) => Math.min(255, v).toString(16).padStart(2, '0')).join(''));
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!ALLOWED_LOGO_TYPES.has(file.type)) {
      setLogoUploadStatus({ kind: 'error', message: 'File type not supported. Use PNG, JPEG, SVG, or WebP.' });
      if (logoUploadRef.current) logoUploadRef.current.value = '';
      return;
    }
    if (file.size > 524288) {
      setLogoUploadStatus({ kind: 'error', message: 'File must be under 512 KB.' });
      if (logoUploadRef.current) logoUploadRef.current.value = '';
      return;
    }

    setLogoUploadStatus({ kind: 'uploading' });

    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch('/.netlify/functions/upload-tenant-logo', {
        method: 'POST',
        body,
      });

      if (res.status === 404) {
        setLogoUploadStatus({ kind: 'error', message: 'Upload coming soon.' });
        return;
      }

      if (!res.ok) {
        let message = 'Upload failed.';
        try {
          const json = (await res.json()) as { error?: string; message?: string };
          message = json.error ?? json.message ?? message;
        } catch {
          // ignore parse error — use fallback message
        }
        setLogoUploadStatus({ kind: 'error', message });
        return;
      }

      const json = (await res.json()) as { url?: string };
      setLogoUploadStatus({ kind: 'success' });
      if (json.url) {
        setBrandLogoUrl(json.url);
        const detected = await extractLogoColor(file);
        if (detected) { setBrandColor(detected); setColorDetected(true); }
      }
    } catch (e) {
      setLogoUploadStatus({ kind: 'error', message: (e as Error).message ?? 'Upload failed.' });
    } finally {
      if (logoUploadRef.current) logoUploadRef.current.value = '';
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setSaveErr(null);
    setBusy(true);
    setSavedAt(null);

    const payload: Record<string, unknown> = {};
    if (name !== settings.name) payload.name = name;
    if (brandColor !== (settings.brand_color ?? '')) payload.brand_color = brandColor;
    if (brandLogoUrl !== (settings.brand_logo_url ?? '')) payload.brand_logo_url = brandLogoUrl;
    if (isPlatformAdmin && fieldTenantSlug !== (settings.field_tenant_slug ?? '')) {
      payload.field_tenant_slug = fieldTenantSlug || null;
    }

    if (isPlatformAdmin) {
      const changedModules: ModuleEntitlement[] = [];
      Object.entries(moduleState).forEach(([mod, enabled]) => {
        const orig = settings.modules.find((m) => m.module === mod)?.enabled ?? false;
        if (orig !== enabled) changedModules.push({ module: mod, enabled });
      });
      if (changedModules.length > 0) payload.modules = changedModules;
    }

    if (Object.keys(payload).length === 0) {
      setBusy(false);
      setSavedAt(Date.now());
      return;
    }

    try {
      const sb = await createSupabaseClient();
      const { data, error } = await sb.rpc('eq_update_tenant_settings', { p_payload: payload });
      if (error) { setSaveErr(error.message); setBusy(false); return; }
      const rows = (data as TenantSettings[] | null) ?? [];
      if (rows.length > 0) {
        const s = rows[0];
        setSettings(s);
        setName(s.name);
        setBrandColor(s.brand_color ?? '');
        setBrandLogoUrl(s.brand_logo_url ?? '');
        const m: Record<string, boolean> = {};
        s.modules.forEach((mod) => { m[mod.module] = mod.enabled; });
        setModuleState(m);
        setFieldTenantSlug(s.field_tenant_slug ?? '');
      }
      setSavedAt(Date.now());
    } catch (e) {
      setSaveErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const sidebarApps: HubApp[] = HUB_APPS
    .filter((a) => session ? moduleEnabled(session, a.key) : false)
    .map((a) => ({
      key: a.key, label: a.label, to: a.to, isBeta: a.isBeta,
      count: null, hasAlert: false, icon: HUB_APP_ICONS[a.key],
    }));

  return (
    <div className="eq-hub">
      <HubSidebar apps={sidebarApps} />

      <div className="eq-hub__content">
        <div className="eq-hub-content">

          {err && <EqError title="Couldn't load settings" message={err} onRetry={load} />}

          {!settings && !err && <Skeleton variant="card" />}

          {settings && (
            <form onSubmit={onSubmit} style={{ maxWidth: 580 }}>
              <div style={{ marginBottom: 28 }}>
                <h1 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 4px' }}>Settings</h1>
                <p style={{ fontSize: 13, color: 'var(--gray-500)', margin: 0 }}>
                  {settings.slug} · {settings.modules.filter((m) => m.enabled).length} apps enabled
                </p>
              </div>

              {/* Branding */}
              <section className="eq-section">
                <h2 className="eq-section__heading">Branding</h2>

                <FieldRow label="Business name">
                  <input
                    type="text" value={name} onChange={(e) => setName(e.target.value)}
                    disabled={busy} style={inputStyle} required
                  />
                </FieldRow>

                <FieldRow label="Brand colour" hint="Hex, e.g. #3DA8D8. Overrides the default sky blue accent throughout the hub.">
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <input
                      type="text" value={brandColor}
                      onChange={(e) => { setBrandColor(e.target.value); setColorDetected(false); }}
                      placeholder="#3DA8D8" disabled={busy}
                      style={{ ...inputStyle, fontFamily: 'ui-monospace, Menlo, Consolas, monospace', flex: 1 }}
                    />
                    <input
                      type="color"
                      value={/^#[0-9A-Fa-f]{6}$/.test(brandColor) ? brandColor : '#3DA8D8'}
                      onChange={(e) => { setBrandColor(e.target.value); setColorDetected(false); }}
                      disabled={busy}
                      style={{ width: 40, height: 40, padding: 2, border: '1px solid var(--gray-300)', borderRadius: 6, cursor: 'pointer', background: 'none' }}
                      title="Pick a colour"
                    />
                  </div>
                  {colorDetected && (
                    <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--eq-brand, #3DA8D8)' }}>
                      Detected from logo — adjust if needed
                    </p>
                  )}
                </FieldRow>

                <FieldRow label="Logo" hint="PNG, JPEG, SVG or WebP · max 512 KB. Brand colour is auto-detected on upload.">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {brandLogoUrl && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: '1px solid var(--gray-200)', borderRadius: 6, background: 'var(--gray-50)' }}>
                        <img src={brandLogoUrl} alt="Logo preview" style={{ height: 32, maxWidth: 120, objectFit: 'contain' }} />
                        <button type="button" onClick={() => setBrandLogoUrl('')} style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--gray-400)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Remove</button>
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        ref={logoUploadRef}
                        type="file"
                        accept="image/png,image/jpeg,image/svg+xml,image/webp"
                        style={{ display: 'none' }}
                        onChange={(e) => void handleLogoUpload(e)}
                      />
                      <button
                        type="button"
                        onClick={() => { setLogoUploadStatus({ kind: 'idle' }); logoUploadRef.current?.click(); }}
                        disabled={logoUploadStatus.kind === 'uploading' || busy}
                        className="eq-btn-primary"
                        style={{ fontSize: 13, padding: '0 16px', height: 36, flexShrink: 0 }}
                      >
                        {logoUploadStatus.kind === 'uploading' ? 'Uploading…' : 'Upload logo'}
                      </button>
                      <input
                        type="url" value={brandLogoUrl}
                        onChange={(e) => setBrandLogoUrl(e.target.value)}
                        placeholder="or paste a URL…"
                        disabled={busy}
                        style={{ ...inputStyle, flex: 1, fontSize: 13 }}
                      />
                    </div>
                    {logoUploadStatus.kind === 'success' && (
                      <span style={{ fontSize: 13, color: '#15803D', fontWeight: 500 }}>✓ Logo updated</span>
                    )}
                    {logoUploadStatus.kind === 'error' && (
                      <span style={{ fontSize: 13, color: '#B91C1C' }}>{logoUploadStatus.message}</span>
                    )}
                  </div>
                </FieldRow>
              </section>

              {/* Integrations — Field workspace (platform admin only) */}
              {isPlatformAdmin && (
                <section className="eq-section">
                  <h2 className="eq-section__heading">Integrations</h2>
                  <FieldRow
                    label="Field workspace"
                    hint="Which EQ Field organisation users on this tenant open by default."
                  >
                    <select
                      value={fieldTenantSlug}
                      onChange={(e) => setFieldTenantSlug(e.target.value)}
                      disabled={busy}
                      style={{ ...inputStyle, cursor: 'pointer' }}
                    >
                      <option value="">None</option>
                      <option value="sks">SKS Technologies</option>
                      <option value="eq">EQ Demo</option>
                      <option value="demo-trades">Demo Trades</option>
                      <option value="melbourne">Melbourne</option>
                    </select>
                  </FieldRow>
                </section>
              )}

              {/* Apps */}
              <section className="eq-section">
                <div className="eq-section__head">
                  <h2 className="eq-section__heading">Apps</h2>
                  {!isPlatformAdmin && (
                    <span className="eq-section__hint">Read-only · contact EQ to change</span>
                  )}
                </div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {settings.modules.map((m) => (
                    <label
                      key={m.module}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '12px 16px', border: '1px solid var(--eq-border)',
                        borderRadius: 6, background: 'var(--eq-bg)',
                        cursor: isPlatformAdmin ? 'pointer' : 'default',
                        opacity: isPlatformAdmin ? 1 : 0.85,
                      }}
                    >
                      <span>
                        <strong style={{ display: 'block', fontSize: 14 }}>{MODULE_LABELS[m.module] ?? m.module}</strong>
                        <span className="eq-table__mute">{m.module}</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={moduleState[m.module] ?? m.enabled}
                        disabled={!isPlatformAdmin || busy}
                        onChange={(e) => setModuleState((prev) => ({ ...prev, [m.module]: e.target.checked }))}
                      />
                    </label>
                  ))}
                </div>
              </section>

              <section className="eq-section">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button type="submit" className="eq-btn-primary" disabled={busy} style={{ width: 'auto', padding: '0 20px' }}>
                    {busy ? 'Saving…' : 'Save changes'}
                  </button>
                  {savedAt && !saveErr && <span className="eq-pill eq-pill--ok">Saved</span>}
                </div>
                {saveErr && <div className="eq-err" role="alert" style={{ marginTop: 16 }}>{saveErr}</div>}
              </section>
            </form>
          )}

        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', height: 40, padding: '0 12px',
  border: '1px solid var(--gray-300)', borderRadius: 6,
  background: 'var(--eq-bg)', color: 'var(--eq-ink)',
};

function FieldRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--eq-grey)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
        {label}
      </label>
      {children}
      {hint && <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--eq-grey)' }}>{hint}</p>}
    </div>
  );
}

export default function AdminTenantSettings() {
  return (
    <Gate
      perm="admin.list_users"
      fallback={
        <div className="eq-empty">
          <p className="eq-empty__title">Not allowed</p>
          <p>Only managers can edit settings.</p>
        </div>
      }
    >
      <AdminTenantSettingsInner />
    </Gate>
  );
}
