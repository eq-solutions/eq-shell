import { cn } from '@/lib/utils/cn'
import { ButtonHTMLAttributes } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  /** When true, shows a spinner inside the button and disables it. Use during async actions. */
  loading?: boolean
}

/**
 * Standard button.
 *
 * `loading` flips the button into a spinner-with-disabled state — the children
 * still render so the layout doesn't jump, but a spinner overlays them. Pair
 * this with useTransition / server-action patterns so every async click gives
 * the user visible feedback.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading
  return (
    <button
      className={cn(
        'relative inline-flex items-center justify-center font-semibold rounded-md transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-eq-sky focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed',
        {
          'bg-eq-sky text-white hover:bg-eq-deep': variant === 'primary',
          'bg-white text-eq-deep border border-eq-deep hover:bg-eq-ice': variant === 'secondary',
          'bg-red-50 text-red-600 border border-red-200 hover:bg-red-600 hover:text-white': variant === 'danger',
          'h-8 px-3 text-xs': size === 'sm',
          'h-10 px-4 text-sm': size === 'md',
          'h-12 px-6 text-base': size === 'lg',
        },
        className
      )}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && (
        <span
          className="absolute inset-0 flex items-center justify-center"
          aria-hidden="true"
        >
          <svg
            className={cn('animate-spin', {
              'h-3.5 w-3.5': size === 'sm',
              'h-4 w-4': size === 'md',
              'h-5 w-5': size === 'lg',
            })}
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
            <path
              d="M22 12a10 10 0 0 1-10 10"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </svg>
        </span>
      )}
      <span className={cn('inline-flex items-center justify-center gap-2', loading && 'invisible')}>
        {children}
      </span>
    </button>
  )
}
