import { useEffect, useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  X, ChevronRight, Building2, MapPin, User, Users, BadgeCheck,
} from 'lucide-react';
import './MobileRecordsDrawer.css';

// Entity tabs shown in the Records drawer (Frame 5).
// key matches the /data/:entity route and the entity-rows ?entity param.
const RECORD_TABS = [
  { key: 'customer', label: 'Customers', Icon: Building2 },
  { key: 'site',     label: 'Sites',     Icon: MapPin    },
  { key: 'contact',  label: 'Contacts',  Icon: User      },
  { key: 'staff',    label: 'Staff',     Icon: Users     },
  { key: 'licence',  label: 'Licences',  Icon: BadgeCheck },
] as const;

type TabKey = (typeof RECORD_TABS)[number]['key'];

// Shape of a single row returned by /.netlify/functions/entity-rows
type EntityRow = Record<string, unknown>;

// Shape of a canonical licence from staff-canonical-licences
interface CanonicalLicenceRow {
  id: string;
  staff_id: string;
  licence_type: string | null;
  licence_number: string | null;
  expiry_date: string | null;
  no_expiry: boolean;
  photo_url: string | null;
}

interface EntityRowsResponse {
  ok: boolean;
  rows?: EntityRow[];
  total?: number;
  error?: string;
}

// Derive a display name from a row for the given entity type.
function rowName(entity: TabKey, row: EntityRow): string {
  switch (entity) {
    case 'customer': return String(row['company_name'] ?? row['name'] ?? '—');
    case 'site':     return String(row['name'] ?? '—');
    case 'contact':  return [row['first_name'], row['last_name']].filter(Boolean).join(' ') || '—';
    case 'staff':    return [row['first_name'], row['last_name']].filter(Boolean).join(' ') || '—';
    case 'licence':  return String(row['licence_class'] ?? row['name'] ?? '—').replace(/_/g, ' ');
    default:         return '—';
  }
}

// Derive a subtitle from a row.
function rowSub(entity: TabKey, row: EntityRow): string {
  switch (entity) {
    case 'customer': return [row['state'], row['active'] === false ? 'inactive' : null].filter(Boolean).join(' · ') || '';
    case 'site':     return [row['suburb'], row['state']].filter(Boolean).join(', ') || '';
    case 'contact':  return String(row['position'] ?? row['email'] ?? '');
    case 'staff':    return String(row['employment_type'] ?? row['trade'] ?? '');
    case 'licence':  return String(row['licence_number'] ?? '');
    default:         return '';
  }
}

// Derive initials from a display name for the avatar.
function nameInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

// Cycle through a small set of EQ brand colours for avatars.
const AVATAR_COLORS = ['#3DA8D8', '#2986B4', '#0E7490', '#1F335C', '#7C77B9'];
function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

interface Props {
  open: boolean;
  /** Initial entity tab to show when opened */
  initialEntity?: TabKey;
  /** Count badges — keyed by entity name (singular) */
  counts: Partial<Record<string, number | null>>;
  onClose: () => void;
}

/**
 * Mobile Records drawer (Frame 5).
 * Slides up from the bottom at 80% screen height. Contains a tab strip
 * (Customers / Sites / Contacts / Staff / Licences) with fetched rows and
 * a "See all N →" footer link to the full entity browser.
 */
export function MobileRecordsDrawer({ open, initialEntity = 'customer', counts, onClose }: Props) {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const [activeTab, setActiveTab] = useState<TabKey>(initialEntity);
  const [rows, setRows] = useState<EntityRow[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fetchRows = useCallback(async (entity: TabKey) => {
    setLoading(true);
    setErr(null);
    setRows(null);
    setTotal(null);
    try {
      if (entity === 'licence') {
        // Canonical licences live on jvkn (public.licences), not ehow app_data.licences.
        const res = await fetch('/.netlify/functions/staff-canonical-licences', { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json() as { licences?: CanonicalLicenceRow[] };
        const mapped = (body.licences ?? []).slice(0, 6).map((l) => ({
          id: l.id,
          licence_class: l.licence_type,
          licence_number: l.licence_number,
          staff_id: l.staff_id,
        }));
        setRows(mapped);
        setTotal(body.licences?.length ?? 0);
        return;
      }
      const res = await fetch(`/.netlify/functions/entity-rows?entity=${entity}&limit=6&page=0`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as EntityRowsResponse;
      if (!body.ok) throw new Error(body.error ?? 'Load failed');
      setRows(body.rows ?? []);
      setTotal(body.total ?? null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch when drawer opens or tab changes
  useEffect(() => {
    if (open) void fetchRows(activeTab);
  }, [open, activeTab, fetchRows]);

  // Reset to initial entity when re-opened
  useEffect(() => {
    if (open) setActiveTab(initialEntity);
  }, [open, initialEntity]);

  // Keyboard dismiss
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const activeTabDef = RECORD_TABS.find((t) => t.key === activeTab)!;
  const totalCount = total ?? counts[activeTab] ?? null;

  return (
    <>
      {/* Full scrim — covers tab bar too (Frame 5 intent) */}
      <div className="eq-rec-scrim" onClick={onClose} aria-hidden="true" />

      <div
        className="eq-rec-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Records"
      >
        {/* Drag handle */}
        <div className="eq-rec-drawer__handle" />

        {/* Header */}
        <div className="eq-rec-drawer__header">
          <h2 className="eq-rec-drawer__title">Records</h2>
          <button
            type="button"
            className="eq-rec-drawer__close"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={13} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        {/* Tab strip */}
        <div className="eq-rec-drawer__tabs" role="tablist">
          {RECORD_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              className={`eq-rec-drawer__tab${activeTab === tab.key ? ' eq-rec-drawer__tab--active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Rows */}
        <div className="eq-rec-drawer__scroll" role="tabpanel">
          {loading && (
            <div className="eq-rec-drawer__loading">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="eq-rec-drawer__skel-row">
                  <div className="eq-rec-drawer__skel-av" />
                  <div className="eq-rec-drawer__skel-lines">
                    <div className="eq-rec-drawer__skel-line eq-rec-drawer__skel-line--wide" />
                    <div className="eq-rec-drawer__skel-line eq-rec-drawer__skel-line--narrow" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {err && !loading && (
            <div className="eq-rec-drawer__err">
              <p>Couldn't load {activeTabDef.label.toLowerCase()}</p>
              <button
                type="button"
                className="eq-rec-drawer__retry"
                onClick={() => void fetchRows(activeTab)}
              >
                Try again
              </button>
            </div>
          )}

          {!loading && !err && rows && rows.length === 0 && (
            <div className="eq-rec-drawer__empty">
              No {activeTabDef.label.toLowerCase()} yet.{' '}
              <Link to={activeTab === 'licence' ? `/${tenantSlug}/staff` : `/${tenantSlug}/data/${activeTab}`} onClick={onClose} className="eq-rec-drawer__empty-link">
                Browse →
              </Link>
            </div>
          )}

          {!loading && !err && rows && rows.length > 0 && rows.map((row, i) => {
            const name = rowName(activeTab, row);
            const sub = rowSub(activeTab, row);
            const bg = avatarColor(name);
            return (
              <Link
                key={i}
                to={activeTab === 'licence' ? `/${tenantSlug}/staff` : `/${tenantSlug}/data/${activeTab}`}
                className="eq-rec-drawer__row"
                onClick={onClose}
              >
                <span
                  className="eq-rec-drawer__row-av"
                  style={{ background: bg }}
                  aria-hidden="true"
                >
                  {nameInitials(name)}
                </span>
                <div className="eq-rec-drawer__row-body">
                  <span className="eq-rec-drawer__row-name">{name}</span>
                  {sub && <span className="eq-rec-drawer__row-sub">{sub}</span>}
                </div>
                <ChevronRight size={16} strokeWidth={2} className="eq-rec-drawer__row-chev" aria-hidden="true" />
              </Link>
            );
          })}
        </div>

        {/* Footer CTA */}
        {tenantSlug && (
          <div className="eq-rec-drawer__footer">
            <Link
              to={activeTab === 'licence' ? `/${tenantSlug}/staff` : `/${tenantSlug}/data/${activeTab}`}
              className="eq-rec-drawer__footer-link"
              onClick={onClose}
            >
              {totalCount !== null
                ? `See all ${totalCount.toLocaleString()} ${activeTabDef.label.toLowerCase()} →`
                : `See all ${activeTabDef.label.toLowerCase()} →`}
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
