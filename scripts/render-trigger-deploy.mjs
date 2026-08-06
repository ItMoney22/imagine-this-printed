#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Manually trigger a Render deploy of the backend API service.
//
// SUPABASE_JWT_SECRET is now set on the service, but setting an env var did not
// auto-trigger a redeploy (Render's GitHub App auto-deploy is disconnected —
// see docs/DEPLOY_RENDER_GITHUB_RECONNECT.md). This POSTs a fresh deploy of the
// current main; because the secret is now present, the backend will boot
// instead of crash-looping, unfreezing prod.
//
// Reads RENDER_API_KEY from the vault — no secrets hardcoded.
//
// Usage:  node scripts/render-trigger-deploy.mjs
// ---------------------------------------------------------------------------
import { readFileSync } from 'fs'
import https from 'https'

const API_SERVICE = 'srv-d7jpgut7vvec739bsid0' // imagine-this-printed-backend
const VAULT = 'C:/Users/David/.secrets/keys.json'

function fail(m) { console.error('✗ ' + m); process.exit(1) }

let renderKey
try {
  const v = JSON.parse(readFileSync(VAULT, 'utf8'))
  renderKey = v.RENDER_API_KEY || (v.render && v.render.RENDER_API_KEY)
} catch (e) { fail('vault read: ' + e.message) }
if (!renderKey) fail('RENDER_API_KEY not in vault')

// Confirm the secret is set before deploying, so we don't kick a doomed build.
function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null
    const req = https.request(`https://api.render.com${path}`, {
      method,
      headers: { Authorization: 'Bearer ' + renderKey, 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) }
    }, (res) => { let s = ''; res.on('data', d => s += d); res.on('end', () => resolve({ status: res.statusCode, body: s })) })
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

const envRes = await api('GET', `/v1/services/${API_SERVICE}/env-vars?limit=100`)
const hasSecret = (JSON.parse(envRes.body) || []).map(x => (x.envVar || x).key).includes('SUPABASE_JWT_SECRET')
if (!hasSecret) fail('SUPABASE_JWT_SECRET is NOT set yet — run render-fix-jwt-and-deploy.mjs first.')
console.log('✓ SUPABASE_JWT_SECRET confirmed present. Triggering deploy of current main …')

const dep = await api('POST', `/v1/services/${API_SERVICE}/deploys`, {})
if (dep.status >= 200 && dep.status < 300) {
  const d = JSON.parse(dep.body)
  console.log(`✓ Deploy started: ${d.id} (commit ${(d.commit && d.commit.id || '').slice(0, 7)}, status ${d.status})`)
  console.log('  Build ~60-90s, then boot. The agent will poll prod to confirm 404 → 401 on the realtime route.')
} else {
  fail('POST deploy failed, status ' + dep.status + ': ' + dep.body.slice(0, 300))
}
