// ---------------------------------------------------------------------------
// Pull variant-level blank costs (style x colour x size) from the supplier and
// upsert them into public.blank_variant_costs.
//
// Watchtower 767f74d4. Before this existed the catalogue knew ONE cost per
// style -- so a 5XL Top Line tee and a 3XL hoodie were both priced as if they
// cost the same as a small, and both sold under water.
//
// HOW THE PRICE IS READ. Jiffy's public product page renders the size grid as
//   <input ... data-catalog-number="G500" data-color="Red" data-size="M"
//          data-amount="2.99" data-sku="B11007524">
// and `data-amount` is the wholesale unit price the account pays. Verified
// 2026-09-22: it matched, to the cent, all four tier cost tables David
// captured on 2026-09-02 while SIGNED IN to his Jiffy account. So this sync
// needs no credentials and no session cookie. The struck-through
// `retail-amount` on the same row is Jiffy's MSRP and is stored as list_usd
// for context only -- nothing prices off it.
//
// Colour is selected with `?ac=<colour-slug>`; the grid only ever renders the
// active colour, so it is one page fetch per (style, colour).
//
// USAGE (from backend/, reads backend/.env):
//   npx tsx --env-file=.env scripts/sync-jiffy-costs.ts --dry-run
//   npx tsx --env-file=.env scripts/sync-jiffy-costs.ts                    # every style, the colours we sell
//   npx tsx --env-file=.env scripts/sync-jiffy-costs.ts --colors all       # every colour the mill offers
//   npx tsx --env-file=.env scripts/sync-jiffy-costs.ts --styles G500,G185
//   npx tsx --env-file=.env scripts/sync-jiffy-costs.ts --source snapshot  # offline seed, no network
//
// Re-running is safe and is the whole point: it UPSERTS on
// (supplier, style_code, color, size) and moves `last_synced` forward, so a
// stale cost is visible in the admin margin view rather than silently wrong.
// After a sync, run scripts/reprice-catalog-variants.ts to push the new costs
// into storefront prices.
// ---------------------------------------------------------------------------
// override:true for the same reason load-env.ts / seed-blanks.ts do it -- an
// OS-level SUPABASE_SERVICE_ROLE_KEY (David's vault loader exports one)
// otherwise wins over backend/.env and the run dies on "Invalid API key".
import dotenv from 'dotenv'
dotenv.config({ override: true })

import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import {
  JIFFY_STYLES,
  jiffyStyleByCode,
  jiffyProductUrl,
  jiffyColorSlug,
  usedSupplierColorNames,
  type JiffyStyle
} from '../shared/jiffy-catalog.js'
import { BLANK_LINE } from '../shared/blank-line.js'

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(`--${name}`)
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}

const DRY_RUN = flag('dry-run')
const SOURCE = (opt('source') || 'jiffy-web') as 'jiffy-web' | 'snapshot'
const COLOR_MODE = opt('colors') || 'used' // 'used' | 'all' | comma list
const CONCURRENCY = Math.max(1, Math.min(6, Number(opt('concurrency') ?? 3)))
const STYLE_FILTER = (opt('styles') || '')
  .split(',')
  .map(s => s.trim().toUpperCase())
  .filter(Boolean)

if (!['jiffy-web', 'snapshot'].includes(SOURCE)) {
  throw new Error(`--source must be jiffy-web|snapshot, got ${SOURCE}`)
}

const styles = STYLE_FILTER.length
  ? STYLE_FILTER.map(code => {
      const s = jiffyStyleByCode(code)
      if (!s) throw new Error(`unknown style "${code}" — known: ${JIFFY_STYLES.map(x => x.code).join(', ')}`)
      return s
    })
  : JIFFY_STYLES

// Lazy so the parsers below can be imported by a test without a live env.
let _supabase: ReturnType<typeof createClient> | null = null
function db() {
  if (_supabase) return _supabase
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing (run from backend/ with .env)')
  _supabase = createClient(url, key)
  return _supabase
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

export interface VariantCostRow {
  supplier: string
  style_code: string
  brand: string
  tier_id: string | null
  garment_id: string | null
  color: string
  color_slug: string
  size: string
  cost_usd: number
  list_usd: number | null
  sku: string | null
  supplier_url: string
  source: string
  last_synced: string
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`))
  return m ? m[1] : null
}

/** Every colour name the mill offers on this page. */
export function parseColorNames(html: string): string[] {
  const out = new Set<string>()
  for (const m of html.matchAll(/data-color-name="([^"]+)"/g)) out.add(m[1].trim())
  return [...out]
}

/**
 * The size grid for the ACTIVE colour: one entry per size, with the wholesale
 * amount and (when present) the struck-through MSRP that sits above it in the
 * same cell.
 */
export function parseSizeGrid(
  html: string
): Array<{ catalog: string; color: string; size: string; amount: number; list: number | null; sku: string | null }> {
  const rows: Array<{ catalog: string; color: string; size: string; amount: number; list: number | null; sku: string | null }> = []
  // The quantity input carries every field we need except the MSRP.
  const inputRe = /<input\b[^>]*js-quantity-form-input[^>]*>/g
  const matches = [...html.matchAll(inputRe)]
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]
    const tag = m[0]
    const catalog = attr(tag, 'data-catalog-number')
    const color = attr(tag, 'data-color')
    const size = attr(tag, 'data-size')
    const amountRaw = attr(tag, 'data-amount')
    if (!catalog || !color || !size || !amountRaw) continue
    const amount = Number(amountRaw)
    if (!Number.isFinite(amount) || amount <= 0) continue

    // The MSRP sits in a `retail-amount` div AFTER the input inside the same
    // cell (input-wrapper first, amounts block last). Bound the search at the
    // next cell's input so a size with no strike-through reads null instead of
    // stealing the next size's MSRP.
    let list: number | null = null
    const from = m.index! + tag.length
    const to = i + 1 < matches.length ? matches[i + 1].index! : Math.min(html.length, from + 6000)
    const retail = html.slice(from, to).match(/class="retail-amount[^"]*"[^>]*\sdata-amount="([\d.]+)"/)
    if (retail) {
      const v = Number(retail[1])
      if (Number.isFinite(v) && v > 0) list = v
    }

    rows.push({ catalog, color: color.trim(), size: size.trim().toUpperCase(), amount, list, sku: attr(tag, 'data-sku') })
  }
  return rows
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function fetchPage(url: string, attempt = 1): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(45_000)
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } catch (err: any) {
    if (attempt >= 3) throw new Error(`${url} failed after 3 attempts: ${err?.message || err}`)
    await sleep(1200 * attempt)
    return fetchPage(url, attempt + 1)
  }
}

/** Run `jobs` with a small worker pool so we stay a polite client. */
async function pool<T>(jobs: Array<() => Promise<T>>, size: number): Promise<T[]> {
  const out: T[] = new Array(jobs.length)
  let next = 0
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++
      out[i] = await jobs[i]()
      await sleep(250)
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, jobs.length) }, worker))
  return out
}

async function colorsFor(style: JiffyStyle): Promise<string[]> {
  if (COLOR_MODE !== 'used' && COLOR_MODE !== 'all') {
    return COLOR_MODE.split(',').map(s => s.trim()).filter(Boolean)
  }
  const html = await fetchPage(jiffyProductUrl(style))
  const offered = parseColorNames(html)
  if (COLOR_MODE === 'all') return offered
  // 'used': only the colours the storefront actually sells, matched
  // case-insensitively against what the mill really offers.
  const wanted = usedSupplierColorNames(style.code).map(n => n.toLowerCase())
  const picked = offered.filter(n => wanted.includes(n.toLowerCase()))
  if (picked.length === 0) {
    console.warn(`  [${style.code}] none of the storefront colours matched this mill's names — falling back to all ${offered.length}`)
    return offered
  }
  return picked
}

async function scrapeStyle(style: JiffyStyle): Promise<VariantCostRow[]> {
  const colors = await colorsFor(style)
  console.log(`  [${style.code}] ${style.brand} ${style.manufacturerStyle} — ${colors.length} colour(s)`)
  const syncedAt = new Date().toISOString()

  const jobs = colors.map(color => async (): Promise<VariantCostRow[]> => {
    const url = jiffyProductUrl(style, color)
    const html = await fetchPage(url)
    const grid = parseSizeGrid(html)
    // The mill echoes the active colour back on every grid row. If it does not
    // match what we asked for, the `?ac=` slug did not resolve — record
    // nothing rather than writing another colour's prices under this name.
    const served = grid[0]?.color
    if (!served || served.toLowerCase() !== color.toLowerCase()) {
      console.warn(`    [${style.code}/${color}] page served "${served ?? 'nothing'}" — skipped`)
      return []
    }
    return grid.map(g => ({
      supplier: 'jiffy',
      style_code: style.code,
      brand: style.brand,
      tier_id: style.tierId,
      garment_id: style.garmentId,
      color,
      color_slug: jiffyColorSlug(color),
      size: g.size,
      cost_usd: g.amount,
      list_usd: g.list,
      sku: g.sku,
      supplier_url: url,
      source: 'jiffy-web',
      last_synced: syncedAt
    }))
  })

  const results = await pool(jobs, CONCURRENCY)
  return results.flat()
}

// ---------------------------------------------------------------------------
// Offline seed — the costs already captured by hand in blank-line.ts. Covers
// only the four tee tiers (the hoodie and youth cuts have never had a cost
// anywhere), so this is a fallback, not a substitute for the live sync.
// ---------------------------------------------------------------------------

function snapshotRows(): VariantCostRow[] {
  const syncedAt = new Date().toISOString()
  const rows: VariantCostRow[] = []
  for (const tier of BLANK_LINE) {
    const style = JIFFY_STYLES.find(s => s.tierId === tier.id)
    if (!style || (STYLE_FILTER.length && !STYLE_FILTER.includes(style.code.toUpperCase()))) continue
    const push = (colorName: string, table: Record<string, number | undefined>, listTable: Record<string, number | undefined>) => {
      for (const [size, cost] of Object.entries(table)) {
        if (!Number.isFinite(cost)) continue
        rows.push({
          supplier: 'jiffy',
          style_code: style.code,
          brand: style.brand,
          tier_id: style.tierId,
          garment_id: style.garmentId,
          color: colorName,
          color_slug: jiffyColorSlug(colorName),
          size,
          cost_usd: Number(cost),
          list_usd: Number.isFinite(listTable[size]) ? Number(listTable[size]) : null,
          sku: null,
          supplier_url: tier.supplier.url,
          source: 'snapshot',
          last_synced: syncedAt
        })
      }
    }
    const whites = new Set(tier.whiteColors.map(c => c.toLowerCase()))
    for (const c of tier.colors) {
      const isWhite = whites.has(c.name.toLowerCase())
      push(
        c.name,
        (isWhite ? tier.cost.account.white : tier.cost.account.default) as Record<string, number | undefined>,
        (isWhite ? tier.cost.list.white : tier.cost.list.default) as Record<string, number | undefined>
      )
    }
  }
  return rows
}

// ---------------------------------------------------------------------------

async function upsert(rows: VariantCostRow[]) {
  const CHUNK = 500
  let written = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const { error } = await db()
      .from('blank_variant_costs')
      .upsert(chunk, { onConflict: 'supplier,style_code,color,size' })
    if (error) throw new Error(`upsert failed at row ${i}: ${error.message}`)
    written += chunk.length
    process.stdout.write(`\r  wrote ${written}/${rows.length}`)
  }
  if (rows.length) process.stdout.write('\n')
}

async function run() {
  console.log(
    `sync-jiffy-costs: source=${SOURCE} colors=${COLOR_MODE} styles=${styles.map(s => s.code).join(',')}${DRY_RUN ? ' (DRY RUN)' : ''}`
  )

  let rows: VariantCostRow[] = []
  if (SOURCE === 'snapshot') {
    rows = snapshotRows()
  } else {
    for (const style of styles) {
      rows.push(...(await scrapeStyle(style)))
    }
  }

  if (rows.length === 0) {
    console.error('no cost rows parsed — refusing to write nothing over live costs')
    process.exit(1)
  }

  // Summary keyed on the base size, so a bad parse is obvious before it lands.
  const byStyle = new Map<string, VariantCostRow[]>()
  for (const r of rows) {
    if (!byStyle.has(r.style_code)) byStyle.set(r.style_code, [])
    byStyle.get(r.style_code)!.push(r)
  }
  console.table(
    [...byStyle.entries()].map(([code, rs]) => {
      const style = jiffyStyleByCode(code)!
      const costs = rs.map(r => r.cost_usd)
      const base = rs.filter(r => r.size === 'M' || r.size === 'L')
      return {
        style: `${style.brand} ${style.manufacturerStyle}`,
        code,
        tier: style.tierId ?? '—',
        garment: style.garmentId ?? '—',
        colours: new Set(rs.map(r => r.color)).size,
        variants: rs.length,
        'base M/L': base.length ? `$${Math.min(...base.map(r => r.cost_usd)).toFixed(2)}–$${Math.max(...base.map(r => r.cost_usd)).toFixed(2)}` : '—',
        'cost range': `$${Math.min(...costs).toFixed(2)}–$${Math.max(...costs).toFixed(2)}`
      }
    })
  )

  if (DRY_RUN) {
    console.log(`DRY RUN — ${rows.length} variant costs parsed, nothing written.`)
    return
  }

  await upsert(rows)

  const { count, error } = await db()
    .from('blank_variant_costs')
    .select('*', { count: 'exact', head: true })
  if (error) throw new Error(`verify failed: ${error.message}`)
  console.log(`✅ blank_variant_costs now holds ${count} variant costs.`)
  console.log('   Next: npx tsx --env-file=.env scripts/reprice-catalog-variants.ts --dry-run')
}

// The parsers above are importable by a test; only a direct invocation syncs.
// Compared as file URLs rather than by basename — a basename match would also
// fire when some other `sync-jiffy-costs` is the entry point.
const invokedDirectly =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (invokedDirectly) {
  run().catch(err => {
    console.error('sync-jiffy-costs failed:', err?.message || err)
    process.exit(1)
  })
}
