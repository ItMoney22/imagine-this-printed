// ---------------------------------------------------------------------------
// Backfill for the ~2,700 designs imported before the media fix.
//
// Repairs three things per product, each independently skippable:
//   1. URLs   — images[] holds 365-day GCS signed URLs that 403 on expiry.
//               Rewritten to the permanent /api/media/<gcs-path> address.
//   2. DIMS   — metadata.image (width/height/DPI/print verdict) was never
//               recorded. Measured from the PNG already in the bucket.
//   3. SOURCE — metadata.source_files held bare Windows paths under the local
//               design bundle. The originals are uploaded to GCS and the field
//               is rewritten to reachable URLs.
//
// Safe to interrupt: every step is idempotent and re-checks state, so the same
// command can be re-run until it reports zero remaining.
//
// Usage (from backend/, reads backend/.env):
//   node scripts/backfill-design-library-media.mjs --dry-run --limit 20
//   node scripts/backfill-design-library-media.mjs --urls --dims      # fast pass
//   node scripts/backfill-design-library-media.mjs --sources          # ~4 GB upload
//   node scripts/backfill-design-library-media.mjs --sources --include-psd
//   node scripts/backfill-design-library-media.mjs --verify 20        # spot check
//   node scripts/backfill-design-library-media.mjs --verify 20 --base http://localhost:4321
//
// To switch the whole catalog to direct public GCS URLs instead of the proxy
// (see MEDIA_PUBLIC_BASE in scripts/lib/design-media.mjs for the trade-off):
//   MEDIA_PUBLIC_BASE=https://storage.googleapis.com/imagine-this-printed-main \
//     node scripts/backfill-design-library-media.mjs --force-urls
// ---------------------------------------------------------------------------
// override:true — see load-env.ts: an OS-level SUPABASE_SERVICE_ROLE_KEY from
// the vault loader otherwise shadows backend/.env and every query 401s.
import dotenv from 'dotenv'
dotenv.config({ override: true })

import fs from 'node:fs'
import path from 'node:path'
import { Storage } from '@google-cloud/storage'
import { createClient } from '@supabase/supabase-js'
import {
  stableMediaUrl,
  gcsPathFromUrl,
  isExpiringUrl,
  readImageStats,
  uploadSources,
  sourceFilesAreLocalPaths
} from './lib/design-media.mjs'

const DESIGN_ROOT = process.env.DESIGN_LIBRARY_ROOT ||
  'E:\\Business\\Imagine-This-Printed\\Imagine This Printed (Designs)'
const SOURCE_MAX_BYTES = Number(process.env.IMPORT_SOURCE_MAX_MB || 300) * 1024 * 1024
const CONCURRENCY = Number(process.env.BACKFILL_CONCURRENCY || 6)

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const opt = (name) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null
}

const DRY_RUN = flag('dry-run')
const LIMIT = Number(opt('limit') || 0)
const COLLECTION = opt('collection')
const INCLUDE_PSD = flag('include-psd')
const FORCE_URLS = flag('force-urls')

// No step flags at all → do URLs and dims (the fast, no-upload repair).
const anyStepFlag = flag('urls') || flag('dims') || flag('sources') || FORCE_URLS
const DO_URLS = anyStepFlag ? (flag('urls') || FORCE_URLS) : true
const DO_DIMS = anyStepFlag ? flag('dims') : true
const DO_SOURCES = flag('sources')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const storage = new Storage({
  projectId: process.env.GCS_PROJECT_ID,
  credentials: process.env.GCS_CREDENTIALS && process.env.GCS_CREDENTIALS.trim().startsWith('{')
    ? JSON.parse(process.env.GCS_CREDENTIALS)
    : undefined,
  ...(process.env.GCS_CREDENTIALS && !process.env.GCS_CREDENTIALS.trim().startsWith('{')
    ? { keyFilename: process.env.GCS_CREDENTIALS }
    : {})
})
const bucket = storage.bucket(process.env.GCS_BUCKET_NAME || 'imagine-this-printed-main')

const slugify = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)

async function fetchAllDesignProducts() {
  const rows = []
  let from = 0
  for (;;) {
    let q = supabase
      .from('products')
      .select('id, name, slug, images, metadata')
      .eq('metadata->>import_source', 'design-library')
      .order('id')
      .range(from, from + 999)
    if (COLLECTION) q = q.eq('metadata->>collection', COLLECTION)
    const { data, error } = await q
    if (error) throw new Error(`fetch failed: ${error.message}`)
    rows.push(...(data || []))
    if (!data || data.length < 1000) break
    from += 1000
  }
  return LIMIT ? rows.slice(0, LIMIT) : rows
}

/**
 * The on-disk folder a design came from. import_key is "<dir>/<design-id>",
 * where <dir> is the raw folder name ("41. American Patriots vol2").
 */
function localDirFor(product) {
  const importKey = product.metadata?.import_key
  if (!importKey || !importKey.includes('/')) return null
  return path.join(DESIGN_ROOT, importKey.slice(0, importKey.lastIndexOf('/')))
}

async function repair(product, stats) {
  const meta = { ...(product.metadata || {}) }
  const patch = {}
  let metaChanged = false

  // ---- 1. permanent image URLs -------------------------------------------
  const gcsPath = meta.gcs_path || gcsPathFromUrl((product.images || [])[0])
  if (DO_URLS && Array.isArray(product.images) && product.images.length) {
    // --force-urls also re-points URLs that are already permanent, which is how
    // you switch the whole catalog between the /api/media proxy and direct
    // public GCS URLs (see MEDIA_PUBLIC_BASE in scripts/lib/design-media.mjs).
    const rewritten = product.images.map(url => {
      if (!isExpiringUrl(url) && !FORCE_URLS) return url
      const objectPath = gcsPathFromUrl(url)
      return objectPath ? stableMediaUrl(objectPath) : url
    })
    if (rewritten.some((url, i) => url !== product.images[i])) {
      patch.images = rewritten
      stats.urls++
    }
    if (!meta.gcs_path && gcsPath) {
      meta.gcs_path = gcsPath
      metaChanged = true
    }
  }

  // ---- 2. pixel dimensions + DPI ------------------------------------------
  if (DO_DIMS && !meta.image?.width_px) {
    if (!gcsPath) {
      stats.dimsSkipped++
    } else {
      try {
        // Prefer the local original (free); fall back to the copy in the bucket.
        const dir = localDirFor(product)
        const localPng = dir && meta.design_id ? path.join(dir, `${meta.design_id}.png`) : null
        const buffer = localPng && fs.existsSync(localPng)
          ? fs.readFileSync(localPng)
          : (await bucket.file(gcsPath).download())[0]
        meta.image = await readImageStats(buffer)
        metaChanged = true
        stats.dims++
        if (meta.image.printable === false) stats.lowRes.push(`${product.slug} (${meta.image.width_px}×${meta.image.height_px})`)
      } catch (err) {
        stats.dimsFailed++
        if (stats.dimsFailed <= 5) console.error(`  [dims] ${product.slug}: ${err.message}`)
      }
    }
  }

  // ---- 3. reachable original source files ---------------------------------
  if (DO_SOURCES) {
    const needsSources = !meta.source_files ||
      Object.keys(meta.source_files).length === 0 ||
      sourceFilesAreLocalPaths(meta.source_files)
    if (needsSources) {
      const dir = localDirFor(product)
      if (!dir || !meta.design_id || !fs.existsSync(dir)) {
        stats.sourcesSkipped++
      } else {
        try {
          const collectionSlug = slugify(meta.collection || '')
          const { sourceFiles, skipped } = await uploadSources(bucket, {
            dirPath: dir,
            designId: meta.design_id,
            collectionSlug,
            includePsd: INCLUDE_PSD,
            maxBytes: SOURCE_MAX_BYTES,
            dryRun: DRY_RUN
          })
          if (Object.keys(sourceFiles).length) {
            meta.source_files = sourceFiles
            if (skipped.length) meta.source_files_skipped = skipped
            metaChanged = true
            stats.sources++
            stats.sourceFileCount += Object.keys(sourceFiles).length
          } else {
            stats.sourcesEmpty++
          }
        } catch (err) {
          stats.sourcesFailed++
          if (stats.sourcesFailed <= 5) console.error(`  [sources] ${product.slug}: ${err.message}`)
        }
      }
    }
  }

  if (metaChanged) {
    meta.media_version = 2
    meta.media_backfilled_at = new Date().toISOString()
    patch.metadata = meta
  }

  if (!Object.keys(patch).length) {
    stats.unchanged++
    return
  }
  if (DRY_RUN) {
    stats.wouldUpdate++
    return
  }

  const { error } = await supabase.from('products').update(patch).eq('id', product.id)
  if (error) {
    stats.updateFailed++
    console.error(`  [update] ${product.slug}: ${error.message}`)
  } else {
    stats.updated++
  }
}

async function verify(sampleSize) {
  const rows = await fetchAllDesignProducts()
  // Spread the sample across the catalog rather than taking the first N.
  const step = Math.max(1, Math.floor(rows.length / sampleSize))
  const sample = rows.filter((_, i) => i % step === 0).slice(0, sampleSize)

  console.log(`\n🔍 Verifying ${sample.length} of ${rows.length} design-library products\n`)
  let ok = 0
  for (const p of sample) {
    const url = (p.images || [])[0] || ''
    const meta = p.metadata || {}
    const stableUrl = url.includes('/api/media/')
    const expiring = isExpiringUrl(url)
    const dims = meta.image?.width_px ? `${meta.image.width_px}×${meta.image.height_px}` : '—'
    const dpi = meta.image?.dpi ? `${meta.image.dpi}dpi` : 'dpi:unset'
    const sourceKeys = Object.keys(meta.source_files || {})
    const sourcesOk = sourceKeys.length > 0 && !sourceFilesAreLocalPaths(meta.source_files)

    // --base http://localhost:4321 checks the URLs against a locally running
    // API, so the backfill can be verified before the route is deployed.
    const baseOverride = opt('base')
    const fetchUrl = baseOverride
      ? url.replace(/^https?:\/\/[^/]+/, baseOverride.replace(/\/+$/, ''))
      : url

    let reachable = 'n/a'
    if (stableUrl) {
      try {
        const r = await fetch(fetchUrl, { redirect: 'follow', method: 'GET', headers: { Range: 'bytes=0-64' } })
        reachable = r.ok ? `HTTP ${r.status}` : `HTTP ${r.status} ✗`
        if (r.ok) ok++
      } catch (e) {
        reachable = `unreachable (${e.message})`
      }
    }

    console.log(
      `${stableUrl ? '✅' : expiring ? '⏳' : '❔'} ${p.slug.padEnd(42).slice(0, 42)} ` +
      `${dims.padEnd(12)} ${dpi.padEnd(11)} ` +
      `src:${sourcesOk ? sourceKeys.join('/') : (sourceKeys.length ? 'LOCAL-PATHS' : 'none')}`.padEnd(26) +
      ` ${reachable}`
    )
  }
  console.log(`\n${ok}/${sample.length} sampled images fetched successfully through the permanent URL.`)
}

async function run() {
  const verifyN = Number(opt('verify') || 0)
  if (verifyN) return verify(verifyN)

  const steps = [DO_URLS && 'urls', DO_DIMS && 'dims', DO_SOURCES && `sources(${INCLUDE_PSD ? 'incl. psd' : 'vectors+jpg'})`]
    .filter(Boolean).join(' + ')
  console.log(`Backfill: ${steps}${DRY_RUN ? ' — DRY RUN' : ''}${COLLECTION ? ` — collection "${COLLECTION}"` : ''}`)

  const rows = await fetchAllDesignProducts()
  console.log(`Loaded ${rows.length} design-library product(s)\n`)

  const stats = {
    urls: 0, dims: 0, dimsFailed: 0, dimsSkipped: 0,
    sources: 0, sourceFileCount: 0, sourcesFailed: 0, sourcesSkipped: 0, sourcesEmpty: 0,
    updated: 0, updateFailed: 0, unchanged: 0, wouldUpdate: 0, lowRes: []
  }
  const started = Date.now()

  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    await Promise.all(rows.slice(i, i + CONCURRENCY).map(p =>
      repair(p, stats).catch(err => {
        stats.updateFailed++
        console.error(`  ❌ ${p.slug}: ${err.message}`)
      })
    ))
    const done = Math.min(i + CONCURRENCY, rows.length)
    if (done % 200 < CONCURRENCY || done === rows.length) {
      console.log(`  … ${done}/${rows.length} — ${stats.updated} updated, ${stats.unchanged} already good (${Math.round((Date.now() - started) / 1000)}s)`)
    }
  }

  console.log('\n' + '='.repeat(62))
  console.log(`URLs made permanent : ${stats.urls}`)
  console.log(`Dimensions recorded : ${stats.dims} (failed ${stats.dimsFailed}, no gcs_path ${stats.dimsSkipped})`)
  if (DO_SOURCES) {
    console.log(`Source sets uploaded: ${stats.sources} (${stats.sourceFileCount} files, failed ${stats.sourcesFailed}, folder missing ${stats.sourcesSkipped}, none on disk ${stats.sourcesEmpty})`)
  }
  console.log(DRY_RUN ? `Would update        : ${stats.wouldUpdate}` : `Rows updated        : ${stats.updated} (failed ${stats.updateFailed})`)
  console.log(`Already correct     : ${stats.unchanged}`)
  if (stats.lowRes.length) {
    console.log(`\n⚠️  ${stats.lowRes.length} design(s) below 1200px on the short edge — too small to print cleanly:`)
    console.log('   ' + stats.lowRes.slice(0, 20).join('\n   ') + (stats.lowRes.length > 20 ? `\n   … +${stats.lowRes.length - 20} more` : ''))
  }
  console.log('='.repeat(62))
  console.log(`Done in ${Math.round((Date.now() - started) / 1000)}s. Spot check with: node scripts/backfill-design-library-media.mjs --verify 20`)
}

run().catch(err => { console.error('FATAL:', err); process.exit(1) })
