#!/usr/bin/env node
// Move the last private files out of the public bucket (Watchtower task 4c100f9f, 2026-11-04).
//
// imagine-this-printed-main answers any plain path to anyone. Follow-up of 1417e863: this moves
//   email        users/inbound/email-attachments/   inbound attachments
//   digital      digital-products/                  digital product files
//   uploads      users/<id>/uploads/, users/pet-ornaments/photos/   files customers hand us
//   print-ready  print-ready/                       full-size press files
// to the PRIVATE bucket at the same path. Live mockups under users/ stay where they are.
//
// For each group: copy, check size + md5, rewrite the rows that point at the originals, then with
// --delete-public scan every text column for anything still pointing at an original and delete only
// if nothing does. The main bucket keeps deleted objects 7 days:
//   gcloud storage restore gs://imagine-this-printed-main/<path>#<generation>
//
// What a row becomes:
//   email_messages.attachments      a one-year private link, so the live inbox keeps working;
//                                   --to-refs writes gs:// instead (only once routes/email.ts ships)
//   products.file_url               gs:// reference (only the admin form reads it, as text)
//   product_assets.url (print-ready) a one-year private link: ~20 readers use it as a plain URL.
//                                   The public cannot read these rows (migration 20261104190000).
//   products.images, social_outbox.media_urls   the print file is removed
//   products.metadata               print_upscale gets gs://, print_artwork a link
//
// product_assets writes fire auto_sync_product_images, which rebuilds products.images from the asset
// rows. So print-ready rows are rewritten in ONE transaction that puts each product's gallery back
// (minus the print file) before commit; nothing ever reads the rebuilt gallery.
//
// Idempotent, resumable, dry run unless --apply. Never prints a signed link.
//
// Usage (from backend/):
//   node scripts/move-last-private-files.mjs --env <path to backend/.env> [--group email,digital,uploads,print-ready]
//        [--apply] [--delete-public] [--to-refs] [--manifest <out.json>] [--before <rows-before.json>]
import fs from 'node:fs'
import dotenv from 'dotenv'
import pg from 'pg'
import { Storage } from '@google-cloud/storage'
import {
  groupOf, publicPathOf, rewriteAttachments, rewriteProductMetadata, withoutMoved,
} from './lib/private-move-rules.mjs'

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }

// override:true: an inherited shell env must not shadow backend/.env (see import-designs.mjs).
dotenv.config({ path: opt('--env') || '.env', override: true })

const APPLY = flag('--apply')
const DELETE_PUBLIC = flag('--delete-public')
const TO_REFS = flag('--to-refs')
const MANIFEST = opt('--manifest')
const BEFORE = opt('--before')
const GROUPS = (opt('--group') || 'email,digital,uploads,print-ready').split(',').map((g) => g.trim())
const PUBLIC_BUCKET = process.env.GCS_BUCKET_NAME || 'imagine-this-printed-main'
const PRIVATE_BUCKET = process.env.PRINT_FILES_BUCKET || 'imagine-this-printed-products'
const LINK_MS = 365 * 24 * 60 * 60 * 1000

const storage = new Storage({
  projectId: process.env.GCS_PROJECT_ID,
  credentials: process.env.GCS_CREDENTIALS ? JSON.parse(process.env.GCS_CREDENTIALS) : undefined,
})

const ref = (path) => `gs://${PRIVATE_BUCKET}/${path}`

async function linksFor(paths) {
  const out = new Map()
  for (const path of paths) {
    const [url] = await storage.bucket(PRIVATE_BUCKET).file(path).getSignedUrl({ action: 'read', expires: Date.now() + LINK_MS })
    out.set(path, url)
  }
  return out
}

async function copyVerified(srcFile) {
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
    throw new Error(`copy mismatch for ${path}`)
  }
  return { path, size: Number(src.size), md5: src.md5Hash, public_generation: String(src.generation) }
}

/** Both guards the print-ready rows depend on must be live before their links go in a row. */
async function assertPrintReadyGuardsLive(db) {
  const { rows: fn } = await db.query(`select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sync_product_images'`)
  const { rows: pol } = await db.query(`select qual from pg_policies where tablename='product_assets' and policyname='Public can read published assets'`)
  if (!fn[0]?.d?.includes('print-ready') || !pol[0]?.qual?.includes('print-ready')) {
    throw new Error('migration 20261104190000 is not live: refusing to put print-ready links in product_assets')
  }
}

async function rewriteEmail(db, moved, before) {
  const { rows } = await db.query(`select id, attachments from email_messages where attachments::text like '%email-attachments/%'`)
  const fromPublic = (a) => publicPathOf(a?.url, PUBLIC_BUCKET)
  // --to-refs also converts the private links an earlier run wrote: those paths are private already.
  const fromPrivate = (a) => (TO_REFS ? publicPathOf(a?.url, PRIVATE_BUCKET) : null)
  const privatePaths = new Set(rows.flatMap((r) => (r.attachments || []).map(fromPrivate)).filter((p) => p && groupOf(p) === 'email'))
  const hit = rows.filter((r) => (r.attachments || []).some((a) => moved.has(fromPublic(a)) || privatePaths.has(fromPrivate(a))))
  if (!APPLY) return { rows: hit.length }
  const paths = new Set(hit.flatMap((r) => r.attachments.map(fromPublic).filter((p) => moved.has(p))))
  const links = TO_REFS ? null : await linksFor(paths)
  await db.query('begin')
  try {
    for (const r of hit) {
      before.email_messages.push(r)
      let next = rewriteAttachments(r.attachments, PUBLIC_BUCKET, moved, (p) => (TO_REFS ? ref(p) : links.get(p)))
      if (TO_REFS) next = rewriteAttachments(next, PRIVATE_BUCKET, privatePaths, ref)
      await db.query('update email_messages set attachments = $2::jsonb where id = $1', [r.id, JSON.stringify(next)])
    }
    await db.query('commit')
  } catch (e) { await db.query('rollback'); throw e }
  return { rows: hit.length }
}

async function rewriteDigital(db, moved, before) {
  const { rows } = await db.query(`select id, status, file_url from products where file_url like '%digital-products/%'`)
  const hit = rows.filter((r) => moved.has(publicPathOf(r.file_url, PUBLIC_BUCKET)))
  if (!APPLY) return { rows: hit.length }
  await db.query('begin')
  try {
    for (const r of hit) {
      before.products_file_url.push(r)
      await db.query('update products set file_url = $2 where id = $1', [r.id, ref(publicPathOf(r.file_url, PUBLIC_BUCKET))])
    }
    await db.query('commit')
  } catch (e) { await db.query('rollback'); throw e }
  return { rows: hit.length }
}

async function rewritePrintReady(db, moved, before) {
  const { rows: assets } = await db.query(`select id, product_id, path, url from product_assets where path like 'print-ready/%' or url like '%/print-ready/%'`)
  // Every product whose asset row is written is here, so the trigger's rebuild is always undone.
  const { rows: products } = await db.query(`select id, images, metadata from products where images::text like '%print-ready/%' or metadata::text like '%print-ready/%' or id = any($1::uuid[])`, [assets.map((a) => a.product_id)])
  const { rows: outbox } = await db.query(`select id, media_urls from social_outbox where media_urls::text like '%print-ready/%'`)
  const counts = { assets: assets.length, products: products.length, outbox: outbox.length }
  if (!APPLY) return counts

  await assertPrintReadyGuardsLive(db)
  const links = await linksFor(moved)
  await db.query('begin')
  try {
    for (const a of assets) {
      const path = publicPathOf(a.url, PUBLIC_BUCKET)
      if (!moved.has(path)) continue
      before.product_assets.push(a)
      await db.query('update product_assets set url = $2 where id = $1', [a.id, links.get(path)])
    }
    // After the asset writes: the trigger has just rebuilt these galleries.
    for (const p of products) {
      before.products.push(p)
      await db.query('update products set images = $2::text[], metadata = $3::jsonb where id = $1', [
        p.id,
        withoutMoved(p.images, PUBLIC_BUCKET, moved),
        JSON.stringify(rewriteProductMetadata(p.metadata, PUBLIC_BUCKET, moved, ref, (x) => links.get(x))),
      ])
    }
    for (const o of outbox) {
      before.social_outbox.push(o)
      await db.query('update social_outbox set media_urls = $2 where id = $1', [o.id, Array.isArray(o.media_urls) ? withoutMoved(o.media_urls, PUBLIC_BUCKET, moved) : o.media_urls])
    }
    await db.query('commit')
  } catch (e) { await db.query('rollback'); throw e }
  return counts
}

/** Every text column, for anything still pointing at a moved original. */
async function remainingRefs(db, moved) {
  const { rows: cols } = await db.query(`select c.table_name t, c.column_name col from information_schema.columns c join information_schema.tables tb on tb.table_schema=c.table_schema and tb.table_name=c.table_name where c.table_schema='public' and tb.table_type='BASE TABLE' and c.data_type in ('text','character varying','json','jsonb','ARRAY')`)
  const left = []
  const pattern = `${PUBLIC_BUCKET}/([^"?[:space:]\\\\<>)&]+)`
  for (const { t, col } of cols) {
    const { rows } = await db.query(`select (regexp_matches("${col}"::text, $1, 'g'))[1] p from "${t}" where "${col}"::text like $2`, [pattern, `%${PUBLIC_BUCKET}/%`])
    for (const r of rows) {
      let path = r.p
      try { path = decodeURIComponent(path) } catch { /* keep as stored */ }
      if (moved.has(path)) left.push({ table: t, column: col, path })
    }
  }
  return left
}

async function main() {
  console.log(`mode: ${APPLY ? 'APPLY' : 'dry run'}${DELETE_PUBLIC ? ' + delete originals' : ''}${TO_REFS ? ' + gs:// on email rows' : ''}; groups: ${GROUPS.join(', ')}`)
  const [files] = await storage.bucket(PUBLIC_BUCKET).getFiles()
  const inScope = files.filter((f) => GROUPS.includes(groupOf(f.name)))

  const url = new URL(process.env.DATABASE_URL)
  url.searchParams.delete('sslmode') // the pooler's chain is self-signed, see setup-email-system.ts
  const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false }, statement_timeout: 60_000 })
  await db.connect()

  const before = { email_messages: [], products_file_url: [], product_assets: [], products: [], social_outbox: [] }
  const report = []
  const failures = []
  const verified = []
  try {
    for (const group of GROUPS) {
      const members = inScope.filter((f) => groupOf(f.name) === group)
      const bytes = members.reduce((n, f) => n + Number(f.metadata.size), 0)
      const copied = []
      if (APPLY) {
        for (const f of members) {
          try { copied.push(await copyVerified(f)) } catch (e) { failures.push({ path: f.name, error: e.message }) }
        }
      }
      // A row only ever moves to a copy that verified.
      const moved = new Set(APPLY ? copied.map((c) => c.path) : members.map((f) => f.name))
      const rewrite = { email: rewriteEmail, digital: rewriteDigital, 'print-ready': rewritePrintReady }[group]
      const rows = rewrite ? await rewrite(db, moved, before) : { rows: 0 }
      console.log(`${group}: ${members.length} objects (${(bytes / 1e6).toFixed(1)} MB), copies verified ${copied.length}, rows ${JSON.stringify(rows)}`)
      report.push({ group, objects: members.length, bytes, rows })
      verified.push(...copied)
    }

    let deleted = 0
    if (APPLY && DELETE_PUBLIC) {
      const moved = new Set(verified.map((c) => c.path))
      const left = await remainingRefs(db, moved)
      if (left.length) {
        console.log(`NOT deleting: ${left.length} stored values still point at originals`)
        for (const l of left.slice(0, 20)) console.log(`  ${l.table}.${l.column} ${l.path}`)
        process.exitCode = 3
      } else {
        for (const f of inScope) {
          if (!moved.has(f.name)) continue
          await f.delete()
          deleted++
        }
      }
    }
    console.log(`deleted originals: ${deleted}; failures: ${failures.length}`)
    for (const f of failures.slice(0, 20)) console.log(`  FAILED ${f.path}: ${f.error}`)

    if (MANIFEST && APPLY) {
      fs.writeFileSync(MANIFEST, JSON.stringify({ task: '4c100f9f', ran_at: new Date().toISOString(), delete_public: DELETE_PUBLIC, to_refs: TO_REFS, public_bucket: PUBLIC_BUCKET, private_bucket: PRIVATE_BUCKET, report, deleted, failures, files: verified }, null, 1))
      console.log(`manifest: ${MANIFEST}`)
    }
    if (failures.length) process.exitCode = 2
  } finally {
    if (BEFORE && APPLY) fs.writeFileSync(BEFORE, JSON.stringify(before, null, 1))
    await db.end()
  }
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
