// Ambient type declarations for @eq-solutions/ui.
//
// The package ships TypeScript source (no build output) which causes tsc to
// type-check it under Shell's stricter compiler options (verbatimModuleSyntax,
// noUnusedLocals). This declaration file shadows the package's source so tsc
// never reads the package's .tsx files directly.
//
// Keep in sync with @eq-solutions/ui/src/index.ts.

declare module '@eq-solutions/ui' {
  import type { CSSProperties, HTMLAttributes, ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

  // ── Button ─────────────────────────────────────────────────────────────────
  export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
  export type ButtonSize = 'sm' | 'md' | 'lg'
  export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant
    size?: ButtonSize
    loading?: boolean
    icon?: ReactNode
  }
  export const Button: React.ForwardRefExoticComponent<
    ButtonProps & React.RefAttributes<HTMLButtonElement>
  >

  // ── FormInput ──────────────────────────────────────────────────────────────
  export interface FormInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
    label?: string
    error?: string
    hint?: string
  }
  export const FormInput: React.ForwardRefExoticComponent<
    FormInputProps & React.RefAttributes<HTMLInputElement>
  >

  // ── Modal / ConfirmDialog ──────────────────────────────────────────────────
  export interface ModalProps {
    open: boolean
    onClose: () => void
    title?: ReactNode
    description?: ReactNode
    footer?: ReactNode
    children?: ReactNode
  }
  export function Modal(props: ModalProps): React.ReactElement | null

  export interface ConfirmDialogProps {
    open: boolean
    onClose: () => void
    onConfirm: () => void
    title: ReactNode
    description?: ReactNode
    confirmLabel?: string
    cancelLabel?: string
    destructive?: boolean
    loading?: boolean
  }
  export function ConfirmDialog(props: ConfirmDialogProps): React.ReactElement

  // ── StatusBadge ────────────────────────────────────────────────────────────
  export type StatusKind = 'ok' | 'warn' | 'err' | 'info' | 'neutral'
  export interface StatusBadgeProps {
    kind?: StatusKind
    label: string
  }
  export function StatusBadge(props: StatusBadgeProps): React.ReactElement

  // ── KindPill ───────────────────────────────────────────────────────────────
  export type WorkKind = string
  export interface KindPillProps {
    kind: WorkKind
    label?: string
  }
  export function KindPill(props: KindPillProps): React.ReactElement

  // ── Card ───────────────────────────────────────────────────────────────────
  export interface CardProps extends HTMLAttributes<HTMLDivElement> {
    children?: ReactNode
  }
  export function Card(props: CardProps): React.ReactElement

  // ── Tabs ───────────────────────────────────────────────────────────────────
  export interface TabItem {
    key: string
    label: string
    content?: ReactNode
  }
  export interface TabsProps {
    tabs: TabItem[]
    activeKey?: string
    onChange?: (key: string) => void
  }
  export function Tabs(props: TabsProps): React.ReactElement

  // ── Toast ──────────────────────────────────────────────────────────────────
  export type ToastTone = 'success' | 'error' | 'warning' | 'info'
  export interface ToastOptions {
    message: string
    tone?: ToastTone
    duration?: number
  }
  export interface ToastContextValue {
    toast: (opts: ToastOptions) => void
  }
  export function ToastProvider(props: { children: ReactNode }): React.ReactElement
  export function useToast(): ToastContextValue

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
