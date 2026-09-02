// ---------------------------------------------------------------------------
// Seed / reprice the four house-branded blank tees (David 2026-09-02).
//
// Source of truth: backend/shared/blank-line.ts (house names, "compared to"
// manufacturer/style, specs, colours, Jiffy costs). Prices are cost × (1 +
// markup) per size band and colour group — see backend/shared/blank-pricing.ts
// — written to products.metadata.garment.pricing, which the storefront AND the
// server checkout engine both read. products.price is only the "from" figure.
//
// Idempotent: keyed on products.slug (and metadata.import_key = blank:<tier>).
// Re-running UPDATES the existing rows in place (ids, created_at preserved),
// so this is also the reprice tool.
//
// Usage (from backend/, reads backend/.env):
//   npx tsx --env-file=.env scripts/seed-blanks.ts --dry-run
//   npx tsx --env-file=.env scripts/seed-blanks.ts                 # account cost basis, 10% markup, active
//   npx tsx --env-file=.env scripts/seed-blanks.ts --basis list    # reprice off Jiffy list price
//   npx tsx --env-file=.env scripts/seed-blanks.ts --markup 15
//   npx tsx --env-file=.env scripts/seed-blanks.ts --status draft
// ---------------------------------------------------------------------------
// override:true for the same reason load-env.ts / import-designs.mjs do it —
// an OS-level SUPABASE_SERVICE_ROLE_KEY (David's vault loader exports one)
// otherwise wins over backend/.env and the run dies on "Invalid API key".
import dotenv from 'dotenv'
dotenv.config({ override: true })

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { BLANK_LINE, BLANK_MARKUP_PCT, BLANK_LABEL_NOTE, compareToLabel, colorSlug, type BlankTierSpec, type BlankColor } from '../shared/blank-line.js'
import { buildBlankPricing, blankFromPriceDollars } from '../shared/blank-pricing.js'

// Per-colour renders written by scripts/render-blank-colors.ts. A colour whose
// file exists gets `image` on its metadata entry so the product page can swap
// the hero to the picked colour; the catalog gallery leads with the hero plus
// a few staple colours.
const PUBLIC_BLANKS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/blanks')
const GALLERY_STAPLES = ['Black', 'White', 'Navy']

function colorImagePath(t: BlankTierSpec, c: BlankColor): string | null {
  const rel = `${t.slug}/${colorSlug(c.name)}.webp`
  return fs.existsSync(path.join(PUBLIC_BLANKS, rel)) ? `/blanks/${rel}` : null
}

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(`--${name}`)
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}

const DRY_RUN = flag('dry-run')
const BASIS = (opt('basis') || 'account') as 'account' | 'list'
const MARKUP = Number(opt('markup') ?? BLANK_MARKUP_PCT)
const STATUS = (opt('status') || 'active') as 'active' | 'draft'

if (!['account', 'list'].includes(BASIS)) throw new Error(`--basis must be account|list, got ${BASIS}`)
if (!Number.isFinite(MARKUP) || MARKUP < 0) throw new Error(`--markup must be a number, got ${opt('markup')}`)
if (!['active', 'draft'].includes(STATUS)) throw new Error(`--status must be active|draft, got ${STATUS}`)

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing (run from backend/ with .env)')
const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

function buildRow(t: BlankTierSpec, knownColumns: Set<string> | null) {
  const cost = t.cost[BASIS]
  const pricing = buildBlankPricing(cost, t.whiteColors, MARKUP)
  // "from" for the card = lowest price in the whole table (usually White S-XL).
  const fromPrice = blankFromPriceDollars(pricing) ?? 0
  // cost_price (when the column exists) = the default-colour S/M cost.
  const baseCost = cost.default.M ?? cost.default.S ?? Object.values(cost.default)[0]

  const colorsWithImages = t.colors.map(c => {
    const image = colorImagePath(t, c)
    return image ? { ...c, image } : { ...c }
  })
  const renderedCount = colorsWithImages.filter(c => 'image' in c).length
  // Gallery: the generated hero first, then staple colour renders (deduped).
  const images = [t.image]
  for (const name of GALLERY_STAPLES) {
    const img = colorsWithImages.find(c => c.name === name && 'image' in c) as (BlankColor & { image?: string }) | undefined
    if (img?.image && !images.includes(img.image)) images.push(img.image)
  }

  const row: Record<string, unknown> = {
    name: `${t.name} — Blank`,
    slug: t.slug,
    description: `${t.description} ${BLANK_LABEL_NOTE}`,
    price: fromPrice,
    cost_price: baseCost,
    images,
    category: 'shirts',
    status: STATUS,
    is_active: true,
    // Satisfies products_print_locations_valid (shirts need >= 1); a single
    // location never renders the placement selector on the product page.
    print_locations: ['front_image'],
    sizes: t.sizes,
    // Jiffy colour NAMES (not hexes) so blank_inventory + reorders line up;
    // swatch hexes ride in metadata.garment.colors.
    colors: t.colors.map(c => c.name),
    is_user_generated: false,
    is_featured: false,
    // The product page appends "| Imagine This Printed" itself.
    meta_title: `Blank ${t.name} · ${t.grade}`,
    meta_description: `${t.tagline} ${t.specs.weightOz} oz, ${t.specs.fabric}. ${BLANK_LABEL_NOTE}`,
    search_keywords: ['blank tee', 'blank t-shirt', 'wholesale blank', t.grade.toLowerCase(), `${t.specs.weightOz} oz`, t.specs.seams].join(', '),
    metadata: {
      garment: {
        blank: true,
        tier: t.id,
        grade: t.grade,
        rank: t.rank,
        // Internal only — the storefront renders these solely as "Compared to".
        brand: t.compareTo.brand,
        style_code: t.compareTo.style,
        compare_to: compareToLabel(t),
        supplier: t.supplier,
        specs: t.specs,
        colors: colorsWithImages,
        color_renders: renderedCount,
        white_colors: t.whiteColors,
        markup_pct: MARKUP,
        cost_basis: BASIS,
        cost: t.cost,
        pricing,
        seeded_by: 'backend/scripts/seed-blanks.ts',
        seeded_at: new Date().toISOString()
      },
      // blank-inventory.ts prefers this to pick the right blank_inventory row.
      blank_style: t.compareTo.style,
      import_source: 'blank-line',
      import_key: `blank:${t.id}`
    }
  }

  // Only send columns the live table actually has (001_initial_schema.sql is
  // aspirational — e.g. cost_price / search_keywords may not exist live).
  if (knownColumns) {
    for (const k of Object.keys(row)) {
      if (!knownColumns.has(k)) delete row[k]
    }
  }
  return { row, pricing, fromPrice, renderedCount }
}

async function liveColumns(): Promise<Set<string> | null> {
  const { data, error } = await supabase.from('products').select('*').limit(1)
  if (error) {
    console.warn(`  [columns] could not sample products (${error.message}); sending all columns`)
    return null
  }
  const sample = data?.[0]
  if (!sample) return null
  return new Set(Object.keys(sample))
}

async function run() {
  console.log(`seed-blanks: basis=${BASIS} markup=${MARKUP}% status=${STATUS}${DRY_RUN ? ' (DRY RUN)' : ''}`)
  const knownColumns = await liveColumns()
  if (knownColumns) {
    const wanted = ['cost_price', 'meta_title', 'meta_description', 'search_keywords', 'is_featured', 'print_locations', 'slug', 'sizes', 'colors']
    const missing = wanted.filter(c => !knownColumns.has(c))
    if (missing.length) console.log(`  [columns] not on live products table, skipped: ${missing.join(', ')}`)
  }

  const slugs = BLANK_LINE.map(t => t.slug)
  const { data: existing, error: exErr } = await supabase
    .from('products')
    .select('id, slug, price, status, metadata')
    .in('slug', slugs)
  if (exErr) throw new Error(`lookup failed: ${exErr.message}`)
  const bySlug = new Map((existing || []).map(r => [r.slug, r]))

  const summary: Array<Record<string, unknown>> = []
  for (const t of [...BLANK_LINE].sort((a, b) => a.rank - b.rank)) {
    const { row, pricing, fromPrice } = buildRow(t, knownColumns)
    const prev = bySlug.get(t.slug)
    const d = pricing.default
    const w = pricing.by_color?.White
    summary.push({
      tier: `${t.grade} — ${t.name}`,
      action: prev ? 'update' : 'insert',
      from: fromPrice,
      'S-XL': d.S ?? d.M,
      '2XL': d['2XL'],
      '3XL': d['3XL'],
      '4XL': d['4XL'],
      '5XL': d['5XL'] ?? '—',
      'white S-XL': w?.S ?? w?.M ?? '—',
      colours: t.colors.length
    })
    if (DRY_RUN) continue

    if (prev) {
      const { error } = await supabase.from('products').update(row).eq('id', prev.id)
      if (error) throw new Error(`update failed for ${t.slug}: ${error.message}`)
    } else {
      const { error } = await supabase.from('products').insert(row)
      if (error) throw new Error(`insert failed for ${t.slug}: ${error.message}`)
    }
  }
  console.table(summary)

  if (!DRY_RUN) {
    const { data: after, error } = await supabase
      .from('products')
      .select('id, slug, name, price, status, is_active')
      .in('slug', slugs)
      .order('price')
    if (error) throw new Error(`verify failed: ${error.message}`)
    console.table((after || []).map(r => ({ id: r.id, slug: r.slug, price: r.price, status: r.status, active: r.is_active })))
    console.log(`✅ ${after?.length ?? 0} blank products ${STATUS === 'active' ? 'LIVE' : 'in draft'} — /blanks and /catalog/blanks read them.`)
  }
}

run().catch(err => {
  console.error('❌ seed-blanks failed:', err?.message || err)
  process.exit(1)
})
