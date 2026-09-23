/**
 * End-to-end proof of the two-sided spin video (task cd85eaca, David
 * 2026-09-22: "if we do a video shoot it needs to be able to show front nd back").
 *
 *   1. Renders the ON-PERSON back shot from a product's existing front
 *      on-person shot (shootBackModelShot — the same call the Step Flow's
 *      'model-back' key makes), verified against the real back artwork.
 *   2. Builds the spin-video request with planSpinVideo — the exact function
 *      POST /api/ai/realtime/spin-video uses — from the product's real row,
 *      with the fresh back shot laid into step_flow.shots IN MEMORY ONLY.
 *   3. Fires the prediction, waits, and downloads the mp4.
 *
 * Read-only against the product row: nothing is written to products or
 * product_assets, so a live listing is never touched. The renders land in
 * GCS/Replicate like any other paid shot.
 *
 *   npx tsx scripts/verify-two-sided-spin.ts <productId> <userId> <outDir>
 */
import 'dotenv/config'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import Replicate from 'replicate'
import { supabase } from '../lib/supabase.js'
import { shootBackModelShot } from '../services/etsy-model-shots.js'
import { planSpinVideo } from '../services/spin-video.js'

async function main() {
  const [productId, userId, outDir] = process.argv.slice(2)
  if (!productId || !userId || !outDir) throw new Error('usage: verify-two-sided-spin.ts <productId> <userId> <outDir>')
  mkdirSync(outDir, { recursive: true })

  const { data: product, error } = await supabase
    .from('products')
    .select('id, name, images, metadata, print_locations')
    .eq('id', productId)
    .single()
  if (error || !product) throw new Error(`product: ${error?.message}`)
  const meta = (product.metadata || {}) as Record<string, any>
  const front = meta.step_flow?.shots?.model
  if (!front?.url || !front.assetId) throw new Error('product has no front on-person shot to turn around')
  console.log(`[verify] ${product.name} print_locations=${JSON.stringify(product.print_locations)}`)

  // 1. On-person back.
  const t0 = Date.now()
  const back = await shootBackModelShot(productId, userId, {
    frontShotUrl: front.url,
    shirtColor: meta.step_flow?.colors?.primary,
    garment: meta.step_flow?.garment,
  })
  console.log(`[verify] back shot ${back.check.ok ? 'PASSED' : 'FAILED'} QA${back.check.retried ? ' (after retry)' : ''} in ${Math.round((Date.now() - t0) / 1000)}s via ${back.modelId}`)
  if (back.check.reason) console.log(`[verify] QA reason: ${back.check.reason}`)
  console.log(`[verify] front: ${front.url}`)
  console.log(`[verify] back:  ${back.url}`)
  console.log(`[verify] back artwork: ${back.backArtworkUrl}`)

  // 2. Plan exactly as the route does, with the shot pair in memory.
  const row = {
    ...product,
    metadata: {
      ...meta,
      step_flow: {
        ...meta.step_flow,
        shots: {
          ...meta.step_flow.shots,
          model: { ...front, approved: true },
          'model-back': { status: 'done', url: back.url, sourceAssetId: front.assetId },
        },
      },
    },
  }
  const plan = planSpinVideo(row as any)
  if ('error' in plan) throw new Error(plan.error)
  console.log(`[verify] plan: model=${plan.model} twoSided=${plan.twoSided} backSource=${plan.backSource}`)
  if (plan.backSource !== 'paired') throw new Error(`expected a paired plan, got ${plan.backSource}`)

  // 3. Render.
  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })
  let prediction = await replicate.predictions.create({ model: plan.model, input: plan.input })
  console.log(`[verify] prediction ${prediction.id}`)
  while (!['succeeded', 'failed', 'canceled'].includes(prediction.status)) {
    await new Promise((r) => setTimeout(r, 5000))
    prediction = await replicate.predictions.get(prediction.id)
  }
  if (prediction.status !== 'succeeded') throw new Error(`prediction ${prediction.status}: ${prediction.error}`)
  const output = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output
  const res = await fetch(String(output))
  const mp4 = Buffer.from(await res.arrayBuffer())
  const path = join(outDir, `spin-${productId}.mp4`)
  writeFileSync(path, mp4)
  writeFileSync(join(outDir, 'result.json'), JSON.stringify({
    productId, frontUrl: front.url, backUrl: back.url, backArtworkUrl: back.backArtworkUrl, backCheck: back.check,
    model: plan.model, predictionId: prediction.id, videoUrl: output, metrics: prediction.metrics,
  }, null, 2))
  console.log(`[verify] video ${mp4.length} bytes → ${path}`)
  console.log(`[verify] replicate url: ${output}`)
}

main().catch((err) => {
  console.error('[verify] FAILED:', err?.message || err)
  process.exit(1)
})
