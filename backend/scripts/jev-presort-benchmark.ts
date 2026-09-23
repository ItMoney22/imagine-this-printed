// Jev pre-sort benchmark — READ-ONLY. Runs every user-submitted product a
// human has already decided (approved_by / rejected_by in metadata) through
// the exact pre-sort the approval queue uses, and scores it against what the
// human did. This is the "measure before enabling as default" step: JEV_PRESORT
// stays `shadow` until this report says the suggestions agree with reviewers.
//
// Writes nothing to the database.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... OPENROUTER_API_KEY=... \
//     npx tsx scripts/jev-presort-benchmark.ts [--out <dir>] [--include-pending]
//
// Human label: approved → approve; rejected with an IP-sounding reason →
// reject_ip; any other rejection → reject_quality. needs_fix has no human
// counterpart (the queue has no "send back" action), so a needs_fix
// suggestion on an approved row is scored as "agrees on keep".
import { createClient } from '@supabase/supabase-js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { presortProducts, type PresortResult, type PresortVerdict } from '../services/jev-approval-presort.js'

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : undefined
}
const outDir = arg('out')
const includePending = process.argv.includes('--include-pending')

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is required')
const supabase = createClient(url, key, { auth: { persistSession: false } })

const IP_REASON = /copyright|trademark|\bip\b|intellectual|brand|licen[cs]e|disney|marvel|nfl|nba/i

type Human = 'approve' | 'reject_quality' | 'reject_ip' | 'pending'

function humanLabel(p: any): Human | null {
  const m = p.metadata || {}
  if (p.status === 'pending_approval') return includePending ? 'pending' : null
  if (m.rejected_by || p.status === 'rejected') return IP_REASON.test(String(m.rejection_reason || '')) ? 'reject_ip' : 'reject_quality'
  if (m.approved_by) return 'approve'
  return null
}

const keep = (v: PresortVerdict | null) => v === 'approve' || v === 'needs_fix'

async function main() {
  const rows: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('products')
      .select('id, name, description, status, images, created_at, metadata, product_assets (id, url, kind, is_primary, display_order), product_tags (tag)')
      .eq('metadata->>user_submitted', 'true')
      .order('created_at', { ascending: false })
      .range(from, from + 999)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  const labelled = rows.map(p => ({ p, human: humanLabel(p) })).filter(r => r.human) as { p: any; human: Human }[]
  const t0 = Date.now()
  const presort = await presortProducts(labelled.map(r => r.p), { mode: 'shadow', budgetMs: 30_000 })
  const ms = Date.now() - t0

  const decided = labelled.filter(r => r.human !== 'pending')
  const lines = labelled.map(({ p, human }) => {
    const r: PresortResult = presort[p.id]
    const agree = human === 'pending' || r.recommendation == null ? null
      : keep(r.recommendation) === (human === 'approve')
    return { id: p.id, name: p.name, human, suggestion: r.recommendation, confidence: r.confidence, reasonCode: r.reasonCode, reasonCodes: r.reasonCodes, band: r.band, agree, rationale: r.rationale }
  })
  const scored = lines.filter(l => l.human !== 'pending')
  const suggested = scored.filter(l => l.suggestion != null)
  const agreed = suggested.filter(l => l.agree)
  const exact = suggested.filter(l => l.suggestion === l.human)
  const summary = {
    ranAt: new Date().toISOString(),
    rowsUserSubmitted: rows.length,
    humanDecided: decided.length,
    coverage: `${suggested.length}/${scored.length} got a suggestion (rest were low-confidence / no opinion)`,
    keepVsRejectAgreement: suggested.length ? `${agreed.length}/${suggested.length}` : 'n/a',
    exactVerdictAgreement: suggested.length ? `${exact.length}/${suggested.length}` : 'n/a',
    falseApprovals: suggested.filter(l => l.suggestion === 'approve' && l.human !== 'approve').length,
    jevMs: ms
  }

  console.log(JSON.stringify(summary, null, 2))
  for (const l of lines) {
    console.log(`${l.agree === null ? '·' : l.agree ? '✓' : '✗'} human=${l.human.padEnd(14)} jev=${String(l.suggestion).padEnd(14)} conf=${l.confidence == null ? '—' : l.confidence.toFixed(2)} ${l.reasonCodes.join(',')}  "${String(l.name).slice(0, 60)}"`)
  }
  if (outDir) {
    mkdirSync(outDir, { recursive: true })
    const stamp = new Date().toISOString().slice(0, 10)
    writeFileSync(join(outDir, `jev-presort-benchmark-${stamp}.json`), JSON.stringify({ summary, lines }, null, 2))
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
