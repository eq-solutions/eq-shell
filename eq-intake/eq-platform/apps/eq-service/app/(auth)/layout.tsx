/**
 * EQ Solves Service
 * © 2026 EQ, a registered business name of CDC Solutions Pty Ltd
 * ACN 651 962 935 · ABN 40 651 962 935
 * Proprietary and confidential. All rights reserved.
 */
import { getTenantSettings } from '@/lib/tenant/getTenantSettings'
import type { TenantSettings } from '@/lib/types'
import { EqFooter } from '@/components/ui/EqFooter'

const WHITE_LOGO_URL = 'https://pub-409bd651f2e549f4907f5a856a9264ae.r2.dev/EQ_logo_white_transparent.svg'

const DEFAULTS: Pick<TenantSettings, 'product_name' | 'logo_url' | 'primary_colour' | 'ink_colour' | 'deep_colour' | 'ice_colour'> = {
  product_name: 'EQ Solves',
  logo_url: null,
  primary_colour: '#3DA8D8',
  ink_colour: '#1A1A2E',
  deep_colour: '#2986B4',
  ice_colour: '#EAF5FB',
}

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  let settings: typeof DEFAULTS = DEFAULTS
  try {
    const result = await getTenantSettings()
    settings = result.settings
  } catch {
    // Gracefully fall back to defaults — never show DB errors on the login page
  }

  const productName = settings.product_name || 'EQ Solves'

  return (
    <div className="min-h-screen flex">
      {/* Left panel — branding */}
      <div
        className="hidden lg:flex lg:w-[480px] xl:w-[540px] flex-col justify-between p-10 relative overflow-hidden"
        style={{ background: `linear-gradient(135deg, ${settings.ink_colour} 0%, ${settings.deep_colour} 100%)` }}
      >
        {/* Subtle watermark — ghost logo behind panel content */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={WHITE_LOGO_URL}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 top-1/2 -translate-y-1/2 w-[360px] h-[360px] object-contain opacity-[0.04]"
        />

        <div className="relative z-10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={WHITE_LOGO_URL} alt={productName} className="h-32 w-auto" />
        </div>

        <div className="space-y-4 relative z-10">
          <h2 className="text-2xl font-bold text-white leading-tight">
            Service Platform
          </h2>
          <p className="text-sm text-white/50 leading-relaxed max-w-sm">
            Circuit breaker testing, preventive maintenance,
            compliance reporting and defect tracking.
          </p>
        </div>

        <p className="text-xs text-white/30 relative z-10 leading-relaxed">
          © {new Date().getFullYear()} EQ, a registered business name of CDC Solutions Pty Ltd
          <br />
          ACN 651 962 935 · ABN 40 651 962 935
        </p>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex flex-col bg-white">
        <div className="flex-1 flex items-center justify-center p-6 sm:p-10">
          <div className="w-full max-w-sm">
            {/* Mobile logo */}
            <div className="lg:hidden flex flex-col items-center mb-10">
              {settings.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={settings.logo_url} alt={productName} className="h-7 w-auto" />
              ) : (
                <span className="text-xl font-bold tracking-tight" style={{ color: settings.ink_colour }}>
                  EQ <span style={{ color: settings.primary_colour }}>Solves</span>
                </span>
              )}
              <span className="text-[10px] uppercase tracking-[0.2em] mt-1.5" style={{ color: settings.deep_colour }}>
                Service Platform
              </span>
            </div>

            {children}
          </div>
        </div>
        <EqFooter />
      </div>
    </div>
  )
}
