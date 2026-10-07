#!/usr/bin/env node
// Move the design-library originals out of the public bucket (Watchtower task 1417e863, 2026-10-07).
//
// design-sources/<collection>/<NNN>.(ai|eps|psd|svg|jpg|dxf) are the editable masters behind ~2,400
// catalog designs (25+ GB). In imagine-this-printed-main anyone could read them by plain path, and the
// names are sequential (001.ai, 002.ai, ...), so every one was guessable; routes/media.ts also proxied
// the prefix publicly. No app code reads them (only the importer writes them).
//
// This copies every object to the PRIVATE bucket (PRINT_FILES_BUCKET, default
// imagine-this-printed-products) at the same path, checks size + md5 of each copy, and with
// --delete-public deletes each original once its copy is verified. The main bucket keeps soft-deleted
// objects 7 days (gcloud storage restore gs://imagine-this-printed-main/<path>#<generation>).
// products.metadata.source_files keeps gcs_path (still right: same path, private bucket); its old
// /api/media/ url field now answers 404.
//
// Resumable and idempotent: a copy that already exists with the same md5 is reused. Dry run unless
// --apply. Server-side copies: no file passes through this machine.
//
// Usage (from backend/):
//   node scripts/move-design-sources-private.mjs --env <path to backend/.env> [--apply] [--delete-public]
//        [--concurrency 16] [--manifest <out.json>]
import fs from 'node:fs'
import dotenv from 'dotenv'
import { Storage } from '@google-cloud/storage'

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }

dotenv.config({ path: opt('--env') || '.env', override: true })

const APPLY = flag('--apply')
const DELETE_PUBLIC = flag('--delete-public')
const MANIFEST = opt('--manifest')
const CONCURRENCY = Math.max(1, Math.min(64, Number(opt('--concurrency')) || 16))
const PREFIX = 'design-sources/'
const PUBLIC_BUCKET = process.env.GCS_BUCKET_NAME || 'imagine-this-printed-main'
const PRIVATE_BUCKET = process.env.PRINT_FILES_BUCKET || 'imagine-this-printed-products'

const storage = new Storage({
  projectId: process.env.GCS_PROJECT_ID,
  credentials: process.env.GCS_CREDENTIALS ? JSON.parse(process.env.GCS_CREDENTIALS) : undefined,
})

async function moveOne(srcFile) {
  const path = srcFile.name
  const src = srcFile.metadata
  const dest = storage.bucket(PRIVATE_BUCKET).file(path)
  let [exists] = await dest.exists()
  if (exists) {
    const [m] = await dest.getMetadata()
    if (m.md5Hash !== src.md5Hash || String(m.size) !== String(src.size)) exists = false
  }
  if (!exists) await srcFile.copy(dest)
  const [destMeta] = await dest.getMetadata()
  if (String(destMeta.size) !== String(src.size) || destMeta.md5Hash !== src.md5Hash) {
    throw new Error(`copy mismatch for ${path}: ${destMeta.size}/${destMeta.md5Hash} vs ${src.size}/${src.md5Hash}`)
  }
  let deleted = false
  if (DELETE_PUBLIC) {
    await srcFile.delete()
    deleted = true
  }
  return { path, size: Number(src.size), md5: src.md5Hash, public_generation: String(src.generation), deleted }
}

async function main() {
  console.log(`mode: ${APPLY ? 'APPLY' : 'dry run'}${DELETE_PUBLIC ? ' + delete public originals' : ''}; ${PUBLIC_BUCKET}/${PREFIX} -> ${PRIVATE_BUCKET}; concurrency ${CONCURRENCY}`)
  const [files] = await storage.bucket(PUBLIC_BUCKET).getFiles({ prefix: PREFIX })
  const bytes = files.reduce((n, f) => n + Number(f.metadata.size), 0)
  console.log(`public originals: ${files.length} (${(bytes / 1e9).toFixed(2)} GB)`)
  if (!APPLY) return

  const results = []
  const failures = []
  let next = 0
  let done = 0
  const started = Date.now()
  async function worker() {
    while (next < files.length) {
      const f = files[next++]
      try {
        results.push(await moveOne(f))
      } catch (e) {
        failures.push({ path: f.name, error: e.message })
      }
      if (++done % 250 === 0) console.log(`  ${done}/${files.length} (${Math.round((Date.now() - started) / 1000)}s, ${failures.length} failed)`)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  const movedBytes = results.reduce((n, r) => n + r.size, 0)
  console.log(`verified copies: ${results.length} (${(movedBytes / 1e9).toFixed(2)} GB); deleted originals: ${results.filter(r => r.deleted).length}; failures: ${failures.length}`)
  for (const f of failures.slice(0, 20)) console.log(`  FAILED ${f.path}: ${f.error}`)

  if (MANIFEST) {
    fs.writeFileSync(MANIFEST, JSON.stringify({ task: '1417e863', ran_at: new Date().toISOString(), apply: APPLY, delete_public: DELETE_PUBLIC, public_bucket: PUBLIC_BUCKET, private_bucket: PRIVATE_BUCKET, count: results.length, bytes: movedBytes, failures, files: results }, null, 1))
    console.log(`manifest: ${MANIFEST}`)
  }
  if (failures.length) process.exit(2)
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
