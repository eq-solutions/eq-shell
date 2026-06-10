/**
 * Maintenance Check Report — HTML template.
 *
 * Server-only. Returns a self-contained HTML string for Gotenberg to convert
 * to PDF. Plain template literals — Next.js 16 / Turbopack rejects
 * react-dom/server imports anywhere in an app-route dependency graph, so we
 * produce HTML directly instead of via JSX.
 *
 * All assets (logos, photos) are inlined as base64 data URIs by the loader,
 * so the rendered HTML makes no network calls at render time.
 *
 * Sections (mirrors docs/reviews/2026-04-26 reference):
 *   1. Cover page (brand band + customer + site + date)
 *   2. Overview (KPI row + check info grid + summary blurb)
 *   3. Asset summary table (one row per asset, progress bar + status)
 *   4. Per-asset checklist cards (full task list, defect callouts inline)
 *   5. Defects register
 *   6. Sign-off
 *   7. Footer
 */

import type {
  PmCheckReportData,
  PmCheckReportAsset,
  PmCheckReportTask,
  PmCheckReportDefect,
} from '@/lib/reports/data/load-pm-check'

export function renderPmCheckHtml(data: PmCheckReportData): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(`Maintenance Check Report — ${data.site.name} — ${data.jobPlan.name}`)}</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>${buildCss(data.tenant.primaryColour)}</style>
</head>
<body>
${cover(data)}
${overview(data)}
${assetSummary(data.assets)}
${data.assets.map(assetCard).join('\n')}
${data.defects.length > 0 ? defectsRegister(data.defects) : ''}
${signOff()}
${footer(data)}
</body>
</html>`
}

// ───────── sections ─────────

function cover(data: PmCheckReportData): string {
  const bandLogo = data.tenant.logoOnDarkDataUri
    ? `<img class="cover-band-logo" src="${data.tenant.logoOnDarkDataUri}" alt="" />`
    : data.tenant.logoColourDataUri
      ? `<img class="cover-band-logo" src="${data.tenant.logoColourDataUri}" alt="" />`
      : `<div class="cover-band-name">${esc(data.tenant.name)}</div>`

  const customerLogo = data.customer?.logoDataUri
    ? `<img class="cover-customer-logo" src="${data.customer.logoDataUri}" alt="" />`
    : ''

  const customerName = data.customer
    ? `<h1 class="cover-customer">${esc(data.customer.name)}</h1>`
    : ''

  const maximoRow = data.check.maximoWONumber
    ? `<dt>Maximo WO#</dt><dd>${esc(data.check.maximoWONumber)}</dd>`
    : ''

  const abnSuffix = data.tenant.abn ? ` — ABN ${esc(data.tenant.abn)}` : ''

  return `
<section class="cover">
  <div class="cover-band">
    ${bandLogo}
    <div class="cover-band-label">Maintenance Check Report</div>
  </div>
  <div class="cover-body">
    ${customerLogo}
    ${customerName}
    <h2 class="cover-site">${esc(data.site.name)}</h2>
    <p class="cover-address">${esc(data.site.addressLine)}</p>
    <p class="cover-date">${esc(data.reportPeriodLabel)}</p>
    <dl class="cover-meta">
      <dt>Job Plan</dt><dd>${esc(`${data.jobPlan.name} — ${data.jobPlan.type}`)}</dd>
      <dt>Frequency</dt><dd>${esc(capitalise(data.check.frequency))}</dd>
      <dt>Due Date</dt><dd>${esc(data.check.dueDateFormatted)}</dd>
      <dt>Assigned To</dt><dd>${esc(data.assignedToName ?? 'Unassigned')}</dd>
      <dt>Status</dt><dd>${esc(statusLabel(data.check.status))}</dd>
      ${maximoRow}
    </dl>
    <p class="cover-confidential">Confidential — ${esc(data.tenant.name)}${abnSuffix}</p>
  </div>
</section>`
}

function overview(data: PmCheckReportData): string {
  return `
<section class="section page-break-before">
  <h2 class="section-title">Check Overview</h2>
  <div class="kpi-row">
    ${kpi('Total Assets', data.kpi.totalAssets, 'brand')}
    ${kpi('Completed', data.kpi.completedCount, 'pass')}
    ${kpi('In Progress', data.kpi.inProgressCount, 'brand')}
    ${kpi('Pending', data.kpi.pendingCount, 'grey')}
    ${kpi('Defects', data.kpi.defectCount, 'warn')}
  </div>
  <div class="info-grid">
    ${field('Check Name', data.check.customName)}
    ${field('Job Plan', `${data.jobPlan.name} — ${data.jobPlan.type}`)}
    ${field('Site', `${data.site.name}, ${data.site.addressLine}`)}
    ${field('Frequency', capitalise(data.check.frequency))}
    ${field('Started', data.check.startedAtFormatted ?? '—')}
    ${field('Due', data.check.dueDateFormatted)}
  </div>
  <p class="overview-blurb">${esc(buildBlurb(data))}</p>
</section>`
}

function assetSummary(assets: PmCheckReportAsset[]): string {
  if (assets.length === 0) {
    return `
<section class="section">
  <h2 class="section-title">Asset Summary</h2>
  <p class="empty-note">No assets linked to this check yet.</p>
</section>`
  }

  const rows = assets.map((a) => `
    <tr>
      <td><strong>${esc(a.name)}</strong></td>
      <td>${esc(a.maximoId ?? '—')}</td>
      <td>${esc(a.location ?? '—')}</td>
      <td>${esc(a.workOrderNumber ?? '—')}</td>
      <td>${a.completedTasks}/${a.totalTasks}</td>
      <td>
        <div class="progress-bar">
          <div class="fill fill-${a.status === 'complete' || a.status === 'defect' ? 'pass' : 'brand'}" style="width:${a.progressPercent}%"></div>
        </div>
      </td>
      <td>${statusBadge(a.status)}</td>
    </tr>`).join('')

  return `
<section class="section">
  <h2 class="section-title">Asset Summary</h2>
  <table>
    <thead>
      <tr>
        <th>Asset</th><th>Maximo ID</th><th>Location</th><th>WO#</th>
        <th>Tasks</th><th>Progress</th><th>Status</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</section>`
}

function assetCard(asset: PmCheckReportAsset): string {
  if (asset.totalTasks === 0) return ''

  const tasksHtml = asset.tasks.map(checklistItem).join('')
  const meta = [asset.maximoId, asset.location, asset.workOrderNumber].filter(Boolean).join(' — ') || '—'

  const defectCallout = asset.hasDefect && asset.defectSummary ? `
    <div class="defect-callout">
      <p class="defect-label">Defect Raised</p>
      <p class="defect-text">${esc(asset.defectSummary)}</p>
    </div>` : ''

  const notes = asset.notes
    ? `<p class="asset-notes"><strong>Notes:</strong> ${esc(asset.notes)}</p>`
    : ''

  return `
<section class="section">
  <h2 class="section-title section-title-faded">${esc(asset.name)}</h2>
  <div class="asset-card">
    <div class="asset-header">
      <div>
        <h3>${esc(asset.name)}</h3>
        <span class="asset-meta">${esc(meta)}</span>
      </div>
      ${statusBadge(asset.status)}
    </div>
    <div class="asset-body">
      <ul class="checklist">${tasksHtml}</ul>
      ${defectCallout}
      ${notes}
    </div>
  </div>
</section>`
}

function checklistItem(task: PmCheckReportTask): string {
  const resultText = task.result === 'pass' ? 'Pass'
    : task.result === 'fail' ? 'Fail'
    : task.result === 'na' ? 'N/A'
    : '—'
  const resultClass = task.result ?? 'na'
  return `
    <li>
      <span class="num">${task.number}</span>
      <span class="desc">${esc(task.description)}</span>
      <span class="result result-${resultClass}">${resultText}</span>
      <span class="comment">${esc(task.notes ?? '')}</span>
    </li>`
}

function defectsRegister(defects: PmCheckReportDefect[]): string {
  const rows = defects.map((d) => {
    const statusClass = d.status === 'resolved' ? 'pass' : 'warn'
    return `
    <tr>
      <td><span class="sev-cell"><span class="sev-dot sev-${d.severity ?? 'low'}"></span>${esc(capitalise(d.severity ?? 'low'))}</span></td>
      <td><strong>${esc(d.assetName)}</strong></td>
      <td>${esc(d.description)}</td>
      <td>${esc(d.raisedByName ?? '—')}</td>
      <td>${esc(d.raisedAtFormatted)}</td>
      <td><span class="badge badge-${statusClass}">${esc(capitalise(d.status))}</span></td>
    </tr>`
  }).join('')

  return `
<section class="section">
  <h2 class="section-title">Defects Register</h2>
  <table>
    <thead>
      <tr>
        <th>Severity</th><th>Asset</th><th>Description</th>
        <th>Raised By</th><th>Date</th><th>Status</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</section>`
}

function signOff(): string {
  return `
<section class="section">
  <h2 class="section-title">Sign-Off</h2>
  <div class="signoff-grid">
    <div class="signoff-box"><label>Technician Signature</label></div>
    <div class="signoff-box"><label>Supervisor Signature</label></div>
    <div class="signoff-box"><label>Technician Name &amp; Date</label></div>
    <div class="signoff-box"><label>Supervisor Name &amp; Date</label></div>
  </div>
</section>`
}

function footer(data: PmCheckReportData): string {
  const abn = data.tenant.abn ? ` — ABN ${esc(data.tenant.abn)}` : ''
  return `
<div class="report-footer">
  Generated by ${esc(data.tenant.name)} — ${esc(data.reportDateFormatted)}${abn}
</div>`
}

// ───────── small builders ─────────

function kpi(label: string, value: number, tone: string): string {
  return `
    <div class="kpi-card">
      <p class="kpi-label">${esc(label)}</p>
      <p class="kpi-value tone-${tone}">${value}</p>
    </div>`
}

function field(label: string, value: string): string {
  return `
    <div class="field">
      <label>${esc(label)}</label>
      <span class="val">${esc(value)}</span>
    </div>`
}

function statusBadge(status: PmCheckReportAsset['status']): string {
  const cls = status === 'complete' ? 'pass'
    : status === 'in_progress' ? 'brand'
    : status === 'defect' ? 'warn'
    : 'grey'
  return `<span class="badge badge-${cls}">${esc(statusLabel(status))}</span>`
}

// ───────── helpers ─────────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function capitalise(s: string): string {
  if (!s) return ''
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ')
}

function statusLabel(s: string): string {
  const map: Record<string, string> = {
    pending: 'Pending',
    in_progress: 'In Progress',
    complete: 'Complete',
    defect: 'Defect',
    scheduled: 'Scheduled',
    overdue: 'Overdue',
  }
  return map[s] ?? capitalise(s)
}

function buildBlurb(data: PmCheckReportData): string {
  const k = data.kpi
  const parts: string[] = []
  parts.push(
    `${data.check.frequency === 'annual' ? 'Annual' : capitalise(data.check.frequency)} ${data.jobPlan.type} maintenance check covering ${k.totalAssets} ${k.totalAssets === 1 ? 'asset' : 'assets'} at ${data.site.name}.`,
  )
  if (k.completedCount > 0) {
    parts.push(`${k.completedCount} ${k.completedCount === 1 ? 'asset' : 'assets'} fully completed.`)
  }
  if (k.inProgressCount > 0) parts.push(`${k.inProgressCount} in progress.`)
  if (k.pendingCount > 0) parts.push(`${k.pendingCount} pending.`)
  if (k.defectCount > 0) {
    parts.push(`${k.defectCount} ${k.defectCount === 1 ? 'defect' : 'defects'} raised — see Defects Register for details.`)
  }
  return parts.join(' ')
}

// ───────── styles ─────────

function buildCss(brand: string): string {
  // Brand is the tenant primary colour (e.g. SKS purple #8070c0).
  // Derive a deep variant by darkening; ice variant by mixing with white.
  const deep = adjustHex(brand, -0.18)
  const ice = mixWithWhite(brand, 0.88)

  return `
:root {
  --brand: ${brand};
  --brand-deep: ${deep};
  --brand-ice: ${ice};
  --ink: #1A1A2E;
  --grey: #666666;
  --pass: #16A34A;
  --fail: #DC2626;
  --warn: #D97706;
  --border: #E5E7EB;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
  color: var(--ink);
  background: #fff;
  font-size: 12px;
  line-height: 1.5;
}
.page-break-before { page-break-before: always; }

/* Cover */
.cover { min-height: 100vh; display: flex; flex-direction: column; page-break-after: always; }
.cover-band {
  background: var(--brand);
  color: #fff;
  padding: 80px 60px 60px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 28px;
}
.cover-band-logo { max-height: 70px; max-width: 280px; }
.cover-band-name { font-size: 28px; font-weight: 700; letter-spacing: 0.5px; }
.cover-band-label { font-size: 16px; font-weight: 600; letter-spacing: 1.2px; text-transform: uppercase; opacity: 0.92; }
.cover-body {
  flex: 1;
  padding: 60px;
  text-align: center;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
}
.cover-customer-logo { max-height: 80px; max-width: 240px; margin-bottom: 24px; }
.cover-customer { font-size: 32px; font-weight: 700; color: var(--ink); margin-bottom: 6px; }
.cover-site { font-size: 22px; font-weight: 500; color: var(--brand-deep); margin-bottom: 4px; }
.cover-address { font-size: 13px; color: var(--grey); margin-bottom: 24px; }
.cover-date { font-size: 16px; color: var(--ink); margin-bottom: 40px; }
.cover-meta {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 14px 40px; text-align: left; max-width: 560px; width: 100%;
  padding: 24px 32px;
  background: var(--brand-ice);
  border-radius: 8px;
}
.cover-meta dt { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--grey); }
.cover-meta dd { font-size: 14px; font-weight: 500; color: var(--ink); margin-top: 2px; }
.cover-confidential { margin-top: 60px; font-size: 11px; color: var(--grey); }

/* Section */
.section { padding: 40px 60px; page-break-inside: avoid; }
.section + .section { border-top: 1px solid var(--border); }
.section-title {
  font-size: 18px; font-weight: 700; color: var(--brand);
  margin-bottom: 20px; padding-bottom: 8px;
  border-bottom: 2px solid var(--brand-ice);
}
.section-title-faded { color: var(--ink); }
.empty-note { font-size: 12px; color: var(--grey); font-style: italic; }

/* KPI */
.kpi-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 24px; }
.kpi-card { background: var(--brand-ice); border-radius: 8px; padding: 14px; text-align: center; }
.kpi-label { font-size: 9px; font-weight: 700; text-transform: uppercase; color: var(--grey); margin-bottom: 4px; }
.kpi-value { font-size: 26px; font-weight: 700; }
.tone-brand { color: var(--brand); }
.tone-pass { color: var(--pass); }
.tone-fail { color: var(--fail); }
.tone-warn { color: var(--warn); }
.tone-grey { color: var(--grey); }

/* Info grid */
.info-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px 24px; margin-bottom: 20px; }
.info-grid .field label { display: block; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px; color: var(--grey); margin-bottom: 2px; }
.info-grid .field .val { font-size: 12px; font-weight: 500; }
.overview-blurb { font-size: 12px; color: var(--grey); line-height: 1.7; }

/* Tables */
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th {
  background: var(--brand-ice);
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px;
  color: var(--grey); text-align: left; padding: 8px 12px;
  border-bottom: 2px solid var(--brand);
}
td { padding: 8px 12px; border-bottom: 1px solid var(--border); vertical-align: top; }

.badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 10px; font-weight: 700; text-transform: uppercase; }
.badge-pass { background: #dcfce7; color: var(--pass); }
.badge-fail { background: #fee2e2; color: var(--fail); }
.badge-warn { background: #fef3c7; color: var(--warn); }
.badge-grey { background: #f3f4f6; color: var(--grey); }
.badge-brand { background: var(--brand-ice); color: var(--brand-deep); }

/* Asset cards */
.asset-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  margin-bottom: 20px;
  overflow: hidden;
  page-break-inside: avoid;
}
.asset-header {
  background: var(--brand-ice);
  padding: 10px 20px;
  display: flex; justify-content: space-between; align-items: center;
  border-bottom: 1px solid var(--border);
}
.asset-header h3 { font-size: 13px; font-weight: 700; color: var(--ink); }
.asset-meta { font-size: 11px; color: var(--grey); }
.asset-body { padding: 12px 20px; }
.asset-notes { margin-top: 10px; font-size: 12px; color: var(--ink); }

/* Checklist */
.checklist { list-style: none; }
.checklist li {
  display: grid;
  grid-template-columns: 28px 1fr 70px 1fr;
  gap: 8px;
  align-items: start;
  padding: 5px 0;
  border-bottom: 1px solid #f3f4f6;
  font-size: 12px;
}
.checklist li:last-child { border-bottom: none; }
.checklist .num { font-weight: 700; color: var(--grey); font-size: 10px; text-align: center; padding-top: 2px; }
.checklist .desc { color: var(--ink); }
.checklist .result { text-align: center; font-weight: 700; font-size: 11px; }
.result-pass { color: var(--pass); }
.result-fail { color: var(--fail); }
.result-na { color: var(--grey); }
.checklist .comment { font-size: 11px; color: var(--grey); font-style: italic; }

/* Progress bars */
.progress-bar {
  height: 6px; background: #e5e7eb; border-radius: 3px; overflow: hidden;
  margin-top: 4px;
}
.progress-bar .fill { height: 100%; border-radius: 3px; }
.fill-pass { background: var(--pass); }
.fill-brand { background: var(--brand); }

/* Defect callout */
.defect-callout {
  margin-top: 12px;
  padding: 12px 16px;
  background: #fef3c7;
  border-left: 4px solid var(--warn);
  border-radius: 4px;
}
.defect-label { font-size: 10px; font-weight: 700; color: var(--warn); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
.defect-text { font-size: 12px; color: var(--ink); }

/* Defects table severity dot */
.sev-cell { display: inline-flex; align-items: center; gap: 6px; }
.sev-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.sev-low { background: var(--brand); }
.sev-medium { background: var(--warn); }
.sev-high { background: var(--fail); }
.sev-critical { background: var(--fail); }

/* Sign-off */
.signoff-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-top: 24px; }
.signoff-box { border-bottom: 2px solid var(--ink); padding-bottom: 40px; }
.signoff-box label { font-size: 10px; font-weight: 700; text-transform: uppercase; color: var(--grey); }

/* Footer */
.report-footer {
  padding: 16px 60px;
  background: var(--brand-ice);
  font-size: 10px;
  color: var(--grey);
  text-align: center;
  border-top: 1px solid var(--border);
}

@media print {
  body { font-size: 11px; }
  .section { page-break-inside: avoid; }
}
`
}

// Lightweight hex math — avoids a dep just for darken/lighten.
function adjustHex(hex: string, delta: number): string {
  const { r, g, b } = parseHex(hex)
  const adjust = (c: number) => Math.max(0, Math.min(255, Math.round(c + 255 * delta)))
  return toHex(adjust(r), adjust(g), adjust(b))
}

function mixWithWhite(hex: string, ratio: number): string {
  const { r, g, b } = parseHex(hex)
  const mix = (c: number) => Math.round(c + (255 - c) * ratio)
  return toHex(mix(r), mix(g), mix(b))
}

function parseHex(hex: string): { r: number; g: number; b: number } {
  const cleaned = hex.replace('#', '')
  const full = cleaned.length === 3
    ? cleaned.split('').map((c) => c + c).join('')
    : cleaned.padEnd(6, '0').slice(0, 6)
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  }
}

function toHex(r: number, g: number, b: number): string {
  const h = (n: number) => n.toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}
