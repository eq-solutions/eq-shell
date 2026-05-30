// EqTable — reusable sortable table for the EQ suite.
//
// Usage:
//   const cols: ColDef<MyRow>[] = [
//     { key: 'name', header: 'Name', sortValue: r => r.name, render: r => r.name },
//     { key: 'amount', header: 'Amount', align: 'right', sortValue: r => r.amount,
//       render: r => fmt(r.amount) },
//   ];
//   <EqTable data={rows} columns={cols} rowKey={r => r.id} />
//
// Columns with sortValue are clickable. Click once to sort desc, again to flip to asc.
// rowStyle receives the row and returns inline style — use for conditional row colours.
// defaultSort sets the initial sorted column + direction.

import { useState, useMemo } from 'react';

export interface ColDef<T> {
  /** Unique key used to track active sort state */
  key: string;
  header: string;
  align?: 'left' | 'right' | 'center';
  /** Return a comparable value. String keys use locale-aware numeric compare.
   *  Omit to make the column non-sortable (no arrow shown). */
  sortValue?: (row: T) => string | number | null | undefined;
  render: (row: T) => React.ReactNode;
  /** Optional fixed column width (passed to th/td) */
  width?: string | number;
}

export interface EqTableProps<T> {
  data: T[];
  columns: ColDef<T>[];
  /** Return a stable string key for each row (used as React key) */
  rowKey: (row: T) => string;
  rowStyle?: (row: T) => React.CSSProperties | undefined;
  defaultSort?: { key: string; dir?: 'asc' | 'desc' };
  emptyMessage?: string;
  style?: React.CSSProperties;
}

export function EqTable<T,>({
  data,
  columns,
  rowKey,
  rowStyle,
  defaultSort,
  emptyMessage = 'No rows.',
  style,
}: EqTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(defaultSort?.key ?? null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(defaultSort?.dir ?? 'desc');

  const sorted = useMemo(() => {
    if (!sortKey) return data;
    const col = columns.find(c => c.key === sortKey);
    if (!col?.sortValue) return data;
    return [...data].sort((a, b) => {
      const av = col.sortValue!(a) ?? '';
      const bv = col.sortValue!(b) ?? '';
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir, columns]);

  function handleHeaderClick(key: string) {
    setSortKey(prev => {
      if (prev === key) {
        setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        return prev;
      }
      setSortDir('desc');
      return key;
    });
  }

  return (
    <table style={{
      width: '100%',
      borderCollapse: 'collapse',
      background: '#fff',
      borderRadius: 10,
      overflow: 'hidden',
      border: '1px solid #E2EAF0',
      fontSize: 13,
      ...style,
    }}>
      <thead>
        <tr>
          {columns.map(col => {
            const active = sortKey === col.key;
            const sortable = !!col.sortValue;
            return (
              <th
                key={col.key}
                onClick={sortable ? () => handleHeaderClick(col.key) : undefined}
                style={{
                  background: '#1A1A2E',
                  color: active ? '#fff' : 'rgba(255,255,255,0.6)',
                  fontSize: 10,
                  fontWeight: active ? 600 : 400,
                  textTransform: 'uppercase',
                  letterSpacing: '0.8px',
                  padding: '9px 12px',
                  textAlign: col.align ?? 'left',
                  cursor: sortable ? 'pointer' : 'default',
                  userSelect: 'none',
                  whiteSpace: 'nowrap',
                  width: col.width,
                  transition: 'color 0.1s',
                }}
              >
                {col.header}
                {sortable && (
                  <span style={{
                    marginLeft: 5,
                    display: 'inline-block',
                    opacity: active ? 1 : 0.25,
                    fontSize: 9,
                    verticalAlign: 'middle',
                  }}>
                    {active ? (sortDir === 'asc' ? '▲' : '▼') : '▲▼'}
                  </span>
                )}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {sorted.length === 0 ? (
          <tr>
            <td
              colSpan={columns.length}
              style={{ padding: '20px 12px', textAlign: 'center', color: '#6B7A99' }}
            >
              {emptyMessage}
            </td>
          </tr>
        ) : sorted.map(row => (
          <tr key={rowKey(row)} style={rowStyle?.(row)}>
            {columns.map(col => (
              <td
                key={col.key}
                style={{
                  padding: '9px 12px',
                  textAlign: col.align ?? 'left',
                  borderBottom: '1px solid #EEF2F7',
                  verticalAlign: 'middle',
                  width: col.width,
                }}
              >
                {col.render(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
