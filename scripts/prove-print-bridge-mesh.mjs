// Poll the LIVE print-bridge queue and verify signed mesh links on meshed lines (task e51d15e8).
// Token comes from the vault (itp.PRINT_BRIDGE_TOKEN), never printed. Read-only: no orders created.
//   node scripts/prove-print-bridge-mesh.mjs           one check, prints WAITING / PASS / FAIL
//   node scripts/prove-print-bridge-mesh.mjs --watch   scheduled-task mode: a WAITING run only appends a line
//     to watch.log; the first run that finds a meshed line writes evidence-<stamp>.json, closes the trigger
//     card (WATCH_CARD_ID) with the result and deletes its own scheduled task, so it fires exactly once.
//   QUEUE_FILE=<json> ...   verify a saved queue body instead of the live API (self-test of the checks).
//   QUEUE_PAGE_LIMIT=1 ...  page the live queue one paid order at a time (proves the cursor walk).
//   Every live run also counts paid meshed lines straight from the database; db > 0 with 0 queue links is a FAIL.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

const watch = process.argv.includes('--watch')
const keys = JSON.parse(fs.readFileSync(process.env.USERPROFILE + '/.secrets/keys.json', 'utf8'))
const token = keys.itp.PRINT_BRIDGE_TOKEN
const base = process.env.API_BASE || 'https://api.imaginethisprinted.com'
const ttlSec = Number(process.env.PRINT_FILE_LINK_TTL_MINUTES || 720) * 60
const BUCKET = 'imagine-this-printed-products'
const evidenceDir = process.env.EVIDENCE_DIR || 'E:/memory/watchtower/projects/imagine-this-printed/print-bridge-mesh-watch'
const cardId = process.env.WATCH_CARD_ID || ''
const TASK_NAME = 'ITP print-bridge mesh watch'
const log = (...a) => console.log(...a)

let http = 200, body
if (process.env.QUEUE_FILE) body = JSON.parse(fs.readFileSync(process.env.QUEUE_FILE, 'utf8'))
else {
  // The queue scans paid orders OLDEST first, at most 100 per call, so one bare call goes blind once the
  // shop passes 100 paid orders. Follow its cursor (since=) until it stops moving.
  body = { orders: [] }
  let since = '', pages = 0
  for (;;) {
    const res = await fetch(`${base}/api/print-bridge/queue?limit=${Number(process.env.QUEUE_PAGE_LIMIT || 100)}${since ? `&since=${encodeURIComponent(since)}` : ''}`, { headers: { Authorization: `Bearer ${token}` } })
    http = res.status
    const page = await res.json().catch(() => ({}))
    pages++
    if (http !== 200) break
    body.orders.push(...(page.orders || []))
    if (!page.cursor || page.cursor === since || pages >= 100) break
    since = page.cursor
  }
  body.cursor = since
  log('queue pages', pages, 'cursor', since || '(none)')
}
const receivedAt = Math.floor(Date.now() / 1000)
log('queue HTTP', http)
const orders = body.orders || body.queue || body.items || (Array.isArray(body) ? body : [])
const lines = []
for (const o of orders) for (const l of (o.lines || o.items || [o])) lines.push({ order: o.itpOrderId || o.id, ...l })
log('orders', orders.length, 'lines', lines.length)
const meshed = lines.filter(l => l.glbUrl || l.stlUrl)
const urls = []
for (const l of meshed) for (const k of ['glbUrl', 'stlUrl']) if (l[k]) urls.push({ order: l.order, line: l.lineItemId || l.id, kind: k, url: l[k] })
log('gs:// anywhere:', JSON.stringify(body).includes('gs://'))
log('mesh links found:', urls.length)

const checks = []
for (const u of urls) {
  const p = new URL(u.url)
  const scheme = p.protocol === 'https:'
  const host = p.hostname === 'storage.googleapis.com'
  const bucket = p.pathname.startsWith(`/${BUCKET}/`)
  // The bridge signs on every queue read: a V2 link carries an absolute Expires epoch (which should sit
  // ~TTL past the read), a V4 link carries X-Goog-Expires seconds.
  const v2 = Number(p.searchParams.get('Expires'))
  const v4 = Number(p.searchParams.get('X-Goog-Expires'))
  const lifeSec = v2 ? v2 - receivedAt : v4 || null
  const expiryOk = lifeSec != null && Math.abs(lifeSec - ttlSec) <= 120
  const r = await fetch(u.url)
  const buf = Buffer.from(await r.arrayBuffer())
  const md5 = crypto.createHash('md5').update(buf).digest('base64')
  const gcsMd5 = (r.headers.get('x-goog-hash') || '').match(/md5=([^,]+)/)?.[1] || null
  const ok = scheme && host && bucket && expiryOk && r.status === 200
  checks.push({ ...u, scheme, host, bucket, expiresAt: v2 ? new Date(v2 * 1000).toISOString() : null, lifeSec, expiryOk, http: r.status, bytes: buf.length, md5, md5MatchesGcs: gcsMd5 ? gcsMd5 === md5 : null, ok })
  log(u.order, u.line, u.kind, { scheme, host, bucket, lifeSec, expiryOk, http: r.status, bytes: buf.length, md5MatchesGcs: gcsMd5 ? gcsMd5 === md5 : null })
}

// Cross-check the database (read-only, vault service key) so an empty queue is the truth, not a bridge
// that dropped a real order: every paid order line that is a 3d-print-<modelId> with a mesh, or a meshed
// print3d catalog toy, should be a meshed queue line.
let db = null
if (!process.env.QUEUE_FILE) {
  const sb = (p) => fetch(`${keys.itp.SUPABASE_URL}/rest/v1/${p}`, { headers: { apikey: keys.itp.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${keys.itp.SUPABASE_SERVICE_ROLE_KEY}` } }).then(r => r.json())
  const paid = await sb('orders?select=id,created_at,metadata&payment_status=eq.paid&order=created_at.desc&limit=10000')
  const ids = paid.map(o => o.id)
  const rows = ids.length ? await sb(`order_items?select=order_id,product_id,metadata&order_id=in.(${ids.join(',')})`) : []
  const toys = await sb('products?select=id,category,metadata&or=(category.eq.3d-prints,metadata->print3d->>enabled.eq.true)&limit=10000')
  const meshedToy = new Set(toys.filter(p => p.metadata?.print3d?.glb_url || p.metadata?.glb_url || p.metadata?.print3d?.stl_url).map(p => p.id))
  const lineIds = new Set()
  for (const o of paid) for (const m of (o.metadata?.items || [])) lineIds.add(`${o.id}|${m?.id}`)
  for (const r of rows) lineIds.add(`${r.order_id}|${r.metadata?.client_product_id ?? r.product_id}`)
  const modelIds = [...lineIds].map(k => k.split('|')[1]).filter(id => String(id).startsWith('3d-print-')).map(id => id.slice(9))
  const models = modelIds.length ? await sb(`user_3d_models?select=id,glb_url,stl_url&id=in.(${[...new Set(modelIds)].join(',')})`) : []
  const meshedModel = new Set(models.filter(m => m.glb_url || m.stl_url).map(m => m.id))
  const expected = [...lineIds].filter(k => { const id = k.split('|')[1]; return meshedToy.has(id) || (String(id).startsWith('3d-print-') && meshedModel.has(id.slice(9))) })
  const allToy = new Set(toys.map(p => p.id))
  const toyLines = [...lineIds].filter(k => { const id = k.split('|')[1]; return allToy.has(id) || String(id).startsWith('3d-print-') })
  // paidToyLines (meshed or not) must equal the queue's line count: proof this join sees what the bridge sees.
  db = { paidOrders: paid.length, newestPaid: paid[0]?.created_at || null, printLinesEver: modelIds.length, meshedCatalogToys: meshedToy.size, paidToyLines: toyLines.length, paidMeshedLines: new Set(expected).size }
  log('db cross-check:', db, db.paidToyLines === lines.length ? '(toy lines match the queue)' : `(MISMATCH: queue has ${lines.length} lines)`)
}

const missed = db && db.paidMeshedLines > 0 && urls.length === 0
const result = http !== 200 ? 'ERROR' : missed ? 'FAIL' : urls.length === 0 ? 'WAITING' : checks.every(c => c.ok) ? 'PASS' : 'FAIL'
if (missed) log(`db holds ${db.paidMeshedLines} paid meshed line(s) but the queue served 0 mesh links`)
log(result === 'WAITING' ? 'RESULT: WAITING (no meshed paid line yet)' : `RESULT: ${result}`)
if (result === 'FAIL' || result === 'ERROR') process.exitCode = 1

if (watch) {
  fs.mkdirSync(evidenceDir, { recursive: true })
  fs.appendFileSync(path.join(evidenceDir, 'watch.log'), `${new Date().toISOString()} queue ${http} lines ${lines.length} mesh ${urls.length} db paid ${db?.paidOrders ?? '-'} paidMeshed ${db?.paidMeshedLines ?? '-'} ${result}\n`)
  if (result === 'PASS' || result === 'FAIL') {
    const redact = l => ({ ...l, customerName: l.customerName && '[redacted]', customerEmail: l.customerEmail && '[redacted]' })
    const file = path.join(evidenceDir, `evidence-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    fs.writeFileSync(file, JSON.stringify({ task: 'e51d15e8', checkedAt: new Date(receivedAt * 1000).toISOString(), queueHttp: http, ttlSec, result, db, meshedLines: meshed.map(redact), links: checks }, null, 2))
    log('evidence written:', file)
    if (cardId) {
      const env = fs.readFileSync('D:/Projects for MetaSphere/david-trinidad-com/.env.local', 'utf8')
      const secret = env.match(/^CRON_SECRET=["']?([^"'\r\n]+)/m)?.[1]
      const summary = `Trigger fired ${new Date().toISOString()}: ${meshed.length} meshed queue line(s) (db: ${db?.paidMeshedLines} paid meshed), ${checks.length} link(s), RESULT ${result} ` +
        `(${checks.map(c => `${c.kind} ${c.http} life ${c.lifeSec}s`).join('; ')}). Evidence: ${file}`
      const res = await fetch('https://davidtrinidad.com/api/tasks/internal', {
        method: 'PATCH', headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
        body: JSON.stringify({ id: cardId, status: 'completed', result: summary }),
      })
      log('trigger card closed:', res.status)
    }
    try { execFileSync('schtasks', ['/Delete', '/TN', TASK_NAME, '/F'], { stdio: 'ignore' }); log('scheduled task removed') } catch { /* not installed */ }
  }
}
