/**
 * PDF Renderer — thin wrapper around the Gotenberg HTML→PDF service.
 *
 * Every customer-facing PDF the app generates flows through this function.
 * The rendering backend (currently Gotenberg on Fly.io) is hidden behind
 * this contract — swapping it for Browserless or self-hosted Chromium later
 * means changing only this file.
 *
 * Configuration:
 *   GOTENBERG_URL — the base URL of the Gotenberg service.
 *                   e.g. https://eq-solves-gotenberg.fly.dev
 *
 * Usage:
 *   const pdf = await renderHtmlToPdf(html)
 *   const pdf = await renderHtmlToPdf(html, { paperWidth: 8.27, paperHeight: 11.69 })
 *
 * Throws if GOTENBERG_URL is unset or the service returns non-200 after retry.
 */

export interface RenderOptions {
  /** Page width in inches. Default 8.27 (A4 portrait). */
  paperWidth?: number
  /** Page height in inches. Default 11.69 (A4 portrait). */
  paperHeight?: number
  /** Margins in inches. Default 0.4 all sides. */
  marginTop?: number
  marginBottom?: number
  marginLeft?: number
  marginRight?: number
  /** Render CSS background colours/images. Default true (we use brand colours heavily). */
  printBackground?: boolean
  /** Wait for network idle before snapshotting. Default true. */
  waitForNetworkIdle?: boolean
}

const DEFAULTS: Required<RenderOptions> = {
  paperWidth: 8.27,
  paperHeight: 11.69,
  marginTop: 0.4,
  marginBottom: 0.4,
  marginLeft: 0.4,
  marginRight: 0.4,
  printBackground: true,
  waitForNetworkIdle: true,
}

export async function renderHtmlToPdf(
  html: string,
  opts: RenderOptions = {},
): Promise<Buffer> {
  const baseUrl = process.env.GOTENBERG_URL
  if (!baseUrl) {
    throw new Error('GOTENBERG_URL is not set. Configure the env var or run npm run dev with .env.local pointing at the Fly deployment.')
  }

  const merged = { ...DEFAULTS, ...opts }
  const endpoint = `${baseUrl.replace(/\/$/, '')}/forms/chromium/convert/html`

  // First attempt; if Fly's machine is cold-starting, Fly's proxy can return
  // 503 (machine waking) or a generic 500 (proxy timeout while waking).
  // One retry after 2s covers either case.
  let res = await postHtml(endpoint, html, merged)
  if (res.status === 503 || res.status === 500) {
    await new Promise((r) => setTimeout(r, 2000))
    res = await postHtml(endpoint, html, merged)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '<unreadable>')
    throw new Error(`Gotenberg render failed: HTTP ${res.status} — ${body.slice(0, 200)}`)
  }

  const arrayBuffer = await res.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

async function postHtml(
  endpoint: string,
  html: string,
  opts: Required<RenderOptions>,
): Promise<Response> {
  const form = new FormData()
  // Gotenberg requires the entry HTML file to be named index.html. Use File
  // (not Blob) so the filename survives Node's multipart serialisation —
  // FormData with a plain Blob drops the filename arg in some runtimes.
  form.append('files', new File([html], 'index.html', { type: 'text/html' }))

  // Chromium routing options — see https://gotenberg.dev/docs/routes#convert-into-pdf-route
  form.append('paperWidth', String(opts.paperWidth))
  form.append('paperHeight', String(opts.paperHeight))
  form.append('marginTop', String(opts.marginTop))
  form.append('marginBottom', String(opts.marginBottom))
  form.append('marginLeft', String(opts.marginLeft))
  form.append('marginRight', String(opts.marginRight))
  form.append('printBackground', String(opts.printBackground))
  if (opts.waitForNetworkIdle) {
    form.append('waitDelay', '500ms')
  }

  return fetch(endpoint, { method: 'POST', body: form })
}
