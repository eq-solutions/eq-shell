'use client'
import { cn } from '@/lib/utils/cn'
import {
  LayoutDashboard, ClipboardCheck, Search, Settings, ChevronLeft, LogOut,
  Menu, X, CalendarDays, AlertTriangle, Shield, Database, Lightbulb, Zap
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { NotificationBell } from '@/components/ui/NotificationBell'
import type { Role, TenantSettings } from '@/lib/types'

/**
 * Sidebar navigation grouped into sections for visual structure.
 *
 * 2026-04-28 polish (PR J): the previous flat 14-item list felt unbalanced
 * after the Testing fold. Grouped by intent — Data (the records), Operations
 * (daily-driver work), Insight (strategic / reporting), with Dashboard at
 * top and Search/Settings at the bottom in their own unlabeled groups.
 *
 * Section labels match the existing Admin block's styling (uppercase 10px
 * tracking-wider white/30) so the Admin block reads as just one more
 * section, not a special case.
 */
type NavItem = {
  label: string
  href: string
  icon: typeof LayoutDashboard
  /**
   * Extra path prefixes that should also mark this entry as active.
   * Used by hub entries (Records, Insight, Admin) so the sidebar stays
   * highlighted when the user navigates to an underlying page via
   * direct URL or breadcrumb.
   */
  extraActivePaths?: string[]
}
type NavSection = { label?: string; items: NavItem[] }

/**
 * Sidebar module flags. After the Records + Insight hub collapse,
 * only Calendar + Defects remain as direct sidebar entries that
 * gate on flags — Variations / Commercials / Analytics / Contract
 * Scope are now hub-internal and gate inside the /insights hub
 * itself. The hub sidebar entry always renders.
 */
interface ModuleFlags {
  calendarEnabled: boolean
  defectsEnabled: boolean
}

// Underlying URLs that should keep the Records hub entry highlighted.
const RECORDS_PATHS = ['/customers', '/sites', '/contacts', '/assets', '/job-plans']

// Underlying URLs that should keep the Insight hub entry highlighted.
const INSIGHT_PATHS = ['/reports', '/analytics', '/contract-scope', '/variations', '/commercials']

function buildNavSections(flags: ModuleFlags, role: Role | null): NavSection[] {
  // Role-aware nav (UX audit PR #149 §2.6 + §5.2 — locked 2026-05-18):
  // technicians get a stripped sidebar — Records (the customers / sites /
  // assets / maintenance plans hub) and Insight (reports / analytics / contract
  // scope) are admin/supervisor concerns and add cognitive noise for a
  // tech whose entire day lives under Maintenance. Non-technician roles
  // see the full sidebar.
  const isTechnician = role === 'technician'

  // Operations section — Maintenance is always-on core; Calendar +
  // Defects are togglable per tenant (migration 0097).
  const operationsItems: NavItem[] = [
    // Testing folded into Maintenance 2026-04-28 (Royce review Q4) —
    // ACB/NSX/RCD live in maintenance_checks via the `kind`
    // discriminator (migration 0080). /testing/* routes still resolve
    // for direct URLs and LinkedTestsPanel deep links, but no longer
    // have a top-level sidebar entry.
    { label: 'Maintenance', href: '/maintenance', icon: ClipboardCheck },
  ]
  if (flags.calendarEnabled) {
    operationsItems.push({ label: 'Calendar', href: '/calendar', icon: CalendarDays })
  }
  if (flags.defectsEnabled) {
    operationsItems.push({ label: 'Defects', href: '/defects', icon: AlertTriangle })
  }

  // /do is action-first — sits ABOVE Dashboard for everyone (the entry
  // point for "what brings you here today?"). Hidden for read_only since
  // they can't actually do any of the things on offer; they get the
  // status-reading dashboard.
  const topItems: NavItem[] = []
  if (role !== 'read_only') {
    topItems.push({ label: 'Do', href: '/do', icon: Zap })
  }
  topItems.push({ label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard })
  if (!isTechnician) {
    topItems.push({ label: 'Records', href: '/records', icon: Database, extraActivePaths: RECORDS_PATHS })
  }

  const bottomItems: NavItem[] = []
  if (!isTechnician) {
    bottomItems.push({ label: 'Insight', href: '/insights', icon: Lightbulb, extraActivePaths: INSIGHT_PATHS })
  }
  bottomItems.push({ label: 'Search',   href: '/search',   icon: Search })
  bottomItems.push({ label: 'Settings', href: '/settings', icon: Settings })

  return [
    { items: topItems },
    { label: 'Operations', items: operationsItems },
    { items: bottomItems },
  ]
}

interface SidebarProps {
  isAdmin?: boolean
  /**
   * Per-tenant role of the current user — drives role-aware nav (PR A,
   * UX audit §5.2): technicians don't see Records or Insight. `null`
   * (unknown role) renders the full sidebar so we never accidentally
   * over-hide for admins.
   */
  role?: Role | null
  settings?: TenantSettings
}

export function Sidebar({
  isAdmin = false,
  role = null,
  settings,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()

  const productName = settings?.product_name || 'EQ Solves'
  // Sidebar module flags (migration 0097). After the Records + Insight
  // hub collapse, only Calendar + Defects gate at the sidebar level —
  // commercial / analytics / contract_scope toggles now drive what shows
  // INSIDE the /insights hub itself, not the sidebar entry. Fallback to
  // "everything on" when settings haven't loaded (rare, pre-onboarding).
  const navSections = buildNavSections(
    {
      calendarEnabled: settings?.calendar_enabled ?? true,
      defectsEnabled:  settings?.defects_enabled  ?? true,
    },
    role,
  )
  // Sidebar background is eq-ink (dark) — prefer the dark-surface logo
  // when configured, fall back to the light-surface one. Without this,
  // tenants with a dark logo (e.g. SKS coloured logo on the eq-ink bg)
  // render invisible.
  const logoUrl = settings?.logo_url_on_dark || settings?.logo_url
  const whiteLogo = 'https://pub-409bd651f2e549f4907f5a856a9264ae.r2.dev/EQ_logo_white_transparent.svg'

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  // Prevent body scroll when mobile drawer open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [mobileOpen])

  const sidebarContent = (
    <>
      <div className={cn(
        'flex items-center h-16 border-b border-white/10',
        collapsed ? 'justify-center px-2' : 'justify-between px-4'
      )}>
        {!collapsed && (
          logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={productName} className="max-h-10 max-w-[140px] w-auto object-contain" />
          ) : (
            <span className="font-bold text-sm tracking-wide text-eq-sky">{productName}</span>
          )
        )}
        <div className={cn('flex items-center gap-2', !collapsed && 'ml-auto')}>
          {/* Bell hidden when collapsed so the expand chevron has room to render in the 64px-wide rail. */}
          {!collapsed && <NotificationBell />}
          {/* Desktop collapse toggle */}
          <button
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="hidden lg:block p-1 rounded hover:bg-white/10 transition-colors"
          >
            <ChevronLeft className={cn('w-4 h-4 transition-transform', collapsed && 'rotate-180')} />
          </button>
          {/* Mobile close */}
          {!collapsed && (
            <button
              onClick={() => setMobileOpen(false)}
              className="lg:hidden p-1 rounded hover:bg-white/10 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
      <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
        {navSections.map((section, sIdx) => (
          <div key={sIdx} className={sIdx > 0 ? 'mt-3' : undefined}>
            {section.label && (
              <div className={cn('mb-1 px-3 text-[10px] uppercase tracking-wider text-white/30', collapsed && 'sr-only')}>
                {section.label}
              </div>
            )}
            {section.items.map(({ label, href, icon: Icon, extraActivePaths }) => {
              const allPaths = [href, ...(extraActivePaths ?? [])]
              const active = allPaths.some((p) => pathname === p || pathname.startsWith(p + '/'))
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    // 44px min-height for field-ergonomic tap targets on
                    // mobile / iPad (UX audit PR #149 §2.6). touch-manipulation
                    // kills iOS 300ms tap delay. Desktop visual stays clean —
                    // 44px on a 56px-wide rail is still a tight, professional
                    // nav.
                    'flex items-center gap-3 px-3 py-2 min-h-[44px] rounded-md transition-colors text-sm font-medium relative touch-manipulation',
                    active
                      ? 'bg-white/10 text-white before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:bg-eq-sky before:rounded-full'
                      : 'text-white/60 hover:text-white hover:bg-white/10'
                  )}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  {!collapsed && <span>{label}</span>}
                </Link>
              )
            })}
          </div>
        ))}
        {isAdmin && (
          <>
            <div className={cn('mt-4 mb-1 px-3 text-[10px] uppercase tracking-wider text-white/30', collapsed && 'sr-only')}>
              Admin
            </div>
            <Link
              href="/admin"
              className={cn(
                'flex items-center gap-3 px-3 py-2 min-h-[44px] rounded-md transition-colors text-sm font-medium relative touch-manipulation',
                pathname === '/admin' || pathname.startsWith('/admin/') || pathname.startsWith('/audit-log')
                  ? 'bg-white/10 text-white before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:bg-eq-sky before:rounded-full'
                  : 'text-white/60 hover:text-white hover:bg-white/10'
              )}
            >
              <Shield className="w-4 h-4 flex-shrink-0" />
              {!collapsed && <span>Admin</span>}
            </Link>
          </>
        )}
      </nav>
      {/* Subtle brand watermark — visible when sidebar is expanded */}
      {!collapsed && (
        <div className="flex justify-center py-4 opacity-[0.10]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={whiteLogo} alt="" aria-hidden="true" className="w-40 h-40 object-contain pointer-events-none" />
        </div>
      )}
      <div className="border-t border-white/10 p-2 mt-2">
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="w-full flex items-center gap-3 px-3 py-2 min-h-[44px] rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-colors text-sm font-medium touch-manipulation"
          >
            <LogOut className="w-4 h-4 flex-shrink-0" />
            {!collapsed && <span>Sign out</span>}
          </button>
        </form>
      </div>
    </>
  )

  return (
    <>
      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 h-14 bg-eq-ink flex items-center justify-between px-4">
        <button
          onClick={() => setMobileOpen(true)}
          className="p-2 -ml-2 rounded-md text-white hover:bg-white/10 transition-colors"
        >
          <Menu className="w-5 h-5" />
        </button>
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={productName} className="h-7 w-auto object-contain" />
        ) : (
          <span className="font-bold text-sm text-eq-sky">{productName}</span>
        )}
        <div className="flex items-center gap-2">
          <NotificationBell />
        </div>
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside className={cn(
        'lg:hidden fixed top-0 left-0 z-50 h-screen w-64 bg-eq-ink text-white transition-transform duration-300 flex flex-col',
        mobileOpen ? 'translate-x-0' : '-translate-x-full'
      )}>
        {sidebarContent}
      </aside>

      {/* Desktop sidebar */}
      <aside className={cn(
        'hidden lg:flex flex-col h-screen bg-eq-ink text-white transition-all duration-200 sticky top-0',
        collapsed ? 'w-16' : 'w-56'
      )}>
        {sidebarContent}
      </aside>
    </>
  )
}
