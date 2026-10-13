// Poll the LIVE print-bridge queue and verify signed mesh links on meshed lines (task e51d15e8).
// Token comes from the vault (itp.PRINT_BRIDGE_TOKEN), never printed. Read-only: no orders created.
//   node scripts/prove-print-bridge-mesh.mjs           one check, prints WAITING / PASS / FAIL
//   node scripts/prove-print-bridge-mesh.mjs --watch   scheduled-task mode: a WAITING run only appends a line
//     to watch.log; the first run that finds a meshed line writes evidence-<stamp>.json, closes the trigger
//     card (WATCH_CARD_ID) with the result and deletes its own scheduled task, so it fires exactly once.
//   QUEUE_FILE=<json> ...   verify a saved queue body instead of the live API (self-test of the checks).
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
  const res = await fetch(`${base}/api/print-bridge/queue`, { headers: { Authorization: `Bearer ${token}` } })
  http = res.status
  body = await res.json().catch(() => ({}))
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
const result = http !== 200 ? 'ERROR' : urls.length === 0 ? 'WAITING' : checks.every(c => c.ok) ? 'PASS' : 'FAIL'
log(result === 'WAITING' ? 'RESULT: WAITING (no meshed paid line yet)' : `RESULT: ${result}`)
if (result === 'FAIL' || result === 'ERROR') process.exitCode = 1

if (watch) {
  fs.mkdirSync(evidenceDir, { recursive: true })
  fs.appendFileSync(path.join(evidenceDir, 'watch.log'), `${new Date().toISOString()} queue ${http} lines ${lines.length} mesh ${urls.length} ${result}\n`)
  if (result === 'PASS' || result === 'FAIL') {
    const redact = l => ({ ...l, customerName: l.customerName && '[redacted]', customerEmail: l.customerEmail && '[redacted]' })
    const file = path.join(evidenceDir, `evidence-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    fs.writeFileSync(file, JSON.stringify({ task: 'e51d15e8', checkedAt: new Date(receivedAt * 1000).toISOString(), queueHttp: http, ttlSec, result, meshedLines: meshed.map(redact), links: checks }, null, 2))
    log('evidence written:', file)
    if (cardId) {
      const env = fs.readFileSync('D:/Projects for MetaSphere/david-trinidad-com/.env.local', 'utf8')
      const secret = env.match(/^CRON_SECRET=["']?([^"'\r\n]+)/m)?.[1]
      const summary = `Trigger fired ${new Date().toISOString()}: ${meshed.length} meshed paid line(s), ${checks.length} link(s), RESULT ${result} ` +
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
