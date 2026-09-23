// Live smoke for the team-plate pipeline (task 65d98dd9):
//
//   flare edit -> cache miss/hit -> crisp upscale -> cache miss/hit -> GCS persistence
//
// Runs the REAL production dependencies (OpenAI gpt-image-2.5-flare, Replicate
// recraft-crisp-upscale, the real bucket) through plate-store.renderOrGetCached,
// with one substitution: the source art is read from a URL instead of a
// product_assets row, so nothing is written to the database. Costs one flare
// edit and one upscale per new name; a second run with the same name costs
// nothing, which is the point of the cache.
//
//   npx tsx --env-file=.env scripts/team-plate-smoke.ts <sourceUrl> [NAME] [NUMBER] [outDir]
//
// Exits non-zero on any failed expectation.
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { parseTeamTemplate } from '../shared/team-template.js'
import { __setGenerateDeps, realDeps, renderOrGetCached, platePath } from '../services/team-plate/plate-store.js'
import { fileExists, downloadFile } from '../services/gcs-storage.js'

const [sourceUrl, name = 'RODRIGUEZ', number = '27', outDir = '.'] = process.argv.slice(2)
if (!sourceUrl) {
  console.error('usage: team-plate-smoke.ts <sourceUrl> [NAME] [NUMBER] [outDir]')
  process.exit(2)
}

function check(ok: boolean, what: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`)
  if (!ok) process.exitCode = 1
}

async function main() {
  const srcRes = await fetch(sourceUrl)
  if (!srcRes.ok) throw new Error(`source fetch ${srcRes.status}`)
  const srcBuf = Buffer.from(await srcRes.arrayBuffer())
  const srcMeta = await sharp(srcBuf).metadata()
  const w = 3600
  const h = Math.round((w * srcMeta.height!) / srcMeta.width!)

  // Zones in canvas px, read off the BEAR 9 art (the derive route's job in
  // production). They are placement HINTS to the model now, not glyph boxes.
  const template = parseTeamTemplate({
    version: 1,
    side: 'back_image',
    plateAssetId: 'smoke-plate',
    sourceAssetId: `smoke-source:${sourceUrl.split('?')[0]}`,
    distressAssetId: null,
    canvas: { w, h, dpi: 300 },
    halftone: false,
    upcharge: 0,
    fields: [
      {
        key: 'name', label: 'Last name', type: 'text', max: 12, uppercase: true,
        zone: { x: 240, y: 360, w: 3120, h: 1620 }, arch: 16,
        font: { family: 'collegiate-slab', src: 'house' },
        fill: '#7A1F2E', strokes: [{ color: '#D9C18F', w: 18 }], offset: null,
      },
      {
        key: 'number', label: 'Number', type: 'number', max: 2, uppercase: false,
        zone: { x: 1020, y: 1740, w: 1680, h: 2400 }, arch: 0,
        font: { family: 'varsity-block', src: 'house' },
        fill: '#C8AE7D', strokes: [{ color: '#7A1F2E', w: 24 }], offset: null,
      },
    ],
  })
  if (!template) throw new Error('smoke template did not parse')
  const values = { name, number }

  let edits = 0
  let upscales = 0
  __setGenerateDeps({
    ...realDeps,
    loadAsset: async () => ({ url: sourceUrl, buffer: srcBuf }),
    edit: async (o) => {
      edits++
      return realDeps.edit(o)
    },
    upscale: async (u, b) => {
      upscales++
      return realDeps.upscale(u, b)
    },
  })

  const t0 = Date.now()
  const preview = await renderOrGetCached(template, values, 900)
  const t1 = Date.now()
  console.log(`preview: ${preview.rendered ? 'MISS' : 'HIT'} in ${((t1 - t0) / 1000).toFixed(1)}s model=${preview.modelId ?? '-'} path=${preview.path}`)
  check(preview.path === platePath(template, values, 'base'), 'preview stored at its deterministic base path')

  const editsAfterFirst = edits
  const again = await renderOrGetCached(template, values, 900)
  check(!again.rendered && edits === editsAfterFirst, 'same name + number again is a cache hit (no flare call)')

  const t2 = Date.now()
  const press = await renderOrGetCached(template, values, w)
  const t3 = Date.now()
  console.log(`press:   ${press.rendered ? 'MISS' : 'HIT'} in ${((t3 - t2) / 1000).toFixed(1)}s path=${press.path}`)
  check(edits === editsAfterFirst, 'press file reused the approved base (no second flare call)')

  const upscalesAfterPress = upscales
  const pressAgain = await renderOrGetCached(template, values, w)
  check(!pressAgain.rendered && upscales === upscalesAfterPress, 'press again is a cache hit (no AI, no upscale)')

  check(!/^https?:|sig=|Signature=/.test(press.path), 'order-facing path is a durable gcsPath, not a signed URL')
  check(await fileExists(press.path), 'press file exists in GCS')
  check(await fileExists(preview.path), 'base file exists in GCS')

  const pressBuf = await downloadFile(press.path)
  const baseBuf = await downloadFile(preview.path)
  const pm = await sharp(pressBuf).metadata()
  const bm = await sharp(baseBuf).metadata()
  console.log(`base ${bm.width}x${bm.height}  press ${pm.width}x${pm.height} (canvas ${w}x${h})`)
  check(pm.width === w && pm.height === h, `press is the full 300 DPI canvas (${w}x${h})`)

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, `smoke-base-${name}-${number}.png`), baseBuf)
  fs.writeFileSync(path.join(outDir, `smoke-press-${name}-${number}.png`), pressBuf)
  await sharp(pressBuf).extract({ left: Math.round(w * 0.25), top: Math.round(h * 0.1), width: 900, height: 900 })
    .png().toFile(path.join(outDir, `smoke-press-crop-${name}-${number}.png`))
  console.log(`flare edits: ${edits}, upscales: ${upscales}`)
}

main().catch((err) => {
  console.error('SMOKE FAILED:', err?.message ?? err)
  process.exit(1)
})
