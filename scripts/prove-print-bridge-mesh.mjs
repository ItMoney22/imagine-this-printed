// Poll the LIVE print-bridge queue and verify signed mesh links on meshed lines.
// Token comes from the vault (itp.PRINT_BRIDGE_TOKEN), never printed. Read-only: no orders created.
import fs from 'node:fs'
const keys = JSON.parse(fs.readFileSync(process.env.USERPROFILE + '/.secrets/keys.json', 'utf8'))
const token = keys.itp.PRINT_BRIDGE_TOKEN
const base = process.env.API_BASE || 'https://api.imaginethisprinted.com'
const ttlMin = Number(process.env.PRINT_FILE_LINK_TTL_MINUTES || 720)
const res = await fetch(`${base}/api/print-bridge/queue`, { headers: { Authorization: `Bearer ${token}` } })
const body = await res.json().catch(() => ({}))
console.log('queue HTTP', res.status)
const orders = body.orders || body.queue || body.items || (Array.isArray(body) ? body : [])
const lines = []
for (const o of orders) for (const l of (o.lines || o.items || [o])) lines.push({ order: o.itpOrderId || o.id, ...l })
console.log('orders', orders.length, 'lines', lines.length)
const urls = []
for (const l of lines) for (const k of ['glbUrl', 'stlUrl']) if (l[k]) urls.push({ order: l.order, line: l.lineItemId || l.id, kind: k, url: l[k] })
console.log('gs:// anywhere:', JSON.stringify(body).includes('gs://'))
console.log('mesh links found:', urls.length)
let bad = 0
for (const u of urls) {
  const p = new URL(u.url)
  const okScheme = p.protocol === 'https:'
  const okHost = p.hostname === 'storage.googleapis.com' && p.pathname.startsWith('/imagine-this-printed-products/')
  const date = p.searchParams.get('X-Goog-Date'), exp = Number(p.searchParams.get('X-Goog-Expires'))
  // V4 links carry X-Goog-Expires (seconds from signing); V2 links carry an absolute Expires epoch.
  const v2 = Number(p.searchParams.get('Expires'))
  const remaining = v2 ? v2 - Math.floor(Date.now() / 1000) : null
  const okExp = v2 ? remaining > 0 && remaining <= ttlMin * 60 : exp === ttlMin * 60
  const r = await fetch(u.url, { headers: { Range: 'bytes=0-15' } })
  const ok = okScheme && okHost && okExp && (r.status === 200 || r.status === 206)
  if (!ok) bad++
  console.log(u.order, u.line, u.kind, { scheme: okScheme, host: okHost, expiresSec: v2 ? remaining : exp, expiryOk: okExp, signedAt: date, http: r.status })
}
console.log(urls.length === 0 ? 'RESULT: WAITING (no meshed paid line yet)' : bad ? 'RESULT: FAIL' : 'RESULT: PASS')
