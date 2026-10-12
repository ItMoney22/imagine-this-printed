/**
 * Proof for the Jiffy per-colour blanks ship (task 67f1d6f2): which colour/size
 * combos does PRODUCTION code still sell that Jiffy does not carry, and does this
 * branch refuse them?
 *
 * Read-only. Reads the live active blanks over anon REST, runs every colour × size
 * through two copies of blankUnitPriceDollars():
 *   live   = backend/shared/blank-pricing.ts at <ref> (default origin/main)
 *   branch = backend/shared/blank-pricing.ts in this checkout
 * and prints a JSON report. A combo is "uncarried" when the colour has its own
 * by_color table and that table has no entry for the size.
 *
 *   npx tsx --env-file=.env.local scripts/proof-blank-size-gating.ts [ref] > report.json
 *
 * Exit 1 when the branch still prices any uncarried combo.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { blankUnitPriceDollars as branchPrice, blankPricingOf } from '../backend/shared/blank-pricing'

const SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL']

async function main() {
  const ref = process.argv[2] || 'origin/main'
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing (run with --env-file=.env.local)')

  const liveSha = execFileSync('git', ['rev-parse', '--short', ref]).toString().trim()
  const branchSha = execFileSync('git', ['rev-parse', '--short', 'HEAD']).toString().trim()
  const liveSrc = execFileSync('git', ['show', `${ref}:backend/shared/blank-pricing.ts`]).toString()
  const liveFile = join(mkdtempSync(join(tmpdir(), 'blank-pricing-live-')), 'blank-pricing.ts')
  writeFileSync(liveFile, liveSrc)
  const { blankUnitPriceDollars: livePrice } = await import(pathToFileURL(liveFile).href)

  const q = 'select=id,name,colors,metadata&status=eq.active&is_active=eq.true&metadata->garment->>blank=eq.true&order=name'
  const res = await fetch(`${url}/rest/v1/products?${q}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
  if (!res.ok) throw new Error(`products read failed: HTTP ${res.status}`)
  const rows: Array<{ id: string; name: string; colors: string[]; metadata: Record<string, any> }> = await res.json()

  const uncarried: Array<{ product: string; id: string; color: string; size: string; live: number | null; branch: number | null }> = []
  const blanks = rows.map(r => {
    const pricing = blankPricingOf(r.metadata)
    let combos = 0
    let refused = 0
    for (const [color, table] of Object.entries(pricing?.by_color ?? {})) {
      for (const size of SIZES) {
        if (table[size] !== undefined) continue
        const live = livePrice(pricing, size, color) as number | null
        const branch = branchPrice(pricing, size, color)
        if (live === null && branch === null) continue // nobody sells it: not a gap
        combos++
        if (branch === null) refused++
        uncarried.push({ product: r.name, id: r.id, color, size, live, branch })
      }
    }
    return {
      id: r.id,
      name: r.name,
      by_color_only: pricing?.by_color_only === true,
      colours: Object.keys(pricing?.by_color ?? {}).length,
      uncarried_sold_live: uncarried.filter(u => u.id === r.id && u.live !== null).length,
      uncarried_branch_refuses: refused,
      uncarried_total: combos,
    }
  })

  const report = {
    generated_at: new Date().toISOString(),
    live_code: `${ref} ${liveSha}`,
    branch_code: `HEAD ${branchSha}`,
    live_blank_rows: rows.length,
    uncarried_sold_by_live_code: uncarried.filter(u => u.live !== null).length,
    uncarried_sold_by_branch_code: uncarried.filter(u => u.branch !== null).length,
    blanks,
    uncarried,
  }
  console.log(JSON.stringify(report, null, 2))
  if (report.uncarried_sold_by_branch_code > 0) process.exit(1)
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(2)
})
