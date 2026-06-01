// Storage browser — /<tenant>/storage
//
// Lists files in the per-tenant Supabase storage bucket
// `tenant-<uuid>` (created in S2.C, RLS scoped by
// app_metadata.tenant_id). Managers can upload; all authed users
// can browse and download via signed URLs.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '@eq-solutions/ui';
import { useSession } from '../session';
import { useCan } from '../permissions';
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
  const [uploadStatus, setUploadStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'uploading' }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const bucket = useMemo(
    () => (session ? `tenant-${session.tenant.id}` : null),
    [session],
  );

  const canUpload = useCan('admin.list_users');

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

  async function handleFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0 || !bucket) return;
    setUploadStatus({ kind: 'uploading' });

    try {
      const sb = await createSupabaseClient();
      const uploads = Array.from(files).map((file) => {
        const destPath = prefix ? `${prefix}/${file.name}` : file.name;
        return sb.storage.from(bucket).upload(destPath, file, { upsert: true });
      });
      const results = await Promise.all(uploads);
      const failed = results.filter((r) => r.error);
      if (failed.length > 0) {
        setUploadStatus({
          kind: 'error',
          message: failed[0].error!.message,
        });
        return;
      }
      setUploadStatus({ kind: 'idle' });
      await load();
    } catch (e) {
      setUploadStatus({ kind: 'error', message: (e as Error).message });
    } finally {
      // Reset the input so the same file can be re-selected after an error.
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  if (!session) return null;

  const crumbs = prefix.split('/').filter(Boolean);

  return (
    <HubLayout>
        <div className="eq-page__header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div>
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
              . Click a file to open a 60-second signed URL in a new tab.
            </p>
          </div>

          {canUpload && (
            <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => void handleFilesSelected(e)}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadStatus.kind === 'uploading'}
                style={{
                  background: uploadStatus.kind === 'uploading' ? 'var(--eq-deep, #2986B4)' : 'var(--eq-sky, #3DA8D8)',
                  color: 'white',
                  borderRadius: 6,
                  padding: '8px 16px',
                  border: 'none',
                  fontSize: 14,
                  cursor: uploadStatus.kind === 'uploading' ? 'not-allowed' : 'pointer',
                  transition: 'background 150ms ease',
                  opacity: uploadStatus.kind === 'uploading' ? 0.8 : 1,
                }}
                onMouseEnter={(e) => {
                  if (uploadStatus.kind !== 'uploading') {
                    (e.currentTarget as HTMLButtonElement).style.background = 'var(--eq-deep, #2986B4)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (uploadStatus.kind !== 'uploading') {
                    (e.currentTarget as HTMLButtonElement).style.background = 'var(--eq-sky, #3DA8D8)';
                  }
                }}
              >
                {uploadStatus.kind === 'uploading' ? 'Uploading…' : 'Upload files'}
              </button>
              {uploadStatus.kind === 'error' && (
                <span style={{ fontSize: 13, color: '#B91C1C' }}>
                  {uploadStatus.message}
                </span>
              )}
            </div>
          )}
        </div>

        <nav
          className="eq-tabs"
          style={{ marginBottom: 16, padding: '8px 0', gap: 4, fontSize: 13 }}
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setSearchParams({})}
          >
            / (root)
          </Button>
          {crumbs.map((c, i) => (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              key={i}
              onClick={() => setSearchParams({ p: crumbs.slice(0, i + 1).join('/') })}
            >
              {c}
            </Button>
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
            Pagination and file deletion land in the next polish pass.
          </Link>
        </p>
    </HubLayout>
  );
}
