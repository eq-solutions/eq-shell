import { cn } from '@/lib/utils/cn'
import { InputHTMLAttributes } from 'react'

interface FormInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
}

export function FormInput({ label, error, hint, className, ...props }: FormInputProps) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">
          {label}
        </label>
      )}
      <input
        className={cn(
          'h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white transition-colors duration-150',
          'focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20',
          error && 'border-red-400 focus:border-red-400 focus:ring-red-200',
          className
        )}
        {...props}
      />
      {hint && !error && <p className="text-xs text-eq-grey">{hint}</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}
