import { cn } from '@/lib/utils/cn'

interface CardProps {
  children: React.ReactNode
  className?: string
}

export function Card({ children, className }: CardProps) {
  return (
    <div className={cn('bg-white border border-gray-200 rounded-lg p-4', className)}>
      {children}
    </div>
  )
}
