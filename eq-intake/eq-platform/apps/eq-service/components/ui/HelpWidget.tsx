'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { cn } from '@/lib/utils/cn'
import {
  HelpCircle, X, Search, Package, MapPin, ClipboardCheck, FileCheck, Building2,
  Zap, FileText, BarChart3, Settings, Users, Upload, Plus, Download, ArrowRight,
} from 'lucide-react'

interface HelpItem {
  id: string
  question: string
  answer: string
  action?: { label: string; href: string }
  tags: string[]
  icon: typeof HelpCircle
}

const helpItems: HelpItem[] = [
  // Assets
  {
    id: 'add-asset',
    question: 'How do I add a new asset?',
    answer: 'Go to Assets, click "Add Asset" in the top right. Fill in the details including site, location, maintenance plan and asset type.',
    action: { label: 'Go to Assets', href: '/assets' },
    tags: ['asset', 'create', 'new', 'add'],
    icon: Package,
  },
  {
    id: 'import-assets',
    question: 'How do I import assets from a spreadsheet?',
    answer: 'Go to Assets, click the "Import" button. Upload a CSV file with columns: name, maximo_id, site, location, asset_type, manufacturer, model, serial_number.',
    action: { label: 'Go to Assets', href: '/assets' },
    tags: ['asset', 'import', 'csv', 'spreadsheet', 'bulk', 'upload'],
    icon: Upload,
  },
  {
    id: 'filter-assets',
    question: 'How do I filter assets?',
    answer: 'The asset table has filter dropdowns under each column header. Use text filters for Maximo ID and Name, or dropdown filters for Site, Location, Type, Maintenance Plan and Status.',
    action: { label: 'Go to Assets', href: '/assets' },
    tags: ['asset', 'filter', 'search', 'find'],
    icon: Package,
  },
  // Sites
  {
    id: 'add-site',
    question: 'How do I add a new site?',
    answer: 'Go to Sites, click "Add Site". Enter the site name, code, customer, and address details.',
    action: { label: 'Go to Sites', href: '/sites' },
    tags: ['site', 'create', 'new', 'add'],
    icon: MapPin,
  },
  {
    id: 'site-contacts',
    question: 'How do I add contacts to a site?',
    answer: 'Open a site by clicking its name, then scroll to the "Site Contacts" section. Click "Add Contact" to add a name, role, email and phone. You can mark one contact as primary.',
    tags: ['site', 'contact', 'primary', 'phone', 'email'],
    icon: MapPin,
  },
  // Customers
  {
    id: 'add-customer',
    question: 'How do I add a new customer?',
    answer: 'Go to Customers, click "Add Customer". Enter the customer name and optionally add a logo URL.',
    action: { label: 'Go to Customers', href: '/customers' },
    tags: ['customer', 'create', 'new', 'add', 'client'],
    icon: Building2,
  },
  // Maintenance
  {
    id: 'create-check',
    question: 'How do I create a maintenance check?',
    answer: 'Go to Maintenance, click "Create Check". Select the site, maintenance plan, and set a due date. Assets matching the maintenance plan will be automatically added.',
    action: { label: 'Go to Maintenance', href: '/maintenance' },
    tags: ['maintenance', 'check', 'create', 'new', 'pm', 'schedule'],
    icon: ClipboardCheck,
  },
  {
    id: 'complete-check',
    question: 'How do I complete a maintenance check?',
    answer: 'Open the check from the Maintenance list. You can complete assets individually, or use "Complete All Assets" to mark everything as passed in one go. Then finalise the check.',
    tags: ['maintenance', 'check', 'complete', 'finish', 'close'],
    icon: ClipboardCheck,
  },
  {
    id: 'download-report',
    question: 'How do I download a maintenance report?',
    answer: 'Open the maintenance check, then click "Download Report" at the top. This generates a Word document with all asset results, photos, and sign-off fields.',
    tags: ['report', 'download', 'word', 'docx', 'maintenance'],
    icon: Download,
  },
  // Maintenance Plans
  {
    id: 'create-job-plan',
    question: 'How do I create a maintenance plan?',
    answer: 'Go to Maintenance Plans, click "Add Maintenance Plan". Define the name, code, and frequency. Then add check items — these are the individual inspection points for each asset.',
    action: { label: 'Go to Maintenance Plans', href: '/job-plans' },
    tags: ['maintenance plan', 'create', 'new', 'frequency', 'check items'],
    icon: FileCheck,
  },
  // Testing
  {
    id: 'record-test',
    question: 'How do I record a test result?',
    answer: 'Go to Testing, click "Add Test Record". Select the site, asset, test type, and enter the results. You can set next test due dates for tracking.',
    action: { label: 'Go to Testing', href: '/testing' },
    tags: ['test', 'record', 'result', 'create'],
    icon: Zap,
  },
  // Reports & Analytics
  {
    id: 'view-analytics',
    question: 'Where can I see analytics and trends?',
    answer: 'Go to Analytics for charts showing maintenance completion rates, overdue trends, and asset health across your sites.',
    action: { label: 'Go to Analytics', href: '/analytics' },
    tags: ['analytics', 'chart', 'trend', 'data', 'report', 'graph'],
    icon: BarChart3,
  },
  // Contract Scope
  {
    id: 'contract-scope',
    question: 'How do I check what\'s in our contract scope?',
    answer: 'Go to Contract Scope in the main menu. This shows what work items are included or excluded from each customer contract for the current financial year.',
    action: { label: 'Go to Contract Scope', href: '/contract-scope' },
    tags: ['contract', 'scope', 'included', 'excluded', 'commercial', 'budget'],
    icon: FileText,
  },
  // Admin
  {
    id: 'manage-users',
    question: 'How do I add or manage users?',
    answer: 'Admin users can go to Users under the Admin section in the sidebar. You can invite new users, change roles, and deactivate accounts.',
    action: { label: 'Go to Users', href: '/admin/users' },
    tags: ['user', 'invite', 'role', 'admin', 'permission', 'access'],
    icon: Users,
  },
  {
    id: 'report-settings',
    question: 'How do I customise report templates?',
    answer: 'Admin users can go to Report Settings under the Admin section. You can toggle sections on/off, set company details, add header/footer text, and configure sign-off fields.',
    action: { label: 'Go to Report Settings', href: '/admin/reports' },
    tags: ['report', 'template', 'settings', 'customise', 'logo', 'cover'],
    icon: Settings,
  },
  {
    id: 'tenant-settings',
    question: 'How do I change the app branding and colours?',
    answer: 'Admin users can go to Tenant Settings under the Admin section. You can set the product name, logo, and colour scheme for your organisation.',
    action: { label: 'Go to Tenant Settings', href: '/admin/settings' },
    tags: ['branding', 'colour', 'logo', 'settings', 'theme', 'customise'],
    icon: Settings,
  },
]

export function HelpWidget() {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const pathname = usePathname()

  // Close on route change
  useEffect(() => {
    setOpen(false)
    setSelectedId(null)
    setSearch('')
  }, [pathname])

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open])

  // Keyboard shortcut: ? or Ctrl+/
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't trigger if typing in an input
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if (e.key === '?' || (e.ctrlKey && e.key === '/')) {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
      if (e.key === 'Escape' && open) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open])

  const filtered = useMemo(() => {
    if (!search.trim()) return helpItems
    const terms = search.toLowerCase().split(/\s+/)
    return helpItems.filter((item) => {
      const haystack = `${item.question} ${item.tags.join(' ')}`.toLowerCase()
      return terms.every((term) => haystack.includes(term))
    })
  }, [search])

  const selected = selectedId ? helpItems.find((h) => h.id === selectedId) : null

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-all',
          open
            ? 'bg-eq-ink text-white rotate-90'
            : 'bg-eq-sky text-white hover:bg-eq-deep'
        )}
        title="Help (press ?)"
      >
        {open ? <X className="w-5 h-5" /> : <HelpCircle className="w-5 h-5" />}
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed bottom-20 right-6 z-50 w-96 max-h-[70vh] bg-white rounded-xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-100 bg-eq-ice/30">
            <h3 className="text-sm font-bold text-eq-deep mb-2">
              {selected ? '← Back' : 'What do you need help with?'}
            </h3>
            {selected ? (
              <button
                onClick={() => setSelectedId(null)}
                className="text-xs text-eq-sky hover:text-eq-deep font-medium"
              >
                ← Back to all topics
              </button>
            ) : (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-eq-grey" />
                <input
                  ref={inputRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search for help..."
                  className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-eq-sky focus:ring-1 focus:ring-eq-sky/20"
                />
              </div>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            {selected ? (
              <div className="p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <selected.icon className="w-5 h-5 text-eq-sky shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-semibold text-eq-ink text-sm">{selected.question}</h4>
                    <p className="text-sm text-eq-grey mt-2 leading-relaxed">{selected.answer}</p>
                  </div>
                </div>
                {selected.action && (
                  <button
                    onClick={() => {
                      router.push(selected.action!.href)
                      setOpen(false)
                    }}
                    className="flex items-center gap-2 w-full px-3 py-2.5 bg-eq-sky text-white text-sm font-medium rounded-lg hover:bg-eq-deep transition-colors"
                  >
                    <ArrowRight className="w-4 h-4" />
                    {selected.action.label}
                  </button>
                )}
              </div>
            ) : (
              <div className="py-1">
                {filtered.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-eq-grey">
                    No results found. Try different keywords.
                  </div>
                ) : (
                  filtered.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setSelectedId(item.id)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors text-left"
                    >
                      <item.icon className="w-4 h-4 text-eq-grey shrink-0" />
                      <span className="text-sm text-eq-ink">{item.question}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 border-t border-gray-100 bg-gray-50">
            <p className="text-[10px] text-eq-grey text-center">
              Press <kbd className="px-1 py-0.5 bg-white border border-gray-200 rounded text-[10px] font-mono">?</kbd> to toggle help
            </p>
          </div>
        </div>
      )}
    </>
  )
}
