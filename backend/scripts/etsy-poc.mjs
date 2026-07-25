#!/usr/bin/env node
// Etsy Open API v3 proof-of-concept — auth (OAuth 2.0 PKCE) + single listing
// creation with image upload. Zero dependencies (Node 18+: fetch/FormData/Blob).
//
// Watchtower task 0a675d4c-860a-40fa-b0fc-1149f031b095. Research:
// docs/ETSY_API_RESEARCH.md. Production code: backend/services/etsy.ts.
//
// PREREQS (owner, one-time):
//   1. Etsy shop on the account.
//   2. App at https://www.etsy.com/developers/your-apps with redirect URI
//      http://localhost:3939/callback registered EXACTLY.
//   3. Keystring in env ETSY_KEYSTRING, or in the vault
//      C:\Users\David\.secrets\keys.json under "ETSY_KEYSTRING".
//
// USAGE:
//   node etsy-poc.mjs auth                  # PoC #1 — OAuth PKCE flow, saves tokens
//   node etsy-poc.mjs whoami                # verify auth: user id + shop
//   node etsy-poc.mjs taxonomy --q shirt    # find a taxonomy_id
//   node etsy-poc.mjs create-listing \
//     --title "Custom DTF Tee" --description "Printed in GA" --price 24.99 \
//     --taxonomy 1234 --image ./tee.jpg [--quantity 4] [--shipping-profile 111] [--publish]
//                                           # PoC #2 — draft listing + image (+ activate)
//
// Listings are created as DRAFTS (free, invisible). --publish activates
// ($0.20 Etsy fee) and requires a shipping profile on the shop.

import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

const ETSY_API = 'https://api.etsy.com/v3'
const TOKEN_URL = 'https://api.etsy.com/v3/public/oauth/token'
const CONNECT_URL = 'https://www.etsy.com/oauth/connect'
const REDIRECT_URI = 'http://localhost:3939/callback'
const SCOPES = 'listings_r listings_w shops_r'
const TOKEN_FILE = join(homedir(), '.etsy-poc-tokens.json')
const VAULT = 'C:\\Users\\David\\.secrets\\keys.json'

function keystring() {
  if (process.env.ETSY_KEYSTRING) return process.env.ETSY_KEYSTRING
  if (existsSync(VAULT)) {
    try {
      const vault = JSON.parse(readFileSync(VAULT, 'utf8'))
      const found = vault.ETSY_KEYSTRING || vault.etsy?.ETSY_KEYSTRING || vault.itp?.ETSY_KEYSTRING
      if (found) return found
    } catch { /* fall through */ }
  }
  console.error('ETSY_KEYSTRING not found (env or vault). Create the Etsy app first — see header comment.')
  process.exit(1)
}

function secret() {
  if (process.env.ETSY_SHARED_SECRET) return process.env.ETSY_SHARED_SECRET
  if (existsSync(VAULT)) {
    try {
      const vault = JSON.parse(readFileSync(VAULT, 'utf8'))
      const found = vault.ETSY_SHARED_SECRET || vault.etsy?.ETSY_SHARED_SECRET || vault.itp?.ETSY_SHARED_SECRET
      if (found) return found
    } catch { /* fall through */ }
  }
  return ''
}
// Etsy v3 (2026 change): x-api-key must be `keystring:shared_secret` for authenticated data calls.
function apiKeyHeader() { const s = secret(); return s ? `${keystring()}:${s}` : keystring() }

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : fallback
}
const hasFlag = (name) => process.argv.includes(`--${name}`)

function saveTokens(t) {
  writeFileSync(TOKEN_FILE, JSON.stringify({ ...t, saved_at: Date.now() }, null, 2))
  console.log(`Tokens saved -> ${TOKEN_FILE}`)
}

function loadTokens() {
  if (!existsSync(TOKEN_FILE)) {
    console.error(`No tokens at ${TOKEN_FILE} — run: node etsy-poc.mjs auth`)
    process.exit(1)
  }
  return JSON.parse(readFileSync(TOKEN_FILE, 'utf8'))
}

async function tokenRequest(body) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Token request failed (${res.status}): ${json.error_description || json.error}`)
  return json
}

// Returns a live access token, refreshing via the saved (rotating) refresh token.
async function accessToken() {
  const t = loadTokens()
  const ageMs = Date.now() - t.saved_at
  if (ageMs < (t.expires_in - 120) * 1000) return t.access_token
  console.log('Access token expired — refreshing…')
  const fresh = await tokenRequest({ grant_type: 'refresh_token', client_id: keystring(), refresh_token: t.refresh_token })
  saveTokens(fresh)
  return fresh.access_token
}

async function api(path, { method = 'GET', token, form, multipart } = {}) {
  const headers = { 'x-api-key': apiKeyHeader() }
  if (token) headers.Authorization = `Bearer ${token}`
  let body
  if (multipart) body = multipart
  else if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
    body = new URLSearchParams(Object.fromEntries(Object.entries(form).filter(([, v]) => v !== undefined)))
  }
  const res = await fetch(`${ETSY_API}${path}`, { method, headers, body })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json).slice(0, 400)}`)
  console.log(`  rate: ${res.headers.get('x-remaining-today')}/${res.headers.get('x-limit-per-day')} left today`)
  return json
}

// ---------------------------------------------------------------- commands --

// PoC deliverable #1: authenticate with the Etsy API (OAuth 2.0 code + PKCE).
async function cmdAuth() {
  const verifier = randomBytes(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = randomBytes(16).toString('base64url')

  const url = `${CONNECT_URL}?${new URLSearchParams({
    response_type: 'code',
    client_id: keystring(),
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256'
  })}`

  console.log('\n1. Open this URL in a browser logged into the ITP Etsy account:\n')
  console.log(url)
  console.log('\n2. Approve access — Etsy redirects to localhost and this script finishes.\n')

  const code = await new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url, 'http://localhost:3939')
      if (u.pathname !== '/callback') { res.writeHead(404).end(); return }
      const err = u.searchParams.get('error')
      if (err) {
        res.end('Access denied — you can close this tab.')
        server.close(); reject(new Error(`OAuth denied: ${err}`)); return
      }
      if (u.searchParams.get('state') !== state) {
        res.end('State mismatch — aborting.')
        server.close(); reject(new Error('CSRF state mismatch')); return
      }
      res.end('Etsy connected! You can close this tab and return to the terminal.')
      server.close()
      resolve(u.searchParams.get('code'))
    })
    server.listen(3939, () => console.log('Listening on http://localhost:3939/callback …'))
  })

  const tokens = await tokenRequest({
    grant_type: 'authorization_code',
    client_id: keystring(),
    redirect_uri: REDIRECT_URI,
    code,
    code_verifier: verifier
  })
  saveTokens(tokens)
  console.log(`\nAUTH OK — Etsy user id ${tokens.access_token.split('.')[0]}, access token valid ${tokens.expires_in}s.`)
}

async function cmdWhoami() {
  const token = await accessToken()
  const me = await api('/application/users/me', { token })
  console.log('User:', JSON.stringify(me, null, 2))
  const shop = await api(`/application/users/${me.user_id}/shops`, { token }).catch(e => { console.log('No shop yet:', e.message); return null })
  if (shop?.shop_id) console.log(`Shop: ${shop.shop_name} (shop_id ${shop.shop_id})`)
}

async function cmdTaxonomy() {
  const q = (arg('q') || '').toLowerCase()
  const res = await api('/application/seller-taxonomy/nodes')
  const flat = []
  const walk = (nodes, trail) => {
    for (const n of nodes || []) {
      const path = [...trail, n.name]
      flat.push({ id: n.id, path: path.join(' > ') })
      walk(n.children, path)
    }
  }
  walk(res.results, [])
  const hits = q ? flat.filter(n => n.path.toLowerCase().includes(q)) : flat
  for (const h of hits.slice(0, 40)) console.log(`${String(h.id).padStart(6)}  ${h.path}`)
  console.log(`(${hits.length} matches)`)
}

// PoC deliverable #2: create one listing (title/description/price + 1 image).
async function cmdCreateListing() {
  const title = arg('title')
  const description = arg('description')
  const price = Number(arg('price'))
  const taxonomyId = Number(arg('taxonomy'))
  const image = arg('image')
  if (!title || !description || !price || !taxonomyId || !image) {
    console.error('Required: --title --description --price --taxonomy --image  (see header for full usage)')
    process.exit(1)
  }

  const token = await accessToken()
  const me = await api('/application/users/me', { token })
  const shop = await api(`/application/users/${me.user_id}/shops`, { token })
  if (!shop?.shop_id) throw new Error('Connected account has no Etsy shop — create the store first.')
  console.log(`Posting to shop ${shop.shop_name} (${shop.shop_id})`)

  const listing = await api(`/application/shops/${shop.shop_id}/listings`, {
    method: 'POST',
    token,
    form: {
      quantity: Number(arg('quantity', 4)),
      title,
      description,
      price,
      who_made: 'i_did',
      when_made: 'made_to_order',
      taxonomy_id: taxonomyId,
      type: 'physical',
      shipping_profile_id: arg('shipping-profile') ? Number(arg('shipping-profile')) : undefined
    }
  })
  console.log(`DRAFT CREATED — listing_id ${listing.listing_id}`)
  console.log(`  https://www.etsy.com/listing/${listing.listing_id}`)

  // Image: local path or URL.
  let buf, name
  if (/^https?:\/\//.test(image)) {
    const r = await fetch(image)
    if (!r.ok) throw new Error(`image fetch ${r.status}`)
    buf = Buffer.from(await r.arrayBuffer())
    name = basename(new URL(image).pathname) || 'image.jpg'
  } else {
    buf = readFileSync(image)
    name = basename(image)
  }
  const fd = new FormData()
  fd.append('image', new Blob([buf]), name)
  const img = await api(`/application/shops/${shop.shop_id}/listings/${listing.listing_id}/images`, {
    method: 'POST', token, multipart: fd
  })
  console.log(`IMAGE UPLOADED — listing_image_id ${img.listing_image_id}`)

  if (hasFlag('publish')) {
    await api(`/application/shops/${shop.shop_id}/listings/${listing.listing_id}`, {
      method: 'PATCH', token, form: { state: 'active' }
    })
    console.log('LISTING ACTIVATED (live, $0.20 fee applied).')
  } else {
    console.log('Left in DRAFT state (free, invisible). Re-run with --publish to go live.')
  }
}

const cmd = process.argv[2]
const commands = { auth: cmdAuth, whoami: cmdWhoami, taxonomy: cmdTaxonomy, 'create-listing': cmdCreateListing }
if (!commands[cmd]) {
  console.error(`Usage: node etsy-poc.mjs <${Object.keys(commands).join('|')}> [options] — see header comment`)
  process.exit(1)
}
commands[cmd]().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
