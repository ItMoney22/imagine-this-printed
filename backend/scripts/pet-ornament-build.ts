// Pet ornament: a flat portrait PNG + a name -> the print files, offline
// (task 81358f3a). Same code path as checkout, minus storage. Writes one STL
// per colour, a preview SVG, the portrait map and a print_spec.json that the
// print check (assets/itp-print-picks/lib/print_check.py) slices for real.
//
//   npx tsx scripts/pet-ornament-build.ts <portrait.png | map.json> <name> <outDir> [font]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { filamentById } from '../shared/pet-ornament.js'
import { toBinaryStl } from '../services/name-print/geometry.js'
import { buildPetModel, toPetPreviewSvg } from '../services/pet-ornament/geometry.js'
import { decodeMap, encodeMap, quantizePortrait } from '../services/pet-ornament/quantize.js'

const [src, name, outDir, font = 'brush-script'] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })
const t0 = Date.now()
const { map, report } = src.endsWith('.json')
  ? { map: decodeMap(readFileSync(src, 'utf8')), report: null }
  : await quantizePortrait(readFileSync(src))
const t1 = Date.now()
const model = buildPetModel(map, font, name)
const t2 = Date.now()
writeFileSync(join(outDir, 'portrait-map.json'), encodeMap(map))
writeFileSync(join(outDir, 'preview.svg'), toPetPreviewSvg(model))
const slug = 'pet-ornament'
for (const p of model.parts) writeFileSync(join(outDir, `${slug}_${p.key}.stl`), toBinaryStl(p, `ITP pet ornament ${p.key}`))
writeFileSync(
  join(outDir, 'print_spec.json'),
  JSON.stringify(
    {
      slug,
      process: '0.16mm Optimal @BBL A1',
      overrides: {
        wall_loops: '3', sparse_infill_density: '20%', sparse_infill_pattern: 'gyroid', top_shell_layers: '5',
        bottom_shell_layers: '3', brim_type: 'no_brim', seam_position: 'back', ironing_type: 'top',
        enable_prime_tower: '0', flush_into_infill: '1', prime_tower_width: '25',
      },
      colors: model.parts.map((p) => filamentById(p.filament)!.hex),
      color_names: model.parts.map((p) => `Bambu PLA Basic ${filamentById(p.filament)!.name} (${p.key})`),
      plates: [{ name: `Pet ornament ${name}`, objects: [{ name: `Pet ornament ${name}`, parts: model.parts.map((p) => ({ stl: `${slug}_${p.key}.stl`, slot: p.slot })) }] }],
    },
    null,
    1
  )
)
console.log(JSON.stringify({ quantizeMs: t1 - t0, buildMs: t2 - t1, report, filaments: map.filaments, parts: model.parts.map((p) => ({ key: p.key, slot: p.slot, filament: p.filament, regions: p.regions.length, tris: p.triangles.length })), size: model.size, nameSize: model.nameSize }))
