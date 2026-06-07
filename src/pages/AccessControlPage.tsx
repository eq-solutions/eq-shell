// Access Control — unified role matrix + custom security groups.
//
// Two sections:
//   1. Role matrix — 5 roles × 7 app modules. Click any cell to see/toggle
//      the individual permissions for that role in that module. Defaults from
//      @eq-solutions/roles; tenant overrides stored in tenant_role_overrides.
//   2. Custom groups — named bundles of extra perms assigned to individual
//      users. Moved here from SecurityGroupsPage (now a redirect).
//
// Gate: admin.manage_groups (manager-only).

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { ShieldCheck, Plus, Trash2, ChevronRight, X, RotateCcw, Eye } from 'lucide-react';
import { resolveEffectivePermissions } from '@eq-solutions/roles';
import { HubLayout } from '../components/HubLayout';
import { Gate } from '../permissions/Gate';
import { defaultSidebarRecords } from '../lib/sidebarConfig';
import { EqError } from '../components/EqError';
import { createSupabaseClient } from '../lib/supabaseJwt';
import type { EqRole } from '../session';

const SIDEBAR_RECORDS = defaultSidebarRecords();

// ── Role + module definitions ─────────────────────────────────────────────────

const ROLES: Array<{ key: string; label: string; description: string }> = [
  { key: 'manager', label: 'Manager', description: 'Full admin access' },
  { key: 'supervisor', label: 'Supervisor', description: 'Create + close, no admin' },
  { key: 'employee', label: 'Employee', description: 'View + import' },
  { key: 'apprentice', label: 'Apprentice', description: 'View only' },
  { key: 'labour_hire', label: 'Labour Hire', description: 'Field view only' },
];

interface PermDef {
  key: string;
  label: string;
}

interface ModuleDef {
  key: string;
  label: string;
  perms: PermDef[];
}

const MODULES: ModuleDef[] = [
  {
    key: 'field',
    label: 'Field',
    perms: [
      { key: 'field.view', label: 'View field resources' },
      { key: 'field.dispatch', label: 'Dispatch staff' },
    ],
  },
  {
    key: 'service',
    label: 'Service',
    perms: [
      { key: 'service.view', label: 'View maintenance' },
      { key: 'service.create', label: 'Raise work orders' },
      { key: 'service.close', label: 'Close work orders' },
    ],
  },
  {
    key: 'cards',
    label: 'Cards',
    perms: [
      { key: 'cards.view', label: 'Open Cards' },
      { key: 'cards.onboard', label: 'Submit onboarding' },
    ],
  },
  {
    key: 'quotes',
    label: 'Quotes',
    perms: [
      { key: 'quotes.view', label: 'View quotes' },
      { key: 'quotes.create', label: 'Create quotes' },
      { key: 'quotes.approve', label: 'Approve quotes' },
    ],
  },
  {
    key: 'intake',
    label: 'Intake',
    perms: [
      { key: 'intake.view', label: 'View imports' },
      { key: 'intake.import', label: 'Start an import' },
      { key: 'intake.commit', label: 'Confirm an import' },
    ],
  },
  {
    key: 'equipment',
    label: 'Equipment',
    perms: [
      { key: 'equipment.view', label: 'View equipment' },
      { key: 'equipment.edit', label: 'Edit equipment' },
    ],
  },
  {
    key: 'reports',
    label: 'Reports',
    perms: [
      { key: 'reports.view', label: 'View reports' },
      { key: 'reports.upload', label: 'Upload reports' },
      { key: 'reports.generate_briefing', label: 'Generate AI briefing' },
    ],
  },
];

// Default permissions per role — mirrors roles.json matrix exactly.
const ROLE_DEFAULTS: Record<string, Set<string>> = {
  manager: new Set([
    'admin.list_users', 'admin.invite_user', 'admin.edit_user', 'admin.deactivate_user',
    'admin.review_cards', 'admin.manage_groups', 'audit.view', 'audit.rollback',
    'entity.view', 'entity.create', 'entity.edit', 'entity.delete',
    'intake.view', 'intake.import', 'intake.commit',
    'equipment.view', 'equipment.edit',
    'reports.view', 'reports.upload', 'reports.generate_briefing',
    'cards.view', 'cards.onboard',
    'service.view', 'service.create', 'service.close',
    'field.view', 'field.dispatch',
    'quotes.view', 'quotes.create', 'quotes.approve',
  ]),
  supervisor: new Set([
    'audit.view', 'entity.view', 'entity.edit',
    'intake.view', 'intake.import', 'intake.commit',
    'equipment.view', 'equipment.edit',
    'cards.view', 'cards.onboard',
    'service.view', 'service.create', 'service.close',
    'field.view', 'field.dispatch',
    'quotes.view', 'quotes.create',
  ]),
  employee: new Set([
    'entity.view', 'intake.view', 'intake.import',
    'equipment.view', 'cards.view', 'service.view',
    'field.view', 'quotes.view',
  ]),
  apprentice: new Set([
    'entity.view', 'intake.view', 'cards.view', 'service.view', 'field.view',
  ]),
  labour_hire: new Set(['field.view']),
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface Override {
  role: string;
  perm_key: string;
  enabled: boolean;
}

// For groups section (moved from SecurityGroupsPage)
interface SecurityGroup {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

interface GroupDetail {
  id: string;
  name: string;
  description: string | null;
  perm_keys: string[];
  members: Array<{ user_id: string; name: string | null; email: string; assigned_at: string }>;
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function loadOverrides(): Promise<Override[]> {
  const res = await fetch('/.netlify/functions/tenant-role-perms', { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as { ok: boolean; overrides: Override[] };
  return data.overrides ?? [];
}

async function setOverride(role: string, perm_key: string, enabled: boolean): Promise<void> {
  const res = await fetch('/.netlify/functions/tenant-role-perms', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'set', role, perm_key, enabled }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function resetOverride(role: string, perm_key: string): Promise<void> {
  const res = await fetch('/.netlify/functions/tenant-role-perms', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'reset', role, perm_key }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function sgFetch(path: string, opts?: RequestInit): Promise<unknown> {
  const res = await fetch(`/.netlify/functions/security-groups${path}`, {
    credentials: 'include', ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AccessControlPage() {
  return (
    <Gate perm="admin.manage_groups">
      <HubLayout sidebarRecords={SIDEBAR_RECORDS}>
        <AccessControlInner />
      </HubLayout>
    </Gate>
  );
}

function AccessControlInner() {
  const { tenantSlug: _tenantSlug } = useParams<{ tenantSlug: string }>();

  const [overridesMap, setOverridesMap] = useState<Map<string, boolean>>(new Map());
  const [matrixLoading, setMatrixLoading] = useState(true);
  const [matrixError, setMatrixError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const [selectedCell, setSelectedCell] = useState<{ role: string; moduleKey: string } | null>(null);

  const fetchOverrides = useCallback(async () => {
    setMatrixLoading(true);
    setMatrixError(null);
    try {
      const rows = await loadOverrides();
      const map = new Map<string, boolean>();
      for (const row of rows) {
        map.set(`${row.role}:${row.perm_key}`, row.enabled);
      }
      setOverridesMap(map);
    } catch {
      setMatrixError('Unable to load access settings — try refreshing.');
    } finally {
      setMatrixLoading(false);
    }
  }, []);

  useEffect(() => { void fetchOverrides(); }, [fetchOverrides]);

  function effectiveEnabled(role: string, permKey: string): boolean {
    const override = overridesMap.get(`${role}:${permKey}`);
    if (override !== undefined) return override;
    return ROLE_DEFAULTS[role]?.has(permKey) ?? false;
  }

  function isOverridden(role: string, permKey: string): boolean {
    return overridesMap.has(`${role}:${permKey}`);
  }

  async function handleToggle(role: string, permKey: string) {
    const k = `${role}:${permKey}`;
    const current = effectiveEnabled(role, permKey);
    const defaultVal = ROLE_DEFAULTS[role]?.has(permKey) ?? false;
    const newVal = !current;

    setSavingKey(k);
    try {
      if (newVal === defaultVal) {
        await resetOverride(role, permKey);
        setOverridesMap(prev => { const m = new Map(prev); m.delete(k); return m; });
      } else {
        await setOverride(role, permKey, newVal);
        setOverridesMap(prev => new Map(prev).set(k, newVal));
      }
    } finally {
      setSavingKey(null);
    }
  }

  async function handleResetAll(role: string, moduleKey: string) {
    const mod = MODULES.find(m => m.key === moduleKey);
    if (!mod) return;
    for (const perm of mod.perms) {
      if (isOverridden(role, perm.key)) {
        await resetOverride(role, perm.key);
        setOverridesMap(prev => { const m = new Map(prev); m.delete(`${role}:${perm.key}`); return m; });
      }
    }
  }

  const selectedModule = selectedCell ? MODULES.find(m => m.key === selectedCell.moduleKey) ?? null : null;
  const selectedRole = selectedCell ? ROLES.find(r => r.key === selectedCell.role) ?? null : null;

  return (
    <div>
      <div className="eq-page__header">
        <h1 className="eq-page__title">Access control</h1>
        <p className="eq-page__lede">
          Set what each role can do in each app. Changes take effect on next sign-in.
        </p>
      </div>

      {/* ── Role matrix ────────────────────────────────────────────────────── */}
      <section style={{ marginBottom: 40 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--eq-ink)', marginBottom: 4 }}>
          Base permissions
        </h2>
        <p style={{ fontSize: 13, color: 'var(--eq-grey)', marginBottom: 16, marginTop: 0 }}>
          Click any cell to view or change permissions for that role.
        </p>

        {matrixError && (
          <EqError title="Couldn't load" message={matrixError} onRetry={() => void fetchOverrides()} />
        )}

        {!matrixError && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{
              borderCollapse: 'collapse', width: '100%', fontSize: 13,
              tableLayout: 'fixed',
            }}>
              <colgroup>
                <col style={{ width: 130 }} />
                {MODULES.map(m => <col key={m.key} style={{ width: `${Math.floor((100 - 15) / MODULES.length)}%` }} />)}
              </colgroup>
              <thead>
                <tr>
                  <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--eq-grey)', borderBottom: '2px solid var(--eq-border)', fontSize: 12 }}>
                    Role
                  </th>
                  {MODULES.map(m => (
                    <th key={m.key} style={{
                      padding: '8px 10px', textAlign: 'center', fontWeight: 600,
                      color: 'var(--eq-grey)', borderBottom: '2px solid var(--eq-border)', fontSize: 12,
                    }}>
                      {m.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrixLoading ? (
                  <tr>
                    <td colSpan={MODULES.length + 1} style={{ padding: 24, textAlign: 'center', color: 'var(--eq-grey)', fontSize: 13 }}>
                      Loading…
                    </td>
                  </tr>
                ) : (
                  ROLES.map((role, ri) => (
                    <tr key={role.key} style={{ background: ri % 2 === 0 ? '#fff' : '#fafafa' }}>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--eq-border)', verticalAlign: 'middle' }}>
                        <div style={{ fontWeight: 600, color: 'var(--eq-ink)', fontSize: 13 }}>{role.label}</div>
                        <div style={{ fontSize: 11, color: 'var(--eq-grey)', marginTop: 1 }}>{role.description}</div>
                      </td>
                      {MODULES.map(mod => {
                        const enabled = mod.perms.filter(p => effectiveEnabled(role.key, p.key)).length;
                        const total = mod.perms.length;
                        const hasOverride = mod.perms.some(p => isOverridden(role.key, p.key));
                        const isSelected = selectedCell?.role === role.key && selectedCell?.moduleKey === mod.key;

                        let label: string;
                        let dotColor: string;
                        if (enabled === 0) { label = 'None'; dotColor = 'transparent'; }
                        else if (enabled === total) { label = 'Full'; dotColor = 'var(--eq-sky)'; }
                        else if (enabled === 1 && mod.perms[0].key.endsWith('.view')) { label = 'View'; dotColor = '#aaa'; }
                        else { label = `${enabled}/${total}`; dotColor = 'var(--eq-sky)'; }

                        return (
                          <td
                            key={mod.key}
                            onClick={() => setSelectedCell(isSelected ? null : { role: role.key, moduleKey: mod.key })}
                            style={{
                              padding: '8px 6px', borderBottom: '1px solid var(--eq-border)',
                              textAlign: 'center', cursor: 'pointer', verticalAlign: 'middle',
                              background: isSelected ? 'var(--eq-ice)' : undefined,
                              outline: isSelected ? '2px solid var(--eq-sky)' : undefined,
                              outlineOffset: -2,
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                              <span style={{
                                display: 'inline-block', width: 8, height: 8,
                                borderRadius: '50%',
                                background: dotColor,
                                border: enabled === 0 ? '1.5px solid #ccc' : 'none',
                                flexShrink: 0,
                              }} />
                              <span style={{
                                fontSize: 12, fontWeight: enabled > 0 ? 600 : 400,
                                color: enabled > 0 ? 'var(--eq-ink)' : 'var(--eq-grey)',
                              }}>
                                {label}
                              </span>
                              {hasOverride && (
                                <span style={{
                                  width: 5, height: 5, borderRadius: '50%',
                                  background: '#f59e0b', flexShrink: 0,
                                }} title="Has custom override" />
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Legend */}
        {!matrixError && !matrixLoading && (
          <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 12, color: 'var(--eq-grey)', alignItems: 'center' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--eq-sky)', display: 'inline-block' }} />
              Full / Partial
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', border: '1.5px solid #ccc', display: 'inline-block' }} />
              No access
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} />
              Custom override
            </span>
          </div>
        )}
      </section>

      {/* ── Cell detail panel ─────────────────────────────────────────────── */}
      {selectedCell && selectedModule && selectedRole && (
        <CellDetailPanel
          role={selectedRole}
          module={selectedModule}
          effectiveEnabled={effectiveEnabled}
          isOverridden={isOverridden}
          savingKey={savingKey}
          onToggle={handleToggle}
          onResetAll={() => void handleResetAll(selectedRole.key, selectedModule.key)}
          onClose={() => setSelectedCell(null)}
        />
      )}

      {/* ── Custom groups ─────────────────────────────────────────────────── */}
      <GroupsSection />

      {/* ── Permission preview ────────────────────────────────────────────── */}
      <PermPreviewSection />
    </div>
  );
}

// ── Cell detail panel ─────────────────────────────────────────────────────────

function CellDetailPanel({
  role, module: mod, effectiveEnabled, isOverridden, savingKey, onToggle, onResetAll, onClose,
}: {
  role: { key: string; label: string };
  module: ModuleDef;
  effectiveEnabled: (role: string, perm: string) => boolean;
  isOverridden: (role: string, perm: string) => boolean;
  savingKey: string | null;
  onToggle: (role: string, perm: string) => Promise<void>;
  onResetAll: () => void;
  onClose: () => void;
}) {
  const hasAnyOverride = mod.perms.some(p => isOverridden(role.key, p.key));

  return (
    <div style={{
      border: '1px solid var(--eq-sky)', borderRadius: 8, padding: '16px 20px',
      background: 'var(--eq-ice)', marginBottom: 28,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--eq-ink)' }}>
            {role.label} · {mod.label}
          </span>
          {hasAnyOverride && (
            <button
              onClick={onResetAll}
              style={{
                marginLeft: 12, fontSize: 12, color: 'var(--eq-grey)',
                background: 'none', border: 'none', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 4, padding: 0,
              }}
            >
              <RotateCcw size={11} /> Reset all to default
            </button>
          )}
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--eq-grey)' }}
        >
          <X size={16} />
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {mod.perms.map(perm => {
          const k = `${role.key}:${perm.key}`;
          const enabled = effectiveEnabled(role.key, perm.key);
          const overridden = isOverridden(role.key, perm.key);
          const defaultVal = ROLE_DEFAULTS[role.key]?.has(perm.key) ?? false;
          const busy = savingKey === k;

          return (
            <label
              key={perm.key}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px', borderRadius: 6, background: '#fff',
                border: '1px solid var(--eq-border)', cursor: busy ? 'wait' : 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={enabled}
                disabled={busy}
                onChange={() => void onToggle(role.key, perm.key)}
                style={{ cursor: busy ? 'wait' : 'pointer', width: 15, height: 15 }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--eq-ink)' }}>{perm.label}</div>
                <div style={{ fontSize: 11, color: 'var(--eq-grey)', fontFamily: 'monospace' }}>{perm.key}</div>
              </div>
              {overridden && (
                <span style={{
                  fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                  background: enabled !== defaultVal ? (enabled ? '#dcfce7' : '#fee2e2') : '#fef3c7',
                  color: enabled !== defaultVal ? (enabled ? '#166534' : '#991b1b') : '#92400e',
                }}>
                  {enabled ? 'GRANTED' : 'DENIED'}
                </span>
              )}
              {!overridden && (
                <span style={{ fontSize: 10, color: '#bbb', fontWeight: 400 }}>Default</span>
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}

// ── Permission preview ────────────────────────────────────────────────────────
//
// Lets an admin select any tenant user and see what their effective permissions
// would be (role defaults ∪ group grants ∖ denied overrides) using the same
// resolveEffectivePermissions call the server uses. Zero network calls after
// the initial user + group-perm fetch — the computation is client-side.

interface TenantUser {
  id: string;
  email: string;
  name: string | null;
  role: EqRole;
}

function PermPreviewSection() {
  const [users, setUsers] = useState<TenantUser[] | null>(null);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewResult, setPreviewResult] = useState<{
    role: string;
    group_perm_keys: string[];
    effective: string[];
  } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Load tenant users on mount (same RPC as AdminUserList)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sb = await createSupabaseClient();
        const { data } = await sb.rpc('eq_list_tenant_users');
        if (!cancelled) setUsers((data as TenantUser[] | null) ?? []);
      } catch {
        if (!cancelled) setUsers([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const preview = async () => {
    if (!selectedUserId) return;
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewResult(null);
    try {
      const res = await fetch(`/.netlify/functions/security-groups?action=user_perms&user_id=${encodeURIComponent(selectedUserId)}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as { ok: boolean; role: string; group_perm_keys: string[] };
      const effective = resolveEffectivePermissions({
        role: data.role as EqRole,
        // group_perm_keys from the API may include unknown keys — the function
        // filters them internally; cast to satisfy the type.
        groupPerms: data.group_perm_keys as unknown as readonly import('@eq-solutions/roles').PermKey[],
      });
      setPreviewResult({ role: data.role, group_perm_keys: data.group_perm_keys, effective: [...effective] });
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <section style={{ marginTop: 40 }}>
      <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--eq-ink)', margin: 0 }}>Preview user permissions</h2>
      <p style={{ fontSize: 13, color: 'var(--eq-grey)', margin: '4px 0 16px' }}>
        Select a user to see their effective permissions — role defaults plus any group grants.
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <select
          value={selectedUserId}
          onChange={e => { setSelectedUserId(e.target.value); setPreviewResult(null); }}
          style={{ ...inputStyle, width: 280, display: 'inline-block', margin: 0 }}
          disabled={!users}
        >
          <option value="">{users === null ? 'Loading users…' : 'Select a user'}</option>
          {(users ?? []).map(u => (
            <option key={u.id} value={u.id}>
              {u.name ?? u.email} — {u.role.replace('_', ' ')}
            </option>
          ))}
        </select>
        <button
          onClick={() => void preview()}
          disabled={!selectedUserId || previewLoading}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: selectedUserId && !previewLoading ? 'var(--eq-sky)' : '#e0e0e0',
            color: selectedUserId && !previewLoading ? '#fff' : 'var(--eq-grey)',
            border: 'none', borderRadius: 6, padding: '8px 14px',
            fontSize: 13, fontWeight: 600, cursor: selectedUserId && !previewLoading ? 'pointer' : 'not-allowed',
          }}
        >
          <Eye size={14} />
          {previewLoading ? 'Loading…' : 'Preview'}
        </button>
      </div>

      {previewError && (
        <p style={{ color: 'var(--eq-danger, #e53935)', fontSize: 13, marginTop: 12 }}>
          Error: {previewError}
        </p>
      )}

      {previewResult && (
        <div style={{ marginTop: 16, border: '1px solid var(--eq-border)', borderRadius: 8, padding: '16px 20px', background: '#fafafa' }}>
          <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 13 }}>
            <span>
              <span style={{ fontWeight: 600, color: 'var(--eq-ink)' }}>Role:</span>{' '}
              <span style={{ color: 'var(--eq-grey)' }}>{previewResult.role.replace('_', ' ')}</span>
            </span>
            <span>
              <span style={{ fontWeight: 600, color: 'var(--eq-ink)' }}>Group grants:</span>{' '}
              <span style={{ color: 'var(--eq-grey)' }}>
                {previewResult.group_perm_keys.length > 0
                  ? previewResult.group_perm_keys.join(', ')
                  : 'none'}
              </span>
            </span>
          </div>
          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--eq-ink)', marginBottom: 8 }}>
            Effective permissions ({previewResult.effective.length})
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {previewResult.effective.map(p => (
              <span
                key={p}
                style={{
                  background: 'var(--eq-ice)', color: 'var(--eq-deep)',
                  border: '1px solid var(--eq-sky)', borderRadius: 4,
                  padding: '3px 8px', fontSize: 11, fontFamily: 'monospace',
                }}
              >
                {p}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ── Groups section ────────────────────────────────────────────────────────────

function GroupsSection() {
  const [groups, setGroups] = useState<SecurityGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<GroupDetail | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await sgFetch('?action=list') as { groups: SecurityGroup[] };
      setGroups(data.groups);
    } catch {
      setError('Unable to load groups — check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openDetail = async (id: string) => {
    try {
      const data = await sgFetch(`?action=detail&id=${encodeURIComponent(id)}`) as { group: GroupDetail };
      setSelected(data.group);
    } catch {
      setError('Unable to load group details.');
    }
  };

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12 }}>
        <div>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--eq-ink)', margin: 0 }}>Custom groups</h2>
          <p style={{ fontSize: 13, color: 'var(--eq-grey)', margin: '4px 0 0' }}>
            Grant specific extra permissions to individual users, on top of their role.
          </p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'var(--eq-sky)', color: '#fff', border: 'none',
            borderRadius: 6, padding: '8px 14px', fontSize: 13,
            fontWeight: 600, cursor: 'pointer', flexShrink: 0,
          }}
        >
          <Plus size={14} /> New group
        </button>
      </div>

      {error && <EqError title="Something went wrong" message={error} onRetry={() => void load()} />}

      {loading ? (
        <p style={{ color: 'var(--eq-grey)', fontSize: 13 }}>Loading…</p>
      ) : groups.length === 0 ? (
        <div style={{
          border: '1px solid var(--eq-border)', borderRadius: 8,
          padding: '32px 24px', textAlign: 'center',
        }}>
          <ShieldCheck size={28} style={{ color: 'var(--eq-grey)', marginBottom: 10 }} />
          <p style={{ color: 'var(--eq-grey)', fontSize: 13, margin: 0 }}>
            No custom groups yet. Create one to grant extra access to specific people.
          </p>
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {groups.map(g => (
            <li
              key={g.id}
              onClick={() => void openDetail(g.id)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 16px', border: '1px solid var(--eq-border)', borderRadius: 6,
                marginBottom: 8, cursor: 'pointer', background: '#fff',
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--eq-ink)' }}>{g.name}</div>
                {g.description && (
                  <div style={{ fontSize: 13, color: 'var(--eq-grey)', marginTop: 2 }}>{g.description}</div>
                )}
              </div>
              <ChevronRight size={16} style={{ color: 'var(--eq-grey)', flexShrink: 0 }} />
            </li>
          ))}
        </ul>
      )}

      {createOpen && (
        <CreateGroupModal
          onClose={() => setCreateOpen(false)}
          onCreated={() => { setCreateOpen(false); void load(); }}
        />
      )}

      {selected && (
        <GroupDetailModal
          group={selected}
          onClose={() => setSelected(null)}
          onUpdated={() => { setSelected(null); void load(); }}
          onPermChange={async (permKey, add) => {
            if (add) await sgFetch('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add_perm', id: selected.id, perm_key: permKey }) });
            else await sgFetch('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'remove_perm', id: selected.id, perm_key: permKey }) });
            const updated = await sgFetch(`?action=detail&id=${encodeURIComponent(selected.id)}`) as { group: GroupDetail };
            setSelected(updated.group);
          }}
          onRemoveMember={async (userId) => {
            await sgFetch('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'remove_member', id: selected.id, user_id: userId }) });
            const updated = await sgFetch(`?action=detail&id=${encodeURIComponent(selected.id)}`) as { group: GroupDetail };
            setSelected(updated.group);
          }}
        />
      )}
    </section>
  );
}

// ── Create group modal ────────────────────────────────────────────────────────

function CreateGroupModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      await sgFetch('', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', name: name.trim(), description: description.trim() || undefined }),
      });
      onCreated();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown';
      setErr(msg === 'name_taken' ? 'A group with that name already exists.' : 'Unable to create group — try again.');
      setSaving(false);
    }
  };

  return (
    <ModalOverlay onClose={onClose}>
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>New group</h2>
      {err && <p style={{ color: 'var(--eq-danger, #e53935)', fontSize: 13, marginBottom: 12 }}>{err}</p>}
      <label style={labelStyle}>
        Name
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Service editors" style={inputStyle} />
      </label>
      <label style={labelStyle}>
        Description (optional)
        <input value={description} onChange={e => setDescription(e.target.value)} placeholder="What does this group grant?" style={inputStyle} />
      </label>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
        <button onClick={onClose} style={ghostBtnStyle}>Cancel</button>
        <button
          onClick={() => void submit()} disabled={!name.trim() || saving}
          style={{ ...primaryBtnStyle, opacity: !name.trim() || saving ? 0.5 : 1, cursor: !name.trim() || saving ? 'not-allowed' : 'pointer' }}
        >
          {saving ? 'Creating…' : 'Create'}
        </button>
      </div>
    </ModalOverlay>
  );
}

// ── Group detail modal ────────────────────────────────────────────────────────

const ALL_PERM_KEYS = [
  'admin.list_users', 'admin.invite_user', 'admin.edit_user',
  'admin.deactivate_user', 'admin.review_cards', 'admin.manage_groups',
  'audit.view', 'audit.rollback',
  'entity.view', 'entity.create', 'entity.edit', 'entity.delete',
  'intake.view', 'intake.import', 'intake.commit',
  'equipment.view', 'equipment.edit',
  'reports.view', 'reports.upload', 'reports.generate_briefing',
  'cards.view', 'cards.onboard',
  'service.view', 'service.create', 'service.close',
  'field.view', 'field.dispatch',
  'quotes.view', 'quotes.create', 'quotes.approve',
] as const;

function GroupDetailModal({
  group, onClose, onUpdated, onPermChange, onRemoveMember,
}: {
  group: GroupDetail;
  onClose: () => void;
  onUpdated: () => void;
  onPermChange: (permKey: string, add: boolean) => Promise<void>;
  onRemoveMember: (userId: string) => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  const [permBusy, setPermBusy] = useState<string | null>(null);
  const [memberBusy, setMemberBusy] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!window.confirm(`Delete "${group.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await sgFetch('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id: group.id }) });
      onUpdated();
    } catch { setDeleting(false); }
  };

  const togglePerm = async (permKey: string, granted: boolean) => {
    setPermBusy(permKey);
    try { await onPermChange(permKey, !granted); }
    finally { setPermBusy(null); }
  };

  const removeMember = async (userId: string) => {
    setMemberBusy(userId);
    try { await onRemoveMember(userId); }
    finally { setMemberBusy(null); }
  };

  return (
    <ModalOverlay onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{group.name}</h2>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          <X size={18} style={{ color: 'var(--eq-grey)' }} />
        </button>
      </div>
      {group.description && <p style={{ color: 'var(--eq-grey)', fontSize: 13, marginBottom: 16 }}>{group.description}</p>}

      <section style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--eq-ink)', marginBottom: 8 }}>Permissions</h3>
        <div style={{ maxHeight: 200, overflowY: 'auto' }}>
          {ALL_PERM_KEYS.map(k => {
            const granted = group.perm_keys.includes(k);
            const busy = permBusy === k;
            return (
              <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', cursor: busy ? 'wait' : 'pointer' }}>
                <input type="checkbox" checked={granted} disabled={busy} onChange={() => void togglePerm(k, granted)} />
                <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--eq-ink)' }}>{k}</span>
              </label>
            );
          })}
        </div>
      </section>

      <section style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--eq-ink)', marginBottom: 8 }}>
          Members ({group.members.length})
        </h3>
        {group.members.length === 0 ? (
          <p style={{ color: 'var(--eq-grey)', fontSize: 13 }}>
            No members. Assign from a user's profile page.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {group.members.map(m => (
              <li key={m.user_id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 12px', border: '1px solid var(--eq-border)',
                borderRadius: 6, marginBottom: 6, fontSize: 13,
              }}>
                <span>
                  <span style={{ fontWeight: 500 }}>{m.name ?? m.email}</span>
                  {m.name && <span style={{ color: 'var(--eq-grey)', marginLeft: 8 }}>{m.email}</span>}
                </span>
                <button
                  onClick={() => void removeMember(m.user_id)}
                  disabled={memberBusy === m.user_id}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--eq-grey)', padding: '2px 4px' }}
                >
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={() => void handleDelete()} disabled={deleting}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'none', border: '1px solid var(--eq-danger, #e53935)',
            color: 'var(--eq-danger, #e53935)', borderRadius: 6,
            padding: '7px 12px', fontSize: 13, cursor: 'pointer',
            opacity: deleting ? 0.5 : 1,
          }}
        >
          <Trash2 size={13} />
          {deleting ? 'Deleting…' : 'Delete group'}
        </button>
      </div>
    </ModalOverlay>
  );
}

// ── Shared modal ──────────────────────────────────────────────────────────────

function ModalOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      role="dialog" aria-modal="true"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: '#fff', borderRadius: 10, padding: 24, width: '100%', maxWidth: 480, maxHeight: '80vh', overflowY: 'auto', boxSizing: 'border-box' }}>
        {children}
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--eq-ink)', marginBottom: 12 };
const inputStyle: React.CSSProperties = { display: 'block', width: '100%', marginTop: 4, padding: '8px 10px', border: '1px solid var(--eq-border)', borderRadius: 6, fontSize: 13, color: 'var(--eq-ink)', background: '#fff', boxSizing: 'border-box' };
const ghostBtnStyle: React.CSSProperties = { background: 'none', border: '1px solid var(--eq-border)', borderRadius: 6, padding: '8px 14px', fontSize: 13, color: 'var(--eq-ink)', cursor: 'pointer' };
const primaryBtnStyle: React.CSSProperties = { background: 'var(--eq-sky)', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
