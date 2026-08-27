import dotenv from 'dotenv'
dotenv.config({ override: true })
import { createClient } from '@supabase/supabase-js'
import { runImageFlowMockup } from '../services/image-flow/worker-helpers.js'
import fs from 'fs'
import path from 'path'
import fetch from 'node-fetch'

// Force the 2-step fallback chain by disabling single-call Flux-2
process.env.MOCKUP_FLUX2_SINGLE_CALL = 'false'

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

const ARTIFACTS_DIR = 'C:/Users/David/.gemini/antigravity-cli/brain/c9371447-34fc-44ff-affd-1aa74fd284fd'
const IMG_DIR = path.join(ARTIFACTS_DIR, 'verification_images')

if (!fs.existsSync(IMG_DIR)) {
  fs.mkdirSync(IMG_DIR, { recursive: true })
}

interface MockupRun {
  id: number
  template: 'flat_lay' | 'ghost_mannequin'
  color: 'black' | 'white' | 'gray'
  emptyGarmentUrl?: string
  finalUrl?: string
  error?: string
  latencyMs?: number
}

async function download(name: string, url: string) {
  const dest = path.join(IMG_DIR, name)
  console.log(`Downloading ${name} from ${url.slice(0, 80)}...`)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`failed to fetch: ${url} (${response.statusText})`)
  const fileStream = fs.createWriteStream(dest)
  await new Promise((resolve, reject) => {
    response.body.pipe(fileStream)
    response.body.on('error', reject)
    fileStream.on('finish', resolve)
  })
}

async function main() {
  console.log('=== STARTING 2-STEP FALLBACK FIX VERIFICATION ===')

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

  // We patched worker-helpers.ts to print the Step A URL
  // We can intercept the console.log output or simply parse the output of this script.
  // We will download the images during the loop by logging them and capturing them.
  // To make it easy, we'll run them sequentially and download their files immediately.

  // Let's monkeypatch console.log to intercept Step A URLs dynamically!
  const originalLog = console.log
  let lastStepAUrl = ''
  console.log = function(...args) {
    const msg = args.join(' ')
    if (msg.includes('2-step Step A empty garment URL:')) {
      const match = msg.match(/URL:\s*(https:\/\/\S+)/)
      if (match) {
        lastStepAUrl = match[1]
      }
    }
    originalLog.apply(console, args)
  }

  for (const run of runs) {
    console.log(`\n--- Run ${run.id}: template=${run.template} color=${run.color} ---`)
    const t0 = Date.now()
    try {
      lastStepAUrl = ''
      const res = await runImageFlowMockup({
        template: run.template,
        designImageUrl: design.url,
        productType: 'tshirt',
        shirtColor: run.color,
        printPlacement: 'front-center',
      })
      run.finalUrl = res.url
      run.emptyGarmentUrl = lastStepAUrl
      run.latencyMs = Date.now() - t0
      console.log(`Finished Run ${run.id} in ${(run.latencyMs / 1000).toFixed(1)}s`)
      
      // Download Step A and Step B
      if (run.emptyGarmentUrl) {
        await download(`run_${run.id}_step_a.jpg`, run.emptyGarmentUrl)
      }
      if (run.finalUrl) {
        await download(`run_${run.id}_step_b.png`, run.finalUrl)
      }
    } catch (err: any) {
      run.error = err?.message ?? String(err)
      console.error(`Failed Run ${run.id}:`, run.error)
    }
  }

  // Restore original log
  console.log = originalLog

  console.log('\n=== FIX VERIFICATION RESULTS SUMMARY ===')
  console.log(JSON.stringify(runs, null, 2))
}

main().catch((e) => {
  console.error('Verification runner failed:', e)
  process.exit(1)
})
