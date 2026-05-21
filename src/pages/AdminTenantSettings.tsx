// Tenant Settings page — /<tenant>/admin/settings
//
// Manager + platform_admin only. Lets the manager edit tenant name +
// brand colour + logo URL. Module entitlements are read-only for plain
// managers (only platform_admin can flip them).
//
// Backed by:
//   public.eq_get_tenant_settings()
//   public.eq_update_tenant_settings(jsonb)

import { useEffect, useState, type FormEvent } from 'react';
import { useSession } from '../session';
import { Gate } from '../permissions/Gate';
import { Topbar } from '../components/Topbar';
import { Skeleton } from '../components/Skeleton';
import { EqError } from '../components/EqError';
import { createSupabaseClient } from '../lib/supabaseJwt';

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
  active: boolean;
  modules: ModuleEntitlement[];
}

const MODULE_LABELS: Record<string, string> = {
  intake: 'Intake',
  cards: 'Cards',
  field: 'Field',
  quotes: 'Quotes',
  service: 'Service',
  tender_pipeline: 'Tender Pipeline',
};

function ShellWrap({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Topbar />
      <main className="eq-page">{children}</main>
    </>
  );
}

function AdminTenantSettingsInner() {
  const { session } = useSession();
  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const [name, setName] = useState('');
  const [brandColor, setBrandColor] = useState('');
  const [brandLogoUrl, setBrandLogoUrl] = useState('');
  const [moduleState, setModuleState] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const isPlatformAdmin = session?.user.is_platform_admin ?? false;

  const load = async () => {
    setErr(null);
    try {
      const sb = await createSupabaseClient();
      const { data, error } = await sb.rpc('eq_get_tenant_settings');
      if (error) {
        setErr(error.message);
        return;
      }
      const rows = (data as TenantSettings[] | null) ?? [];
      if (rows.length === 0) {
        setErr('Tenant not found.');
        return;
      }
      const s = rows[0];
      setSettings(s);
      setName(s.name);
      setBrandColor(s.brand_color ?? '');
      setBrandLogoUrl(s.brand_logo_url ?? '');
      const m: Record<string, boolean> = {};
      s.modules.forEach((mod) => {
        m[mod.module] = mod.enabled;
      });
      setModuleState(m);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

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

    if (isPlatformAdmin) {
      const changedModules: ModuleEntitlement[] = [];
      Object.entries(moduleState).forEach(([mod, enabled]) => {
        const orig = settings.modules.find((m) => m.module === mod)?.enabled ?? false;
        if (orig !== enabled) {
          changedModules.push({ module: mod, enabled });
        }
      });
      if (changedModules.length > 0) {
        payload.modules = changedModules;
      }
    }

    if (Object.keys(payload).length === 0) {
      setBusy(false);
      setSavedAt(Date.now());
      return;
    }

    try {
      const sb = await createSupabaseClient();
      const { data, error } = await sb.rpc('eq_update_tenant_settings', {
        p_payload: payload,
      });
      if (error) {
        setSaveErr(error.message);
        setBusy(false);
        return;
      }
      const rows = (data as TenantSettings[] | null) ?? [];
      if (rows.length > 0) {
        const s = rows[0];
        setSettings(s);
        setName(s.name);
        setBrandColor(s.brand_color ?? '');
        setBrandLogoUrl(s.brand_logo_url ?? '');
        const m: Record<string, boolean> = {};
        s.modules.forEach((mod) => {
          m[mod.module] = mod.enabled;
        });
        setModuleState(m);
      }
      setSavedAt(Date.now());
    } catch (e) {
      setSaveErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (err) {
    return (
      <ShellWrap>
        <EqError title="Couldn't load tenant settings" message={err} onRetry={load} />
      </ShellWrap>
    );
  }

  if (!settings) {
    return (
      <ShellWrap>
        <Skeleton variant="card" />
      </ShellWrap>
    );
  }

  return (
    <ShellWrap>
      <div className="eq-page__header">
        <h1 className="eq-page__title">Tenant settings</h1>
        <p className="eq-page__lede">
          {settings.slug} · {settings.modules.filter((m) => m.enabled).length} module
          {settings.modules.filter((m) => m.enabled).length === 1 ? '' : 's'} enabled
        </p>
      </div>

      <form onSubmit={onSubmit} style={{ maxWidth: 640 }}>
        <section className="eq-section">
          <h2 className="eq-section__heading">Branding</h2>

          <FieldRow label="Tenant name">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
              style={inputStyle}
              required
            />
          </FieldRow>

          <FieldRow
            label="Brand colour"
            hint="Hex, e.g. #3DA8D8. Overrides the default Sky accent."
          >
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <input
                type="text"
                value={brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                placeholder="#3DA8D8"
                disabled={busy}
                style={{ ...inputStyle, fontFamily: 'ui-monospace, Menlo, Consolas, monospace' }}
              />
              {brandColor && /^#[0-9A-Fa-f]{6}$/.test(brandColor) && (
                <span
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 6,
                    border: '1px solid var(--eq-border)',
                    background: brandColor,
                  }}
                />
              )}
            </div>
          </FieldRow>

          <FieldRow
            label="Logo URL"
            hint="Public URL to your logo (PNG, SVG, JPG). Shown in the topbar."
          >
            <input
              type="url"
              value={brandLogoUrl}
              onChange={(e) => setBrandLogoUrl(e.target.value)}
              placeholder="https://…"
              disabled={busy}
              style={inputStyle}
            />
          </FieldRow>
        </section>

        <section className="eq-section">
          <div className="eq-section__head">
            <h2 className="eq-section__heading">Modules</h2>
            {!isPlatformAdmin && (
              <span className="eq-section__hint">
                Read-only · platform admin required to change
              </span>
            )}
          </div>

          <div style={{ display: 'grid', gap: 8 }}>
            {settings.modules.map((m) => (
              <label
                key={m.module}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  border: '1px solid var(--eq-border)',
                  borderRadius: 6,
                  background: 'var(--eq-bg)',
                  cursor: isPlatformAdmin ? 'pointer' : 'default',
                  opacity: isPlatformAdmin ? 1 : 0.85,
                }}
              >
                <span>
                  <strong style={{ display: 'block', fontSize: 14 }}>
                    {MODULE_LABELS[m.module] ?? m.module}
                  </strong>
                  <span className="eq-table__mute">{m.module}</span>
                </span>
                <input
                  type="checkbox"
                  checked={moduleState[m.module] ?? m.enabled}
                  disabled={!isPlatformAdmin || busy}
                  onChange={(e) =>
                    setModuleState((prev) => ({ ...prev, [m.module]: e.target.checked }))
                  }
                />
              </label>
            ))}
          </div>
        </section>

        <section className="eq-section">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              type="submit"
              className="eq-btn-primary"
              disabled={busy}
              style={{ width: 'auto', padding: '0 20px' }}
            >
              {busy ? 'Saving…' : 'Save changes'}
            </button>
            {savedAt && !saveErr && (
              <span className="eq-pill eq-pill--ok">Saved</span>
            )}
          </div>
          {saveErr && (
            <div className="eq-err" role="alert" style={{ marginTop: 16 }}>
              {saveErr}
            </div>
          )}
        </section>
      </form>
    </ShellWrap>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 40,
  padding: '0 12px',
  border: '1px solid var(--gray-300)',
  borderRadius: 6,
  background: 'var(--eq-bg)',
  color: 'var(--eq-ink)',
};

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 20 }}>
      <label
        style={{
          display: 'block',
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--eq-grey)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: 8,
        }}
      >
        {label}
      </label>
      {children}
      {hint && (
        <p
          style={{
            margin: '6px 0 0',
            fontSize: 12,
            color: 'var(--eq-grey)',
          }}
        >
          {hint}
        </p>
      )}
    </div>
  );
}

export default function AdminTenantSettings() {
  return (
    <Gate
      perm="admin.list_users"
      fallback={
        <ShellWrap>
          <div className="eq-empty">
            <p className="eq-empty__title">Not allowed</p>
            <p>Only managers can edit tenant settings.</p>
          </div>
        </ShellWrap>
      }
    >
      <AdminTenantSettingsInner />
    </Gate>
  );
}
