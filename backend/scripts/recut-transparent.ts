/**
 * Re-cut a design's print file by RE-RENDERING it transparent, instead of
 * carving a cutout out of a design that was painted onto an opaque field.
 *
 * WHY THIS EXISTS: every print file made before 2026-09-03 was produced by
 * removing a background that should never have been generated. On black line
 * art drawn on a black field that is not a solvable problem - the ink and the
 * background are the same pixels - so those files carry either ghosted outlines
 * (colour key) or deleted floating artwork (AI segmentation). gpt-image-2's
 * edit endpoint accepts `background:'transparent'` and re-renders the SAME
 * artwork with real alpha, which is as close to a lossless recut as exists.
 *
 * It is a re-render, not a pixel copy: the linework is redrawn, so the result
 * is recognisably the same design but not byte-identical to the source. That is
 * the trade for a genuinely clean separation. The `source` asset is left alone,
 * so the design the user picked still shows in the picker.
 *
 *   npx tsx scripts/recut-transparent.ts --since 2026-09-02T22:00:00Z
 *   npx tsx scripts/recut-transparent.ts --product <uuid> [--product <uuid>]
 *   npx tsx scripts/recut-transparent.ts --since ... --dry-run
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { editOpenAIImage } from '../services/image-flow/providers/openai-image.js'

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const RECUT_PROMPT =
  'Remove the background completely so the background is fully transparent. Keep the artwork itself ' +
  'EXACTLY as it is - identical composition, identical linework, identical colours and detail. ' +
  'Change nothing except deleting the background.'

/** Fraction of pixels that are fully transparent, and whether the border is clear. */
async function alphaReport(buf: Buffer): Promise<{ clear: number; borderClear: number }> {
  const { data, info } = await sharp(buf).ensureAlpha().resize(128, 128, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H } = info
  let clear = 0
  for (let i = 3; i < data.length; i += 4) if (data[i] < 16) clear++
  let bc = 0, bt = 0
  const look = (x: number, y: number) => { bt++; if (data[(y * W + x) * 4 + 3] < 16) bc++ }
  for (let x = 0; x < W; x++) { look(x, 0); look(x, H - 1) }
  for (let y = 0; y < H; y++) { look(0, y); look(W - 1, y) }
  return { clear: clear / (W * H), borderClear: bc / bt }
}

async function recut(productId: string, dryRun: boolean): Promise<void> {
  const { data: product } = await supabase.from('products').select('id,name,category').eq('id', productId).single()
  if (!product) { console.log(`  ${productId}: no such product`); return }
  const label = (product.name ?? '').slice(0, 44)

  // Metal art is a full-bleed panel - it is SUPPOSED to have a background.
  if (/metal/i.test(product.category ?? '') || /metal/i.test(product.name ?? '')) {
    console.log(`  SKIP  ${label} - metal art keeps its background`)
    return
  }

  const { data: source } = await supabase.from('product_assets').select('id,url')
    .eq('product_id', productId).eq('kind', 'source').order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!source) { console.log(`  SKIP  ${label} - no source asset`); return }

  if (dryRun) { console.log(`  would recut  ${label}`); return }

  const slug = (product.name ?? 'design').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
  const objectPath = `graphics/${slug}/transparent/${slug}-recut-${Date.now()}.png`
  const { url, path, modelId } = await editOpenAIImage({
    sourceUrl: source.url, prompt: RECUT_PROMPT, quality: 'high',
    background: 'transparent', moderation: 'low', objectPath,
  })

  const buf = Buffer.from(await (await fetch(url)).arrayBuffer())
  const report = await alphaReport(buf)
  const dims = await sharp(buf).metadata()
  if (report.clear < 0.1 || report.borderClear < 0.8) {
    console.log(`  FAIL  ${label} - came back opaque (clear ${(100 * report.clear).toFixed(1)}%, ` +
      `border ${(100 * report.borderClear).toFixed(0)}%); old cut LEFT IN PLACE`)
    return
  }

  const { data: inserted, error } = await supabase.from('product_assets').insert({
    product_id: productId, kind: 'nobg', path, url,
    width: dims.width ?? 1024, height: dims.height ?? 1024,
    asset_role: 'auxiliary', is_primary: false, display_order: 99,
    metadata: {
      bg_removal_method: 'generated-transparent',
      model_id: modelId,
      recut_from_asset_id: source.id,
      recut_at: new Date().toISOString(),
    },
  }).select('id').single()
  if (error) { console.log(`  FAIL  ${label} - insert: ${error.message}`); return }

  // Only now is it safe to drop the old cut.
  const { data: stale } = await supabase.from('product_assets').select('id')
    .eq('product_id', productId).eq('kind', 'nobg').neq('id', inserted!.id)
  for (const a of stale ?? []) await supabase.from('product_assets').delete().eq('id', a.id)

  console.log(`  OK    ${label} - transparent ${(100 * report.clear).toFixed(1)}%, replaced ${stale?.length ?? 0} old cut(s)`)
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const dryRun = argv.includes('--dry-run')
  const ids = argv.filter((a, i) => argv[i - 1] === '--product')
  const sinceIdx = argv.indexOf('--since')
  const since = sinceIdx >= 0 ? argv[sinceIdx + 1] : undefined

  let targets = ids
  if (!targets.length && since) {
    const { data } = await supabase.from('product_assets').select('product_id')
      .eq('kind', 'nobg').gte('created_at', since)
    targets = [...new Set((data ?? []).map((r: any) => r.product_id))]
  }
  if (!targets.length) {
    console.error('nothing to do - pass --product <uuid> or --since <iso timestamp>')
    process.exit(1)
  }

  console.log(`recutting ${targets.length} design(s)${dryRun ? ' (dry run)' : ''}`)
  for (const id of targets) {
    try { await recut(id, dryRun) } catch (e: any) { console.log(`  FAIL  ${id}: ${e?.message}`) }
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
