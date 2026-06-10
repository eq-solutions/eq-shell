import type { TenantSettings } from '@/lib/types'

interface TenantLogoProps {
  settings: TenantSettings
  size?: 'sm' | 'md' | 'lg'
}

const sizes = {
  sm: { text: 'text-sm', img: 'h-6' },
  md: { text: 'text-lg', img: 'h-8' },
  lg: { text: 'text-2xl', img: 'h-10' },
}

export function TenantLogo({ settings, size = 'md' }: TenantLogoProps) {
  const s = sizes[size]

  if (settings.logo_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={settings.logo_url}
        alt={settings.product_name}
        className={`${s.img} w-auto object-contain`}
      />
    )
  }

  // Text fallback — product name in primary colour
  const words = settings.product_name.split(' ')
  const first = words.slice(0, -1).join(' ')
  const last = words.at(-1)

  return (
    <span className={`${s.text} font-bold tracking-tight`}>
      <span style={{ color: settings.ink_colour }}>{first} </span>
      <span style={{ color: settings.primary_colour }}>{last}</span>
    </span>
  )
}
