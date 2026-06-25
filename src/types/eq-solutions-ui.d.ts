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

  // ── Spinner ────────────────────────────────────────────────────────────────
  export type SpinnerVariant = 'bars' | 'ring' | 'dots' | 'trail'
  export type SpinnerSize = 'sm' | 'md' | 'lg'
  export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
    variant?: SpinnerVariant
    size?: SpinnerSize
    label?: string
    inverted?: boolean
  }
  export function Spinner(props: SpinnerProps): React.ReactElement

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
    locked?: boolean
  }
  export type TableColumnDef<T> = TableColumn<T>

  export interface TableSlicer<T> {
    key: string
    label: string
    filter?: (row: T) => boolean
    dot?: string
  }

  export interface TablePagination {
    pageSize?: number
    totalCount?: number
  }

  export interface TableBulkActionProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    icon?: ReactNode
    danger?: boolean
  }
  export function TableBulkAction(props: TableBulkActionProps): React.ReactElement

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
    loading?: boolean
    loadingRows?: number
    // v1.4 props
    slicers?: TableSlicer<T>[]
    activeSlicer?: string
    onSlicerChange?: (key: string) => void
    globalSearch?: boolean | { placeholder?: string }
    columnToggle?: boolean
    exportable?: boolean | { filename?: string }
    bulkActions?: (rows: T[], clearSelection: () => void) => ReactNode
    rowIndicator?: (row: T) => { color: string } | null | undefined
    density?: 'comfortable' | 'compact'
    rowVariant?: 'lines' | 'zebra' | 'plain'
    pagination?: TablePagination
    summary?: string | ((visibleCount: number, totalCount: number) => ReactNode)
    // v1.5 built-in row actions
    onDelete?: (rows: T[]) => Promise<void> | void
    onArchive?: (rows: T[]) => Promise<void> | void
    deleteLabel?: string
    archiveLabel?: string
    deleteConfirm?: {
      title?: string | ((count: number) => string)
      description?: string | ((count: number) => string)
    }
    archiveConfirm?: boolean | {
      title?: string | ((count: number) => string)
      description?: string | ((count: number) => string)
    }
    onActionError?: (action: 'delete' | 'archive', error: unknown) => void
  }
  export function Table<T>(props: TableProps<T>): React.ReactElement

  // ── DropdownMenu ──────────────────────────────────────────────────────────
  export interface DropdownMenuItemDef {
    key: string
    label: string
    icon?: ReactNode
    onClick: () => void
    disabled?: boolean
    variant?: 'default' | 'danger'
  }
  export interface DropdownMenuSeparatorDef {
    key: string
    separator: true
  }
  export type DropdownMenuEntry = DropdownMenuItemDef | DropdownMenuSeparatorDef
  export interface DropdownMenuProps {
    trigger: ReactNode
    items: DropdownMenuEntry[]
    align?: 'left' | 'right'
  }
  export function DropdownMenu(props: DropdownMenuProps): React.ReactElement

  // ── AppShell / AppSidebar / AppRail ────────────────────────────────────────
  export interface AppSidebarItem {
    key: string
    label: string
    href: string
    icon: ReactNode
    isActive?: boolean
    count?: number | null
    badge?: string
    warn?: boolean
    muted?: boolean
    arrow?: boolean
  }

  export interface AppSidebarSection {
    key: string
    label: string
    items: AppSidebarItem[]
  }

  export interface AppSidebarUser {
    initials: string
    name: string
    meta: string
  }

  export interface AppSidebarProps {
    homeHref: string
    logo?: ReactNode
    brandLabel?: string
    live?: boolean
    tenantSwitcher?: ReactNode
    sections: AppSidebarSection[]
    user: AppSidebarUser
    compact?: boolean
    onToggleCompact?: () => void
    onLogout: () => void
    storageKey?: string
  }

  export function AppSidebar(props: AppSidebarProps): React.ReactElement

  export interface AppRailItem {
    key: string
    label: string
    icon: ReactNode
    href: string
    isActive?: boolean
    isDisabled?: boolean
    disabledTitle?: string
  }

  export interface AppRailProps {
    homeHref: string
    logo?: ReactNode
    items: AppRailItem[]
    settingsHref?: string
    settingsActive?: boolean
    user: { initials: string; name: string }
    onLogout: () => void
  }

  export function AppRail(props: AppRailProps): React.ReactElement

  type AppShellSidebarProps = {
    mode?: 'sidebar'
    sidebar: ReactNode
    children: ReactNode
    fullWidth?: boolean
  }

  type AppShellRailProps = {
    mode: 'rail'
    rail: ReactNode
    children: ReactNode
    fullWidth?: never
  }

  export type AppShellProps = AppShellSidebarProps | AppShellRailProps

  export function AppShell(props: AppShellProps): React.ReactElement
}
