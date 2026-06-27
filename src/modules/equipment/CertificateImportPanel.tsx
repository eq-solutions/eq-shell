// Certificate import — drop calibration-cert PDFs, the server reads them with
// vision and matches each against the register, you confirm, it commits.
//
// Flow: select → POST cert-import-parse (server-side vision + match) → review
// table (update / confirm / new per row) → commit each accepted row via
// upload-asset-cert (the PDF) + asset-calibration (create/update). The engine
// only proposes; nothing is written until you hit Commit.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Upload, FileText, Check, AlertTriangle, Plus } from 'lucide-react';
import { Button } from '@eq-solutions/ui';
import type { CalCertReconcileRow } from '@eq/intake';

interface SiteOption {
  site_id: string;
  name: string;
}

type Phase = 'select' | 'parsing' | 'review' | 'committing' | 'done';

interface ParseResponse {
  ok: boolean;
  summary?: { update: number; confirm: number; create: number };
  rows?: CalCertReconcileRow[];
  warnings?: Array<{ code: string; message: string }>;
  error?: string;
  detail?: string;
}

const ACTION_LABEL: Record<string, string> = { update: 'Update', confirm: 'Confirm', create: 'New item' };
const ACTION_COLOUR: Record<string, string> = { update: '#2986B4', confirm: '#B5780B', create: '#1F4E6C' };

export function CertificateImportPanel({
  sites,
  onClose,
  onCommitted,
}: {
  sites: SiteOption[];
  onClose: () => void;
  onCommitted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('select');
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<CalCertReconcileRow[]>([]);
  const [included, setIncluded] = useState<Record<number, boolean>>({});
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [results, setResults] = useState<Array<{ index: number; ok: boolean; error?: string }>>([]);
  const [dragOver, setDragOver] = useState(false);

  const asideRef = useRef<HTMLElement>(null);
  const rafRef = useRef<number | null>(null);

  // New items default to the site the existing tools sit on; a manual pick overrides.
  const [pickedSiteId, setPickedSiteId] = useState<string>('');
  const defaultSiteId = useMemo(() => {
    const internal = sites.find((s) => /internal/i.test(s.name));
    return (internal ?? sites[0])?.site_id ?? '';
  }, [sites]);
  const createSiteId = pickedSiteId || defaultSiteId;

  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    rafRef.current = requestAnimationFrame(() => setOpen(true));
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      prevFocus?.focus?.();
    };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && phase !== 'committing') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, phase]);

  const addFiles = useCallback((list: FileList | null) => {
    if (!list) return;
    const pdfs = Array.from(list).filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    if (pdfs.length === 0) return;
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => f.name));
      return [...prev, ...pdfs.filter((f) => !seen.has(f.name))];
    });
  }, []);

  const parse = useCallback(async () => {
    if (files.length === 0) return;
    setPhase('parsing');
    setErr(null);
    try {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      const res = await fetch('/.netlify/functions/cert-import-parse', {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      // Read as text first: a platform-level 502 (Netlify function timeout or
      // crash) returns a non-JSON body, so res.json() would throw and mask the
      // real message ("Task timed out after 26.00 seconds"). Surface it instead.
      const raw = await res.text();
      let body: ParseResponse | null = null;
      try { body = JSON.parse(raw) as ParseResponse; } catch { /* non-JSON platform error */ }
      if (!res.ok || !body?.ok || !body?.rows) {
        const detail = body?.detail ?? body?.error ?? (raw.trim() ? raw.trim().slice(0, 300) : `HTTP ${res.status}`);
        console.error('[cert-import] parse failed', { status: res.status, detail });
        throw new Error(`Import failed (${res.status}): ${detail}`);
      }
      setRows(body.rows);
      setIncluded(Object.fromEntries(body.rows.map((_, i) => [i, true])));
      setPhase('review');
    } catch (e) {
      setErr((e as Error).message);
      setPhase('select');
    }
  }, [files]);

  const fileByName = useMemo(() => {
    const m = new Map<string, File>();
    for (const f of files) m.set(f.name, f);
    return m;
  }, [files]);

  const counts = useMemo(() => {
    const c = { update: 0, confirm: 0, create: 0 };
    rows.forEach((r, i) => { if (included[i]) c[r.match.action] += 1; });
    return c;
  }, [rows, included]);

  const commit = useCallback(async () => {
    const chosen = rows.map((r, i) => ({ r, i })).filter(({ i }) => included[i]);
    setPhase('committing');
    setErr(null);
    setProgress({ done: 0, total: chosen.length });
    const certUrlCache = new Map<string, string>();
    const out: Array<{ index: number; ok: boolean; error?: string }> = [];

    for (const { r, i } of chosen) {
      try {
        // 1. Upload the cert PDF once per source file.
        const fileName = r.record.source.file_name;
        let certUrl = fileName ? certUrlCache.get(fileName) : undefined;
        const file = fileName ? fileByName.get(fileName) : undefined;
        if (!certUrl && file) {
          const fd = new FormData();
          fd.append('file', file);
          const up = await fetch('/.netlify/functions/upload-asset-cert', { method: 'POST', credentials: 'include', body: fd });
          const upBody = (await up.json()) as { ok: boolean; url?: string; error?: string; detail?: string };
          if (up.ok && upBody.ok && upBody.url) {
            certUrl = upBody.url;
            if (fileName) certUrlCache.set(fileName, certUrl);
          }
        }

        // 2. Build the field set — only non-empty values, so we never clobber
        //    an existing value with a blank from the cert.
        const c = r.candidate;
        const fields: Record<string, string> = {};
        if (c.last_service_date) fields.last_service_date = c.last_service_date;
        if (c.next_service_due) fields.next_service_due = c.next_service_due;
        if (c.external_id) fields.external_id = c.external_id;
        if (c.make) fields.make = c.make;
        if (c.model) fields.model = c.model;
        if (c.serial_number) fields.serial_number = c.serial_number;
        if (certUrl) fields.cert_url = certUrl;

        let payload: Record<string, unknown>;
        if (r.match.action === 'create') {
          if (!createSiteId) throw new Error('Pick a site for new items first.');
          payload = { action: 'create', fields: { ...fields, name: c.name, site_id: createSiteId } };
        } else {
          if (!r.match.asset_id) throw new Error('No matched asset to update.');
          payload = { action: 'update', id: r.match.asset_id, fields };
        }

        const res = await fetch('/.netlify/functions/asset-calibration', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const body = (await res.json()) as { ok: boolean; error?: string; detail?: string };
        if (!res.ok || !body.ok) throw new Error(body.detail ?? body.error ?? `HTTP ${res.status}`);
        out.push({ index: i, ok: true });
      } catch (e) {
        out.push({ index: i, ok: false, error: (e as Error).message });
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }));
    }

    setResults(out);
    setPhase('done');
  }, [rows, included, fileByName, createSiteId]);

  const committedOk = results.filter((r) => r.ok).length;
  const committedFail = results.length - committedOk;

  return (
    <>
      <div
        onClick={() => phase !== 'committing' && onClose()}
        style={{ position: 'fixed', inset: 0, background: 'rgba(26,26,46,0.32)', opacity: open ? 1 : 0, transition: 'opacity .18s ease', zIndex: 60 }}
      />
      <aside
        ref={asideRef}
        role="dialog"
        aria-label="Import calibration certificates"
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(760px, 96vw)',
          background: '#fff', borderLeft: '1px solid #E2E8EE', zIndex: 61,
          transform: open ? 'translateX(0)' : 'translateX(24px)', opacity: open ? 1 : 0,
          transition: 'transform .2s ease, opacity .2s ease', display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{ padding: '18px 24px', borderBottom: '1px solid #EEF3F7', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--eq-deep)', margin: '0 0 4px' }}>Records · Import</p>
            <h2 style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em', color: '#1A1A2E', margin: 0 }}>Import certificates</h2>
          </div>
          <button type="button" onClick={() => phase !== 'committing' && onClose()} aria-label="Close" style={iconBtn}><X size={18} /></button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          {err && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '10px 12px', background: '#FCEDED', border: '1px solid #F2C9C9', borderRadius: 8, color: '#9A2C2C', fontSize: 13, marginBottom: 16 }}>
              <AlertTriangle size={15} /> {err}
            </div>
          )}

          {/* SELECT */}
          {(phase === 'select' || phase === 'parsing') && (
            <>
              <label
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: '36px 20px', border: `1.5px dashed ${dragOver ? 'var(--eq-sky, #3DA8D8)' : '#CFE0EA'}`,
                  borderRadius: 12, background: dragOver ? '#EAF5FB' : '#F7FBFD', cursor: 'pointer', textAlign: 'center',
                }}
              >
                <Upload size={22} color="var(--eq-deep)" />
                <span style={{ fontSize: 14, fontWeight: 600, color: '#1A1A2E' }}>Drop calibration certificates (PDF)</span>
                <span style={{ fontSize: 12, color: 'var(--eq-mute)' }}>or click to choose — the whole bundle at once is fine</span>
                <input type="file" accept="application/pdf" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
              </label>

              {files.length > 0 && (
                <ul style={{ listStyle: 'none', padding: 0, margin: '16px 0 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {files.map((f) => (
                    <li key={f.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#33414D' }}>
                      <FileText size={15} color="var(--eq-deep)" /> {f.name}
                      <span style={{ marginLeft: 'auto', color: 'var(--eq-mute)', fontSize: 12 }}>{(f.size / 1024).toFixed(0)} KB</span>
                      {phase === 'select' && (
                        <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((prev) => prev.filter((x) => x.name !== f.name))} style={{ ...iconBtn, width: 24, height: 24 }}><X size={13} /></button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              <div style={{ marginTop: 20 }}>
                <Button type="button" onClick={() => void parse()} disabled={files.length === 0 || phase === 'parsing'} icon={<Check size={16} />}>
                  {phase === 'parsing' ? `Reading ${files.length} certificate${files.length === 1 ? '' : 's'}…` : `Read ${files.length || ''} certificate${files.length === 1 ? '' : 's'}`}
                </Button>
              </div>
            </>
          )}

          {/* REVIEW */}
          {phase === 'review' && (
            <>
              <p style={{ fontSize: 13, color: '#33414D', margin: '0 0 14px' }}>
                <b>{counts.update}</b> update · <b>{counts.confirm}</b> confirm · <b>{counts.create}</b> new — untick anything you don't want.
              </p>

              {counts.create > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: '#F7FBFD', border: '1px solid #E2EEF5', borderRadius: 8, marginBottom: 14 }}>
                  <Plus size={15} color="var(--eq-deep)" />
                  <span style={{ fontSize: 13, color: '#33414D' }}>New items go to</span>
                  <select value={createSiteId} onChange={(e) => setPickedSiteId(e.target.value)} style={{ marginLeft: 'auto', fontSize: 13, padding: '5px 8px', border: '1px solid #CFE0EA', borderRadius: 6 }}>
                    {sites.map((s) => <option key={s.site_id} value={s.site_id}>{s.name}</option>)}
                  </select>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {rows.map((r, i) => {
                  const c = r.candidate;
                  const instrument = r.record.unit_under_test || [c.make, c.model].filter(Boolean).join(' ') || c.name;
                  const flagged = c.cal_result === 'limited' || c.cal_result === 'fail';
                  return (
                    <div key={i} style={{ display: 'flex', gap: 12, padding: '12px 14px', border: '1px solid #EAF0F4', borderRadius: 10, opacity: included[i] ? 1 : 0.5 }}>
                      <input type="checkbox" checked={!!included[i]} onChange={(e) => setIncluded((s) => ({ ...s, [i]: e.target.checked }))} style={{ marginTop: 3 }} aria-label={`Include ${instrument}`} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 14, fontWeight: 700, color: '#1A1A2E' }}>{instrument}</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: ACTION_COLOUR[r.match.action], padding: '2px 8px', borderRadius: 999 }}>{ACTION_LABEL[r.match.action]}</span>
                          {flagged && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 600, color: '#B5780B' }}><AlertTriangle size={12} />{c.cal_result === 'limited' ? 'Limited cal' : 'Failed'}</span>}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--eq-mute)', marginTop: 3 }}>
                          {c.external_id ? `Tag ${c.external_id} · ` : ''}{c.serial_number ? `S/N ${c.serial_number} · ` : ''}
                          Cal {c.last_service_date ?? '—'} → due {c.next_service_due ?? '—'}
                        </div>
                        {r.match.action !== 'create' && r.match.matched_name && (
                          <div style={{ fontSize: 12, color: '#2986B4', marginTop: 2 }}>
                            ↳ {r.match.matched_name} {r.match.matched_serial ? `(S/N ${r.match.matched_serial})` : ''} · {r.match.confidence} confidence
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ marginTop: 20, display: 'flex', gap: 10 }}>
                <Button type="button" onClick={() => void commit()} disabled={counts.update + counts.confirm + counts.create === 0} icon={<Check size={16} />}>
                  Commit {counts.update + counts.confirm + counts.create} change{counts.update + counts.confirm + counts.create === 1 ? '' : 's'}
                </Button>
                <Button type="button" variant="ghost" onClick={() => { setPhase('select'); setRows([]); }}>Back</Button>
              </div>
            </>
          )}

          {/* COMMITTING */}
          {phase === 'committing' && (
            <div style={{ padding: '40px 0', textAlign: 'center', color: '#33414D' }}>
              <p style={{ fontSize: 14, fontWeight: 600 }}>Committing {progress.done} / {progress.total}…</p>
              <div style={{ height: 6, background: '#EAF0F4', borderRadius: 999, overflow: 'hidden', marginTop: 12 }}>
                <div style={{ height: '100%', width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`, background: 'var(--eq-deep)', transition: 'width .2s ease' }} />
              </div>
            </div>
          )}

          {/* DONE */}
          {phase === 'done' && (
            <div style={{ padding: '12px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 700, color: '#1A6B3B', marginBottom: 8 }}>
                <Check size={18} /> {committedOk} record{committedOk === 1 ? '' : 's'} updated
              </div>
              {committedFail > 0 && (
                <div style={{ fontSize: 13, color: '#9A2C2C', marginBottom: 8 }}>
                  {committedFail} failed:
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                    {results.filter((r) => !r.ok).map((r) => {
                      const c = rows[r.index]?.candidate;
                      return <li key={r.index} style={{ fontSize: 12 }}>{c?.name ?? `Row ${r.index + 1}`}: {r.error}</li>;
                    })}
                  </ul>
                </div>
              )}
              <div style={{ marginTop: 14 }}>
                <Button type="button" onClick={onCommitted} icon={<Check size={16} />}>Done</Button>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

const iconBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30,
  border: '1px solid #E2E8EE', borderRadius: 8, background: '#fff', color: '#5A6B7A', cursor: 'pointer',
};
