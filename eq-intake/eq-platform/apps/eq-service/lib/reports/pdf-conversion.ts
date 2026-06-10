/**
 * pdf-conversion.ts
 *
 * DOCX → PDF conversion utility.
 *
 * Strategy (ordered by preference):
 *
 * 1. **CloudConvert API** (recommended for production)
 *    - $0.01/conversion, no server-side dependencies
 *    - Highest fidelity DOCX → PDF conversion
 *    - Sign up at cloudconvert.com, add CLOUDCONVERT_API_KEY to .env.local
 *
 * 2. **Gotenberg** (self-hosted, Docker-based)
 *    - Free, uses LibreOffice under the hood
 *    - Needs a container running alongside — good if we add more conversion needs
 *
 * 3. **LibreOffice on Netlify Functions** (not viable)
 *    - Netlify Functions have a 50MB limit, LibreOffice binary is ~300MB
 *    - Would need a separate microservice
 *
 * 4. **Supabase Edge Functions** (Deno, limited)
 *    - No native LibreOffice, would need an external API call anyway
 *
 * For the spike, this module is a pass-through that logs a warning when
 * no conversion backend is configured. The DOCX is the primary deliverable;
 * PDF will be added when we choose a backend.
 */

export async function convertDocxToPdf(docxBuffer: Buffer): Promise<Buffer | null> {
  const cloudConvertKey = process.env.CLOUDCONVERT_API_KEY

  if (cloudConvertKey) {
    return convertViaCloudConvert(docxBuffer, cloudConvertKey)
  }

  const gotenbergUrl = process.env.GOTENBERG_URL
  if (gotenbergUrl) {
    return convertViaGotenberg(docxBuffer, gotenbergUrl)
  }

  // No conversion backend configured — skip PDF generation
  console.info('[pdf] No PDF conversion backend configured (CLOUDCONVERT_API_KEY or GOTENBERG_URL). Skipping PDF generation.')
  return null
}

/**
 * CloudConvert: upload DOCX → convert → download PDF.
 * Uses their synchronous conversion endpoint for simplicity.
 */
async function convertViaCloudConvert(docxBuffer: Buffer, apiKey: string): Promise<Buffer> {
  // Create job with upload + convert + export tasks
  const jobRes = await fetch('https://api.cloudconvert.com/v2/jobs', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      tasks: {
        upload: { operation: 'import/upload' },
        convert: {
          operation: 'convert',
          input: ['upload'],
          output_format: 'pdf',
          engine: 'libreoffice',
        },
        export: {
          operation: 'export/url',
          input: ['convert'],
        },
      },
    }),
  })

  if (!jobRes.ok) {
    const err = await jobRes.text()
    throw new Error(`CloudConvert job creation failed: ${err}`)
  }

  const job = await jobRes.json()
  const uploadTask = job.data.tasks.find((t: { name: string }) => t.name === 'upload')

  if (!uploadTask?.result?.form) {
    throw new Error('CloudConvert: no upload form returned')
  }

  // Upload the DOCX
  const form = new FormData()
  for (const [key, value] of Object.entries(uploadTask.result.form.parameters as Record<string, string>)) {
    form.append(key, value)
  }
  form.append('file', new Blob([new Uint8Array(docxBuffer)]), 'report.docx')

  const uploadRes = await fetch(uploadTask.result.form.url, { method: 'POST', body: form })
  if (!uploadRes.ok) {
    throw new Error(`CloudConvert upload failed: ${uploadRes.statusText}`)
  }

  // Poll for completion
  const jobId = job.data.id
  let attempts = 0
  while (attempts < 30) {
    await new Promise((r) => setTimeout(r, 2000))
    const statusRes = await fetch(`https://api.cloudconvert.com/v2/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    const statusData = await statusRes.json()

    if (statusData.data.status === 'finished') {
      const exportTask = statusData.data.tasks.find((t: { name: string }) => t.name === 'export')
      const fileUrl = exportTask?.result?.files?.[0]?.url
      if (!fileUrl) throw new Error('CloudConvert: no export URL')

      const pdfRes = await fetch(fileUrl)
      return Buffer.from(await pdfRes.arrayBuffer())
    }

    if (statusData.data.status === 'error') {
      throw new Error(`CloudConvert conversion failed: ${JSON.stringify(statusData.data.tasks)}`)
    }

    attempts++
  }

  throw new Error('CloudConvert: conversion timed out')
}

/**
 * Gotenberg: POST DOCX to the LibreOffice conversion endpoint.
 * Assumes Gotenberg is running at GOTENBERG_URL (e.g., http://localhost:3000).
 */
async function convertViaGotenberg(docxBuffer: Buffer, baseUrl: string): Promise<Buffer> {
  const form = new FormData()
  form.append('files', new Blob([new Uint8Array(docxBuffer)]), 'report.docx')

  const res = await fetch(`${baseUrl}/forms/libreoffice/convert`, {
    method: 'POST',
    body: form,
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gotenberg conversion failed: ${err}`)
  }

  return Buffer.from(await res.arrayBuffer())
}
