#!/usr/bin/env node
// ---------------------------------------------------------------------------
// One-shot fix: production backend has been frozen on the 2026-07-29 commit
// because every deploy since then crashes on boot with:
//
//   Error: SUPABASE_JWT_SECRET is not set — refusing to boot without a way to
//   verify auth tokens.   (backend/dist/middleware/supabaseAuth.js:6)
//
// A boot-time guard was added that requires SUPABASE_JWT_SECRET, but only
// JWT_SECRET is set on the Render API service. This sets SUPABASE_JWT_SECRET
// (same verified value) on the API service, which auto-triggers a redeploy of
// the current main — unfreezing prod and shipping the Mr. Imagine builder +
// /api/ai/realtime/token route.
//
// Reads the Render key from the vault and the secret from backend/.env — NO
// secrets are hardcoded here. Prints the result; verify prod afterward.
//
// Usage (run yourself; an agent is blocked from writing to prod):
//   node scripts/render-fix-jwt-and-deploy.mjs
// ---------------------------------------------------------------------------
import { readFileSync } from 'fs'
import https from 'https'

const API_SERVICE = 'srv-d7jpgut7vvec739bsid0' // imagine-this-printed-backend
const VAULT = 'C:/Users/David/.secrets/keys.json'

function fail(msg) { console.error('✗ ' + msg); process.exit(1) }

// --- Render API key from vault (top-level or nested under "render") ---
let renderKey
try {
  const vault = JSON.parse(readFileSync(VAULT, 'utf8'))
  renderKey = vault.RENDER_API_KEY || (vault.render && vault.render.RENDER_API_KEY)
} catch (e) { fail('could not read vault: ' + e.message) }
if (!renderKey) fail('RENDER_API_KEY not found in vault')

// --- SUPABASE_JWT_SECRET from backend/.env ---
let secret
try {
  const env = readFileSync('backend/.env', 'utf8')
  const m = env.match(/^\s*SUPABASE_JWT_SECRET\s*=\s*"?([^"\r\n]+)"?/m)
  secret = m && m[1]
} catch (e) { fail('could not read backend/.env: ' + e.message) }
if (!secret) fail('SUPABASE_JWT_SECRET not found in backend/.env')

console.log(`Setting SUPABASE_JWT_SECRET (len ${secret.length}) on ${API_SERVICE} …`)

const body = JSON.stringify({ value: secret })
const req = https.request(
  `https://api.render.com/v1/services/${API_SERVICE}/env-vars/SUPABASE_JWT_SECRET`,
  { method: 'PUT', headers: { Authorization: 'Bearer ' + renderKey, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
  (res) => {
    let s = ''; res.on('data', d => s += d)
    res.on('end', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log('✓ SUPABASE_JWT_SECRET set. Render is now redeploying current main.')
        console.log('  Watch: the build takes ~60-90s, then the backend boots.')
        console.log('  Verify:  curl -s -o /dev/null -w "%{http_code}" -X POST https://api.imaginethisprinted.com/api/ai/realtime/token')
        console.log('  Expect 401 (route live) instead of 404 (stale). Health should stay 200.')
      } else {
        console.error('✗ PUT failed, status ' + res.statusCode + ': ' + s.slice(0, 400))
        process.exit(1)
      }
    })
  }
)
req.on('error', e => fail('request error: ' + e.message))
req.write(body); req.end()
