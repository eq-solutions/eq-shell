'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { FormInput } from '@/components/ui/FormInput'
import { updateCompanyDetailsAction, createFirstSiteAction, completeOnboardingAction, skipOnboardingAction } from './actions'
import { Building2, MapPin, Rocket, ChevronRight, X } from 'lucide-react'

const AU_STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA']

interface OnboardingWizardProps {
  userName: string | null
  companyName: string | null
}

export function OnboardingWizard({ userName, companyName }: OnboardingWizardProps) {
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)

  if (dismissed) return null

  const steps = [
    { icon: Building2, label: 'Company Details' },
    { icon: MapPin, label: 'First Site' },
    { icon: Rocket, label: 'Ready to Go' },
  ]

  async function handleCompanySubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const result = await updateCompanyDetailsAction(new FormData(e.currentTarget))
    setLoading(false)
    if (result.success) {
      setStep(1)
    } else {
      setError(result.error ?? 'Something went wrong.')
    }
  }

  async function handleSiteSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const result = await createFirstSiteAction(new FormData(e.currentTarget))
    setLoading(false)
    if (result.success) {
      setStep(2)
    } else {
      setError(result.error ?? 'Something went wrong.')
    }
  }

  async function handleFinish() {
    setLoading(true)
    await completeOnboardingAction()
    setDismissed(true)
  }

  async function handleSkip() {
    setLoading(true)
    await skipOnboardingAction()
    setDismissed(true)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header — solid brand tone, no gradient (CLAUDE.md brand rule). */}
        <div className="bg-eq-deep px-6 py-5 text-white relative">
          <button
            onClick={handleSkip}
            className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors"
            title="Skip setup"
          >
            <X className="w-5 h-5" />
          </button>
          <h2 className="text-xl font-bold">Welcome to EQ Solves</h2>
          <p className="text-sm text-white/80 mt-1">
            {userName ? `Hi ${userName}! ` : ''}Let&apos;s get your workspace set up.
          </p>
        </div>

        {/* Step indicators */}
        <div className="flex items-center gap-1 px-6 pt-4 pb-2">
          {steps.map((s, i) => {
            const Icon = s.icon
            const isActive = i === step
            const isDone = i < step
            return (
              <div key={i} className="flex items-center gap-1 flex-1">
                <div className={`flex items-center gap-1.5 text-xs font-medium transition-colors ${
                  isActive ? 'text-eq-sky' : isDone ? 'text-green-600' : 'text-eq-grey'
                }`}>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                    isActive ? 'bg-eq-sky text-white' : isDone ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-eq-grey'
                  }`}>
                    {isDone ? '✓' : i + 1}
                  </div>
                  <span className="hidden sm:inline">{s.label}</span>
                </div>
                {i < steps.length - 1 && (
                  <ChevronRight className="w-3.5 h-3.5 text-gray-300 mx-1 shrink-0" />
                )}
              </div>
            )
          })}
        </div>

        {/* Step content */}
        <div className="px-6 py-4">
          {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

          {/* Step 0: Company Details */}
          {step === 0 && (
            <form onSubmit={handleCompanySubmit} className="space-y-3">
              <p className="text-sm text-eq-grey mb-2">Tell us about your company so we can personalise your workspace.</p>
              <FormInput label="Your Name" name="full_name" defaultValue={userName ?? ''} placeholder="e.g. Royce Milmlow" />
              <FormInput label="Company Name *" name="company_name" required defaultValue={companyName ?? ''} placeholder="e.g. SKS Technologies" />
              <FormInput label="Company ABN" name="company_abn" placeholder="e.g. 12 345 678 901" />
              <FormInput label="Company Address" name="company_address" placeholder="e.g. 123 Main St, Sydney NSW 2000" />
              <div className="grid grid-cols-2 gap-3">
                <FormInput label="Phone" name="company_phone" placeholder="e.g. 02 9876 5432" />
                <FormInput label="Support Email" name="support_email" type="email" placeholder="e.g. support@company.com.au" />
              </div>
              <div className="flex items-center justify-between pt-2">
                <button type="button" onClick={handleSkip} className="text-xs text-eq-grey hover:text-eq-ink transition-colors">
                  Skip setup for now
                </button>
                <Button type="submit" loading={loading}>
                  Next
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </form>
          )}

          {/* Step 1: First Site */}
          {step === 1 && (
            <form onSubmit={handleSiteSubmit} className="space-y-3">
              <p className="text-sm text-eq-grey mb-2">Add your first site. You can add more later.</p>
              <FormInput label="Customer Name" name="customer_name" placeholder="e.g. Equinix Australia" />
              <FormInput label="Site Name *" name="site_name" required placeholder="e.g. SY4 Alexandria" />
              <div className="grid grid-cols-2 gap-3">
                <FormInput label="City" name="city" placeholder="e.g. Alexandria" />
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">State</label>
                  <select
                    name="state"
                    className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
                  >
                    <option value="">Select...</option>
                    {AU_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex items-center justify-between pt-2">
                <button type="button" onClick={() => setStep(2)} className="text-xs text-eq-grey hover:text-eq-ink transition-colors">
                  Skip this step
                </button>
                <Button type="submit" loading={loading}>
                  Create Site
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </form>
          )}

          {/* Step 2: Ready */}
          {step === 2 && (
            <div className="text-center py-4">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                <Rocket className="w-8 h-8 text-green-600" />
              </div>
              <h3 className="text-lg font-bold text-eq-deep mb-2">You&apos;re all set!</h3>
              <p className="text-sm text-eq-grey mb-6">
                Your workspace is ready. You can add more customers, sites, and assets from the sidebar navigation.
              </p>
              <Button onClick={handleFinish} loading={loading}>
                Go to Dashboard
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
