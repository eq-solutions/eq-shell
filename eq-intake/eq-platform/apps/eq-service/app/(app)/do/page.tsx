/**
 * EQ Solves Service
 * © 2026 EQ, a registered business name of CDC Solutions Pty Ltd
 * Proprietary and confidential.
 *
 * /do — action hub. The "what brings you here today?" launcher.
 *
 * Lands users at one obvious starting point for the most common
 * intents: import bulk data, add new records, or create a check
 * / test. Role-aware ordering — technicians see "Create a check
 * or test" first; admins see "Import data" first.
 *
 * Each tile links to the existing flow's URL. /do doesn't reinvent
 * the slide-panel forms — it just makes discovery one click instead
 * of two-or-three.
 *
 * Background: pre-go-live UX surface. Royce has flagged this in
 * multiple sessions as a critical readiness item — see the memory
 * entry project_do_page_action_hub. Conceptually mirrors the
 * "Quick actions" panel that MaintainX / UpKeep / Limble all use
 * (per the 2026-05-19 competitive feature audit).
 */
import Link from 'next/link'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { createClient } from '@/lib/supabase/server'
import { canCreateCheck, isAdmin, canWrite } from '@/lib/utils/roles'
import type { Role } from '@/lib/types'
import {
  FileSpreadsheet, Upload, Zap,
  Building2, MapPin, Package, ClipboardList,
  ClipboardCheck, Activity, Gauge, ShieldCheck,
} from 'lucide-react'

export const dynamic = 'force-dynamic'

type Visibility = 'admin-supervisor' | 'check-creator'

type DoTile = {
  label: string
  description: string
  href: string
  icon: typeof Building2
  visibleTo: Visibility
}

type DoSection = {
  label: string
  description: string
  /** Higher renders earlier. Same priority falls back to declaration order. */
  priorityFor: Partial<Record<Role, number>>
  tiles: DoTile[]
}

const SECTIONS: DoSection[] = [
  {
    label: 'Import data',
    description: 'Bring whole tables in at once — scope items, work orders, RCD circuits — via spreadsheet or contract upload.',
    priorityFor: { super_admin: 3, admin: 3, supervisor: 2, technician: 0 },
    tiles: [
      {
        label: 'Import scope items from Excel',
        description: 'Upload a customer\'s scope spreadsheet — included / excluded items per site, per FY.',
        href: '/contract-scope',
        icon: FileSpreadsheet,
        visibleTo: 'admin-supervisor',
      },
      {
        label: 'Import work orders',
        description: 'Equinix Delta WO export (.xlsx). Multi-file consolidation supported.',
        href: '/maintenance/import',
        icon: Upload,
        visibleTo: 'admin-supervisor',
      },
      {
        label: 'Import RCD tests',
        description: 'Jemena multi-tab RCD xlsx — one tab per board, full circuit detail.',
        href: '/testing/rcd/import',
        icon: Zap,
        visibleTo: 'admin-supervisor',
      },
    ],
  },
  {
    label: 'Add a record',
    description: 'Manual one-at-a-time creation for customers, sites, assets, and the maintenance plans that bind them.',
    priorityFor: { super_admin: 2, admin: 2, supervisor: 2, technician: 0 },
    tiles: [
      {
        label: 'Add a customer',
        description: 'New customer account — branding, contacts, contract scope.',
        href: '/customers',
        icon: Building2,
        visibleTo: 'admin-supervisor',
      },
      {
        label: 'Add a site',
        description: 'A location under a customer — address, contacts, after-hours.',
        href: '/sites',
        icon: MapPin,
        visibleTo: 'admin-supervisor',
      },
      {
        label: 'Add an asset',
        description: 'A serviceable item — breaker, board, generator — under a site.',
        href: '/assets',
        icon: Package,
        visibleTo: 'admin-supervisor',
      },
      {
        label: 'Add a Maintenance Plan',
        description: 'A reusable checklist — tasks, frequency, scope. Customer or site or global.',
        href: '/job-plans',
        icon: ClipboardList,
        visibleTo: 'admin-supervisor',
      },
    ],
  },
  {
    label: 'Create a check or test',
    description: 'Start the actual work — schedule a visit or open a test workflow on-site.',
    priorityFor: { super_admin: 1, admin: 1, supervisor: 3, technician: 3 },
    tiles: [
      {
        label: 'Schedule a maintenance check',
        description: 'Pick a site, frequency, and plan — generates a check with one card per asset.',
        href: '/maintenance',
        icon: ClipboardCheck,
        visibleTo: 'check-creator',
      },
      {
        label: 'Start an ACB test',
        description: 'Air Circuit Breaker — 3-step workflow: collection, visual / functional, electrical.',
        href: '/testing/acb',
        icon: Activity,
        visibleTo: 'check-creator',
      },
      {
        label: 'Start an NSX test',
        description: 'Moulded-case breaker — same 3-step shape as ACB.',
        href: '/testing/nsx',
        icon: Gauge,
        visibleTo: 'check-creator',
      },
      {
        label: 'Start an RCD test',
        description: 'Residual current device per-circuit timing — Jemena 6-monthly compliance flow.',
        href: '/testing/rcd',
        icon: ShieldCheck,
        visibleTo: 'check-creator',
      },
    ],
  },
]

function isVisible(visibility: Visibility, role: Role | null): boolean {
  if (visibility === 'admin-supervisor') return canWrite(role) || isAdmin(role)
  if (visibility === 'check-creator') return canCreateCheck(role)
  return false
}

export default async function DoPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  let userRole: Role | null = null
  let firstName: string | null = null
  if (user) {
    const [{ data: membership }, { data: profile }] = await Promise.all([
      supabase
        .from('tenant_members')
        .select('role')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle(),
      supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .maybeSingle(),
    ])
    userRole = (membership?.role as Role) ?? null
    firstName = profile?.full_name?.split(' ')[0] ?? null
  }

  // Filter tiles per role + order sections by role priority.
  const visibleSections = SECTIONS
    .map((section) => ({
      ...section,
      tiles: section.tiles.filter((t) => isVisible(t.visibleTo, userRole)),
      priority: userRole ? section.priorityFor[userRole] ?? 0 : 0,
    }))
    .filter((s) => s.tiles.length > 0)
    .sort((a, b) => b.priority - a.priority)

  const greeting = firstName ? `What would you like to do, ${firstName}?` : 'What would you like to do?'

  return (
    <div className="space-y-8">
      <div>
        <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'Do' }]} />
        <h1 className="text-3xl font-bold text-eq-ink mt-2">{greeting}</h1>
        <p className="text-sm text-eq-grey mt-1">
          One tap to start the most common things — importing data, adding records, or running a check.
        </p>
      </div>

      {visibleSections.length === 0 ? (
        <div className="text-center py-12 border border-gray-200 rounded-xl bg-white">
          <p className="text-eq-grey text-sm">
            You don&apos;t have permissions to start any actions from here yet. Ask an administrator
            to grant you a role that can create checks.
          </p>
        </div>
      ) : (
        visibleSections.map((section) => (
          <section key={section.label} className="space-y-3">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-eq-deep">
                {section.label}
              </h2>
              <p className="text-xs text-eq-grey mt-0.5">{section.description}</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {section.tiles.map(({ label, description, href, icon: Icon }) => (
                <Link
                  key={href + label}
                  href={href}
                  className="group flex flex-col gap-2 p-5 bg-white border border-eq-line rounded-xl hover:border-eq-sky transition-colors min-h-[120px]"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-md bg-eq-ice flex items-center justify-center text-eq-deep group-hover:bg-eq-sky group-hover:text-white transition-colors shrink-0">
                      <Icon className="w-5 h-5" />
                    </div>
                    <span className="text-sm font-semibold text-eq-ink leading-tight">{label}</span>
                  </div>
                  <p className="text-xs text-eq-grey">{description}</p>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  )
}
