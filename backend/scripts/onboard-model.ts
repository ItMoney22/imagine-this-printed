// Model onboarding helper.
//
//   npx tsx scripts/onboard-model.ts <owner/name>      # fetch + scaffold a specific model
//   npx tsx scripts/onboard-model.ts <search term>      # list candidate models to pick from
//
// It hits the Replicate API for the model's LIVE input schema and prints a
// ready-to-paste ImageModel registry entry, a buildInput() case mapping the
// real params, and a brand-name suggestion. We never auto-edit the registry —
// review the scaffold, then wire it into models.ts / input-builder.ts /
// BRAND_NAMES. (gpt-image runs via OpenAI direct, not this Replicate path.)

import 'dotenv/config'

const TOKEN = process.env.REPLICATE_API_TOKEN
if (!TOKEN) {
  console.error('REPLICATE_API_TOKEN not set (backend/.env).')
  process.exit(1)
}
const H = { Authorization: `Bearer ${TOKEN}` }

async function getModel(id: string): Promise<any | null> {
  const res = await fetch(`https://api.replicate.com/v1/models/${id}`, { headers: H })
  if (!res.ok) return null
  return res.json()
}

async function search(term: string): Promise<any[]> {
  // Replicate's relevance search uses the QUERY method with the term as body.
  const res = await fetch('https://api.replicate.com/v1/models', {
    method: 'QUERY' as any,
    headers: { ...H, 'Content-Type': 'text/plain' },
    body: term,
  }).catch(() => null as any)
  if (res && res.ok) {
    const j = await res.json()
    return j.results || []
  }
  return []
}

function guessTier(id: string, cost: number): string {
  if (/turbo|schnell|fast|lite|draft/i.test(id)) return 'draft'
  if (cost >= 0.05) return 'hero'
  return 'workhorse'
}

function scaffold(model: any) {
  const id = `${model.owner}/${model.name}`
  const props = model.latest_version?.openapi_schema?.components?.schemas?.Input?.properties || {}
  const keys = Object.keys(props)
  const cost = 0.04 // placeholder — set from the model's pricing on Replicate
  const tier = guessTier(id, cost)

  console.log('\n================ REGISTRY ENTRY (models.ts MODELS[]) ================')
  console.log(`  {
    id: '${id}',
    provider: 'replicate',
    tier: '${tier}',
    label: '${model.name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}',
    costPerImageUsd: ${cost}, // TODO: confirm on Replicate pricing page
    approxSeconds: 8, // TODO: confirm
    strengths: ['stylized'], // TODO: pick from Strength union
    notes: ${JSON.stringify((model.description || '').slice(0, 90))},
    promptCraft: 'TODO: how to best prompt this model (its dialect).',
  },`)

  console.log('\n================ buildInput() CASE (input-builder.ts) ================')
  const lines: string[] = [`    case '${id}': {`]
  if (keys.includes('aspect_ratio')) lines.push(`      base.aspect_ratio = '1:1'`)
  else if (keys.includes('size')) lines.push(`      base.size = '1024x1024' // confirm enum`)
  if (keys.includes('output_format')) lines.push(`      base.output_format = 'png'`)
  if (keys.includes('num_images')) lines.push(`      base.num_images = 1`)
  if (keys.includes('max_images')) lines.push(`      base.max_images = 1`)
  if (keys.includes('disable_safety_checker')) lines.push(`      // base.disable_safety_checker = true // optional — loosens NSFW filter`)
  if (keys.includes('safety_filter_level')) lines.push(`      base.safety_filter_level = 'block_only_high' // loosest`)
  const imgField = ['image_input', 'image_urls', 'input_images', 'images', 'image_url', 'image'].find((f) => keys.includes(f))
  if (imgField) lines.push(`      // if (refs.length) base.${imgField} = refs // for edit/compositing`)
  lines.push(`      break`)
  lines.push(`    }`)
  console.log(lines.join('\n'))

  console.log('\n================ BRAND NAME (models.ts BRAND_NAMES) ================')
  console.log(`  '${id}': 'Imagine TODO',`)

  console.log('\n================ FULL INPUT SCHEMA ================')
  for (const k of keys) {
    const p = props[k] || {}
    const enumv = p.enum ? ` enum[${p.enum.slice(0, 6).join('|')}]` : ''
    console.log(`  - ${k}: ${p.type || '?'}${p.default !== undefined ? ` (default ${JSON.stringify(p.default)})` : ''}${enumv}`)
  }
  console.log(`\nrun_count: ${model.run_count?.toLocaleString?.() || model.run_count}`)
  console.log('Add to pickFanOutModels candidate pool automatically (tier in workhorse/hero/text-in-image).')
}

async function main() {
  const arg = process.argv.slice(2).join(' ').trim()
  if (!arg) {
    console.error('Usage: npx tsx scripts/onboard-model.ts <owner/name | search term>')
    process.exit(1)
  }

  if (arg.includes('/')) {
    const model = await getModel(arg)
    if (!model) {
      console.error(`Model "${arg}" not found on Replicate (check the exact owner/name).`)
      process.exit(1)
    }
    console.log(`Found: ${model.owner}/${model.name} — ${model.description?.slice(0, 100) || ''}`)
    scaffold(model)
  } else {
    console.log(`Searching Replicate for "${arg}"...`)
    const results = await search(arg)
    if (!results.length) {
      console.log('No results (or search unavailable). Try the exact owner/name instead.')
      return
    }
    console.log('\nCandidates (newest/most-run first) — re-run with the exact owner/name to scaffold:')
    for (const r of results.slice(0, 15)) {
      console.log(`  ${r.owner}/${r.name}  ·  runs=${r.run_count?.toLocaleString?.() || '?'}  ·  ${(r.description || '').slice(0, 70)}`)
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
