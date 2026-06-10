/**
 * EQ Solves Service
 * © 2026 EQ, a registered business name of CDC Solutions Pty Ltd
 * Proprietary and confidential.
 *
 * Admin hub. Lands at /admin and surfaces the six admin tools as a card
 * grid: Users · Tenant Settings · Media Library · Report Settings ·
 * Archive · Audit Log. Replaces the flat 9-link Admin block that used
 * to live in the sidebar (the commercial tools — renewal pack, scope
 * import, scope derive — moved out to /commercials in the same PR).
 *
 * No hard role gate at the page level — matches existing /admin/*
 * behaviour where the sidebar entry is admin-only but the URLs are
 * reachable by anyone signed in. Mutating actions on each sub-page
 * still gate role server-side.
 */
import Link from 'next/link'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { Users, Settings, Image, FileText, Archive, ScrollText, Upload, Download, Sparkles } from 'lucide-react'

export const dynamic = 'force-dynamic'

type AdminCard = {
  label: string
  href: string
  description: string
  icon: typeof Users
}

const ADMIN_CARDS: AdminCard[] = [
  {
    label: 'Users',
    href: '/admin/users',
    description: 'Invite users, manage roles, deactivate accounts.',
    icon: Users,
  },
  {
    label: 'Workspace Settings',
    href: '/admin/settings',
    description: 'Branding, colours, logos, and how the app behaves.',
    icon: Settings,
  },
  {
    label: 'Media Library',
    href: '/admin/media',
    description: 'Workspace logos, site photos, and brand assets.',
    icon: Image,
  },
  {
    label: 'Report Settings',
    href: '/admin/reports',
    description: 'Customer report templates, sections, sign-off fields.',
    icon: FileText,
  },
  {
    label: 'Archive',
    href: '/admin/archive',
    description: 'Removed records — restore them or remove for good.',
    icon: Archive,
  },
  {
    label: 'Audit Log',
    href: '/audit-log',
    description: 'Every change — who, what, when. Filter by record type.',
    icon: ScrollText,
  },
  {
    label: 'Imports',
    href: '/admin/imports',
    description: 'All import flows in one place — work orders, ACB, RCD, scope.',
    icon: Upload,
  },
  {
    label: 'Backup',
    href: '/admin/backup',
    description: 'Download a workspace snapshot, or preview a backup file.',
    icon: Download,
  },
  {
    label: 'Tidy Our Data',
    href: '/admin/tidy',
    description: 'Auto-fix phones, states, emails and ABNs. Surface gaps and broken links.',
    icon: Sparkles,
  },
]

export default function AdminHubPage() {
  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'Admin' }]} />
        <h1 className="text-2xl font-bold text-eq-ink mt-2">Admin</h1>
        <p className="text-sm text-eq-grey mt-1">
          Manage users, branding, archive, and audit history.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {ADMIN_CARDS.map(({ label, href, description, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="group flex flex-col gap-2 p-5 bg-white border border-eq-line rounded-xl hover:border-eq-sky transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-md bg-eq-ice flex items-center justify-center text-eq-deep group-hover:bg-eq-sky group-hover:text-white transition-colors">
                <Icon className="w-5 h-5" />
              </div>
              <span className="text-sm font-semibold text-eq-ink">{label}</span>
            </div>
            <p className="text-xs text-eq-grey">{description}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
