// Tender Sync — xlsx import. React port of vanilla:
//   eq-solves-field/scripts/tender-pipeline.js:276-540
//   + scripts/tender-parser.js (full file)
//
// Stack:
//   - `xlsx` (SheetJS) for parsing (bundled, lazy-loaded with this chunk).
//   - `@tanstack/react-table` for the 4 diff preview tables.
//   - No `react-hook-form` — the spike comment mentioned it but a single
//     file input doesn't need form state. Reserved for the Review wizard.
//
// PostHog: vanilla fires `tenderImported` on apply with the 6-count
// payload. eq-shell doesn't have posthog-js wired yet (CLAUDE.md
// observability stack mentions PostHog but no integration shipped in
// Phase 1.A/1.B) — TODO marker on the apply path.
//
// Data plane: see `lib/repository.ts`. This component talks to a
// `TenderRepository` injected via context. Today's binding is the
// `MockTenderRepository`; real Supabase implementation waits on the
// per-tenant data-plane design.

import { useEffect, useMemo, useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from '@tanstack/react-table';
import { useTenderRepository } from '../lib/RepositoryContext';
import {
  diffAgainstExisting,
  parseTenderXlsx,
  summariseImport,
  type ExistingTender,
  type ImportDiff,
  type ImportSummary,
  type ParseError,
  type RowWithPrevious,
  type TenderRow,
} from '../lib/tenderParser';
import type { ImportRun } from '../lib/repository';

interface PendingImport {
  rows: TenderRow[];
  diff: ImportDiff;
  summary: ImportSummary;
  fileName: string;
  warnings: ParseError[];
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '—';
  return '$' + n.toLocaleString();
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString();
}

function formatLastRun(r: ImportRun): string {
  return (
    `${fmtDate(r.imported_at)} — ${r.file_name} — ${r.rows_total} rows ` +
    `(${r.rows_new} new, ${r.rows_stage_changed} stage changed, ` +
    `${r.rows_value_changed} value changed, ${r.rows_missing} missing).`
  );
}

export default function Import() {
  const repository = useTenderRepository();
  const [lastRun, setLastRun] = useState<ImportRun | null>(null);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [applying, setApplying] = useState(false);
  const [parseErrors, setParseErrors] = useState<ParseError[] | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);

  useEffect(() => {
    void repository.getLastImportRun().then(setLastRun);
  }, [repository]);

  async function handleFile(file: File) {
    setParseErrors(null);
    setPending(null);
    const parsed = await parseTenderXlsx(file);
    const fatal = parsed.errors.filter((e) => e.severity === 'fatal');
    if (!parsed.rows.length && fatal.length > 0) {
      setParseErrors(parsed.errors);
      return;
    }
    const existing = await repository.getCurrentTenders();
    const diff = diffAgainstExisting(parsed.rows, existing);
    const summary = summariseImport(diff, parsed.rows);
    setPending({
      rows: parsed.rows,
      diff,
      summary,
      fileName: file.name,
      warnings: parsed.errors,
    });
  }

  async function handleApply() {
    if (!pending) return;
    setApplying(true);
    try {
      await repository.applyImport({
        diff: pending.diff,
        summary: pending.summary,
        fileName: pending.fileName,
        parsedRows: pending.rows,
      });
      // TODO: fire PostHog `tenderImported` once posthog-js is wired
      // into eq-shell. Payload shape (matches vanilla):
      //   { rows_total, rows_new, rows_stage_changed,
      //     rows_value_changed, rows_missing, rows_below_threshold }
      const next = await repository.getLastImportRun();
      setLastRun(next);
      const updated = pending.summary.rows_stage_changed + pending.summary.rows_value_changed;
      setToast({
        message: `Import applied — ${pending.summary.rows_new} new, ${updated} updated`,
        tone: 'success',
      });
      setPending(null);
    } catch (err) {
      console.error('EQ[pipeline] applyImport failed', err);
      setToast({ message: 'Import failed — see console', tone: 'error' });
    } finally {
      setApplying(false);
    }
  }

  function handleCancel() {
    setPending(null);
    setParseErrors(null);
  }

  return (
    <section className="tp-page tp-import">
      <h2>Tender Sync — xlsx import</h2>
      <p className="tp-lede-sub">
        Upload the latest SKS Smartsheet xlsx export ("Open 12m Tenders
        (State)"). The parser diffs against the pipeline and shows what
        will change before anything is written.
      </p>

      <div className="tp-card">
        <div className="tp-card-label">Last import</div>
        <div className="tp-card-body">
          {lastRun ? formatLastRun(lastRun) : 'No prior imports recorded.'}
        </div>
      </div>

      <div className="tp-card">
        <div className="tp-card-label">Upload xlsx</div>
        <input
          type="file"
          accept=".xlsx,.xls"
          aria-label="Tender pipeline xlsx upload"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            // Reset value so re-uploading the same file fires onChange.
            e.target.value = '';
          }}
        />
        <div className="tp-card-fineprint">
          Required columns: SITE / JOB NAME, SKS Quote No, Due Date,
          Status, Project $ Amount, SKS Estimator, Builder/Client Name,
          Market Vertical, SKS Dept, Site Address, SKS Entity, Probability.
        </div>
      </div>

      {parseErrors && (
        <div className="tp-card tp-card-error" role="alert">
          <h3>Couldn't read the file</h3>
          {parseErrors
            .filter((e) => e.severity === 'fatal')
            .map((e, i) => (
              <div key={i} className="tp-error-line">{e.message}</div>
            ))}
        </div>
      )}

      {pending && (
        <ImportPreview
          pending={pending}
          applying={applying}
          onApply={handleApply}
          onCancel={handleCancel}
        />
      )}

      {toast && (
        <div
          className={`tp-toast tp-toast-${toast.tone}`}
          role="status"
          aria-live="polite"
          onAnimationEnd={() => setToast(null)}
        >
          {toast.message}
        </div>
      )}
    </section>
  );
}

// ============================================================================
// Preview — summary line + 4 diff tables + Apply/Cancel
// ============================================================================

interface ImportPreviewProps {
  pending: PendingImport;
  applying: boolean;
  onApply: () => void;
  onCancel: () => void;
}

function ImportPreview({ pending, applying, onApply, onCancel }: ImportPreviewProps) {
  const s = pending.summary;
  const warnings = useMemo(
    () => pending.warnings.filter((w) => w.severity === 'warning'),
    [pending.warnings],
  );

  return (
    <div className="tp-card tp-card-preview">
      <h3>Preview — {pending.fileName}</h3>
      <div className="tp-summary">
        Total <strong>{s.rows_total}</strong> ·{' '}
        New <strong>{s.rows_new}</strong> ·{' '}
        Stage changes <strong>{s.rows_stage_changed}</strong> ·{' '}
        Value changes <strong>{s.rows_value_changed}</strong> ·{' '}
        Missing <strong>{s.rows_missing}</strong> ·{' '}
        Below floor <strong>{s.rows_below_threshold}</strong>
      </div>

      {warnings.length > 0 && (
        <div className="tp-warnings">
          {warnings.map((w, i) => (
            <div key={i} className="tp-warning">⚠ {w.message}</div>
          ))}
        </div>
      )}

      <div className="tp-buttons">
        <button
          className="tp-btn tp-btn-primary"
          disabled={applying}
          onClick={onApply}
        >
          {applying ? 'Applying…' : 'Apply to pipeline'}
        </button>
        <button className="tp-btn" disabled={applying} onClick={onCancel}>
          Cancel
        </button>
      </div>

      {pending.diff.new.length > 0 && (
        <DiffTable title="New tenders" rows={pending.diff.new} columns={NEW_COLS} />
      )}
      {pending.diff.stageChanged.length > 0 && (
        <DiffTable
          title="Stage changed"
          rows={pending.diff.stageChanged}
          columns={STAGE_COLS}
        />
      )}
      {pending.diff.valueChanged.length > 0 && (
        <DiffTable
          title="Value changed"
          rows={pending.diff.valueChanged}
          columns={VALUE_COLS}
        />
      )}
      {pending.diff.missing.length > 0 && (
        <DiffTable
          title="Missing from this import"
          rows={pending.diff.missing}
          columns={MISS_COLS}
        />
      )}
    </div>
  );
}

// ============================================================================
// Diff table — generic @tanstack/react-table wrapper
// ============================================================================

interface DiffTableProps<T> {
  title: string;
  rows: T[];
  columns: ColumnDef<T>[];
}

function DiffTable<T>({ title, rows, columns }: DiffTableProps<T>) {
  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="tp-diff-section">
      <h4>
        {title} <span className="tp-pill">{rows.length}</span>
      </h4>
      <table className="tp-diff-table">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th key={h.id}>
                  {flexRender(h.column.columnDef.header, h.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================================
// Column definitions — column shape matches vanilla _renderImportPreview
// ============================================================================

const NEW_COLS: ColumnDef<TenderRow>[] = [
  { header: 'Quote', accessorKey: 'external_ref' },
  { header: 'Job', accessorFn: (r) => r.job_name ?? '—', id: 'job' },
  {
    header: 'Value',
    id: 'value',
    cell: ({ row }) => fmtMoney(row.original.quote_value),
  },
  {
    header: 'Prob',
    id: 'prob',
    cell: ({ row }) =>
      row.original.probability_pct == null ? '—' : `${row.original.probability_pct}%`,
  },
  { header: 'Stage', accessorKey: 'stage' },
  {
    header: 'Below floor',
    id: 'below',
    cell: ({ row }) => (row.original.below_threshold ? 'Yes' : 'No'),
  },
];

const STAGE_COLS: ColumnDef<RowWithPrevious>[] = [
  { header: 'Quote', accessorKey: 'external_ref' },
  { header: 'Job', accessorFn: (r) => r.job_name ?? '—', id: 'job' },
  {
    header: 'Prev %',
    id: 'prevPct',
    cell: ({ row }) =>
      row.original.previous?.probability_pct == null
        ? '—'
        : `${row.original.previous.probability_pct}%`,
  },
  {
    header: 'New %',
    id: 'newPct',
    cell: ({ row }) =>
      row.original.probability_pct == null ? '—' : `${row.original.probability_pct}%`,
  },
];

const VALUE_COLS: ColumnDef<RowWithPrevious>[] = [
  { header: 'Quote', accessorKey: 'external_ref' },
  { header: 'Job', accessorFn: (r) => r.job_name ?? '—', id: 'job' },
  {
    header: 'Prev',
    id: 'prev',
    cell: ({ row }) => fmtMoney(row.original.previous?.quote_value ?? null),
  },
  {
    header: 'New',
    id: 'new',
    cell: ({ row }) => fmtMoney(row.original.quote_value),
  },
];

const MISS_COLS: ColumnDef<ExistingTender>[] = [
  { header: 'Quote', accessorKey: 'external_ref' },
];
