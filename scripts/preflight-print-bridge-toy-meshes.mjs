// Task e51d15e8. Run: node scripts/preflight-print-bridge-toy-meshes.mjs
// Pre-flight (NOT the live proof): for each buyable meshed toy, sign 12 h V2 links to its real mesh objects
// with the backend's own GCS signer and fetch them, so a missing/broken file shows now rather than on the
// first paid order. Read-only.
import fs from 'node:fs'
import crypto from 'node:crypto'
const { itp } = JSON.parse(fs.readFileSync(process.env.USERPROFILE + '/.secrets/keys.json', 'utf8'))
// BACKEND_ENV defaults to the shared checkout's backend/.env (worktrees carry none).
const env = fs.readFileSync(process.env.BACKEND_ENV || 'D:/Projects for MetaSphere/imagine-this-printed/backend/.env', 'utf8')
const cred = JSON.parse(env.match(/^GCS_CREDENTIALS='(\{[\s\S]*?\})'/m)[1])
const pem = cred.private_key.replace(/\\n/g, '\n'), email = cred.client_email
console.log('signer', email.replace(/^[^@]+/, '***'))
const H = { apikey: itp.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + itp.SUPABASE_SERVICE_ROLE_KEY }
const toys = await fetch(itp.SUPABASE_URL + '/rest/v1/products?select=id,name,status,metadata&or=(category.eq.3d-prints,metadata->print3d->>enabled.eq.true)', { headers: H }).then(r => r.json())
const ttl = 720 * 60
let all = true
for (const p of toys) {
  for (const [kind, ref] of [['glb', p.metadata?.print3d?.glb_url || p.metadata?.glb_url], ['stl', p.metadata?.print3d?.stl_url]]) {
    if (!ref) { console.log(p.id.slice(0, 8), p.name, kind, 'no mesh on record'); continue }
    const m = String(ref).match(/^gs:\/\/([^/]+)\/(.+)$/)
    if (!m) { console.log(p.id.slice(0, 8), kind, 'not a gs:// ref'); all = false; continue }
    const [, bucket, obj] = m
    const now = Math.floor(Date.now() / 1000), exp = now + ttl
    const path = `/${bucket}/${obj.split('/').map(encodeURIComponent).join('/')}`
    const sig = crypto.createSign('RSA-SHA256').update(`GET\n\n\n${exp}\n${path}`).sign(pem, 'base64')
    const url = `https://storage.googleapis.com${path}?GoogleAccessId=${encodeURIComponent(email)}&Expires=${exp}&Signature=${encodeURIComponent(sig)}`
    const r = await fetch(url)
    const buf = Buffer.from(await r.arrayBuffer())
    const md5 = crypto.createHash('md5').update(buf).digest('base64')
    const gcs = (r.headers.get('x-goog-hash') || '').match(/md5=([^,]+)/)?.[1] || null
    const ok = r.status === 200 && bucket === 'imagine-this-printed-products' && gcs === md5
    all &&= ok
    console.log(p.id.slice(0, 8), p.name, kind, { object: `${bucket}/${obj}`, http: r.status, bytes: buf.length, lifeSec: exp - now, md5MatchesGcs: gcs ? gcs === md5 : null, ok })
  }
}
console.log(all ? 'PREFLIGHT: every buyable toy mesh fetches 200 on a 12 h link, md5 = GCS' : 'PREFLIGHT: PROBLEM')
