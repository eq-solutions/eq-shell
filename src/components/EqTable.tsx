// EqTable — compatibility shim over @eq-solutions/ui Table.
//
// Accepts Shell's original EqTableProps / ColDef API so call sites don't
// need to change. Internally converts to the canonical TableColumn / TableProps
// and renders the package component.

import { Table, type TableColumn } from '@eq-solutions/ui';

export interface ColDef<T> {
  key: string;
  header: string;
  align?: 'left' | 'right' | 'center';
  sortValue?: (row: T) => string | number | null | undefined;
  render: (row: T) => React.ReactNode;
  width?: string | number;
}

export interface EqTableProps<T> {
  data: T[];
  columns: ColDef<T>[];
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
  emptyMessage,
  style,
}: EqTableProps<T>) {
  const tableColumns: TableColumn<T>[] = columns.map(col => ({
    key: col.key,
    header: col.header,
    align: col.align,
    width: col.width,
    sortAccessor: col.sortValue,
    render: col.render,
  }));

  return (
    <div style={style}>
      <Table
        rows={data}
        columns={tableColumns}
        getRowId={rowKey}
        rowStyle={rowStyle}
        defaultSort={defaultSort}
        emptyMessage={emptyMessage}
      />
    </div>
  );
}
