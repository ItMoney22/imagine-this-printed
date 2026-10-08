// Re-runs only the GLB → STL conversion for an existing 3D model row, picking
// up the new print-prep pipeline (Z-up rotate, scale to size_tier mm, center +
// ground). No Tripo / fal cost — uses the already-stored GLB.
//
// Usage: npx tsx --env-file=.env scripts/reconvert-3d-stl.ts <model_id>

import '../load-env.js'
import { createClient } from '@supabase/supabase-js'
import { SIZE_TIERS, type PrintSizeTier } from '../services/tripo3d.js'
import { modelFilePath, signOwnModelFile, storeModelFile } from '../services/model-files.js'
import { convertGlbToStl } from '../services/glb-to-stl.js'

const modelId = process.argv[2]
if (!modelId) {
  console.error('Usage: tsx scripts/reconvert-3d-stl.ts <model_id>')
  process.exit(1)
}

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function main() {
  const { data: model, error } = await sb
    .from('user_3d_models')
    .select('id, glb_url, size_tier, print_height_mm, metadata')
    .eq('id', modelId)
    .single()
  if (error || !model) throw new Error('Model not found: ' + (error?.message ?? ''))
  if (!model.glb_url) throw new Error('Model has no glb_url — generate the 3D first')

  const tierKey = (model.size_tier || 'small') as PrintSizeTier
  const tier = SIZE_TIERS[tierKey] ?? SIZE_TIERS.small
  const targetHeightMm = model.print_height_mm || tier.printHeightMm

  console.log('[reconvert] model:', modelId)
  console.log('[reconvert] tier:', tierKey, '| target height:', targetHeightMm + 'mm')

  // The GLB is private (task 1417e863): read it through a short-lived link.
  const glbLink = await signOwnModelFile(model, 'glb', { ttlMinutes: 15 })
  if (!glbLink) throw new Error('Could not sign the stored GLB (' + model.glb_url + ')')
  const { stlBuffer, triangleCount, bboxMm, processingTime } = await convertGlbToStl(glbLink, {
    targetHeightMm,
    yUpToZUp: true,
    centerAndGround: true,
  })
  console.log('[reconvert] STL ready —', triangleCount, 'triangles in', processingTime.toFixed(1) + 's')
  if (bboxMm) console.log('[reconvert] STL bbox (mm):', bboxMm.x.toFixed(1), '×', bboxMm.y.toFixed(1), '×', bboxMm.z.toFixed(1))

  const stlRef = await storeModelFile(stlBuffer, modelFilePath(modelId, 'stl'), 'stl')
  console.log('[reconvert] STL saved (private bucket)')

  await sb.from('user_3d_models').update({
    stl_url: stlRef,
    triangle_count: triangleCount,
    metadata: {
      ...(model.metadata ?? {}),
      stl_bbox_mm: bboxMm,
      stl_z_up: true,
      stl_centered_grounded: true,
      stl_reconverted_at: new Date().toISOString(),
    },
    updated_at: new Date().toISOString(),
  }).eq('id', modelId)

  console.log('[reconvert] 🎉 done')
  console.log('[reconvert] stl:', stlRef)
}

main().catch((e) => { console.error('[reconvert] ❌', e?.message ?? e); process.exit(1) })
