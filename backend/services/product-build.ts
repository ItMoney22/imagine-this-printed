/**
 * Product build pipeline — the select-image core, extracted from
 * routes/admin/ai-products.ts so the ADMIN builder and the CREATOR studio run
 * the exact same code path. This file exists to prevent a third copy of the
 * mockup fan-out: the file already carried two (select-image + create-mockups)
 * and the in-code comments document how changes to one silently missed the
 * other. Anything that changes what a "build" produces belongs HERE.
 *
 * applyImageSelection() — multi-pick image selection (David 2026-08-09:
 * "sometimes i like more then 1 … do products for each"):
 *   - first pick keeps the product; every extra pick clones the draft and
 *     re-homes that candidate onto the clone
 *   - losing candidates (and their DTF twins) are deleted
 *   - each product gets the full mockup fan-out (flat lay, ghost mannequin,
 *     Mr. Imagine, two-sided back view, pocket shot) + the model shoot
 */
import { supabase } from '../lib/supabase.js'
import { slugify, generateUniqueSlug } from '../utils/slugify.js'
import { GHOST_MANNEQUIN_SUPPORTED_CATEGORIES, GHOST_MANNEQUIN_SUPPORTED_PRODUCT_TYPES } from './replicate.js'
import { startModelShots } from './etsy-model-shots.js'
import { addWatermark } from './watermark.js'
import { uploadImageFromBuffer } from './google-cloud-storage.js'
import { chooseGarmentColorForDesign, garmentColorMetadata, type GarmentColorDecision } from './garment-color.js'

/**
 * Gallery contract slot: a watermarked copy of the chosen design for
 * storefront display — the raw design never ships unprotected. Exactly one
 * per product (replaces any prior design_watermarked asset).
 */
export async function createWatermarkedDesignAsset(
  productId: string,
  sourceAsset: { id: string; url: string },
): Promise<void> {
  try {
    const watermarked = await addWatermark(sourceAsset.url)
    const { data: product } = await supabase
      .from('products')
      .select('slug')
      .eq('id', productId)
      .single()
    const slug = product?.slug || productId.substring(0, 8)
    const gcsPath = `graphics/${slug}/watermarked/${slug}-design-watermarked-${Date.now()}.png`
    const { publicUrl, path } = await uploadImageFromBuffer(watermarked, gcsPath, 'image/png')

    await supabase
      .from('product_assets')
      .delete()
      .eq('product_id', productId)
      .eq('asset_role', 'design_watermarked')

    const { error } = await supabase.from('product_assets').insert({
      product_id: productId,
      kind: 'design_preview',
      path,
      url: publicUrl,
      asset_role: 'design_watermarked',
      is_primary: false,
      display_order: 4,
      metadata: {
        parent_asset_id: sourceAsset.id,
        watermarked_at: new Date().toISOString(),
      },
    })
    if (error) throw new Error(error.message)
    console.log('[product-build] 🔒 Watermarked design asset created for product:', productId)
  } catch (err: any) {
    console.error('[product-build] ⚠️ Watermarked design asset failed:', err.message)
  }
}

/**
 * Decide, record and return the garment colour a product's mockups should be
 * rendered on.
 *
 * WHY IT LIVES HERE. This file's own header says anything that changes what a
 * "build" produces belongs in it, and the colour of the shirt in every listing
 * photo is about as load-bearing as that gets. Both callers of
 * applyImageSelection (the admin builder and the creator studio) go through
 * here already, and routes/admin/ai-products.ts's /create-mockups twin imports
 * this same function so the two fan-outs cannot drift on the one setting that
 * put a black design on a black shirt.
 *
 * THE RULE:
 *   - a colour a HUMAN asked for is never overridden. That is what
 *     `metadata.shirt_color_source === 'requested'` records, and the create
 *     routes only stamp it when the request body actually named a colour.
 *   - anything else is MEASURED off the artwork (services/garment-color.ts).
 *     Rows created before this existed carry no source at all, so they are
 *     measured too — which is the intended repair: their 'black' was never a
 *     decision, it was a default.
 *   - a failure (no artwork yet, unreadable file, no ink) changes nothing. The
 *     product keeps whatever it had, exactly as before.
 *
 * The decision and its numbers are written to `metadata.garment_color` so that
 * "why is this on a white shirt" has an answer that outlives the job.
 */
export async function resolveGarmentColor(opts: {
  productId: string
  /** The artwork that will be printed — the selected design asset's URL. */
  designUrl: string | null | undefined
  /** Garment id or legacy string ('tshirt', 'shirts', 'hoodie'). */
  productType: string | null | undefined
  /** The product's category; metal art has no garment and is skipped. */
  category?: string | null
  /** Already-loaded metadata, to save a read. Re-read when omitted. */
  metadata?: Record<string, any> | null
  log?: { info?: (o: any, m: string) => void; error?: (o: any, m: string) => void }
}): Promise<{ color: string; source: 'requested' | 'measured' | 'default'; decision: GarmentColorDecision | null }> {
  const { productId, designUrl, productType, log } = opts

  let meta = opts.metadata ?? null
  if (!meta) {
    const { data } = await supabase.from('products').select('metadata').eq('id', productId).maybeSingle()
    meta = ((data as any)?.metadata as Record<string, any>) || {}
  }

  const stamped = typeof meta.shirt_color === 'string' && meta.shirt_color ? meta.shirt_color : null

  if (opts.category === 'metal-art' || meta.product_type === 'metal-art') {
    return { color: stamped ?? 'black', source: 'default', decision: null }
  }
  if (meta.shirt_color_source === 'requested' && stamped) {
    return { color: stamped, source: 'requested', decision: null }
  }
  if (!designUrl) {
    return { color: stamped ?? 'black', source: 'default', decision: null }
  }

  const decision = await chooseGarmentColorForDesign(designUrl, { garment: productType })
  if (!decision) {
    log?.info?.({ productId }, '[product-build] garment colour not measurable — keeping the existing value')
    return { color: stamped ?? 'black', source: 'default', decision: null }
  }

  // Read-modify-write: products.metadata is one JSON column that many writers
  // share, so the update has to carry everything that was already there.
  const { data: fresh } = await supabase.from('products').select('metadata').eq('id', productId).maybeSingle()
  const current = ((fresh as any)?.metadata as Record<string, any>) || meta
  const { error } = await supabase
    .from('products')
    .update({
      metadata: {
        ...current,
        shirt_color: decision.color,
        shirt_color_source: 'measured',
        garment_color: garmentColorMetadata(decision, 'measured'),
      },
    })
    .eq('id', productId)
  if (error) {
    console.warn('[product-build] ⚠️ could not persist the garment colour decision:', error.message)
  }

  console.log('[product-build] 👕 garment colour MEASURED:', JSON.stringify({
    product_id: productId,
    was: stamped,
    now: decision.color,
    alternates: decision.alternates,
    reason: decision.reason,
  }))
  log?.info?.({ productId, color: decision.color, was: stamped }, '[product-build] 👕 garment colour chosen from the artwork')

  return { color: decision.color, source: 'measured', decision }
}

export interface ApplyImageSelectionOpts {
  productId: string
  /** Primary pick first; every extra id becomes its own sibling product. */
  pickedIds: string[]
  /** Who triggered the build — passed to the model shoot pipeline. */
  actorId: string
  log?: { info?: (o: any, m: string) => void; error?: (o: any, m: string) => void }
}

export type ApplyImageSelectionResult =
  | { ok: true; selectedAsset: any; createdJobs: any[]; siblings: Array<{ productId: string; assetId: string; name: string }> }
  | { ok: false; status: number; error: string }

export async function applyImageSelection(opts: ApplyImageSelectionOpts): Promise<ApplyImageSelectionResult> {
  const { productId: id, actorId, log } = opts
  const pickedIds = Array.from(new Set(opts.pickedIds.filter((v) => typeof v === 'string' && v.length > 0)))
  if (pickedIds.length === 0) return { ok: false, status: 400, error: 'selectedAssetId (or selectedAssetIds) is required' }

  const primaryAssetId = pickedIds[0]
  const extraAssetIds = pickedIds.slice(1)

  log?.info?.({ productId: id, pickedIds }, '[product-build] 🎨 image(s) selected')

  // Get every picked asset, scoped to this product
  const { data: pickedAssets, error: assetError } = await supabase
    .from('product_assets')
    .select('*')
    .in('id', pickedIds)
    .eq('product_id', id)

  const selectedAsset = (pickedAssets || []).find((a) => a.id === primaryAssetId)
  if (assetError || !selectedAsset || (pickedAssets || []).length !== pickedIds.length) {
    return { ok: false, status: 404, error: 'Selected asset not found' }
  }

  // Mark the primary pick with explicit fields
  await supabase
    .from('product_assets')
    .update({
      is_primary: true,
      asset_role: 'design',
      display_order: 1,
      metadata: {
        ...selectedAsset.metadata,
        is_selected: true,
        selected_at: new Date().toISOString(),
      },
    })
    .eq('id', primaryAssetId)

  // Watermarked design copy for the storefront gallery (fire-and-forget —
  // it's ready long before the build reaches its final step).
  void createWatermarkedDesignAsset(id, { id: selectedAsset.id, url: selectedAsset.url })

  // DELETE non-selected source and DTF images.
  // Keep: EVERY picked source asset + their corresponding DTF assets
  // (matching model_id) — extra picks are re-homed onto cloned products
  // below, so deleting them here would destroy the sibling builds.
  console.log('[product-build] 🗑️ Deleting non-selected assets for product:', id, '(keeping picks:', pickedIds.join(', '), ')')

  const pickedModelIds = new Set((pickedAssets || []).map((a) => a.metadata?.model_id).filter(Boolean))

  const { data: allAssets } = await supabase
    .from('product_assets')
    .select('id, kind, metadata')
    .eq('product_id', id)
    .in('kind', ['source', 'dtf'])

  const idsToDelete = (allAssets || [])
    .filter((asset) => {
      if (pickedIds.includes(asset.id)) return false
      if (asset.kind === 'dtf' && asset.metadata?.model_id && pickedModelIds.has(asset.metadata.model_id)) return false
      return true
    })
    .map((a) => a.id)

  if (idsToDelete.length > 0) {
    const { data: deletedAssets, error: deleteError } = await supabase
      .from('product_assets')
      .delete()
      .in('id', idsToDelete)
      .select('id')
    if (deleteError) {
      console.error('[product-build] ❌ Failed to delete non-selected assets:', deleteError)
      log?.error?.({ error: deleteError }, '[product-build] ⚠️ Failed to delete non-selected assets')
    } else {
      console.log('[product-build] ✅ Deleted', deletedAssets?.length || 0, 'non-selected assets')
    }
  }

  // Clean up ALL existing mockup JOBS (including succeeded) to prevent duplicate generation
  const { error: deleteMockupJobsError } = await supabase
    .from('ai_jobs')
    .delete()
    .eq('product_id', id)
    .in('type', ['replicate_mockup', 'replicate_mockup_v2']) // BOTH legacy + v2 (clears prod-orphan dupes)
  if (deleteMockupJobsError) {
    console.warn('[product-build] ⚠️ Failed to delete existing mockup jobs:', deleteMockupJobsError)
  }

  // Clean up existing mockup assets to prevent accumulation
  const { error: deleteMockupsError } = await supabase
    .from('product_assets')
    .delete()
    .eq('product_id', id)
    .eq('kind', 'mockup')
  if (deleteMockupsError) {
    console.warn('[product-build] ⚠️ Failed to delete existing mockups:', deleteMockupsError)
  }

  // Image job carries the DTF settings chosen at creation time. The admin
  // builder creates these as 'replicate_image_v2' (only the legacy worker used
  // plain 'replicate_image'), so match BOTH — a stale single-type filter
  // returns null and every DTF setting silently defaults.
  const { data: imageJob } = await supabase
    .from('ai_jobs')
    .select('input')
    .eq('product_id', id)
    .in('type', ['replicate_image', 'replicate_image_v2'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Full product row — needed both for DTF settings AND for cloning siblings.
  const { data: product } = await supabase
    .from('products')
    .select('*')
    .eq('id', id)
    .single()

  // Product metadata is the authoritative source for DTF settings — every
  // create path writes shirt_color / product_type / print_placement onto
  // products.metadata. Image job input is a secondary fallback; defaults last.
  const meta = (product?.metadata as any) || {}
  const resolvedProductType = meta.product_type || imageJob?.input?.productType || 'tshirt'
  const resolvedPrintPlacement = meta.print_placement || imageJob?.input?.printPlacement || 'front-center'
  const resolvedPrintSize = Number(meta.print_size_inches) || Number(imageJob?.input?.printSizeInches) || 11

  // GARMENT COLOUR IS MEASURED, NOT DEFAULTED (David 2026-09-01, on black line
  // art rendered onto a black polo: "it should go on a white shirt because of
  // how it looks but it was mocked on a black shirt"). The artwork exists by
  // the time a build starts — it is the asset the user just picked — so this is
  // the first point in the pipeline where the question can actually be answered.
  const garmentColor = await resolveGarmentColor({
    productId: id,
    designUrl: selectedAsset.url,
    productType: resolvedProductType,
    category: product?.category,
    metadata: meta,
    log,
  })
  const resolvedShirtColor = garmentColor.color

  console.log('[product-build] 🎯 mockup DTF settings:', JSON.stringify({
    shirtColor: resolvedShirtColor,
    shirtColorSource: garmentColor.source,
    productType: resolvedProductType,
    printPlacement: resolvedPrintPlacement,
    printSizeInches: resolvedPrintSize,
  }))

  const productCategory = product?.category || 'shirts'

  // Build the full mockup fan-out for ONE product. Parameterized because the
  // same fan-out runs for this product AND for each sibling clone built from
  // an extra pick. NOTE: routes/admin/ai-products.ts still carries a twin
  // fan-out in /create-mockups — keep the two in lockstep until that endpoint
  // is also routed through here.
  const buildMockupJobs = (targetProductId: string, designAssetId: string): any[] => {
    const baseInput = {
      product_type: productCategory,
      productType: resolvedProductType,
      shirtColor: resolvedShirtColor,
      printPlacement: resolvedPrintPlacement,
      printSizeInches: resolvedPrintSize,
      selected_asset_id: designAssetId,
    }
    const jobs: any[] = []

    if (productCategory === 'metal-art') {
      // Metal art: size-accurate scenes, no garment/mascot templates.
      const metalSize = meta.metal_size === '8x10' ? '8x10' : '4x6'
      for (const template of ['metal_shelf', 'metal_wall']) {
        jobs.push({
          product_id: targetProductId,
          type: 'replicate_mockup_v2',
          status: 'queued',
          input: { ...baseInput, template, metalSize },
        })
      }
      console.log(`[product-build] 🖼️ Metal-art mockup jobs (size ${metalSize}): metal_shelf + metal_wall`)
      return jobs
    }

    // Two-sided products render each side as its OWN job: a single image
    // can't show front and back at once, so the front shots override to
    // front-center and a dedicated back shot carries mockupRole so the
    // worker files it as mockup_back instead of evicting the front flat lay.
    const isTwoSided = resolvedPrintPlacement === 'front-back'
    const frontPlacement = isTwoSided ? 'front-center' : resolvedPrintPlacement

    jobs.push({
      product_id: targetProductId,
      type: 'replicate_mockup_v2',
      status: 'queued',
      input: { ...baseInput, template: 'flat_lay', printPlacement: frontPlacement },
    })

    // Ghost mannequin only for supported garment types
    if (GHOST_MANNEQUIN_SUPPORTED_CATEGORIES.includes(productCategory) ||
        GHOST_MANNEQUIN_SUPPORTED_PRODUCT_TYPES.includes(resolvedProductType)) {
      jobs.push({
        product_id: targetProductId,
        type: 'replicate_mockup_v2',
        status: 'queued',
        input: { ...baseInput, template: 'ghost_mannequin', printPlacement: frontPlacement },
      })
      console.log('[product-build] 👻 Adding ghost mannequin job for garment type:', resolvedProductType)
    }

    // Always add Mr. Imagine mockup (garment paths only)
    jobs.push({
      product_id: targetProductId,
      type: 'replicate_mockup_v2',
      status: 'queued',
      input: { ...baseInput, template: 'mr_imagine', printPlacement: frontPlacement },
    })

    // Back view for two-sided products
    if (isTwoSided) {
      jobs.push({
        product_id: targetProductId,
        type: 'replicate_mockup_v2',
        status: 'queued',
        input: { ...baseInput, template: 'flat_lay', printPlacement: 'back-only', mockupRole: 'mockup_back' },
      })
      console.log('[product-build] 🔄 Adding back-view mockup job (two-sided product)')
    }

    // Extra pocket-scale merchandising shot
    const alreadyPocketScale = resolvedPrintPlacement === 'left-pocket'
    const backOnly = resolvedPrintPlacement === 'back-only'
    if (!alreadyPocketScale && !backOnly) {
      jobs.push({
        product_id: targetProductId,
        type: 'replicate_mockup_v2',
        status: 'queued',
        input: { ...baseInput, template: 'flat_lay', printPlacement: 'left-pocket' },
      })
      console.log('[product-build] 👕 Adding pocket-scale mockup job')
    }

    // SECOND COLOURWAY. Only when the measurement says the design genuinely
    // holds up on another base (services/garment-color.ts: almost no vanishing
    // ink AND comfortable mean contrast) — a colourway is a listing variation
    // and another render bill, so "technically legible" is not the bar.
    //
    // mockupRole pins it to its own slot: without that it would land as
    // mockup_flat_lay and the replace-by-role write in the worker would have
    // the two colours delete each other forever.
    for (const alt of garmentColor.decision?.alternates ?? []) {
      jobs.push({
        product_id: targetProductId,
        type: 'replicate_mockup_v2',
        status: 'queued',
        input: {
          ...baseInput,
          shirtColor: alt,
          template: 'flat_lay',
          printPlacement: frontPlacement,
          mockupRole: `mockup_color_${alt}`,
        },
      })
      console.log('[product-build] 🎨 Adding second-colourway mockup job:', alt)
    }
    return jobs
  }

  const mockupJobs = buildMockupJobs(id, primaryAssetId)

  console.log('[product-build] 🎨 Creating mockup jobs:', mockupJobs.map((j) => ({ type: j.type, template: j.input?.template || j.type, placement: j.input?.printPlacement })))

  const { data: createdJobs, error: jobError } = await supabase
    .from('ai_jobs')
    .insert(mockupJobs)
    .select()

  if (jobError) {
    console.error('[product-build] ❌ Mockup job creation error:', jobError)
    log?.error?.({ error: jobError }, '[product-build] ❌ Mockup job creation error')
    return { ok: false, status: 500, error: 'Failed to create mockup jobs' }
  }

  log?.info?.({ jobCount: createdJobs?.length }, '[product-build] ✅ Mockup jobs created (flat_lay + ghost_mannequin + mr_imagine + pocket)')

  // Two real-person model shots, mirrored into product_assets when they pass
  // QA (services/etsy-model-shots.ts). Fire-and-forget: the shoot outlives
  // this request and a shoot failure must not fail mockup creation.
  if (productCategory !== 'metal-art') {
    startModelShots(id, actorId || 'system')
      .then(() => console.log('[product-build] 📸 model shots kicked off for', id))
      .catch((e: any) => console.warn('[product-build] model shots did not start:', e?.message))
  }

  // EXTRA PICKS → one sibling product each. Clone the draft (row + variants
  // + tags, NOT assets), re-home the picked candidate and its DTF twin onto
  // the clone, then run the identical mockup fan-out + model shoot for it.
  // A sibling failure never fails the primary selection — it logs and moves
  // on, and the result names only the siblings that actually built.
  const siblings: Array<{ productId: string; assetId: string; name: string }> = []
  if (product && extraAssetIds.length > 0) {
    for (const [i, extraId] of extraAssetIds.entries()) {
      const pickNumber = i + 2
      const extraAsset = (pickedAssets || []).find((a) => a.id === extraId)
      if (!extraAsset) continue
      try {
        const altName = `${product.name} — Alt ${pickNumber}`
        const baseSlug = slugify(`${product.name} alt ${pickNumber}`)
        const { data: slugRows } = await supabase
          .from('products')
          .select('slug')
          .like('slug', `${baseSlug}%`)
        const altSlug = generateUniqueSlug(baseSlug, (slugRows || []).map((r: any) => r.slug))

        const { id: _pid, created_at: _pc, updated_at: _pu, ...productRest } = product
        const { data: clone, error: cloneErr } = await supabase
          .from('products')
          .insert({
            ...productRest,
            name: altName,
            slug: altSlug,
            status: 'draft',
            is_active: false,
            images: [],
            metadata: {
              ...(product.metadata || {}),
              sibling_of: id,
              sibling_pick: pickNumber,
              sibling_created_at: new Date().toISOString(),
            },
          })
          .select()
          .single()
        if (cloneErr || !clone) {
          console.warn('[product-build] ⚠️ sibling clone insert failed for pick', pickNumber, cloneErr?.message)
          continue
        }

        for (const table of ['product_variants', 'product_tags']) {
          const { data: rows } = await supabase.from(table).select('*').eq('product_id', id)
          if (rows && rows.length > 0) {
            const rowClones = rows.map(({ id: _i, created_at: _cc, updated_at: _uu, ...r }: any) => ({
              ...r,
              product_id: clone.id,
            }))
            const { error: cErr } = await supabase.from(table).insert(rowClones)
            if (cErr) console.warn(`[product-build] ⚠️ sibling ${table} copy failed:`, cErr.message)
          }
        }

        // Re-home the picked candidate onto the clone as its design
        await supabase
          .from('product_assets')
          .update({
            product_id: clone.id,
            is_primary: true,
            asset_role: 'design',
            display_order: 1,
            metadata: {
              ...extraAsset.metadata,
              is_selected: true,
              selected_at: new Date().toISOString(),
            },
          })
          .eq('id', extraId)

        // …and its DTF twin, if one exists
        const extraModelId = extraAsset.metadata?.model_id
        if (extraModelId) {
          await supabase
            .from('product_assets')
            .update({ product_id: clone.id })
            .eq('product_id', id)
            .eq('kind', 'dtf')
            .eq('metadata->>model_id', extraModelId)
        }

        void createWatermarkedDesignAsset(clone.id, { id: extraAsset.id, url: extraAsset.url })

        const cloneJobs = buildMockupJobs(clone.id, extraId)
        const { error: cloneJobErr } = await supabase.from('ai_jobs').insert(cloneJobs)
        if (cloneJobErr) {
          console.warn('[product-build] ⚠️ sibling mockup jobs failed for', clone.id, cloneJobErr.message)
        }

        if (productCategory !== 'metal-art') {
          startModelShots(clone.id, actorId || 'system')
            .then(() => console.log('[product-build] 📸 model shots kicked off for sibling', clone.id))
            .catch((e: any) => console.warn('[product-build] sibling model shots did not start:', e?.message))
        }

        siblings.push({ productId: clone.id, assetId: extraId, name: altName })
        console.log('[product-build] 👯 Sibling product built from pick', pickNumber, '→', clone.id)
      } catch (e: any) {
        console.warn('[product-build] ⚠️ sibling build failed for pick', pickNumber, e?.message)
      }
    }
    log?.info?.({ requested: extraAssetIds.length, built: siblings.length }, '[product-build] 👯 Sibling products from extra picks')
  }

  return { ok: true, selectedAsset, createdJobs: createdJobs || [], siblings }
}
