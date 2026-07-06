// ---------------------------------------------------------------------------
// Per-design SEO pack: meta title/description, search keywords, and social
// marketing hooks, generated once per product when it goes fully active.
//
// Entry points:
//   - generateSeoPackForProduct(id): fired (void, non-blocking) from the
//     admin approval route when a design lands status='active'.
//   - sweepMissingSeoPacks(): hourly worker catch-all — backfills any active
//     product without a pack (covers admin-created products and legacy rows),
//     bounded per run to keep model spend flat.
//
// Cost-first (David's standing rule): gpt-4o-mini, one call per product, and
// existing AI copy in metadata is reused as input, never regenerated.
// Idempotent via products.metadata.seo_pack_generated_at. If no OPENAI_API_KEY
// the pack falls back to mechanical derivation so columns still get filled.
// ---------------------------------------------------------------------------
import OpenAI from 'openai'
import { supabase } from '../lib/supabase.js'

const SEO_MODEL = process.env.SEO_PACK_MODEL || 'gpt-4o-mini'
const SWEEP_BATCH = Number(process.env.SEO_PACK_SWEEP_BATCH || 10)
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://imaginethisprinted.com'

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null

interface SeoPack {
  meta_title: string
  meta_description: string
  search_keywords: string[]
  captions: string[]
  hashtags: string[]
}

const clip = (s: string, max: number) => (s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…')

function mechanicalPack(product: any, tags: string[]): SeoPack {
  const name = String(product.name || 'Custom Design')
  const desc = String(product.description || `${name} — custom printed by Imagine This Printed.`)
  return {
    meta_title: clip(`${name} | Imagine This Printed`, 60),
    meta_description: clip(desc.replace(/\s+/g, ' '), 155),
    search_keywords: [...new Set([...tags, product.category, 'custom printing'].filter(Boolean).map(String))].slice(0, 10),
    captions: [`${name} — now live at Imagine This Printed 🎨`],
    hashtags: ['#customprinting', '#imaginethisprinted']
  }
}

async function aiPack(product: any, tags: string[]): Promise<SeoPack | null> {
  if (!openai) return null
  try {
    const context = {
      name: product.name,
      description: product.description,
      category: product.category,
      price: product.price,
      tags,
      original_prompt: product.metadata?.original_prompt || product.metadata?.image_prompt || null,
      existing_seo_title: product.metadata?.seo_title || null,
      existing_seo_description: product.metadata?.seo_description || null
    }
    const completion = await openai.chat.completions.create({
      model: SEO_MODEL,
      response_format: { type: 'json_object' },
      max_tokens: 600,
      messages: [
        {
          role: 'system',
          content:
            'You write ecommerce SEO metadata and short social captions for a custom-printing marketplace ' +
            '(shirts, DTF prints, metal art, 3D prints). Respond ONLY with JSON: ' +
            '{"meta_title": string (<=60 chars, include the design name, no site name), ' +
            '"meta_description": string (<=155 chars, benefit-led, natural), ' +
            '"search_keywords": string[] (8-12 buyer-intent phrases, lowercase), ' +
            '"captions": string[] (3 short social captions, 1 emoji max each, no links), ' +
            '"hashtags": string[] (8-10, lowercase, leading #)}. ' +
            'Reuse existing_seo_title/description if they are good. Never invent facts.'
        },
        { role: 'user', content: JSON.stringify(context) }
      ]
    })
    const raw = completion.choices[0]?.message?.content
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed.meta_title || !parsed.meta_description) return null
    return {
      meta_title: clip(String(parsed.meta_title), 70),
      meta_description: clip(String(parsed.meta_description), 160),
      search_keywords: Array.isArray(parsed.search_keywords) ? parsed.search_keywords.map(String).slice(0, 12) : [],
      captions: Array.isArray(parsed.captions) ? parsed.captions.map(String).slice(0, 3) : [],
      hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.map(String).slice(0, 10) : []
    }
  } catch (err: any) {
    console.error('[seo-pack] Model call failed (falling back to mechanical):', err?.message || err)
    return null
  }
}

export async function generateSeoPackForProduct(productId: string): Promise<boolean> {
  try {
    const { data: product, error } = await supabase
      .from('products')
      .select('id, name, slug, description, price, category, status, metadata')
      .eq('id', productId)
      .single()
    if (error || !product) {
      console.error(`[seo-pack] Product ${productId} not found:`, error?.message)
      return false
    }
    if (product.metadata?.seo_pack_generated_at) return true // already done

    const { data: tagRows } = await supabase.from('product_tags').select('tag').eq('product_id', productId)
    const tags = (tagRows || []).map(t => t.tag)

    const pack = (await aiPack(product, tags)) || mechanicalPack(product, tags)
    const productUrl = `${FRONTEND_URL}/product/${product.slug || product.id}`

    const { error: updateError } = await supabase
      .from('products')
      .update({
        meta_title: pack.meta_title,
        meta_description: pack.meta_description,
        search_keywords: pack.search_keywords.join(', '),
        metadata: {
          ...(product.metadata || {}),
          seo_pack_generated_at: new Date().toISOString(),
          marketing_hooks: {
            captions: pack.captions,
            hashtags: pack.hashtags,
            product_url: productUrl
          }
        }
      })
      .eq('id', productId)
    if (updateError) {
      console.error(`[seo-pack] Failed to persist pack for ${productId}:`, updateError.message)
      return false
    }
    console.log(`[seo-pack] ✅ SEO pack saved for "${product.name}" (${productId})`)

    // Queue a DRAFT TikTok post in the social outbox (David approves/edits in
    // the admin Outbox tab before Rico ever sees it). Idempotent via the
    // (product_id, platform, kind) unique index; never fails the pack.
    try {
      const { data: images } = await supabase.from('products').select('images').eq('id', productId).single()
      await supabase.from('social_outbox').upsert({
        product_id: productId,
        platform: 'tiktok',
        kind: 'post',
        caption: `${pack.captions[0] || product.name} ${productUrl}`.trim(),
        hashtags: pack.hashtags,
        media_urls: images?.images || [],
        listing: { title: product.name, description: product.description, price: product.price, product_url: productUrl },
        status: 'draft'
      }, { onConflict: 'product_id,platform,kind', ignoreDuplicates: true })
    } catch (outboxErr: any) {
      console.error(`[seo-pack] Outbox enqueue failed for ${productId}:`, outboxErr?.message || outboxErr)
    }
    return true
  } catch (err: any) {
    console.error(`[seo-pack] generateSeoPackForProduct(${productId}) error:`, err?.message || err)
    return false
  }
}

// Hourly catch-all: active products missing a pack (any creation path).
export async function sweepMissingSeoPacks(): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('id, metadata')
      .eq('status', 'active')
      .is('meta_title', null)
      .order('updated_at', { ascending: false })
      .limit(SWEEP_BATCH * 3)
    if (error) {
      console.error('[seo-pack] Sweep query failed:', error.message)
      return
    }
    const missing = (data || []).filter(p => !p.metadata?.seo_pack_generated_at).slice(0, SWEEP_BATCH)
    if (missing.length === 0) return
    console.log(`[seo-pack] Backfilling ${missing.length} product(s) without SEO packs`)
    for (const p of missing) {
      await generateSeoPackForProduct(p.id)
    }
  } catch (err: any) {
    console.error('[seo-pack] sweepMissingSeoPacks error:', err?.message || err)
  }
}
