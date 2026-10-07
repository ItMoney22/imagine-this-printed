#!/usr/bin/env node
// Move creator print files out of the public products row (Watchtower task b312de9c, 2026-10-07).
//
// Before this task a Merch Studio publish wrote the creator's print-ready PNG into
// products.metadata.print_files / assets.clean / assets.dtf (/ assets.back_print) as a 1-year signed
// URL to the PUBLIC bucket (imagine-this-printed-main: allUsers objectViewer, so the plain path and a
// bucket listing both hand it out). products is readable with the site's anon key.
//
// For every creator product (metadata.source 'merch-studio') still carrying those keys, this:
//   1. copies each print file into the PRIVATE bucket (PRINT_FILES_BUCKET, default
//      imagine-this-printed-products) under print-files/<old path>, and checks the copy's size;
//   2. records bucket + paths in product_print_files (service role only);
//   3. strips print_files, assets.clean, assets.dtf, assets.back_print from the public row and sets
//      metadata.print_file_placements. Also strips assets.display: approval used to make it from the
//      print file — the full design at 3072x4096 with one small corner watermark, i.e. a printable copy.
//      A creator's page shows only garment photos (src/lib/product-kind.ts), so nothing needs it;
//   4. with --delete-public, deletes the old public objects (print files + that display copy), which
//      also kills every signed URL ever handed out for them. The main bucket keeps soft-deleted objects
//      7 days (gcloud storage restore gs://imagine-this-printed-main/<path>#<generation>).
//
// Idempotent: a product already in product_print_files is not copied again; a row with nothing left to
// strip is skipped. Dry run unless --apply. Never prints a signed URL.
//
// Usage (from backend/):
//   node scripts/move-creator-print-files-private.mjs --env <path to backend/.env> [--apply] [--delete-public] [--manifest <file.json>]
import fs from 'node:fs'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { Storage } from '@google-cloud/storage'

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }

// override:true — an inherited shell env must not shadow backend/.env (see import-designs.mjs).
dotenv.config({ path: opt('--env') || '.env', override: true })

const APPLY = flag('--apply')
const DELETE_PUBLIC = flag('--delete-public')
const MANIFEST = opt('--manifest')
const PUBLIC_BUCKET = process.env.GCS_BUCKET_NAME || 'imagine-this-printed-main'
const PRIVATE_BUCKET = process.env.PRINT_FILES_BUCKET || 'imagine-this-printed-products'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const storage = new Storage({
  projectId: process.env.GCS_PROJECT_ID,
  credentials: process.env.GCS_CREDENTIALS ? JSON.parse(process.env.GCS_CREDENTIALS) : undefined,
})

/** bucket + object path from a stored GCS URL (signed or plain); null if it is not one. */
function gcsObjectOf(url) {
  if (typeof url !== 'string') return null
  try {
    const u = new URL(url)
    if (u.hostname !== 'storage.googleapis.com') return null
    const m = u.pathname.match(/^\/([^/]+)\/(.+)$/)
    return m ? { bucket: m[1], path: decodeURIComponent(m[2]) } : null
  } catch {
    return null
  }
}

/** The print files a legacy row points at, by placement. */
function legacyPrintFiles(metadata) {
  const assets = metadata?.assets && typeof metadata.assets === 'object' ? metadata.assets : {}
  const pf = metadata?.print_files && typeof metadata.print_files === 'object' ? metadata.print_files : {}
  const front = gcsObjectOf(pf.front) || gcsObjectOf(assets.dtf) || gcsObjectOf(assets.clean)
  const back = gcsObjectOf(pf.back) || gcsObjectOf(assets.back_print)
  return { front, back }
}

const STRIP_ASSET_KEYS = ['clean', 'dtf', 'back_print', 'display']

function strippedMetadata(metadata, placements) {
  const { print_files: _drop, ...rest } = metadata || {}
  const assets = { ...(rest.assets || {}) }
  for (const k of STRIP_ASSET_KEYS) delete assets[k]
  return { ...rest, assets, print_file_placements: placements }
}

function needsWork(metadata) {
  const assets = metadata?.assets || {}
  return !!metadata?.print_files || STRIP_ASSET_KEYS.some(k => k in assets)
}

async function copyToPrivate(src) {
  const destPath = `print-files/${src.path}`
  const dest = storage.bucket(PRIVATE_BUCKET).file(destPath)
  const [srcMeta] = await storage.bucket(src.bucket).file(src.path).getMetadata()
  const [exists] = await dest.exists()
  if (!exists) await storage.bucket(src.bucket).file(src.path).copy(dest)
  const [destMeta] = await dest.getMetadata()
  // The public original may be deleted in this same run, so the copy must be
  // byte-identical first.
  if (String(destMeta.size) !== String(srcMeta.size) || destMeta.md5Hash !== srcMeta.md5Hash) {
    throw new Error(`copy mismatch for ${destPath}: ${destMeta.size}/${destMeta.md5Hash} vs ${srcMeta.size}/${srcMeta.md5Hash}`)
  }
  return { path: destPath, size: Number(destMeta.size), md5: destMeta.md5Hash, srcGeneration: String(srcMeta.generation) }
}

async function main() {
  console.log(`mode: ${APPLY ? 'APPLY' : 'dry run'}${DELETE_PUBLIC ? ' + delete public objects' : ''}; private bucket ${PRIVATE_BUCKET}`)

  const { data: rows, error } = await supabase
    .from('products')
    .select('id, name, status, metadata')
    .eq('metadata->>source', 'merch-studio')
  if (error) throw new Error(`products read failed: ${error.message}`)

  const { data: existing, error: refsError } = await supabase
    .from('product_print_files')
    .select('product_id, bucket, front_path, back_path')
    .in('product_id', (rows || []).map(r => r.id))
  if (refsError) throw new Error(`product_print_files read failed (is the migration applied?): ${refsError.message}`)
  const refsById = new Map((existing || []).map(r => [r.product_id, r]))

  const manifest = []
  for (const row of rows || []) {
    const entry = { product_id: row.id, name: row.name, status: row.status, actions: [] }
    manifest.push(entry)
    const { front, back } = legacyPrintFiles(row.metadata)
    const display = gcsObjectOf(row.metadata?.assets?.display)
    entry.public_objects = [front, back, display].filter(Boolean).map(o => `${o.bucket}/${o.path}`)

    if (!needsWork(row.metadata) && refsById.has(row.id)) {
      entry.actions.push('already private, nothing to strip')
      console.log(`- ${row.id} "${row.name}": already done`)
      continue
    }
    if (!front && !refsById.has(row.id)) {
      entry.actions.push('SKIPPED: no front print file found and no private record')
      console.log(`! ${row.id} "${row.name}": no front print file to move — left untouched`)
      continue
    }
    if (front && front.bucket !== PUBLIC_BUCKET) {
      entry.actions.push(`note: front was in bucket ${front.bucket}`)
    }

    console.log(`- ${row.id} "${row.name}" [${row.status}]: front=${front ? `${front.bucket}/${front.path}` : '(private already)'}${back ? ` back=${back.bucket}/${back.path}` : ''}${display ? ` display=${display.bucket}/${display.path}` : ''}`)
    if (!APPLY) { entry.actions.push('dry run'); continue }

    let refs = refsById.get(row.id)
    if (!refs) {
      const frontCopy = await copyToPrivate(front)
      const backCopy = back ? await copyToPrivate(back) : null
      entry.private_front = frontCopy
      if (backCopy) entry.private_back = backCopy
      refs = { product_id: row.id, bucket: PRIVATE_BUCKET, front_path: frontCopy.path, back_path: backCopy?.path ?? null }
      const { error: upsertError } = await supabase
        .from('product_print_files')
        .upsert({ ...refs, source: 'merch-studio', updated_at: new Date().toISOString() }, { onConflict: 'product_id' })
      if (upsertError) throw new Error(`product_print_files write failed for ${row.id}: ${upsertError.message}`)
      entry.actions.push(`copied to ${PRIVATE_BUCKET} + recorded`)
    }

    const placements = refs.back_path ? ['front', 'back'] : ['front']
    entry.removed_metadata_keys = ['print_files', ...STRIP_ASSET_KEYS.map(k => `assets.${k}`)]
      .filter(k => k === 'print_files' ? !!row.metadata?.print_files : (k.split('.')[1] in (row.metadata?.assets || {})))
    const { error: updateError } = await supabase
      .from('products')
      .update({ metadata: strippedMetadata(row.metadata, placements) })
      .eq('id', row.id)
    if (updateError) throw new Error(`products update failed for ${row.id}: ${updateError.message}`)
    entry.actions.push(`public row stripped (${entry.removed_metadata_keys.join(', ')}), print_file_placements=${placements.join('+')}`)

    if (DELETE_PUBLIC) {
      for (const obj of [front, back, display].filter(Boolean)) {
        if (obj.bucket !== PUBLIC_BUCKET) continue
        const file = storage.bucket(obj.bucket).file(obj.path)
        const [exists] = await file.exists()
        if (exists) {
          await file.delete()
          entry.actions.push(`deleted public ${obj.bucket}/${obj.path} (soft-deleted 7 days)`)
        }
      }
    }
  }

  if (MANIFEST) {
    fs.writeFileSync(MANIFEST, JSON.stringify({ task: 'b312de9c', ran_at: new Date().toISOString(), apply: APPLY, delete_public: DELETE_PUBLIC, private_bucket: PRIVATE_BUCKET, products: manifest }, null, 2))
    console.log(`manifest: ${MANIFEST}`)
  }
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
