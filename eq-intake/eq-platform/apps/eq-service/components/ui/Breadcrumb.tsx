import { ChevronRight } from 'lucide-react'

interface BreadcrumbItem {
  label: string
  href?: string
}

export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav className="flex items-center gap-1 text-sm text-eq-grey">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="w-3 h-3" />}
          {item.href ? (
            <a href={item.href} className="hover:text-eq-sky transition-colors">{item.label}</a>
          ) : (
            <span className="text-eq-ink font-medium">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}
