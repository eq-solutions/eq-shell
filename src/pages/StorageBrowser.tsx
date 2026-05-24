// Storage browser — /<tenant>/storage
//
// Lists files in the per-tenant Supabase storage bucket
// `tenant-<uuid>` (created in S2.C, RLS scoped by
// app_metadata.tenant_id). Read-only + signed-URL download. Upload
// support is a follow-up (Phase 2.X), file moves/deletes likewise.
//
// Designed for the manager use-case: "where did that PDF go?" rather
// than the dev use-case ("inspect storage internals"). One folder at
// a time, breadcrumb nav, file size + last-modified timestamp shown.

import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useSession } from '../session';
import { HubLayout } from '../components/HubLayout';
import { Skeleton } from '../components/Skeleton';
import { EqError } from '../components/EqError';
import { createSupabaseClient } from '../lib/supabaseJwt';

interface FileEntry {
  name: string;
  id: string | null;
  metadata: { size?: number; mimetype?: string } | null;
  updated_at: string | null;
  // `id` is null on virtual "folder" rows synthesised by Supabase's
  // list() helper. We use that to distinguish file vs folder.
}

function humanSize(bytes?: number): string {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-AU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export default function StorageBrowser() {
  const { session } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const prefix = searchParams.get('p') ?? '';
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const bucket = useMemo(
    () => (session ? `tenant-${session.tenant.id}` : null),
    [session],
  );

  const load = async () => {
    if (!bucket) return;
    setErr(null);
    setEntries(null);
    try {
      const sb = await createSupabaseClient();
      const { data, error } = await sb.storage
        .from(bucket)
        .list(prefix, {
          limit: 100,
          sortBy: { column: 'name', order: 'asc' },
        });
      if (error) {
        setErr(error.message);
        return;
      }
      setEntries((data as FileEntry[]) ?? []);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  useEffect(() => {
    void load();
  }, [prefix, bucket]);

  async function openSigned(filename: string) {
    if (!bucket) return;
    try {
      const sb = await createSupabaseClient();
      const fullPath = prefix ? `${prefix}/${filename}` : filename;
      const { data, error } = await sb.storage
        .from(bucket)
        .createSignedUrl(fullPath, 60);
      if (error) {
        setErr(error.message);
        return;
      }
      if (data?.signedUrl) {
        window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
      }
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  if (!session) return null;

  const crumbs = prefix.split('/').filter(Boolean);

  return (
    <HubLayout>
        <div className="eq-page__header">
          <h1 className="eq-page__title">Storage</h1>
          <p className="eq-page__lede">
            Files in your tenant bucket{' '}
            <code
              style={{
                background: 'var(--gray-100)',
                padding: '2px 6px',
                borderRadius: 4,
                fontSize: 12,
                color: 'var(--eq-grey)',
              }}
            >
              tenant-{session.tenant.id.slice(0, 8)}…
            </code>
            . Read-only · click a file to open a 60-second signed URL in a new tab.
          </p>
        </div>

        <nav
          className="eq-tabs"
          style={{ marginBottom: 16, padding: '8px 0', gap: 4, fontSize: 13 }}
        >
          <button
            type="button"
            onClick={() => setSearchParams({})}
            className="eq-btn-ghost"
            style={{ padding: '4px 10px', textDecoration: 'none' }}
          >
            / (root)
          </button>
          {crumbs.map((c, i) => (
            <button
              type="button"
              key={i}
              onClick={() => setSearchParams({ p: crumbs.slice(0, i + 1).join('/') })}
              className="eq-btn-ghost"
              style={{ padding: '4px 10px', textDecoration: 'none' }}
            >
              {c}
            </button>
          ))}
        </nav>

        {err && <EqError title="Couldn't list storage" message={err} onRetry={load} />}

        <div className="eq-table-wrap">
          <table className="eq-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Size</th>
                <th>Type</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {entries === null ? (
                <tr>
                  <td colSpan={4}>
                    <Skeleton variant="row" count={6} />
                  </td>
                </tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    style={{ textAlign: 'center', padding: 32, color: 'var(--eq-grey)' }}
                  >
                    Nothing here yet.
                  </td>
                </tr>
              ) : (
                entries.map((entry) => {
                  const isFolder = entry.id === null;
                  return (
                    <tr key={`${entry.name}-${entry.id ?? 'dir'}`}>
                      <td>
                        {isFolder ? (
                          <button
                            type="button"
                            onClick={() =>
                              setSearchParams({
                                p: prefix ? `${prefix}/${entry.name}` : entry.name,
                              })
                            }
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: 'var(--eq-deep)',
                              cursor: 'pointer',
                              fontWeight: 500,
                              fontSize: 14,
                              padding: 0,
                            }}
                          >
                            📁 {entry.name}/
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openSigned(entry.name)}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: 'var(--eq-deep)',
                              cursor: 'pointer',
                              fontSize: 14,
                              padding: 0,
                            }}
                          >
                            {entry.name}
                          </button>
                        )}
                      </td>
                      <td className="eq-table__mute">
                        {isFolder ? '—' : humanSize(entry.metadata?.size)}
                      </td>
                      <td className="eq-table__mute">
                        {isFolder ? 'folder' : entry.metadata?.mimetype ?? '—'}
                      </td>
                      <td className="eq-table__mute">{fmtTime(entry.updated_at)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <p
          style={{
            marginTop: 16,
            fontSize: 12,
            color: 'var(--eq-grey)',
          }}
        >
          Showing up to 100 entries per folder.{' '}
          <Link to=".." style={{ textDecoration: 'none' }}>
            Pagination + upload + delete land in the next polish pass.
          </Link>
        </p>
    </HubLayout>
  );
}
