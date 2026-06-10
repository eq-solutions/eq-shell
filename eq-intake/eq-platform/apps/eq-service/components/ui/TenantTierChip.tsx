/**
 * EQ Solves Service
 * © 2026 EQ, a registered business name of CDC Solutions Pty Ltd
 * Proprietary and confidential.
 *
 * TenantTierChip — Plan visibility chip in the global header.
 *
 * Phase A of the tier framework (migration 0092). VISIBILITY ONLY —
 * this component renders the tenant's tier + compliance_tier and a
 * dropdown summarising what's included. Nothing in the app blocks
 * based on tier at this phase; we ship the chip first, watch usage
 * for a sprint, then layer enforcement in a later PR.
 *
 * Positioning: fixed top-right on desktop, inline in the mobile top
 * bar (handled by parent). Renders nothing when tier data is absent.
 */
'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { ChevronDown, Sparkles } from 'lucide-react'
import type { TenantTier, TenantComplianceTier } from '@/lib/types'
import { cn } from '@/lib/utils/cn'

/**
 * What's included at each tier — used to populate the dropdown.
 * Kept inline as constants so the chip doesn't need a DB roundtrip
 * for descriptive copy. Mirrors SCALING-TIERS.md verbatim where
 * possible so any future doc update flows straight in.
 */
const TIER_DESCRIPTIONS: Record<TenantTier, {
  label: string
  pitch: string
  includes: string[]
}> = {
  starter: {
    label: 'Starter',
    pitch: 'Solo Sparky — print a checklist, generate a customer-ready PDF.',
    includes: [
      '1 customer · ≤5 sites · ≤25 assets',
      'PPM maintenance checks',
      'Customer Report + Field Run-Sheet (Standard)',
      'Defects register',
    ],
  },
  team: {
    label: 'Team',
    pitch: 'Your full PPM + compliance ops in one place — including the test bench.',
    includes: [
      '5+ customers · ≤50 sites · ≤500 assets',
      'ACB / NSX / RCD test workflows',
      'Customer Portal · branded reports',
      'Multi-file Delta import',
      'Audit log · variations register',
    ],
  },
  enterprise: {
    label: 'Enterprise',
    pitch: 'Multi-site ops with the audit trail and integrations procurement requires.',
    includes: [
      'Unlimited customers / sites / assets',
      'Multi-tenant (parent + child)',
      'Maximo · SAP · Oracle · ServiceNow integrations',
      'SAML SSO · API · webhooks',
      'Full white-label · SOC 2 evidence',
    ],
  },
}

const COMPLIANCE_LABELS: Record<TenantComplianceTier, string> = {
  standard: 'Standard',
  enhanced: 'Enhanced',
  enterprise: 'Enterprise',
}

export interface TenantTierChipProps {
  tier: TenantTier
  complianceTier: TenantComplianceTier
  tenantName?: string | null
  /**
   * Visual variant.
   *   `desktop` — fixed top-right corner. Shows tier + compliance pill.
   *   `mobile`  — inline element (smaller). Used inside the mobile top bar.
   *   `sidebar` — inline element styled for the dark eq-ink sidebar footer.
   *               Hidden when the sidebar is collapsed (parent decides).
   */
  variant?: 'desktop' | 'mobile' | 'sidebar'
}

export function TenantTierChip({
  tier,
  complianceTier,
  tenantName,
  variant = 'desktop',
}: TenantTierChipProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const tierMeta = TIER_DESCRIPTIONS[tier]
  const complianceLabel = COMPLIANCE_LABELS[complianceTier]
  const tierLabel = `${tierMeta.label} ${complianceLabel}`

  // Sidebar variant — inline on the dark eq-ink sidebar footer. Shows
  // both tier + compliance label so the user gets the full picture
  // (the sidebar footer is the only place this chip lives on desktop now).
  if (variant === 'sidebar') {
    return (
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={`Plan: ${tierLabel}. Click to see what's included.`}
          aria-expanded={open}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-md bg-white/5 hover:bg-white/10 transition-colors text-white text-xs font-semibold"
        >
          <Sparkles className="w-3.5 h-3.5 text-eq-sky flex-shrink-0" aria-hidden="true" />
          <span className="truncate">
            {tierMeta.label}
            <span className="text-white/40 font-normal mx-1">·</span>
            <span className="text-white/80">{complianceLabel}</span>
          </span>
          <ChevronDown className={cn('w-3.5 h-3.5 text-white/40 ml-auto transition-transform flex-shrink-0', open && 'rotate-180')} aria-hidden="true" />
        </button>
        {open && (
          <DropdownPanel
            tierMeta={tierMeta}
            complianceLabel={complianceLabel}
            tenantName={tenantName}
            className="absolute left-0 right-0 bottom-full mb-1 z-50"
          />
        )}
      </div>
    )
  }

  // Mobile variant — smaller, no tooltip, inline.
  if (variant === 'mobile') {
    return (
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={`Plan: ${tierLabel}`}
          aria-expanded={open}
          className="flex items-center gap-1 px-2 py-1 rounded-md bg-white/10 text-white text-[11px] font-semibold uppercase tracking-wider hover:bg-white/20 transition-colors"
        >
          <Sparkles className="w-3 h-3" aria-hidden="true" />
          <span>{tierMeta.label}</span>
          <ChevronDown className={cn('w-3 h-3 transition-transform', open && 'rotate-180')} aria-hidden="true" />
        </button>
        {open && (
          <DropdownPanel
            tierMeta={tierMeta}
            complianceLabel={complianceLabel}
            tenantName={tenantName}
            className="absolute right-0 top-full mt-1 z-50"
          />
        )}
      </div>
    )
  }

  // Desktop variant — fixed top-right of viewport.
  return (
    <div
      ref={ref}
      className="hidden lg:block fixed top-3 right-3 z-30"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Plan: ${tierLabel}. Click to see what's included.`}
        aria-expanded={open}
        className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-eq-line shadow-sm hover:border-eq-sky transition-colors text-xs font-semibold text-eq-ink"
      >
        <Sparkles className="w-3.5 h-3.5 text-eq-deep" aria-hidden="true" />
        <span>
          {tierMeta.label}
          <span className="text-eq-grey font-normal mx-1">·</span>
          <span className="text-eq-deep">{complianceLabel}</span>
        </span>
        <ChevronDown className={cn('w-3.5 h-3.5 text-eq-grey transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>
      {open && (
        <DropdownPanel
          tierMeta={tierMeta}
          complianceLabel={complianceLabel}
          tenantName={tenantName}
          className="absolute right-0 top-full mt-2"
        />
      )}
    </div>
  )
}

interface DropdownPanelProps {
  tierMeta: typeof TIER_DESCRIPTIONS[TenantTier]
  complianceLabel: string
  tenantName?: string | null
  className?: string
}

function DropdownPanel({ tierMeta, complianceLabel, tenantName, className }: DropdownPanelProps) {
  return (
    <div
      role="menu"
      className={cn(
        'w-80 bg-white border border-eq-line rounded-xl shadow-lg p-4 text-eq-ink',
        className,
      )}
    >
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wider text-eq-grey font-bold">Current plan</span>
        {tenantName && <span className="text-[10px] text-eq-grey truncate max-w-[160px]">{tenantName}</span>}
      </div>
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-lg font-bold text-eq-ink">{tierMeta.label}</span>
        <span className="text-xs px-2 py-0.5 rounded-full bg-eq-ice text-eq-deep font-semibold">{complianceLabel} compliance</span>
      </div>
      <p className="text-xs text-eq-grey mb-3">{tierMeta.pitch}</p>
      <div className="border-t border-eq-line pt-3">
        <div className="text-[10px] uppercase tracking-wider text-eq-grey font-bold mb-2">Included</div>
        <ul className="space-y-1.5">
          {tierMeta.includes.map((line) => (
            <li key={line} className="text-xs text-eq-ink flex items-start gap-2">
              <span className="text-eq-sky font-bold leading-none mt-0.5">✓</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-3 pt-3 border-t border-eq-line text-[11px] text-eq-grey">
        Want to change tier?{' '}
        <Link href="mailto:hello@eqsolves.com.au?subject=Plan change request" className="text-eq-deep hover:underline">
          Contact sales
        </Link>
      </div>
    </div>
  )
}
