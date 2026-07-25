// Etsy Open API v3 integration — OAuth 2.0 (Authorization Code + PKCE) and
// product → listing publishing for the ITP Etsy store.
//
// Design notes (full research: docs/ETSY_API_RESEARCH.md):
// - OAuth token exchange uses PKCE (no client secret in the token call). BUT
//   authenticated data calls require BOTH creds: the x-api-key header must be
//   `<ETSY_KEYSTRING>:<ETSY_SHARED_SECRET>` (colon-joined). Keystring-alone now
//   returns 403 "Shared secret is required in x-api-key header" (Etsy v3 change,
//   verified live 2026-07-25). The OAuth client_id stays the bare keystring.
// - Access tokens live 1h; refresh tokens live 90 days and ROTATE on every
//   refresh, so both tokens are rewritten atomically in etsy_connection.
// - There is no Etsy sandbox: listings are created in `draft` state (invisible,
//   free) and only PATCHed to `active` ($0.20 fee) when explicitly requested.
// - Single-shop design: one etsy_connection row (id=1) for ITP's own store.
import { createHash, randomBytes } from 'crypto'
import { supabase } from '../lib/supabase.js'

const ETSY_API = 'https://api.etsy.com/v3'
const ETSY_CONNECT_URL = 'https://www.etsy.com/oauth/connect'
const ETSY_TOKEN_URL = 'https://api.etsy.com/v3/public/oauth/token'
const OAUTH_SCOPES = 'listings_r listings_w shops_r'

// Etsy hard limits (see research doc §4–5)
const MAX_TITLE_LEN = 140
const MAX_TAGS = 13
const MAX_TAG_LEN = 20
const MAX_IMAGES = 10
const MIN_PRICE_USD = 0.2

export interface EtsyPublishOptions {
  taxonomyId?: number
  shippingProfileId?: number
  returnPolicyId?: number
  quantity?: number
  publish?: boolean          // PATCH to active after images upload (incurs $0.20 fee)
  priceOverride?: number     // dollars
  readinessStateId?: number  // Etsy readiness state; REQUIRED on physical listings (see ETSY_READINESS_STATE_ID)
  descriptionSuffix?: string // appended to the listing description (e.g. required AI disclosure)
}

export interface EtsyPublishResult {
  ok: boolean
  productId: string
  listingId?: number
  state?: string
  etsyUrl?: string
  uploadedImages: number
  error?: string
}

export function isEtsyConfigured(): boolean {
  // Both are required: keystring for OAuth, keystring:secret for data calls.
  return !!process.env.ETSY_KEYSTRING && !!process.env.ETSY_SHARED_SECRET
}

export function isEtsyEnabled(): boolean {
  return process.env.ETSY_ENABLED === 'true' && isEtsyConfigured()
}

function keystring(): string {
  const key = process.env.ETSY_KEYSTRING
  if (!key) throw new Error('ETSY_KEYSTRING is not set — create the Etsy app first (docs/plans/2026-07-24-etsy-integration-plan.md Phase 1)')
  return key
}

function sharedSecret(): string {
  return process.env.ETSY_SHARED_SECRET || ''
}

// Etsy v3 (verified live 2026-07-25) requires the shared secret joined to the
// keystring in the x-api-key header for authenticated data calls: `<keystring>:<secret>`.
// Falls back to keystring-only if the secret is unset (which will 403 on data calls).
function apiKey(): string {
  const s = sharedSecret()
  return s ? `${keystring()}:${s}` : keystring()
}

function redirectUri(): string {
  return process.env.ETSY_REDIRECT_URI
    || `${process.env.API_ORIGIN || 'http://localhost:4000'}/api/admin/etsy/callback`
}

// ---------------------------------------------------------------------------
// OAuth connect flow
// ---------------------------------------------------------------------------

// Step 1: build the consent URL the admin opens. Persists {state, verifier} so
// the (unauthenticated) callback can complete the exchange after the redirect.
export async function buildAuthUrl(createdBy?: string): Promise<string> {
  const verifier = randomBytes(48).toString('base64url') // 64 chars, PKCE-legal alphabet
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = randomBytes(24).toString('base64url')

  // Opportunistic cleanup of abandoned handshakes (>1h old)
  await supabase.from('etsy_oauth_states').delete().lt('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())

  const { error } = await supabase.from('etsy_oauth_states').insert({
    state,
    code_verifier: verifier,
    redirect_uri: redirectUri(),
    created_by: createdBy ?? null
  })
  if (error) throw new Error(`Failed to persist OAuth state: ${error.message}`)

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: keystring(),
    redirect_uri: redirectUri(),
    scope: OAUTH_SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256'
  })
  return `${ETSY_CONNECT_URL}?${params.toString()}`
}

// Step 2: the callback route hands us ?code&state. Exchange, resolve the shop,
// and store the connection. State lookup doubles as CSRF protection since the
// callback endpoint itself cannot require an admin JWT (browser redirect).
export async function handleOAuthCallback(code: string, state: string): Promise<{ shopId: number | null, shopName: string | null }> {
  const { data: row, error } = await supabase
    .from('etsy_oauth_states')
    .select('code_verifier, redirect_uri')
    .eq('state', state)
    .maybeSingle()
  if (error) throw new Error(`OAuth state lookup failed: ${error.message}`)
  if (!row) throw new Error('Unknown or expired OAuth state — restart the connect flow')

  const tokens = await requestTokens({
    grant_type: 'authorization_code',
    client_id: keystring(),
    redirect_uri: row.redirect_uri,
    code,
    code_verifier: row.code_verifier
  })
  await supabase.from('etsy_oauth_states').delete().eq('state', state)

  // Access token is "<user_id>.<token>" — user id rides along for free.
  const etsyUserId = Number(tokens.access_token.split('.')[0])

  // Resolve the user's shop (ITP's store). New accounts may not have one yet.
  let shopId: number | null = null
  let shopName: string | null = null
  try {
    const shops = await etsyFetch(`/application/users/${etsyUserId}/shops`, { token: tokens.access_token })
    // getShopByOwnerUserId returns a single shop object (or 404 if none)
    if (shops?.shop_id) {
      shopId = shops.shop_id
      shopName = shops.shop_name ?? null
    }
  } catch (e: any) {
    console.warn('[etsy] connected but no shop found yet:', e.message)
  }

  const { error: upsertErr } = await supabase.from('etsy_connection').upsert({
    id: 1,
    etsy_user_id: etsyUserId,
    shop_id: shopId,
    shop_name: shopName,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    access_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    scopes: OAUTH_SCOPES,
    updated_at: new Date().toISOString()
  })
  if (upsertErr) throw new Error(`Failed to store Etsy connection: ${upsertErr.message}`)

  return { shopId, shopName }
}

interface TokenResponse { access_token: string, refresh_token: string, expires_in: number }

async function requestTokens(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(ETSY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const json: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Etsy token request failed (${res.status}): ${json.error_description || json.error || 'unknown'}`)
  return json as TokenResponse
}

// Returns a live access token, refreshing (and persisting the ROTATED refresh
// token) when within 2 minutes of expiry.
export async function getAccessToken(): Promise<{ token: string, shopId: number | null }> {
  const { data: conn, error } = await supabase
    .from('etsy_connection')
    .select('access_token, refresh_token, access_token_expires_at, shop_id')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw new Error(`Etsy connection lookup failed: ${error.message}`)
  if (!conn) throw new Error('Etsy is not connected — run the admin connect flow first (GET /api/admin/etsy/connect)')

  if (new Date(conn.access_token_expires_at).getTime() - Date.now() > 2 * 60 * 1000) {
    return { token: conn.access_token, shopId: conn.shop_id }
  }

  const tokens = await requestTokens({
    grant_type: 'refresh_token',
    client_id: keystring(),
    refresh_token: conn.refresh_token
  })
  const { error: updErr } = await supabase.from('etsy_connection').update({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    access_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString()
  }).eq('id', 1)
  if (updErr) throw new Error(`Failed to persist refreshed Etsy tokens: ${updErr.message}`)
  return { token: tokens.access_token, shopId: conn.shop_id }
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

interface EtsyFetchOpts {
  method?: string
  token?: string
  form?: Record<string, string | number | boolean | undefined>  // x-www-form-urlencoded (Etsy listing endpoints)
  multipart?: FormData                                          // image upload
  retried?: boolean
}

export async function etsyFetch(path: string, opts: EtsyFetchOpts = {}): Promise<any> {
  const headers: Record<string, string> = { 'x-api-key': apiKey() }
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`

  let body: URLSearchParams | FormData | undefined
  if (opts.multipart) {
    body = opts.multipart // fetch sets the multipart boundary header itself
  } else if (opts.form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(opts.form)) {
      if (v !== undefined) params.append(k, String(v))
    }
    body = params
  }

  const res = await fetch(`${ETSY_API}${path}`, { method: opts.method || 'GET', headers, body })

  // Honor Etsy's retry-after once, then give up (caller records the error).
  if (res.status === 429 && !opts.retried) {
    const wait = Math.min(Number(res.headers.get('retry-after') || 2), 30)
    await new Promise(r => setTimeout(r, wait * 1000))
    return etsyFetch(path, { ...opts, retried: true })
  }

  const json: any = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(`Etsy ${opts.method || 'GET'} ${path} failed (${res.status}): ${json.error || JSON.stringify(json).slice(0, 300)}`)
  }
  return json
}

export async function getConnectionStatus() {
  const { data: conn } = await supabase
    .from('etsy_connection')
    .select('etsy_user_id, shop_id, shop_name, access_token_expires_at, scopes, connected_at, updated_at')
    .eq('id', 1)
    .maybeSingle()
  return {
    enabled: isEtsyEnabled(),
    configured: isEtsyConfigured(),
    connected: !!conn,
    shop_id: conn?.shop_id ?? null,
    shop_name: conn?.shop_name ?? null,
    scopes: conn?.scopes ?? null,
    connected_at: conn?.connected_at ?? null,
    token_expires_at: conn?.access_token_expires_at ?? null,
    redirect_uri: isEtsyConfigured() ? redirectUri() : null
  }
}

// Setup helpers surfaced in the admin UI so taxonomy/shipping ids never need
// to be guessed or hardcoded.
export async function getTaxonomyNodes(): Promise<any[]> {
  const res = await etsyFetch('/application/seller-taxonomy/nodes')
  return res?.results ?? []
}

export async function getShippingProfiles(): Promise<any[]> {
  const { token, shopId } = await getAccessToken()
  if (!shopId) throw new Error('No Etsy shop on the connected account yet')
  const res = await etsyFetch(`/application/shops/${shopId}/shipping-profiles`, { token })
  return res?.results ?? []
}

export async function getReturnPolicies(): Promise<any[]> {
  const { token, shopId } = await getAccessToken()
  if (!shopId) throw new Error('No Etsy shop on the connected account yet')
  const res = await etsyFetch(`/application/shops/${shopId}/policies/return`, { token })
  return res?.results ?? []
}

// ---------------------------------------------------------------------------
// Product → listing mapping
// ---------------------------------------------------------------------------

// ITP category slug → Etsy taxonomy id. Populated via ETSY_TAXONOMY_MAP env
// (JSON, e.g. {"shirts":1234,"tumblers":5678}) after browsing
// GET /api/admin/etsy/taxonomy — Etsy's ids are theirs to define, so none are
// hardcoded here.
function taxonomyIdFor(category: string | null): number | null {
  try {
    const map = JSON.parse(process.env.ETSY_TAXONOMY_MAP || '{}')
    if (category && Number.isFinite(Number(map[category]))) return Number(map[category])
  } catch { /* malformed map falls through to default */ }
  const fallback = Number(process.env.ETSY_DEFAULT_TAXONOMY_ID)
  return Number.isFinite(fallback) && fallback > 0 ? fallback : null
}

// Etsy tag rules: ≤13 tags, ≤20 chars, letters/numbers/spaces/hyphens.
function toEtsyTags(searchKeywords: string | null): string[] {
  if (!searchKeywords) return []
  return searchKeywords
    .split(/[,;]+/)
    .map(t => t.trim().replace(/[^A-Za-z0-9 -]/g, '').slice(0, MAX_TAG_LEN).trim())
    .filter(t => t.length >= 2)
    .slice(0, MAX_TAGS)
}

// Publish one ITP product to Etsy: draft listing + image uploads (+ optional
// activate). Sync state and errors land in etsy_listings either way.
export async function publishProductToEtsy(productId: string, opts: EtsyPublishOptions = {}): Promise<EtsyPublishResult> {
  const result: EtsyPublishResult = { ok: false, productId, uploadedImages: 0 }

  const { data: product, error: prodErr } = await supabase
    .from('products')
    .select('id, name, description, price, images, category, meta_title, meta_description, search_keywords, status, is_active')
    .eq('id', productId)
    .maybeSingle()
  if (prodErr) throw new Error(`Product lookup failed: ${prodErr.message}`)
  if (!product) throw new Error(`Product ${productId} not found`)

  // One listing per product — refuse a duplicate rather than double-list.
  const { data: existing } = await supabase
    .from('etsy_listings')
    .select('id, listing_id, state')
    .eq('product_id', productId)
    .maybeSingle()
  if (existing?.listing_id && existing.state !== 'error' && existing.state !== 'removed') {
    throw new Error(`Product already has Etsy listing ${existing.listing_id} (${existing.state}) — use update instead of re-posting`)
  }

  const upsertSync = async (fields: Record<string, unknown>) => {
    await supabase.from('etsy_listings').upsert(
      { product_id: productId, updated_at: new Date().toISOString(), ...fields },
      { onConflict: 'product_id' }
    )
  }

  try {
    const { token, shopId } = await getAccessToken()
    if (!shopId) throw new Error('Connected Etsy account has no shop — create the ITP Etsy store first')

    const taxonomyId = opts.taxonomyId ?? taxonomyIdFor(product.category)
    if (!taxonomyId) {
      throw new Error(`No Etsy taxonomy id for category "${product.category}" — set ETSY_TAXONOMY_MAP or pass taxonomyId (browse GET /api/admin/etsy/taxonomy)`)
    }

    const price = Math.max(Number(opts.priceOverride ?? product.price) || 0, MIN_PRICE_USD)
    const title = (product.meta_title || product.name || '').slice(0, MAX_TITLE_LEN)
    const baseDescription = product.description || product.meta_description || product.name
    const description = opts.descriptionSuffix ? `${baseDescription}\n\n${opts.descriptionSuffix}` : baseDescription
    const tags = toEtsyTags(product.search_keywords)
    const shippingProfileId = opts.shippingProfileId ?? (Number(process.env.ETSY_SHIPPING_PROFILE_ID) || undefined)
    const returnPolicyId = opts.returnPolicyId ?? (Number(process.env.ETSY_RETURN_POLICY_ID) || undefined)
    // Etsy now REQUIRES readiness_state_id on physical listings (verified live 2026-07-25 — omitting it 400s).
    // Provision once: POST /shops/{id}/readiness-state-definitions (readiness_state=made_to_order +
    // min_processing_time/max_processing_time, needs shops_w), then put its id in ETSY_READINESS_STATE_ID.
    const readinessStateId = opts.readinessStateId ?? (Number(process.env.ETSY_READINESS_STATE_ID) || undefined)

    await upsertSync({ state: 'pending', last_error: null })

    // createDraftListing — always lands in draft state (no fee, invisible).
    const listing = await etsyFetch(`/application/shops/${shopId}/listings`, {
      method: 'POST',
      token,
      form: {
        quantity: opts.quantity ?? Number(process.env.ETSY_DEFAULT_QUANTITY || 100),
        title,
        description,
        price,
        who_made: 'i_did',            // ITP prints in-house (Rockmart, GA)
        when_made: 'made_to_order',
        taxonomy_id: taxonomyId,
        type: 'physical',
        shipping_profile_id: shippingProfileId,
        return_policy_id: returnPolicyId,
        readiness_state_id: readinessStateId,
        tags: tags.length ? tags.join(',') : undefined
      }
    })
    const listingId: number = listing.listing_id
    result.listingId = listingId
    result.etsyUrl = `https://www.etsy.com/listing/${listingId}`
    await upsertSync({ listing_id: listingId, shop_id: shopId, state: 'draft', etsy_url: result.etsyUrl })

    // Upload up to 10 product images, sequentially (rate-limit friendly).
    // First success becomes the hero image (rank 1, upload order).
    const images: string[] = Array.isArray(product.images) ? product.images.slice(0, MAX_IMAGES) : []
    for (const url of images) {
      try {
        const imgRes = await fetch(url)
        if (!imgRes.ok) throw new Error(`image fetch ${imgRes.status}`)
        const buf = await imgRes.arrayBuffer()
        if (buf.byteLength > 10 * 1024 * 1024) throw new Error('image exceeds Etsy 10MB limit')
        const fd = new FormData()
        const name = (url.split('/').pop() || 'image').split('?')[0] || 'image.png'
        fd.append('image', new Blob([buf]), name)
        await etsyFetch(`/application/shops/${shopId}/listings/${listingId}/images`, { method: 'POST', token, multipart: fd })
        result.uploadedImages++
      } catch (imgErr: any) {
        console.warn(`[etsy] image upload failed for product ${productId} (${url}):`, imgErr.message)
      }
    }
    await upsertSync({ uploaded_image_count: result.uploadedImages })

    // Optional activation — explicit opt-in only; costs $0.20 and goes live.
    let finalState = 'draft'
    const wantPublish = opts.publish ?? (process.env.ETSY_AUTO_PUBLISH === 'true')
    if (wantPublish) {
      if (result.uploadedImages === 0) throw new Error('Cannot activate: no images uploaded (draft kept)')
      await etsyFetch(`/application/shops/${shopId}/listings/${listingId}`, {
        method: 'PATCH',
        token,
        form: { state: 'active' }
      })
      finalState = 'active'
    }

    await upsertSync({ state: finalState, last_synced_at: new Date().toISOString(), last_error: null })
    result.state = finalState
    result.ok = true
    return result
  } catch (err: any) {
    result.error = err.message
    await upsertSync({ state: result.listingId ? 'draft' : 'error', last_error: err.message })
    return result
  }
}

export async function listEtsyListings(limit = 100) {
  const { data, error } = await supabase
    .from('etsy_listings')
    .select('id, product_id, listing_id, shop_id, state, etsy_url, uploaded_image_count, last_error, last_synced_at, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return data ?? []
}
