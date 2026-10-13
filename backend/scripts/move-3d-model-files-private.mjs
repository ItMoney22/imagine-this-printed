#!/usr/bin/env node
// Move the paid 3D model files out of the public bucket (Watchtower task 1417e863, 2026-10-07).
//
// model.stl / model.glb under 3d-models/<id>/ in imagine-this-printed-main answered HTTP 200 to anyone
// by plain path, and the toy page shows every toy's id. They are PAID deliverables (the license route
// in routes/3d-models.ts sells them for 200/500 ITC) and the print floor's source files.
//
// This:
//   1. copies every 3d-models/<id>/model.(stl|glb) to the PRIVATE bucket (PRINT_FILES_BUCKET, default
//      imagine-this-printed-products) at the same path, and checks size + md5 of every copy;
//   2. rewrites every DB value that pointed at an original to a gs:// reference to the copy
//      (services/model-files.ts signs those on read):
//        user_3d_models.glb_url / stl_url, products.metadata.print3d.glb_url / stl_url (+ legacy
//        metadata.glb_url), ai_jobs.output.glb_url / stl_url (job history);
//   3. with --delete-public, re-checks that no DB value still points at a public original, then deletes
//      the originals. That also kills every signed URL ever handed out for them. The main bucket keeps
//      soft-deleted objects 7 days (gcloud storage restore gs://imagine-this-printed-main/<path>#<gen>).
// concept.png and the angle PNGs stay public: the toy page shows them.
//
// Idempotent: a copy that already exists with the same md5 is reused; a value already a gs:// ref is
// left alone. Dry run unless --apply. Never prints a signed URL.
//
// Usage (from backend/):
//   node scripts/move-3d-model-files-private.mjs --env <path to backend/.env> [--apply] [--delete-public]
//        [--manifest <out.json>] [--before <metadata-before.json>]
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
const BEFORE = opt('--before')
const PUBLIC_BUCKET = process.env.GCS_BUCKET_NAME || 'imagine-this-printed-main'
const PRIVATE_BUCKET = process.env.PRINT_FILES_BUCKET || 'imagine-this-printed-products'
const MESH_RE = /^3d-models\/[^/]+\/model\.(stl|glb)$/

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const storage = new Storage({
  projectId: process.env.GCS_PROJECT_ID,
  credentials: process.env.GCS_CREDENTIALS ? JSON.parse(process.env.GCS_CREDENTIALS) : undefined,
})

const ref = (path) => `gs://${PRIVATE_BUCKET}/${path}`
const stripSig = (v) => (typeof v === 'string' ? v.replace(/\?.*$/, '') : v)

/** Public-bucket mesh path a stored value points at, or null. */
function publicMeshPathOf(value) {
  if (typeof value !== 'string') return null
  try {
    const u = new URL(value)
    if (u.hostname !== 'storage.googleapis.com') return null
    const m = u.pathname.match(/^\/([^/]+)\/(.+)$/)
    if (!m || m[1] !== PUBLIC_BUCKET) return null
    const path = decodeURIComponent(m[2])
    return MESH_RE.test(path) ? path : null
  } catch {
    return null
  }
}

async function copyToPrivate(path) {
  const src = storage.bucket(PUBLIC_BUCKET).file(path)
  const dest = storage.bucket(PRIVATE_BUCKET).file(path)
  const [srcMeta] = await src.getMetadata()
  const [exists] = await dest.exists()
  if (!exists) await src.copy(dest)
  const [destMeta] = await dest.getMetadata()
  if (String(destMeta.size) !== String(srcMeta.size) || destMeta.md5Hash !== srcMeta.md5Hash) {
    throw new Error(`copy mismatch for ${path}: ${destMeta.size}/${destMeta.md5Hash} vs ${srcMeta.size}/${srcMeta.md5Hash}`)
  }
  return { path, size: Number(destMeta.size), md5: destMeta.md5Hash, content_type: destMeta.contentType, public_generation: String(srcMeta.generation) }
}

/** Every DB value still pointing at a public mesh original. */
async function publicReferences() {
  const found = []
  const { data: models, error: me } = await supabase.from('user_3d_models').select('id, glb_url, stl_url')
  if (me) throw new Error(`user_3d_models read failed: ${me.message}`)
  for (const m of models) for (const k of ['glb_url', 'stl_url']) if (publicMeshPathOf(m[k])) found.push(`user_3d_models.${k} ${m.id}`)
  const { data: prods, error: pe } = await supabase.from('products').select('id, metadata')
    .or('metadata->print3d->>stl_url.not.is.null,metadata->print3d->>glb_url.not.is.null,metadata->>glb_url.not.is.null')
  if (pe) throw new Error(`products read failed: ${pe.message}`)
  for (const p of prods) {
    for (const v of [p.metadata?.print3d?.glb_url, p.metadata?.print3d?.stl_url, p.metadata?.glb_url]) {
      if (publicMeshPathOf(v)) found.push(`products.metadata ${p.id}`)
    }
  }
  const { data: jobs, error: je } = await supabase.from('ai_jobs').select('id, output')
    .or('output->>glb_url.not.is.null,output->>stl_url.not.is.null')
  if (je) throw new Error(`ai_jobs read failed: ${je.message}`)
  for (const j of jobs) for (const k of ['glb_url', 'stl_url']) if (publicMeshPathOf(j.output?.[k])) found.push(`ai_jobs.output.${k} ${j.id}`)
  return { found, models, prods, jobs }
}

async function main() {
  console.log(`mode: ${APPLY ? 'APPLY' : 'dry run'}${DELETE_PUBLIC ? ' + delete public originals' : ''}; ${PUBLIC_BUCKET} -> ${PRIVATE_BUCKET}`)

  const [files] = await storage.bucket(PUBLIC_BUCKET).getFiles({ prefix: '3d-models/' })
  const meshes = files.filter(f => MESH_RE.test(f.name)).map(f => f.name)
  console.log(`public mesh originals: ${meshes.length}`)

  const { found, models, prods, jobs } = await publicReferences()
  console.log(`DB values pointing at them: ${found.length}`)

  const manifest = { task: '1417e863', ran_at: new Date().toISOString(), apply: APPLY, delete_public: DELETE_PUBLIC, public_bucket: PUBLIC_BUCKET, private_bucket: PRIVATE_BUCKET, files: [], rows: [], deleted: [] }

  if (BEFORE && APPLY) {
    // What the rows held before, signatures stripped, so a revert knows the old shape.
    fs.writeFileSync(BEFORE, JSON.stringify({
      task: '1417e863', saved_at: new Date().toISOString(),
      user_3d_models: models.filter(m => m.glb_url || m.stl_url).map(m => ({ id: m.id, glb_url: stripSig(m.glb_url), stl_url: stripSig(m.stl_url) })),
      products: prods.map(p => ({ id: p.id, print3d: { glb_url: stripSig(p.metadata?.print3d?.glb_url), stl_url: stripSig(p.metadata?.print3d?.stl_url) }, glb_url: stripSig(p.metadata?.glb_url) })),
      ai_jobs: jobs.filter(j => j.output?.glb_url || j.output?.stl_url).map(j => ({ id: j.id, glb_url: stripSig(j.output?.glb_url), stl_url: stripSig(j.output?.stl_url) })),
    }, null, 2))
    console.log(`before-state: ${BEFORE}`)
  }

  if (!APPLY) {
    for (const p of meshes) console.log(`  would copy ${p}`)
    for (const f of found) console.log(`  would rewrite ${f}`)
    return
  }

  // 1. copy + verify
  const copied = new Map()
  for (const path of meshes) {
    const c = await copyToPrivate(path)
    copied.set(path, c)
    manifest.files.push(c)
    console.log(`  copied ${path} (${c.size} B, md5 ${c.md5})`)
  }

  const refFor = (value) => {
    const path = publicMeshPathOf(value)
    if (!path) return value
    if (!copied.has(path)) throw new Error(`a DB value points at ${path}, which has no verified private copy`)
    return ref(path)
  }

  // 2. rewrite DB values
  for (const m of models) {
    const next = { glb_url: refFor(m.glb_url), stl_url: refFor(m.stl_url) }
    if (next.glb_url === m.glb_url && next.stl_url === m.stl_url) continue
    const { error } = await supabase.from('user_3d_models').update(next).eq('id', m.id)
    if (error) throw new Error(`user_3d_models update failed for ${m.id}: ${error.message}`)
    manifest.rows.push({ table: 'user_3d_models', id: m.id, glb_url: next.glb_url, stl_url: next.stl_url })
  }
  for (const p of prods) {
    // Read-modify-write: a PATCH of metadata replaces the whole jsonb.
    const { data: fresh, error: re } = await supabase.from('products').select('metadata').eq('id', p.id).single()
    if (re) throw new Error(`products re-read failed for ${p.id}: ${re.message}`)
    const meta = { ...(fresh.metadata || {}) }
    const before = JSON.stringify(meta)
    if (meta.print3d && typeof meta.print3d === 'object') {
      meta.print3d = { ...meta.print3d, glb_url: refFor(meta.print3d.glb_url), stl_url: refFor(meta.print3d.stl_url) }
    }
    if (meta.glb_url) meta.glb_url = refFor(meta.glb_url)
    if (JSON.stringify(meta) === before) continue
    const { error } = await supabase.from('products').update({ metadata: meta }).eq('id', p.id)
    if (error) throw new Error(`products update failed for ${p.id}: ${error.message}`)
    manifest.rows.push({ table: 'products', id: p.id, print3d_glb_url: meta.print3d?.glb_url ?? null, print3d_stl_url: meta.print3d?.stl_url ?? null })
  }
  for (const j of jobs) {
    const out = { ...(j.output || {}) }
    const next = { ...out, glb_url: refFor(out.glb_url), stl_url: refFor(out.stl_url) }
    if (next.glb_url === out.glb_url && next.stl_url === out.stl_url) continue
    const { error } = await supabase.from('ai_jobs').update({ output: next }).eq('id', j.id)
    if (error) throw new Error(`ai_jobs update failed for ${j.id}: ${error.message}`)
    manifest.rows.push({ table: 'ai_jobs', id: j.id })
  }
  console.log(`rows rewritten: ${manifest.rows.length}`)

  // 3. delete the public originals, only once nothing points at them
  if (DELETE_PUBLIC) {
    const left = (await publicReferences()).found
    if (left.length) throw new Error(`not deleting: ${left.length} DB value(s) still point at public originals: ${left.join(', ')}`)
    for (const path of meshes) {
      const file = storage.bucket(PUBLIC_BUCKET).file(path)
      const [exists] = await file.exists()
      if (!exists) continue
      await file.delete()
      manifest.deleted.push({ path, generation: copied.get(path)?.public_generation })
      console.log(`  deleted public ${path} (soft-deleted 7 days)`)
    }
  }

  if (MANIFEST) {
    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2))
    console.log(`manifest: ${MANIFEST}`)
  }
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
