// Generic sortable, column-configurable data table.
//
// Features: sortable headers, column picker (localStorage-persisted),
// row actions kebab menu, selected row highlight, loading + empty states.
//
// Usage:
//   <DataTable columns={COLS} rows={data} rowKey={(r) => r.id} storageKey="customers" />

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown, Settings2, MoreHorizontal } from 'lucide-react';

export interface ColDef<T> {
  key: string;
  label: string;
  defaultVisible?: boolean;
  sortable?: boolean;
  sortValue?: (row: T) => string | number | null | undefined;
  render: (row: T) => React.ReactNode;
  cellStyle?: React.CSSProperties;
}

export interface RowAction<T> {
  label: string;
  destructive?: boolean;
  onClick: (row: T) => void;
}

interface DataTableProps<T> {
  columns: ColDef<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  rowActions?: RowAction<T>[];
  storageKey?: string;
  loading?: boolean;
  emptyIcon?: string;
  emptyMsg?: string;
  onRowClick?: (row: T) => void;
  selectedId?: string | null;
}

type SortState = { key: string; dir: 'asc' | 'desc' } | null;

// ─── Column picker popover ────────────────────────────────────────────────────

function ColPicker({ columns, visible, onChange }: {
  columns: ColDef<unknown>[];
  visible: Set<string>;
  onChange: (key: string, on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Configure columns"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '4px 9px', borderRadius: 6, border: '1px solid #E2E8F0',
          background: open ? '#F1F5F9' : 'white', color: '#64748B',
          fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        <Settings2 size={12} /> Columns
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', right: 0,
          background: 'white', border: '1px solid #E2E8F0', borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,.08)', zIndex: 50,
          minWidth: 160, padding: '4px 0',
        }}>
          {columns.map((col) => (
            <label
              key={col.key}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', cursor: 'pointer' }}
            >
              <input
                type="checkbox"
                checked={visible.has(col.key)}
                onChange={(e) => onChange(col.key, e.target.checked)}
                style={{ accentColor: '#3DA8D8', cursor: 'pointer' }}
              />
              <span style={{ fontSize: 12, color: '#1A1A2E' }}>{col.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Row actions kebab menu ────────────────────────────────────────────────────

function RowMenu<T>({ row, actions }: { row: T; actions: RowAction<T>[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        aria-label="Row actions"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 26, height: 26, borderRadius: 6,
          border: '1px solid #E2E8F0', background: 'white', color: '#94A3B8', cursor: 'pointer',
        }}
      >
        <MoreHorizontal size={13} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', right: 0,
          background: 'white', border: '1px solid #E2E8F0', borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,.08)', zIndex: 50,
          minWidth: 140, padding: '4px 0',
        }}>
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={(e) => { e.stopPropagation(); setOpen(false); action.onClick(row); }}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '7px 14px', fontSize: 12, fontWeight: 500,
                color: action.destructive ? '#EF4444' : '#1A1A2E',
                background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── DataTable ────────────────────────────────────────────────────────────────

export function DataTable<T>({
  columns, rows, rowKey, rowActions, storageKey,
  loading, emptyIcon = '📋', emptyMsg = 'No records',
  onRowClick, selectedId,
}: DataTableProps<T>) {
  const defaultVisible = useMemo(
    () => new Set(columns.filter((c) => c.defaultVisible !== false).map((c) => c.key)),
    // Intentionally only on mount — column list is stable after initial render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [visible, setVisible] = useState<Set<string>>(() => {
    if (storageKey) {
      try {
        const raw = localStorage.getItem(`dt:cols:${storageKey}`);
        if (raw) return new Set(JSON.parse(raw) as string[]);
      } catch { /* ignore */ }
    }
    return defaultVisible;
  });

  const toggleCol = useCallback((key: string, on: boolean) => {
    setVisible((prev) => {
      const next = new Set(prev);
      if (on) next.add(key); else next.delete(key);
      if (storageKey) {
        try { localStorage.setItem(`dt:cols:${storageKey}`, JSON.stringify([...next])); } catch { /* ignore */ }
      }
      return next;
    });
  }, [storageKey]);

  const [sort, setSort] = useState<SortState>(null);

  const cycleSort = useCallback((key: string) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return null;
    });
  }, []);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const fn = col.sortValue;
    return [...rows].sort((a, b) => {
      const av = fn(a) ?? '';
      const bv = fn(b) ?? '';
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv));
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sort, columns]);

  const visibleCols = columns.filter((c) => visible.has(c.key));
  const hasActions = !!rowActions?.length;

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: '#94A3B8' }}>
        Loading…
      </div>
    );
  }

  if (!sortedRows.length) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200, gap: 8 }}>
        <span style={{ fontSize: 28 }}>{emptyIcon}</span>
        <strong style={{ color: '#475569', fontSize: 13 }}>{emptyMsg}</strong>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '4px 14px 0' }}>
        <ColPicker columns={columns as ColDef<unknown>[]} visible={visible} onChange={toggleCol} />
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {visibleCols.map((col) => (
              <th
                key={col.key}
                onClick={col.sortable ? () => cycleSort(col.key) : undefined}
                style={{
                  position: 'sticky', top: 0, zIndex: 1,
                  background: 'white', textAlign: 'left',
                  fontSize: 10, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase',
                  color: '#94A3B8', padding: '8px 14px',
                  borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap',
                  cursor: col.sortable ? 'pointer' : undefined,
                  userSelect: 'none',
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  {col.label}
                  {col.sortable && (
                    sort?.key === col.key
                      ? sort.dir === 'asc'
                        ? <ChevronUp size={11} color="#3DA8D8" />
                        : <ChevronDown size={11} color="#3DA8D8" />
                      : <ChevronsUpDown size={11} style={{ opacity: 0.35 }} />
                  )}
                </span>
              </th>
            ))}
            {hasActions && (
              <th style={{
                position: 'sticky', top: 0, zIndex: 1, background: 'white',
                borderBottom: '1px solid #E2E8F0', width: 48,
              }} />
            )}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => {
            const id = rowKey(row);
            const sel = selectedId === id;
            return (
              <tr
                key={id}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                style={{
                  borderBottom: '1px solid #F1F5F9',
                  cursor: onRowClick ? 'pointer' : undefined,
                  background: sel ? 'rgba(61,168,216,0.05)' : undefined,
                }}
              >
                {visibleCols.map((col) => (
                  <td key={col.key} style={{ padding: '8px 14px', verticalAlign: 'middle', fontSize: 13, ...col.cellStyle }}>
                    {col.render(row)}
                  </td>
                ))}
                {hasActions && (
                  <td style={{ padding: '8px 14px', verticalAlign: 'middle', textAlign: 'right' }}>
                    <RowMenu row={row} actions={rowActions!} />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
