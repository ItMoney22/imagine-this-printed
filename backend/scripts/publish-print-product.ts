// ---------------------------------------------------------------------------
// Publish a print-factory build as an ITP catalog product.
//
// tools/print-factory turns a fixture into `model.stl` + `metrics.json`. Nothing
// consumed that pair, so a finished, validated mesh could not be sold — not on
// ITP and not on a creator storefront. This script is that missing step.
//
//   cd backend
//   tsx --env-file=.env scripts/publish-print-product.ts \
//     --stl <path> --metrics <path> --name "..." [--category 3d-prints] \
//     [--creator <userId>] [--preview <png>] [--price <usd>] \
//     [--description "..."] [--filament PLA] [--magnet-sockets 2] \
//     [--nfc-url https://...] [--commit]
//
// ═══════════════════════════════════════════════════════════════════════════
//  DRY RUN IS THE DEFAULT. Without --commit this uploads nothing, writes
//  nothing, and only prints the row it would insert.
//
//  Everything it creates is a DRAFT: status='draft', is_active=false. Both.
//  GET /api/storefront/catalog (routes/storefront.ts) gates on
//  `is_active = true AND status = 'active'` — deliberately both, because
//  is_active DEFAULTS TRUE in the live DB and filtering on it alone once
//  leaked 2,000+ unapproved drafts into external storefronts. This script
//  never sets either flag live; David approves through the admin flow.
// ═══════════════════════════════════════════════════════════════════════════
//
// Reaching a creator's storefront: Darrell's shop is not a separate site — it
// calls the same /api/storefront/catalog with a creator-scoped key
// (STOREFRONT_CREATOR_KEYS) that filters on created_by_user_id. So --creator
// <Darrell's ITP user id> is the whole difference between "in the ITP catalog"
// and "in Darrell's shop", once the two liveness flags are approved.
//
// The row shape (category upsert, unique slug, dollars-not-cents price) is
// copied from the working insert in routes/admin/ai-products.ts, not invented.
// ---------------------------------------------------------------------------
import { readFileSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'

import {
  loadPrintPricingConfig,
  metricsBlockers,
  priceFromMetrics,
  type PrintMetrics,
  type PrintPriceBreakdown,
} from '../services/print-pricing.js'
import { slugify, generateUniqueSlug } from '../utils/slugify.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Display names for the slugs this script is likely to create. product_categories
// currently has NO '3d-prints' row even though three live products already carry
// category='3d-prints' and routes/seo.ts, presentation-qa.ts and print-bridge.ts
// all treat it as real — the text column and the FK have drifted apart. Without
// this map the upsert would name the category "3d-prints" in the admin UI.
const CATEGORY_DISPLAY_NAMES: Record<string, string> = {
  '3d-prints': '3D Prints',
  shirts: 'Shirts',
  hoodies: 'Hoodies',
  tumblers: 'Tumblers',
  'dtf-transfers': 'DTF Transfers',
  'metal-art': 'Metal Art',
}

// Binary STL: 80-byte header, then a uint32 triangle count, then 50 bytes per
// triangle. Exact — which is why it can be checked against metrics.tri_count.
const STL_HEADER_BYTES = 80
const STL_COUNT_BYTES = 4
const STL_BYTES_PER_TRIANGLE = 50

class PublishRefused extends Error {
  constructor(public readonly reasons: string[]) {
    super(reasons.join('; '))
  }
}

interface Args {
  stl: string
  metrics: string
  name: string
  category: string
  creator?: string
  preview?: string
  price?: number
  description?: string
  filament: string
  magnetSockets?: number
  nfcUrl?: string
  commit: boolean
}

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string>()
  let commit = false
  let sawDryRun = false

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (!token.startsWith('--')) {
      throw new Error(`unexpected argument "${token}" — every option must be --named`)
    }
    const key = token.slice(2)
    if (key === 'commit') {
      commit = true
      continue
    }
    if (key === 'dry-run') {
      sawDryRun = true
      continue
    }
    const value = argv[++i]
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`--${key} needs a value`)
    }
    flags.set(key, value)
  }

  // Explicit --dry-run always wins over --commit. Someone who typed both meant
  // the safe one, and this is a script that writes to the live catalog.
  if (sawDryRun && commit) {
    console.warn('[publish] --dry-run and --commit both given — honouring --dry-run.')
    commit = false
  }

  const required = (key: string): string => {
    const v = flags.get(key)
    if (!v) throw new Error(`--${key} is required`)
    return v
  }

  const num = (key: string): number | undefined => {
    const raw = flags.get(key)
    if (raw === undefined) return undefined
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`--${key} must be a non-negative number`)
    return parsed
  }

  return {
    stl: required('stl'),
    metrics: required('metrics'),
    name: required('name'),
    category: flags.get('category') || '3d-prints',
    creator: flags.get('creator'),
    preview: flags.get('preview'),
    price: num('price'),
    description: flags.get('description'),
    filament: flags.get('filament') || 'PLA',
    magnetSockets: num('magnet-sockets'),
    nfcUrl: flags.get('nfc-url'),
    commit,
  }
}

function readMetrics(path: string): PrintMetrics {
  let raw: string
  try {
    raw = readFileSync(path, 'utf-8')
  } catch (e: any) {
    throw new PublishRefused([`cannot read metrics file ${path}: ${e?.message || e}`])
  }
  try {
    return JSON.parse(raw) as PrintMetrics
  } catch (e: any) {
    throw new PublishRefused([`metrics file ${path} is not valid JSON: ${e?.message || e}`])
  }
}

/**
 * Cross-check the STL against the metrics that claim to describe it.
 *
 * The two files are passed as separate arguments, so nothing but this stops
 * someone publishing candle_cradle_L.stl with candle_cradle_S.metrics.json —
 * which would price and print the wrong object with no error anywhere. A binary
 * STL's triangle count is exact and free to read, so it is the cheap proof that
 * the pair belongs together.
 */
function stlBlockers(path: string, metrics: PrintMetrics): string[] {
  const reasons: string[] = []

  let size: number
  try {
    const st = statSync(path)
    if (!st.isFile()) return [`${path} is not a file`]
    size = st.size
  } catch (e: any) {
    return [`cannot read STL ${path}: ${e?.message || e}`]
  }

  if (size === 0) return [`STL ${path} is empty`]

  const head = readFileSync(path).subarray(0, STL_HEADER_BYTES + STL_COUNT_BYTES)
  const isAscii = head.subarray(0, 5).toString('ascii').toLowerCase() === 'solid'

  if (isAscii) {
    // ASCII STLs carry no triangle count in a fixed place; skip the cross-check
    // rather than parse the whole file, but say so out loud.
    console.warn('[publish] ⚠️  ASCII STL — triangle count cross-check against metrics.json skipped.')
    return reasons
  }

  const triCount = head.readUInt32LE(STL_HEADER_BYTES)
  const expectedBytes = STL_HEADER_BYTES + STL_COUNT_BYTES + triCount * STL_BYTES_PER_TRIANGLE
  if (expectedBytes !== size) {
    reasons.push(
      `STL ${basename(path)} is truncated or not a binary STL: header says ${triCount} triangles ` +
        `(${expectedBytes} bytes expected) but the file is ${size} bytes`
    )
    return reasons
  }

  if (typeof metrics.tri_count === 'number' && metrics.tri_count !== triCount) {
    reasons.push(
      `STL/metrics mismatch: ${basename(path)} has ${triCount} triangles but metrics.json reports ` +
        `${metrics.tri_count} — these two files do not describe the same mesh`
    )
  }

  return reasons
}

const money = (n: number): string => `$${n.toFixed(2)}`

function printBreakdown(b: PrintPriceBreakdown, overriddenTo?: number): void {
  const hours = b.printMinutes / 60
  console.log('  Pricing')
  console.log(`    filament           ${money(b.filamentUsd).padStart(9)}   ${b.grams.toFixed(1)}g`)
  console.log(
    `    machine            ${money(b.machineUsd).padStart(9)}   ${b.printMinutes} min ` +
      `(${hours.toFixed(2)}h) — ESTIMATE, nothing sliced yet`
  )
  console.log(`    scrap allowance    ${money(b.scrapUsd).padStart(9)}`)
  console.log(`    labour             ${money(b.labourUsd).padStart(9)}`)
  console.log(`    packaging          ${money(b.packagingUsd).padStart(9)}`)
  console.log(`    ─────────────────────────────`)
  console.log(`    cost               ${money(b.costUsd).padStart(9)}`)
  console.log(`    x margin ${String(b.marginMultiplier).padEnd(6)}    ${money(b.rawPriceUsd).padStart(9)}`)
  if (b.floorApplied) console.log(`    (minimum price floor applied)`)
  console.log(`    PRICE              ${money(b.priceUsd).padStart(9)}`)
  if (overriddenTo !== undefined) {
    console.log(`    --price override   ${money(overriddenTo).padStart(9)}   <- this is what gets stored`)
  }
  console.log('')
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const mode = args.commit ? 'COMMIT' : 'DRY RUN'

  console.log('')
  console.log(`=== publish-print-product — ${mode} ===`)
  console.log('')

  // -- 1. Read and gate the metrics -----------------------------------------
  const metricsPath = resolve(args.metrics)
  const stlPath = resolve(args.stl)
  const metrics = readMetrics(metricsPath)

  const blockers = [...metricsBlockers(metrics), ...stlBlockers(stlPath, metrics)]
  if (blockers.length > 0) throw new PublishRefused(blockers)

  console.log(`  Source     ${basename(stlPath)}  +  ${basename(metricsPath)}`)
  console.log(
    `  Geometry   ${metrics.grams_est}g · ${Math.round(metrics.volume_mm3)}mm³ · ` +
      `${metrics.bbox_mm.x}×${metrics.bbox_mm.y}×${metrics.bbox_mm.z}mm · ` +
      `${metrics.tri_count ?? '?'} tris · manifold · 0 warnings`
  )
  console.log(`  Fixture    ${metrics.fixture ?? '(unnamed)'}`)
  console.log('')

  // -- 2. Price --------------------------------------------------------------
  const breakdown = priceFromMetrics(metrics, loadPrintPricingConfig())
  const price = args.price ?? breakdown.priceUsd
  printBreakdown(breakdown, args.price)

  // -- 3. Creator ------------------------------------------------------------
  if (args.creator && !UUID_RE.test(args.creator)) {
    throw new PublishRefused([`--creator "${args.creator}" is not a UUID — that is an ITP user id, not a name`])
  }

  // -- 4. Resolve the category and a unique slug against the live catalog -----
  //
  // Even a dry run reads the DB: a slug that collides or a category that does
  // not exist is exactly the kind of thing a dry run is supposed to surface,
  // and showing a row that would fail on insert is worse than showing nothing.
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new PublishRefused([
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set — even a dry run reads the catalog ' +
        'to resolve the category and prove the slug is free. Run with `tsx --env-file=.env`.',
    ])
  }
  // Imported lazily: lib/supabase.ts builds its client at module load, so a
  // top-level import would crash on a missing env before the nicer message
  // above can be printed.
  const { supabase } = await import('../lib/supabase.js')

  const { data: category, error: catError } = await supabase
    .from('product_categories')
    .select('id, slug, name')
    .eq('slug', args.category)
    .maybeSingle()
  if (catError) throw new Error(`category lookup failed: ${catError.message}`)

  const baseSlug = slugify(args.name)
  const { data: existing, error: slugError } = await supabase
    .from('products')
    .select('slug')
    .like('slug', `${baseSlug}%`)
  if (slugError) throw new Error(`slug lookup failed: ${slugError.message}`)
  const existingSlugs = (existing ?? []).map((p: any) => p.slug).filter(Boolean)
  const uniqueSlug = generateUniqueSlug(baseSlug, existingSlugs)

  if (!category) {
    console.log(
      `  Category   "${args.category}" has no product_categories row — it would be upserted as ` +
        `"${CATEGORY_DISPLAY_NAMES[args.category] ?? args.category}".`
    )
  } else {
    console.log(`  Category   ${category.slug} (${category.id})`)
  }
  if (uniqueSlug !== baseSlug) {
    console.log(`  Slug       "${baseSlug}" is taken (${existingSlugs.length} match) → "${uniqueSlug}"`)
  } else {
    console.log(`  Slug       ${uniqueSlug}`)
  }
  console.log('')

  // -- 5. Upload the artefacts (COMMIT ONLY) ---------------------------------
  //
  // services/gcs-storage.ts `uploadFile()` cannot be used here: it hardcodes the
  // object path to `users/<userId>/<folder>/<file>` with a closed union of
  // folder names, so it physically cannot write print-factory/<slug>/model.stl.
  // uploadImageFromBuffer() takes an explicit destination path and mints the
  // same 1-year signed URL (public reads are blocked at the GCS org level, so a
  // plain storage.googleapis.com URL 403s). Despite the name it is a plain
  // buffer upload — the content type is a parameter.
  const stlObjectPath = `print-factory/${uniqueSlug}/model.stl`
  const previewObjectPath = args.preview
    ? `print-factory/${uniqueSlug}/preview${args.preview.match(/\.[a-z0-9]+$/i)?.[0] ?? '.png'}`
    : null

  let stlUrl = `gs://<GCS_BUCKET_NAME>/${stlObjectPath}  (not uploaded — dry run)`
  let previewUrl: string | null = previewObjectPath
    ? `gs://<GCS_BUCKET_NAME>/${previewObjectPath}  (not uploaded — dry run)`
    : null

  if (args.commit) {
    const { uploadImageFromBuffer } = await import('../services/google-cloud-storage.js')

    const stlBuffer = readFileSync(stlPath)
    console.log(`  Uploading  ${stlObjectPath} (${stlBuffer.length} bytes)`)
    stlUrl = (await uploadImageFromBuffer(stlBuffer, stlObjectPath, 'model/stl')).publicUrl

    if (args.preview && previewObjectPath) {
      const previewBuffer = readFileSync(resolve(args.preview))
      const ext = previewObjectPath.split('.').pop()!.toLowerCase()
      const contentType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'
      console.log(`  Uploading  ${previewObjectPath} (${previewBuffer.length} bytes)`)
      previewUrl = (await uploadImageFromBuffer(previewBuffer, previewObjectPath, contentType)).publicUrl
    }
    console.log('')
  }

  // -- 6. Build the row ------------------------------------------------------
  const description =
    args.description ??
    `3D printed in ${args.filament}. ${Math.round(metrics.bbox_mm.x)}×${Math.round(metrics.bbox_mm.y)}×` +
      `${Math.round(metrics.bbox_mm.z)}mm, approximately ${metrics.grams_est}g. Printed to order on ` +
      `ITP's own printers from the original model.`

  const row = {
    ...(category ? { category_id: category.id } : {}),
    name: args.name,
    slug: uniqueSlug,
    description,
    price, // DOLLARS, not cents — matches routes/admin/ai-products.ts
    // ⚠️ THE TWO FLAGS THAT KEEP THIS OUT OF EVERY STOREFRONT UNTIL APPROVED.
    // is_active DEFAULTS TRUE in the live DB, so it is pinned explicitly here
    // rather than left off the insert.
    status: 'draft' as const,
    is_active: false,
    category: args.category,
    print_locations: [] as string[],
    images: previewUrl ? [previewUrl] : ([] as string[]),
    ...(args.creator ? { created_by_user_id: args.creator, is_user_generated: true } : {}),
    metadata: {
      // `enabled` is the flag routes/print-bridge.ts checks (alongside
      // category === '3d-prints') to decide an order goes to the printer fleet.
      print3d: {
        enabled: true,
        source: 'print-factory',
        source_fixture: metrics.fixture ?? null,
        ...(metrics.params ? { fixture_params: metrics.params } : {}),
        grams_est: metrics.grams_est,
        volume_mm3: metrics.volume_mm3,
        bbox_mm: metrics.bbox_mm,
        stl_url: stlUrl,
        filament: args.filament,
        material: args.filament,
        color_mode: 'grey' as const,
        ...(args.magnetSockets !== undefined ? { magnet_sockets: args.magnetSockets } : {}),
        ...(args.nfcUrl ? { nfc_url: args.nfcUrl } : {}),
        // The price the model produced, kept even when --price overrode it, so
        // a later audit can see what the geometry said it should cost.
        pricing: {
          ...breakdown,
          // Restated at the row level so nobody reads this as a slicer number.
          print_minutes_are_estimated: true,
          print_minutes_note:
            'ESTIMATE from volume + layer count. Nothing has been sliced. Replace with slicer output when print-factory Phase 3 lands.',
        },
      },
      published_by: 'scripts/publish-print-product.ts',
      published_at: new Date().toISOString(),
    },
  }

  console.log('  Row it would insert into `products`:')
  console.log(
    JSON.stringify(row, null, 2)
      .split('\n')
      .map((l) => `    ${l}`)
      .join('\n')
  )
  console.log('')

  if (!args.commit) {
    console.log('  DRY RUN — nothing uploaded, nothing written. Re-run with --commit to publish.')
    console.log('')
    return
  }

  // -- 7. Write (COMMIT ONLY) ------------------------------------------------
  let categoryId = category?.id
  if (!categoryId) {
    const { data: upserted, error } = await supabase
      .from('product_categories')
      .upsert(
        { slug: args.category, name: CATEGORY_DISPLAY_NAMES[args.category] ?? args.category },
        { onConflict: 'slug' }
      )
      .select()
      .single()
    if (error) throw new Error(`category upsert failed: ${error.message}`)
    categoryId = upserted.id
  }

  const { data: product, error: insertError } = await supabase
    .from('products')
    .insert({ ...row, category_id: categoryId })
    .select()
    .single()
  if (insertError) throw new Error(`product insert failed: ${insertError.message}`)

  console.log(`  ✅ Draft product created: ${product.id}`)
  console.log(`     status=${product.status} is_active=${product.is_active} — NOT live.`)
  console.log(`     Approve it through the admin flow to publish.`)
  console.log('')
}

main().catch((e) => {
  console.error('')
  if (e instanceof PublishRefused) {
    console.error('  ❌ REFUSED — this model must not become a product:')
    for (const r of e.reasons) console.error(`     · ${r}`)
    console.error('')
    console.error('  Nothing was uploaded and nothing was written.')
  } else {
    console.error(`  ❌ ${e?.message || e}`)
  }
  console.error('')
  process.exit(1)
})
