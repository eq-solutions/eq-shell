/**
 * SitesModule — canonical sites management for eq-shell.
 *
 * Connects to app_data.sites in sks-canonical via SECURITY DEFINER RPCs
 * (migration 021): eq_list_sites, eq_archive_site, eq_unarchive_site,
 * eq_delete_site. These bypass the REST schema restriction on app_data.
 *
 * Features:
 *   - Search by name, client, suburb, or external ID
 *   - Toggle to show archived sites
 *   - Per-row Archive / Restore / Delete actions
 *   - Delete requires a confirmation step
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Site {
  site_id: string;
  name: string;
  client_name: string | null;
  suburb: string | null;
  state: string | null;
  external_id: string | null;
  imported_from: string | null;
  active: boolean;
  customer_id: string | null;
}

interface SitesModuleProps {
  supabase: SupabaseClient | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SitesModule({ supabase }: SitesModuleProps): JSX.Element {
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Site | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Debounce search
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSites = useCallback(
    async (searchTerm: string, archived: boolean) => {
      if (!supabase) {
        setLoading(false);
        setError("No Supabase connection configured.");
        return;
      }
      setLoading(true);
      setError(null);
      const { data, error: rpcError } = await supabase.rpc("eq_list_sites", {
        p_search: searchTerm.trim() || null,
        p_show_archived: archived,
      });
      setLoading(false);
      if (rpcError) {
        setError(rpcError.message);
      } else {
        setSites((data as Site[]) ?? []);
      }
    },
    [supabase],
  );

  // Initial load
  useEffect(() => {
    void fetchSites(search, showArchived);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived]);

  // Debounced search
  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetchSites(value, showArchived);
    }, 300);
  };

  const handleArchiveToggle = () => {
    setShowArchived((prev) => !prev);
  };

  // ---------------------------------------------------------------------------
  // Row actions
  // ---------------------------------------------------------------------------

  async function archiveSite(site: Site) {
    if (!supabase) return;
    setBusyId(site.site_id);
    setActionError(null);
    const { error: rpcError } = await supabase.rpc("eq_archive_site", {
      p_site_id: site.site_id,
    });
    setBusyId(null);
    if (rpcError) {
      setActionError(`Archive failed: ${rpcError.message}`);
    } else {
      void fetchSites(search, showArchived);
    }
  }

  async function unarchiveSite(site: Site) {
    if (!supabase) return;
    setBusyId(site.site_id);
    setActionError(null);
    const { error: rpcError } = await supabase.rpc("eq_unarchive_site", {
      p_site_id: site.site_id,
    });
    setBusyId(null);
    if (rpcError) {
      setActionError(`Restore failed: ${rpcError.message}`);
    } else {
      void fetchSites(search, showArchived);
    }
  }

  async function deleteSite(site: Site) {
    if (!supabase) return;
    setBusyId(site.site_id);
    setActionError(null);
    setConfirmDelete(null);
    const { error: rpcError } = await supabase.rpc("eq_delete_site", {
      p_site_id: site.site_id,
    });
    setBusyId(null);
    if (rpcError) {
      setActionError(`Delete failed: ${rpcError.message}`);
    } else {
      void fetchSites(search, showArchived);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const activeCount = sites.filter((s) => s.active).length;
  const archivedCount = sites.filter((s) => !s.active).length;

  return (
    <div className="eq-sites">
      {/* Header */}
      <div className="eq-sites__header">
        <div className="eq-sites__title-row">
          <h2 className="eq-sites__title">Sites</h2>
          <span className="eq-sites__count">
            {loading ? "…" : `${activeCount} active${showArchived && archivedCount > 0 ? `, ${archivedCount} archived` : ""}`}
          </span>
        </div>

        <div className="eq-sites__controls">
          <input
            className="eq-sites__search"
            type="search"
            placeholder="Search by name, client, suburb, or ID…"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            aria-label="Search sites"
          />
          <label className="eq-sites__archived-toggle">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={handleArchiveToggle}
            />
            Show archived
          </label>
        </div>
      </div>

      {/* Action error banner */}
      {actionError && (
        <div className="eq-sites__error-banner">
          {actionError}
          <button
            type="button"
            className="eq-sites__error-dismiss"
            onClick={() => setActionError(null)}
          >
            ×
          </button>
        </div>
      )}

      {/* Body */}
      {loading ? (
        <div className="eq-sites__loading">Loading sites…</div>
      ) : error ? (
        <div className="eq-sites__error-banner">{error}</div>
      ) : sites.length === 0 ? (
        <div className="eq-sites__empty">
          {search
            ? `No sites match "${search}".`
            : showArchived
              ? "No sites found."
              : "No active sites found."}
        </div>
      ) : (
        <div className="eq-sites__table-wrap">
          <table className="eq-sites__table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Client</th>
                <th>Location</th>
                <th>Source</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {sites.map((site) => (
                <tr
                  key={site.site_id}
                  className={
                    "eq-sites__row" + (!site.active ? " eq-sites__row--archived" : "")
                  }
                >
                  <td className="eq-sites__cell-name">
                    <span className="eq-sites__name">{site.name}</span>
                    {site.external_id && (
                      <span className="eq-sites__ext-id">{site.external_id}</span>
                    )}
                  </td>
                  <td>{site.client_name ?? <span className="eq-sites__muted">—</span>}</td>
                  <td>
                    {site.suburb || site.state ? (
                      [site.suburb, site.state].filter(Boolean).join(", ")
                    ) : (
                      <span className="eq-sites__muted">—</span>
                    )}
                  </td>
                  <td>
                    {site.imported_from ? (
                      <span className="eq-sites__source">{site.imported_from}</span>
                    ) : (
                      <span className="eq-sites__muted">—</span>
                    )}
                  </td>
                  <td>
                    <span
                      className={
                        "eq-sites__badge" +
                        (site.active ? " eq-sites__badge--active" : " eq-sites__badge--archived")
                      }
                    >
                      {site.active ? "Active" : "Archived"}
                    </span>
                  </td>
                  <td className="eq-sites__actions">
                    {site.active ? (
                      <button
                        type="button"
                        className="eq-sites__btn eq-sites__btn--secondary"
                        disabled={busyId === site.site_id}
                        onClick={() => void archiveSite(site)}
                      >
                        {busyId === site.site_id ? "…" : "Archive"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="eq-sites__btn eq-sites__btn--secondary"
                        disabled={busyId === site.site_id}
                        onClick={() => void unarchiveSite(site)}
                      >
                        {busyId === site.site_id ? "…" : "Restore"}
                      </button>
                    )}
                    <button
                      type="button"
                      className="eq-sites__btn eq-sites__btn--danger"
                      disabled={busyId === site.site_id}
                      onClick={() => setConfirmDelete(site)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="eq-sites__modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div
            className="eq-sites__modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="eq-sites-confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="eq-sites-confirm-title" className="eq-sites__modal-title">
              Delete site?
            </h3>
            <p className="eq-sites__modal-body">
              <strong>{confirmDelete.name}</strong>
              {confirmDelete.client_name ? ` — ${confirmDelete.client_name}` : ""}
              <br />
              This permanently removes the row from canonical. It cannot be undone.
            </p>
            <div className="eq-sites__modal-actions">
              <button
                type="button"
                className="eq-sites__btn eq-sites__btn--secondary"
                onClick={() => setConfirmDelete(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="eq-sites__btn eq-sites__btn--danger"
                onClick={() => void deleteSite(confirmDelete)}
              >
                Yes, delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
