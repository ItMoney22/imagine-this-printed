// Post-merge / post-deploy verification for MOCKUP_FLUX2_SINGLE_CALL.
// Watchtower task d1f954de (jimmy-phix, 2026-08-16) — companion to
// scripts/grade-flux2-single-call-batch.ts.
//
// The grading run forced `MOCKUP_FLUX2_SINGLE_CALL=true` on its own process.
// Production runs the OTHER branch: neither Render service defines the var at
// all, so the live behaviour depends on `flux2SingleCallEnabled()` returning
// true when the var is UNSET. This script exercises exactly that, through the
// real `runImageFlowMockup()`, on a real design pulled read-only from
// `product_assets` — and doubles as the monitoring probe (it prints the
// `metadata.model_id` distribution of the most recent live mockup assets, which
// is how you confirm real customer jobs are taking the new path).
//
//   npx tsx scripts/verify-flux2-single-call.ts               # default path (var unset)
//   npx tsx scripts/verify-flux2-single-call.ts --keep-env    # honour the var as set (kill-switch test)
//   VERIFY_TEMPLATE=ghost_mannequin npx tsx scripts/verify-flux2-single-call.ts
//   VERIFY_COLOR=white VERIFY_BASELINE_ONLY=1 npx tsx ...     # $0 — distribution only
//
// One flux-2-pro call is ~$0.03; the 2-step fallback chain is ~$0.054.
import dotenv from 'dotenv'
// NOTE: plain `import 'dotenv/config'` does NOT override OS env, and David's
// vault loader exports a different SUPABASE_SERVICE_ROLE_KEY — that mismatch
// produces a bare "Invalid API key". Override, exactly as load-env.ts does.
dotenv.config({ override: true })
import { createClient } from '@supabase/supabase-js'
import { runImageFlowMockup } from '../services/image-flow/worker-helpers.js'

// Default run = production's actual condition: the var absent entirely.
if (!process.argv.includes('--keep-env')) delete process.env.MOCKUP_FLUX2_SINGLE_CALL

// Real asset_role values written by ai-jobs-worker.ts:~1019 (confirmed live,
// Watchtower task 189bc25b) — the original list here had 'mockup_ghost' and
// 'mockup_front', neither of which the worker ever writes, so the baseline
// probe silently excluded every ghost_mannequin asset from its distribution.
const MOCKUP_ROLES = ['mockup_flat_lay', 'mockup_ghost_mannequin', 'mockup_mr_imagine', 'mockup_pocket', 'mockup_back']

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

async function main() {
  // --- monitoring probe: which model produced the most recent LIVE mockups ---
  const { data: recent, error: rErr } = await sb
    .from('product_assets')
    .select('id, asset_role, metadata, created_at')
    .in('asset_role', MOCKUP_ROLES)
    .order('created_at', { ascending: false })
    .limit(25)
  if (rErr) {
    console.log('[baseline] query error:', rErr.message)
  } else {
    const dist: Record<string, number> = {}
    for (const r of recent ?? []) {
      const m = (r.metadata as any)?.model_id ?? '(none)'
      dist[m] = (dist[m] ?? 0) + 1
    }
    console.log('[baseline] last 25 live mockup assets by metadata.model_id:', dist)
    console.log('[baseline] newest mockup asset created_at:', recent?.[0]?.created_at ?? '(none)')
  }
  if (process.env.VERIFY_BASELINE_ONLY) return

  // --- a real production design to feed the mockup ---
  const { data: design, error: dErr } = await sb
    .from('product_assets')
    .select('id, url')
    .eq('kind', 'source')
    .eq('asset_role', 'design')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()
  if (dErr || !design?.url) throw new Error('no design asset found: ' + (dErr?.message ?? 'empty'))

  const template = (process.env.VERIFY_TEMPLATE as any) ?? 'flat_lay'
  const shirtColor = (process.env.VERIFY_COLOR as any) ?? 'black'
  console.log(
    `[verify] template=${template} color=${shirtColor} design=${design.id} ` +
    `MOCKUP_FLUX2_SINGLE_CALL=${JSON.stringify(process.env.MOCKUP_FLUX2_SINGLE_CALL)}`
  )

  const t0 = Date.now()
  const r = await runImageFlowMockup({
    template,
    designImageUrl: design.url,
    productType: 'tshirt',
    shirtColor,
    printPlacement: 'front-center',
  } as any)
  console.log(`[verify] modelId = ${r.modelId} (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
  console.log('[verify] url =', r.url)

  const single = r.modelId === 'black-forest-labs/flux-2-pro'
  const wantSingle = !/^(0|false|no|off)$/i.test(process.env.MOCKUP_FLUX2_SINGLE_CALL ?? '')
  console.log(
    single === wantSingle
      ? `[verify] PASS — took the ${single ? 'single-call flux-2-pro' : '2-step chain'} path, as expected`
      : `[verify] FAIL — expected ${wantSingle ? 'flux-2-pro' : 'the 2-step chain'}, got ${r.modelId}`
  )
  // Open the URL and LOOK at it — the failure modes this exists to catch
  // (wearer/mascot, wrong garment colour, hallucinated props, garbled
  // letterforms) are all visual and none of them throw.
  process.exit(single === wantSingle ? 0 : 1)
}

main().catch((e) => {
  console.error('[verify] ERROR', e?.message ?? e)
  process.exit(1)
})
