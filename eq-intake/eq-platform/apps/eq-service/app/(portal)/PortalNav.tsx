'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Building2, Scale, AlertTriangle, CalendarDays, FileSignature, FileText, Settings } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

interface PortalNavProps {
  /** Tabs to show. Variations is gated on commercial-tier. */
  showVariations: boolean
}

/**
 * Tab navigation for the customer portal. Matches the visual vocabulary
 * of the main app's sidebar (active = bg-eq-ice/40 + bottom accent), but
 * laid out horizontally because portal pages are wide-and-short rather
 * than the main app's tall-and-many-rows.
 */
export function PortalNav({ showVariations }: PortalNavProps) {
  const pathname = usePathname()

  const items: Array<{ label: string; href: string; icon: typeof LayoutDashboard }> = [
    { label: 'Overview',   href: '/portal/sites',      icon: Building2 },
    { label: 'Reports',    href: '/portal',            icon: FileText },
    { label: 'Visits',     href: '/portal/visits',     icon: CalendarDays },
    { label: 'Scope',      href: '/portal/scope',      icon: Scale },
    { label: 'Defects',    href: '/portal/defects',    icon: AlertTriangle },
  ]
  if (showVariations) {
    items.push({ label: 'Variations', href: '/portal/variations', icon: FileSignature })
  }
  items.push({ label: 'Settings', href: '/portal/settings', icon: Settings })

  return (
    <nav className="bg-white border-b border-gray-200 -mx-6 px-6 mb-6 overflow-x-auto">
      <div className="max-w-4xl mx-auto flex gap-6">
        {items.map(({ label, href, icon: Icon }) => {
          const active = pathname === href || (href !== '/portal' && pathname.startsWith(href + '/'))
          // Special: /portal exact match for Reports (since it's the root).
          const isReportsRoot = href === '/portal' && pathname === '/portal'
          const finalActive = href === '/portal' ? isReportsRoot : active

          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-2 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                finalActive
                  ? 'border-eq-sky text-eq-deep'
                  : 'border-transparent text-eq-grey hover:text-eq-ink',
              )}
            >
              <Icon className="w-4 h-4" />
              <span>{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
