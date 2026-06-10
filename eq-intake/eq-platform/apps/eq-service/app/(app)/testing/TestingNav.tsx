'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils/cn'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { Zap, Shield, CircuitBoard, Gauge, ClipboardList, ShieldCheck } from 'lucide-react'

const tabs = [
  { label: 'Summary', href: '/testing/summary', icon: ClipboardList },
  { label: 'ACB Testing', href: '/testing/acb', icon: Shield },
  { label: 'NSX Testing', href: '/testing/nsx', icon: CircuitBoard },
  { label: 'RCD Testing', href: '/testing/rcd', icon: ShieldCheck },
  { label: 'Instruments', href: '/instruments', icon: Gauge },
  { label: 'General Testing (under development)', href: '/testing?stay=1', icon: Zap },
]

export function TestingNav() {
  const pathname = usePathname()

  function isActive(href: string) {
    const hrefPath = href.split('?')[0]
    if (hrefPath === '/testing') return pathname === '/testing'
    return pathname.startsWith(hrefPath)
  }

  return (
    <div>
      <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'Testing' }]} />
      <h1 className="text-3xl font-bold text-eq-sky mt-2 mb-4">Testing</h1>
      <div className="flex items-center gap-1 border-b border-gray-200">
        {tabs.map(({ label, href, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px',
              isActive(href)
                ? 'border-eq-sky text-eq-sky'
                : 'border-transparent text-eq-grey hover:text-eq-ink hover:border-gray-300'
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </Link>
        ))}
      </div>
    </div>
  )
}
