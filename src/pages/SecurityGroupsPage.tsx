// Security Groups — manager-only admin surface for creating named bundles
// of extra permission keys that can be assigned to users.
//
// Calls /.netlify/functions/security-groups (server-gated with admin.manage_groups).
// Gate: admin.manage_groups (manager-only via <Gate perm>).

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Users, Plus, Trash2, ChevronRight, X } from 'lucide-react';
import { HubLayout } from '../components/HubLayout';
import { Gate } from '../permissions/Gate';
import { defaultSidebarRecords } from '../lib/sidebarConfig';
import { EqError } from '../components/EqError';

const SIDEBAR_RECORDS = defaultSidebarRecords();

// ── Types ────────────────────────────────────────────────────────────────────

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

// ── API helper ────────────────────────────────────────────────────────────────

async function sgFetch(path: string, opts?: RequestInit): Promise<unknown> {
  const res = await fetch(`/.netlify/functions/security-groups${path}`, {
    credentials: 'include',
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

async function listGroups(): Promise<SecurityGroup[]> {
  const data = await sgFetch('?action=list') as { groups: SecurityGroup[] };
  return data.groups;
}

async function getDetail(id: string): Promise<GroupDetail> {
  const data = await sgFetch(`?action=detail&id=${encodeURIComponent(id)}`) as { group: GroupDetail };
  return data.group;
}

async function createGroup(name: string, description?: string): Promise<SecurityGroup> {
  const data = await sgFetch('', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'create', name, description }),
  }) as { group: SecurityGroup };
  return data.group;
}

async function deleteGroup(id: string): Promise<void> {
  await sgFetch('', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'delete', id }),
  });
}

async function addPerm(id: string, perm_key: string): Promise<void> {
  await sgFetch('', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'add_perm', id, perm_key }),
  });
}

async function removePerm(id: string, perm_key: string): Promise<void> {
  await sgFetch('', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'remove_perm', id, perm_key }),
  });
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function SecurityGroupsPage() {
  return (
    <Gate perm="admin.manage_groups">
      <HubLayout sidebarRecords={SIDEBAR_RECORDS}>
        <SecurityGroupsInner />
      </HubLayout>
    </Gate>
  );
}

function SecurityGroupsInner() {
  const { tenantSlug: _tenantSlug } = useParams<{ tenantSlug: string }>();

  const [groups, setGroups] = useState<SecurityGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<GroupDetail | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const gs = await listGroups();
      setGroups(gs);
    } catch {
      setError('Unable to load groups — check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openDetail = async (id: string) => {
    try {
      const detail = await getDetail(id);
      setSelected(detail);
    } catch {
      setError('Unable to load group details.');
    }
  };

  return (
    <div>
      <div className="eq-page__header">
        <h1 className="eq-page__title">Security groups</h1>
        <p className="eq-page__lede">
          Assign named permission bundles to users beyond their default role access.
        </p>
      </div>

      {error && (
        <EqError
          title="Something went wrong"
          message={error}
          onRetry={() => void load()}
        />
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button
          onClick={() => setCreateOpen(true)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'var(--eq-sky)', color: '#fff', border: 'none',
            borderRadius: 6, padding: '8px 14px', fontSize: 13,
            fontWeight: 600, cursor: 'pointer',
          }}
        >
          <Plus size={14} />
          New group
        </button>
      </div>

      {loading ? (
        <p style={{ color: 'var(--eq-grey)', fontSize: 14 }}>Loading…</p>
      ) : groups.length === 0 ? (
        <div style={{
          border: '1px solid var(--eq-border)', borderRadius: 8,
          padding: '40px 24px', textAlign: 'center',
        }}>
          <Users size={32} style={{ color: 'var(--eq-grey)', marginBottom: 12 }} />
          <p style={{ color: 'var(--eq-grey)', fontSize: 14, margin: 0 }}>
            No security groups yet. Create one to grant extra access to specific users.
          </p>
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {groups.map((g) => (
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
            if (add) await addPerm(selected.id, permKey);
            else await removePerm(selected.id, permKey);
            const updated = await getDetail(selected.id);
            setSelected(updated);
          }}
        />
      )}
    </div>
  );
}

// ── Create modal ──────────────────────────────────────────────────────────────

function CreateGroupModal({
  onClose, onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      await createGroup(name, description || undefined);
      onCreated();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown';
      setErr(msg === 'name_taken' ? 'A group with that name already exists.' : 'Unable to create group — try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalOverlay onClose={onClose}>
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>New security group</h2>
      {err && <p style={{ color: 'var(--eq-danger, #e53935)', fontSize: 13, marginBottom: 12 }}>{err}</p>}
      <label style={labelStyle}>
        Name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Service editors"
          style={inputStyle}
        />
      </label>
      <label style={labelStyle}>
        Description (optional)
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Brief description of what this group grants"
          style={inputStyle}
        />
      </label>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
        <button onClick={onClose} style={ghostBtnStyle}>Cancel</button>
        <button
          onClick={() => void submit()}
          disabled={!name.trim() || saving}
          style={{
            ...primaryBtnStyle,
            opacity: !name.trim() || saving ? 0.5 : 1,
            cursor: !name.trim() || saving ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? 'Creating…' : 'Create'}
        </button>
      </div>
    </ModalOverlay>
  );
}

// ── Detail modal ──────────────────────────────────────────────────────────────

// All known permission keys — sourced from @eq-solutions/roles at build time
// (permissions.ts PermKey). Listed here for the add-perm UI.
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
  group, onClose, onUpdated, onPermChange,
}: {
  group: GroupDetail;
  onClose: () => void;
  onUpdated: () => void;
  onPermChange: (permKey: string, add: boolean) => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  const [permBusy, setPermBusy] = useState<string | null>(null);

  const handleDeleteGroup = async () => {
    if (!window.confirm(`Delete group "${group.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await deleteGroup(group.id);
      onUpdated();
    } catch {
      setDeleting(false);
    }
  };

  const togglePerm = async (permKey: string, currentlyGranted: boolean) => {
    setPermBusy(permKey);
    try {
      await onPermChange(permKey, !currentlyGranted);
    } finally {
      setPermBusy(null);
    }
  };

  return (
    <ModalOverlay onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{group.name}</h2>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          <X size={18} style={{ color: 'var(--eq-grey)' }} />
        </button>
      </div>
      {group.description && (
        <p style={{ color: 'var(--eq-grey)', fontSize: 13, marginBottom: 16 }}>{group.description}</p>
      )}

      <section style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--eq-ink)', marginBottom: 8 }}>
          Permissions
        </h3>
        <div style={{ maxHeight: 220, overflowY: 'auto' }}>
          {ALL_PERM_KEYS.map((k) => {
            const granted = group.perm_keys.includes(k);
            const busy = permBusy === k;
            return (
              <label
                key={k}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '5px 0', cursor: busy ? 'wait' : 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={granted}
                  disabled={busy}
                  onChange={() => void togglePerm(k, granted)}
                />
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
          <p style={{ color: 'var(--eq-grey)', fontSize: 13 }}>No members. Assign this group from a user's profile.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {group.members.map((m) => (
              <li key={m.user_id} style={{
                padding: '8px 12px', border: '1px solid var(--eq-border)',
                borderRadius: 6, marginBottom: 6, fontSize: 13, color: 'var(--eq-ink)',
              }}>
                <span style={{ fontWeight: 500 }}>{m.name ?? m.email}</span>
                {m.name && <span style={{ color: 'var(--eq-grey)', marginLeft: 8 }}>{m.email}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
        <button
          onClick={() => void handleDeleteGroup()}
          disabled={deleting}
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

// ── Shared modal overlay ──────────────────────────────────────────────────────

function ModalOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: '#fff', borderRadius: 10,
        padding: 24, width: '100%', maxWidth: 480,
        maxHeight: '80vh', overflowY: 'auto',
        boxSizing: 'border-box',
      }}>
        {children}
      </div>
    </div>
  );
}

// ── Style helpers ─────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 13, fontWeight: 500,
  color: 'var(--eq-ink)', marginBottom: 12,
};

const inputStyle: React.CSSProperties = {
  display: 'block', width: '100%', marginTop: 4,
  padding: '8px 10px', border: '1px solid var(--eq-border)',
  borderRadius: 6, fontSize: 13, color: 'var(--eq-ink)',
  background: '#fff', boxSizing: 'border-box',
};

const ghostBtnStyle: React.CSSProperties = {
  background: 'none', border: '1px solid var(--eq-border)',
  borderRadius: 6, padding: '8px 14px', fontSize: 13,
  color: 'var(--eq-ink)', cursor: 'pointer',
};

const primaryBtnStyle: React.CSSProperties = {
  background: 'var(--eq-sky)', color: '#fff', border: 'none',
  borderRadius: 6, padding: '8px 14px', fontSize: 13,
  fontWeight: 600, cursor: 'pointer',
};
