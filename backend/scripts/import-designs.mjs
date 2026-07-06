// ---------------------------------------------------------------------------
// Design-library importer: walks David's local design bundle
// (E:\Business\Imagine-This-Printed\Imagine This Printed (Designs)),
// uploads each design's transparent PNG to GCS, names/categorizes it with
// gpt-4o-mini vision (detail:low — pennies per design), and creates catalogued
// DRAFT products (status flips per collection via --activate after review).
//
// Idempotent: each design carries metadata.import_key = "<dir>/<file-id>";
// re-runs skip anything already imported.
//
// Usage (from backend/, reads backend/.env):
//   node scripts/import-designs.mjs --dir Gaming --limit 2      # smoke test
//   node scripts/import-designs.mjs --all                       # full run
//   node scripts/import-designs.mjs --activate Gaming           # go live
//   node scripts/import-designs.mjs --status                    # counts
// ---------------------------------------------------------------------------
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { Storage } from '@google-cloud/storage'
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'

const DESIGN_ROOT = process.env.DESIGN_LIBRARY_ROOT ||
  'E:\\Business\\Imagine-This-Printed\\Imagine This Printed (Designs)'
const PRICE = Number(process.env.IMPORT_PRICE || 24.99)
const SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL']
const COLORS = ['Black', 'White']
const CONCURRENCY = 3

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const storage = new Storage({
  projectId: process.env.GCS_PROJECT_ID,
  credentials: process.env.GCS_CREDENTIALS ? JSON.parse(process.env.GCS_CREDENTIALS) : undefined
})
const bucket = storage.bucket(process.env.GCS_BUCKET_NAME || 'imagine-this-printed-main')
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const opt = (name) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null
}

const slugify = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)

// "41. American Patriots vol2" / "Gaming (100 designs)" → "American Patriots vol2" / "Gaming"
const cleanCollection = (dir) => dir.replace(/^\d+\.\s*/, '').replace(/\s*\(\d+\s*designs?\)\s*$/i, '').trim()

async function nameDesign(pngPath, collection) {
  const fallback = {
    title: `${collection} Design ${path.basename(pngPath, '.png')}`,
    description: `${collection}-themed design, custom printed by Imagine This Printed.`,
    tags: [collection.toLowerCase()]
  }
  if (!openai) return fallback
  try {
    const b64 = fs.readFileSync(pngPath).toString('base64')
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      max_tokens: 300,
      messages: [
        {
          role: 'system',
          content: 'You name t-shirt designs for an ecommerce catalog. Look at the design image and reply ONLY with JSON: ' +
            '{"title": string (catchy 3-7 word product name reflecting the design text/imagery, no quotes-in-quotes, no "T-Shirt" suffix), ' +
            '"description": string (1-2 sentences, natural, mentions what the design shows), ' +
            '"tags": string[] (5-8 lowercase search tags)}. Never invent brand names.'
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: `Collection theme: ${collection}` },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}`, detail: 'low' } }
          ]
        }
      ]
    })
    const parsed = JSON.parse(completion.choices[0]?.message?.content || '{}')
    if (!parsed.title) return fallback
    return {
      title: String(parsed.title).slice(0, 90),
      description: String(parsed.description || fallback.description).slice(0, 500),
      tags: Array.isArray(parsed.tags) ? parsed.tags.map(String).slice(0, 8) : fallback.tags
    }
  } catch (err) {
    console.error(`  [ai] naming failed for ${path.basename(pngPath)} (${err.message}) — using fallback`)
    return fallback
  }
}

async function uploadPng(pngPath, collectionSlug, designId) {
  const dest = `design-library/${collectionSlug}/${designId}.png`
  const file = bucket.file(dest)
  await file.save(fs.readFileSync(pngPath), { contentType: 'image/png', resumable: false })
  const [signedUrl] = await file.getSignedUrl({ action: 'read', expires: Date.now() + 365 * 24 * 60 * 60 * 1000 })
  return { publicUrl: signedUrl, path: dest }
}

async function loadExisting() {
  const keys = new Set()
  const slugs = new Set()
  let from = 0
  for (;;) {
    const { data, error } = await supabase
      .from('products')
      .select('slug, metadata')
      .range(from, from + 999)
    if (error) throw new Error(`preload failed: ${error.message}`)
    for (const row of data || []) {
      if (row.slug) slugs.add(row.slug)
      if (row.metadata?.import_key) keys.add(row.metadata.import_key)
    }
    if (!data || data.length < 1000) break
    from += 1000
  }
  return { keys, slugs }
}

function uniqueSlug(base, slugs) {
  let s = base || 'design'
  let n = 2
  while (slugs.has(s)) s = `${base}-${n++}`
  slugs.add(s)
  return s
}

async function importDesign(dir, pngName, existing, stats) {
  const designId = path.basename(pngName, '.png')
  const importKey = `${dir}/${designId}`
  if (existing.keys.has(importKey)) { stats.skipped++; return }

  const collection = cleanCollection(dir)
  const collectionSlug = slugify(collection)
  const pngPath = path.join(DESIGN_ROOT, dir, pngName)

  const [named, uploaded] = await Promise.all([
    nameDesign(pngPath, collection),
    uploadPng(pngPath, collectionSlug, designId)
  ])

  const sourceFiles = {}
  for (const ext of ['ai', 'svg', 'psd', 'jpg']) {
    const p = path.join(DESIGN_ROOT, dir, `${designId}.${ext}`)
    if (fs.existsSync(p)) sourceFiles[ext] = p
  }

  const slug = uniqueSlug(slugify(named.title), existing.slugs)
  const { data: product, error } = await supabase
    .from('products')
    .insert({
      name: named.title,
      slug,
      description: named.description,
      price: PRICE,
      images: [uploaded.publicUrl],
      category: 'shirts',
      status: 'draft',
      print_locations: ['front_image'],
      sizes: SIZES,
      colors: COLORS,
      is_user_generated: false,
      metadata: {
        import_source: 'design-library',
        import_key: importKey,
        collection,
        design_id: designId,
        gcs_path: uploaded.path,
        source_files: sourceFiles,
        ai_tags: named.tags,
        imported_at: new Date().toISOString()
      }
    })
    .select('id')
    .single()
  if (error) throw new Error(`insert failed for ${importKey}: ${error.message}`)

  const tags = [...new Set([...named.tags, collection.toLowerCase()])]
  await supabase.from('product_tags').insert(tags.map(tag => ({ product_id: product.id, tag })))

  existing.keys.add(importKey)
  stats.imported++
}

async function run() {
  if (flag('status')) {
    const { data } = await supabase
      .from('products')
      .select('status, metadata')
      .eq('metadata->>import_source', 'design-library')
    const byCollection = {}
    for (const p of data || []) {
      const c = p.metadata?.collection || '?'
      byCollection[c] = byCollection[c] || { draft: 0, active: 0 }
      byCollection[c][p.status === 'active' ? 'active' : 'draft']++
    }
    console.table(byCollection)
    console.log(`total imported: ${(data || []).length}`)
    return
  }

  const activate = opt('activate')
  if (activate) {
    const { data, error } = await supabase
      .from('products')
      .update({ status: 'active' })
      .eq('metadata->>import_source', 'design-library')
      .ilike('metadata->>collection', `%${activate}%`)
      .eq('status', 'draft')
      .select('id')
    if (error) throw new Error(error.message)
    console.log(`✅ Activated ${data?.length ?? 0} products in collections matching "${activate}" (SEO packs generate on the worker's next hourly sweep)`)
    return
  }

  const dirFilter = opt('dir')
  const limit = Number(opt('limit') || 0)
  const dirs = fs.readdirSync(DESIGN_ROOT, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .filter(d => !dirFilter || d.toLowerCase().includes(dirFilter.toLowerCase()))
  if (!dirs.length) { console.error('No matching collection folders'); process.exit(1) }

  console.log(`Importing from ${dirs.length} collection(s)${limit ? ` (limit ${limit}/collection)` : ''} — price $${PRICE}, status draft`)
  const existing = await loadExisting()
  console.log(`Preloaded ${existing.keys.size} already-imported keys, ${existing.slugs.size} slugs`)

  const stats = { imported: 0, skipped: 0, failed: 0 }
  const started = Date.now()

  for (const dir of dirs) {
    let pngs = fs.readdirSync(path.join(DESIGN_ROOT, dir)).filter(f => f.toLowerCase().endsWith('.png')).sort()
    if (limit) pngs = pngs.slice(0, limit)
    console.log(`\n📁 ${dir} — ${pngs.length} design(s)`)
    for (let i = 0; i < pngs.length; i += CONCURRENCY) {
      await Promise.all(pngs.slice(i, i + CONCURRENCY).map(png =>
        importDesign(dir, png, existing, stats).catch(err => {
          stats.failed++
          console.error(`  ❌ ${dir}/${png}: ${err.message}`)
        })
      ))
      const done = stats.imported + stats.skipped + stats.failed
      if (done % 25 < CONCURRENCY) console.log(`  … ${stats.imported} imported / ${stats.skipped} skipped / ${stats.failed} failed (${Math.round((Date.now() - started) / 1000)}s)`)
    }
  }

  console.log(`\n✅ DONE: ${stats.imported} imported, ${stats.skipped} skipped (already in), ${stats.failed} failed, ${Math.round((Date.now() - started) / 60000)} min`)
  console.log('Products are DRAFT. Review in /admin?tab=products, then: node scripts/import-designs.mjs --activate "<collection>"')
}

run().catch(err => { console.error('FATAL:', err); process.exit(1) })
