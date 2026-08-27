import dotenv from 'dotenv'
dotenv.config({ override: true })
import { createClient } from '@supabase/supabase-js'
import { runImageFlowMockup } from '../services/image-flow/worker-helpers.js'

// Force the 2-step fallback chain by disabling single-call Flux-2
process.env.MOCKUP_FLUX2_SINGLE_CALL = 'false'

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

interface MockupRun {
  id: number
  template: 'flat_lay' | 'ghost_mannequin'
  color: 'black' | 'white' | 'gray'
  emptyGarmentUrl?: string
  finalUrl?: string
  error?: string
  latencyMs?: number
}

async function main() {
  console.log('=== STARTING 2-STEP FALLBACK REPRODUCTION ===')

  // Fetch a real source design to keep the test representative
  const { data: design, error: dErr } = await sb
    .from('product_assets')
    .select('id, url')
    .eq('kind', 'source')
    .eq('asset_role', 'design')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()
  if (dErr || !design?.url) throw new Error('no design asset found: ' + (dErr?.message ?? 'empty'))
  console.log(`Using design asset: ${design.id} (${design.url})`)

  const runs: MockupRun[] = [
    // Black garments
    { id: 1, template: 'flat_lay', color: 'black' },
    { id: 2, template: 'flat_lay', color: 'black' },
    { id: 3, template: 'ghost_mannequin', color: 'black' },
    { id: 4, template: 'ghost_mannequin', color: 'black' },
    // White garments
    { id: 5, template: 'flat_lay', color: 'white' },
    { id: 6, template: 'flat_lay', color: 'white' },
    { id: 7, template: 'ghost_mannequin', color: 'white' },
    { id: 8, template: 'ghost_mannequin', color: 'white' },
    // Gray garments
    { id: 9, template: 'flat_lay', color: 'gray' },
    { id: 10, template: 'flat_lay', color: 'gray' },
    { id: 11, template: 'ghost_mannequin', color: 'gray' },
    { id: 12, template: 'ghost_mannequin', color: 'gray' },
  ]

  // We will intercept the intermediate URL by modifying worker-helpers.ts or logging it
  // Actually, worker-helpers.ts doesn't return emptyGarmentUrl directly, but we can temporarily
  // patch it, or read it from the logs, or just add a log statement in worker-helpers.ts to print it!
  // Let's check worker-helpers.ts line 503:
  //   const emptyGarmentUrl = sceneRes.imageUrls[0]
  //   console.log(`[image-flow] 🧪 2-step Step A empty garment: ${emptyGarmentUrl}`)
  // That will print it nicely!

  for (const run of runs) {
    console.log(`\n--- Run ${run.id}: template=${run.template} color=${run.color} ---`)
    const t0 = Date.now()
    try {
      const res = await runImageFlowMockup({
        template: run.template,
        designImageUrl: design.url,
        productType: 'tshirt',
        shirtColor: run.color,
        printPlacement: 'front-center',
      })
      run.finalUrl = res.url
      run.latencyMs = Date.now() - t0
      console.log(`Finished Run ${run.id} in ${(run.latencyMs / 1000).toFixed(1)}s -> ${res.url}`)
    } catch (err: any) {
      run.error = err?.message ?? String(err)
      console.error(`Failed Run ${run.id}:`, run.error)
    }
  }

  console.log('\n=== REPRODUCTION RESULTS SUMMARY ===')
  console.log(JSON.stringify(runs, null, 2))
}

main().catch((e) => {
  console.error('Reproduction runner failed:', e)
  process.exit(1)
})
