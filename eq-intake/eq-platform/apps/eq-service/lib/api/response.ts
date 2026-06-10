import { NextResponse } from 'next/server'
import type { ApiResponse, PaginationMeta } from '@/lib/types'

export function ok<T>(data: T, meta?: PaginationMeta): NextResponse<ApiResponse<T>> {
  return NextResponse.json({ data, error: null, ...(meta ? { meta } : {}) })
}

export function created<T>(data: T): NextResponse<ApiResponse<T>> {
  return NextResponse.json({ data, error: null }, { status: 201 })
}

export function err(message: string, status = 400): NextResponse<ApiResponse<null>> {
  return NextResponse.json({ data: null, error: message }, { status })
}

export function unauthorized(): NextResponse<ApiResponse<null>> {
  return err('Authentication required.', 401)
}

export function forbidden(): NextResponse<ApiResponse<null>> {
  return err('Insufficient permissions.', 403)
}

export function notFound(entity = 'Resource'): NextResponse<ApiResponse<null>> {
  return err(`${entity} not found.`, 404)
}
