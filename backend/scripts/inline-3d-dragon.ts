// One-off: process the dragon's 3D generation inline, bypassing the Render
// production worker which still has the old tcli_ Tripo Studio key. After
// running, the model row is updated to status=ready with glb/stl URLs.
import '../load-env.js'
import { createClient } from '@supabase/supabase-js'
import { generateTripo3D, SIZE_TIERS, type PrintSizeTier } from '../services/tripo3d.js'
import { uploadImageFromUrl, uploadImageFromBuffer } from '../services/google-cloud-storage.js'
import { convertGlbToStl } from '../services/glb-to-stl.js'

const modelId = '8638333f-7bf1-4a71-bc94-4e18b4027f96'
const userId = '3e409705-2d5f-4ef8-a819-c7579f226961'
const sizeTier: PrintSizeTier = 'small'
const tier = SIZE_TIERS[sizeTier]

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function main() {
  console.log('[inline] 🎲 Starting Tripo3D direct call for dragon...')
  const t0 = Date.now()

  const { data: model, error: modelErr } = await sb
    .from('user_3d_models')
    .select('concept_image_url, itc_charged')
    .eq('id', modelId)
    .single()
  if (modelErr || !model) throw new Error('Model not found: ' + (modelErr?.message ?? ''))
  console.log('[inline] using concept image:', model.concept_image_url.slice(0, 60) + '...')

  const { glbUrl: tripoGlbUrl, processingTimeSec, modelMetadata, pbrUrl, rendererPreviewUrl } = await generateTripo3D({
    imageUrl: model.concept_image_url,
    tier: sizeTier,
    orientation: 'align_image',
  })
  console.log('[inline] ✅ Tripo3D mesh ready in', processingTimeSec.toFixed(1) + 's via', modelMetadata.provider)

  const glbPath = `3d-models/${modelId}/model.glb`
  const { publicUrl: glbPublicUrl } = await uploadImageFromUrl(tripoGlbUrl, glbPath)
  console.log('[inline] ✅ GLB uploaded')

  const { stlBuffer, triangleCount, bboxMm } = await convertGlbToStl(glbPublicUrl, {
    targetHeightMm: tier.printHeightMm,
    yUpToZUp: true,
    centerAndGround: true,
  })
  if (bboxMm) console.log('[inline] STL bbox (mm):', bboxMm.x.toFixed(1), '×', bboxMm.y.toFixed(1), '×', bboxMm.z.toFixed(1))
  const stlPath = `3d-models/${modelId}/model.stl`
  const { publicUrl: stlPublicUrl } = await uploadImageFromBuffer(stlBuffer, stlPath, 'model/stl')
  console.log('[inline] ✅ STL ready —', triangleCount, 'triangles')

  const richUpdate = await sb.from('user_3d_models').update({
    glb_url: glbPublicUrl,
    stl_url: stlPublicUrl,
    status: 'ready',
    size_tier: sizeTier,
    print_height_mm: tier.printHeightMm,
    print_price_usd: tier.printPriceUsd,
    triangle_count: triangleCount,
    itc_charged: (model.itc_charged || 0) + tier.itcCost,
    metadata: {
      provider: modelMetadata.provider,
      face_limit: modelMetadata.faceLimit,
      texture: modelMetadata.texture,
      quad: modelMetadata.quad,
      auto_sized: modelMetadata.autoSized,
      pbr_url: pbrUrl,
      preview_url: rendererPreviewUrl,
      processing_time_sec: processingTimeSec,
      inline_process: true,
    },
    updated_at: new Date().toISOString(),
  }).eq('id', modelId)
  if (richUpdate.error) {
    console.warn('[inline] rich update failed, retrying minimal:', richUpdate.error.message)
    await sb.from('user_3d_models').update({
      glb_url: glbPublicUrl,
      stl_url: stlPublicUrl,
      status: 'ready',
      itc_charged: (model.itc_charged || 0) + tier.itcCost,
      updated_at: new Date().toISOString(),
    }).eq('id', modelId)
  }

  const { data: w } = await sb.from('user_wallets').select('itc_balance').eq('user_id', userId).single()
  const newBalance = (w?.itc_balance ?? 0) - tier.itcCost
  await sb.from('user_wallets').update({ itc_balance: newBalance }).eq('user_id', userId)
  await sb.from('itc_transactions').insert({
    user_id: userId,
    type: 'spend',
    amount: -tier.itcCost,
    balance_after: newBalance,
    reference_type: '3d_model',
    reference_id: modelId,
    description: `3D ${tier.label} conversion (inline bypass)`,
  })
  console.log('[inline] 💸 deducted', tier.itcCost, 'ITC | new balance:', newBalance)

  const totalS = Math.round((Date.now() - t0) / 1000)
  console.log(`[inline] 🎉 DONE in ${totalS}s`)
  console.log(`[inline] glb: ${glbPublicUrl}`)
  console.log(`[inline] stl: ${stlPublicUrl}`)
}

main().catch((e) => { console.error('[inline] ❌', e?.message ?? e); process.exit(1) })
