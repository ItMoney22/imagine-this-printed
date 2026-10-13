// Fill Etsy-required attributes (Craft type) on the shop's existing listings.
//
// The publisher now writes Craft type onto every new DTF / PNG draft
// (services/etsy-required-attributes.ts). This is for the drafts made before
// that shipped: 2026-10-13 every DTF and PNG draft in the shop had it blank.
// Only blank required attributes are written; a value set in Shop Manager is
// never touched.
//
// Uses the same local Etsy grant as etsy-poc.mjs (~/.etsy-poc-tokens.json, run
// `node backend/scripts/etsy-poc.mjs auth` once), NOT the production
// etsy_connection row, so a local run never rotates the token Render uses.
//
//   npx tsx backend/scripts/etsy-fill-required-attributes.ts            # dry run
//   npx tsx backend/scripts/etsy-fill-required-attributes.ts --apply    # write
//   ... --listing 4593902255                                            # one listing
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { applyRequiredAttributes, craftKindFor, type EtsyCall } from '../services/etsy-required-attributes.js'

const ETSY_API = 'https://api.etsy.com/v3'
const TOKEN_URL = 'https://api.etsy.com/v3/public/oauth/token'
const TOKEN_FILE = join(homedir(), '.etsy-poc-tokens.json')
const VAULT = 'C:\\Users\\David\\.secrets\\keys.json'
const SHOP_ID = Number(process.env.ETSY_SHOP_ID || 67055923)

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : undefined
}
const apply = process.argv.includes('--apply')

function cred(name: 'ETSY_KEYSTRING' | 'ETSY_SHARED_SECRET'): string {
  if (process.env[name]) return process.env[name] as string
  if (existsSync(VAULT)) {
    const v = JSON.parse(readFileSync(VAULT, 'utf8'))
    const found = v[name] || v.etsy?.[name] || v.itp?.[name]
    if (found) return found
  }
  if (name === 'ETSY_KEYSTRING') throw new Error('ETSY_KEYSTRING not found (env or vault)')
  return ''
}

async function accessToken(): Promise<string> {
  if (!existsSync(TOKEN_FILE)) throw new Error(`No tokens at ${TOKEN_FILE} — run: node backend/scripts/etsy-poc.mjs auth`)
  const t = JSON.parse(readFileSync(TOKEN_FILE, 'utf8'))
  if (Date.now() - t.saved_at < (t.expires_in - 120) * 1000) return t.access_token
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', client_id: cred('ETSY_KEYSTRING'), refresh_token: t.refresh_token })
  })
  const json: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Token refresh failed (${res.status}): ${json.error_description || json.error}`)
  writeFileSync(TOKEN_FILE, JSON.stringify({ ...json, saved_at: Date.now() }, null, 2))
  return json.access_token
}

const nodeCache = new Map<string, any>()
const call: EtsyCall = async (path, opts = {}) => {
  const method = opts.method || 'GET'
  // Taxonomy properties are the same for every listing on a node.
  if (method === 'GET' && path.includes('/seller-taxonomy/') && nodeCache.has(path)) return nodeCache.get(path)
  const secret = cred('ETSY_SHARED_SECRET')
  const headers: Record<string, string> = {
    'x-api-key': secret ? `${cred('ETSY_KEYSTRING')}:${secret}` : cred('ETSY_KEYSTRING'),
    Authorization: `Bearer ${await accessToken()}`
  }
  let body: string | undefined
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.json)
  }
  const res = await fetch(`${ETSY_API}${path}`, { method, headers, body })
  const json: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json).slice(0, 300)}`)
  if (method === 'GET' && path.includes('/seller-taxonomy/')) nodeCache.set(path, json)
  return json
}

async function listingsToCheck(): Promise<any[]> {
  const one = arg('listing')
  if (one) return [await call(`/application/listings/${one}`)]
  const out: any[] = []
  for (const state of ['draft', 'active']) {
    const res = await call(`/application/shops/${SHOP_ID}/listings?state=${state}&limit=100`)
    out.push(...(res.results ?? []))
  }
  return out
}

const listings = await listingsToCheck()
console.log(`${apply ? 'APPLY' : 'DRY RUN'} — shop ${SHOP_ID}, ${listings.length} listings`)
let filled = 0
let blank = 0
for (const l of listings) {
  const r = await applyRequiredAttributes(call, SHOP_ID, l.listing_id, l.taxonomy_id, craftKindFor(l.listing_type), { dryRun: !apply })
  if (!r.writes.length && !r.unfilled.length) continue
  const what = r.writes.map(w => `${w.name}=${w.values.join(' / ')}`).join('; ')
  console.log(`${l.listing_id} ${l.state} ${l.taxonomy_id} "${String(l.title).slice(0, 50)}"  ${apply ? 'wrote' : 'would write'}: ${what || '-'}${r.unfilled.length ? `  STILL BLANK: ${r.unfilled.join(', ')}` : ''}`)
  filled += apply ? r.filled.length : r.writes.length
  blank += r.unfilled.length
}
console.log(`${apply ? 'wrote' : 'would write'} ${filled} attribute(s); ${blank} required attribute(s) with no rule left blank`)
