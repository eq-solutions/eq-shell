/**
 * Glue: load a maintenance check, render its HTML, return a PDF Buffer.
 *
 * The three steps are intentionally separate so the renderer (Gotenberg)
 * and the template can each be swapped without touching the data layer,
 * and the data layer can be reused for non-PDF outputs (e.g. an in-app
 * preview screen).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadPmCheckReportData } from '@/lib/reports/data/load-pm-check'
import { renderPmCheckHtml } from '@/lib/reports/html/pm-check'
import { renderHtmlToPdf } from '@/lib/reports/pdf-renderer'

export async function generatePmCheckPdf(
  supabase: SupabaseClient,
  tenantId: string,
  checkId: string,
): Promise<Buffer> {
  const data = await loadPmCheckReportData(supabase, tenantId, checkId)
  const html = renderPmCheckHtml(data)
  return renderHtmlToPdf(html)
}
