// Ambient type declarations for @eq-solutions/ui.
//
// The package ships TypeScript source (no build output) which causes tsc to
// type-check it under Shell's stricter compiler options (verbatimModuleSyntax,
// noUnusedLocals). This declaration file shadows the package's source so tsc
// never reads the package's .tsx files directly.
//
// Keep in sync with @eq-solutions/ui/src/index.ts.

declare module '@eq-solutions/ui' {
  import type { CSSProperties, HTMLAttributes, ButtonHTMLAttributes } from 'react'

  // ── Button ─────────────────────────────────────────────────────────────────
  export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
  export type ButtonSize = 'sm' | 'md' | 'lg'
  export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant
    size?: ButtonSize
    loading?: boolean
  }
  export const Button: React.ForwardRefExoticComponent<
    ButtonProps & React.RefAttributes<HTMLButtonElement>
  >

  // ── Skeleton ───────────────────────────────────────────────────────────────
  export type SkeletonShape = 'text' | 'line' | 'circle' | 'card'
  export interface SkeletonProps extends HTMLAttributes<HTMLSpanElement> {
    shape?: SkeletonShape
    count?: number
    width?: string | number
    height?: string | number
  }
  export interface SkeletonRowsProps {
    count?: number
    columns?: number
  }
  export interface SkeletonCardsProps {
    count?: number
  }
  export function Skeleton(props: SkeletonProps): React.ReactElement
  export function SkeletonRows(props: SkeletonRowsProps): React.ReactElement
  export function SkeletonCards(props: SkeletonCardsProps): React.ReactElement

  // ── Table ──────────────────────────────────────────────────────────────────
  export interface TableColumn<T> {
    key: string
    header: string
    render?: (row: T) => React.ReactNode
    sortAccessor?: (row: T) => string | number | null | undefined
    sortable?: false
    filterable?: 'text' | 'select'
    filterOptions?: { value: string; label: string }[]
    className?: string
    width?: string | number
    align?: 'left' | 'right' | 'center'
  }
  export type TableColumnDef<T> = TableColumn<T>
  export interface TableProps<T> {
    columns: TableColumn<T>[]
    rows: T[]
    getRowId?: (row: T) => string
    defaultSort?: { key: string; dir?: 'asc' | 'desc' }
    emptyMessage?: string
    className?: string
    rowStyle?: (row: T) => CSSProperties | undefined
    selectable?: boolean
    selectedIds?: Set<string>
    onSelectionChange?: (ids: Set<string>) => void
    onRowClick?: (row: T) => void
  }
  export function Table<T>(props: TableProps<T>): React.ReactElement
}
