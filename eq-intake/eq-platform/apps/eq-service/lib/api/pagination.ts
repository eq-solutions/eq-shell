import type { PaginationMeta } from '@/lib/types'

const DEFAULT_PER_PAGE = 25
const MAX_PER_PAGE = 100

export function parsePagination(searchParams: URLSearchParams) {
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)
  const per_page = Math.min(
    MAX_PER_PAGE,
    Math.max(1, parseInt(searchParams.get('per_page') || String(DEFAULT_PER_PAGE), 10) || DEFAULT_PER_PAGE)
  )
  const from = (page - 1) * per_page
  const to = from + per_page - 1

  return { page, per_page, from, to }
}

export function paginationMeta(page: number, per_page: number, total: number): PaginationMeta {
  return {
    page,
    per_page,
    total,
    total_pages: Math.ceil(total / per_page) || 1,
  }
}
