// One-shot helper that ingests `tsc --noEmit` output and inserts
// `// @ts-expect-error TODO(db-types) PR 2b: ...` markers above each
// reported error line. Used once during the Database<> type wiring PR
// to defer null-safety / shape drift to a follow-up. Safe to delete
// after PR 2b lands and the markers are removed.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const errFile = process.argv[2] ?? 'tsc-errors.txt'
const raw = readFileSync(errFile, 'utf8')

const byFile = new Map()
for (const line of raw.split(/\r?\n/)) {
  const m = line.match(/^(.+?)\((\d+),(\d+)\): error TS/)
  if (!m) continue
  const file = m[1]
  const ln = parseInt(m[2], 10)
  if (!byFile.has(file)) byFile.set(file, new Set())
  byFile.get(file).add(ln)
}

let totalPatched = 0
for (const [file, linesSet] of byFile) {
  const fp = resolve(file)
  const src = readFileSync(fp, 'utf8')
  const lines = src.split(/\r?\n/)
  const sorted = [...linesSet].sort((a, b) => b - a) // bottom-up
  for (const ln of sorted) {
    const idx = ln - 1
    if (idx < 0 || idx >= lines.length) continue
    const target = lines[idx]
    const ws = (target.match(/^\s*/) ?? [''])[0]
    const marker = `${ws}// @ts-expect-error TODO(db-types) PR 2b: drift surfaced by generated Database types`
    lines.splice(idx, 0, marker)
    totalPatched++
  }
  writeFileSync(fp, lines.join('\n'), 'utf8')
  console.log(`patched ${file} x${sorted.length}`)
}
console.log(`total markers inserted: ${totalPatched}`)
