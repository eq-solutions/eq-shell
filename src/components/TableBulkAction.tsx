import type { ReactNode } from 'react';

interface Props {
  onClick: () => void;
  icon?: ReactNode;
  danger?: boolean;
  children?: ReactNode;
}

export function TableBulkAction({ onClick, icon, danger, children }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`eq-table-bulk-action${danger ? ' eq-table-bulk-action--danger' : ''}`}
    >
      {icon && <span className="eq-table-bulk-action__icon">{icon}</span>}
      {children}
    </button>
  );
}
