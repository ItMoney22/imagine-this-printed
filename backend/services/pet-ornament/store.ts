// Pet ornament — the I/O half (task 81358f3a). geometry.ts and quantize.ts
// are pure; this is where pictures and print files live.
//
//   portraits   users/pet-ornaments/portraits/<id>.json   the four-colour map
//               users/pet-ornaments/portraits/<id>.png    what the model drew
//               users/pet-ornaments/photos/<id>.<ext>     the customer's photo
//   stock       backend/assets/pet-ornament/<pet>.json   (in the repo, no I/O)
//   print files users/pet-ornaments/geo-v<N>/<key>/       one STL per colour +
//                                                         print-spec.json
//
// A portrait id is the hash of the photo bytes, so the same photo uploaded
// twice is drawn once (and paid for once). Orders store durable gcs paths,
// never signed URLs; whoever needs a file signs it on read.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { downloadFile, fileExists, generateSignedUrl } from '../gcs-storage.js'
import { uploadImageFromBuffer } from '../google-cloud-storage.js'
import { filamentById, type PetOrnamentTemplate, type PetOrnamentValues } from '../../shared/pet-ornament.js'
import { toBinaryStl } from '../name-print/geometry.js'
import { PET_GEOMETRY_VERSION, buildPetModel, type PetModel } from './geometry.js'
import { decodeMap, encodeMap, type PortraitMap } from './quantize.js'

const OWNER = 'pet-ornaments'

/**
 * Where the files go. GCS in production; a test or the local walk harness
 * (scripts/pet-ornament-dev-server.ts) swaps in its own.
 */
export const blobStore = {
  exists: (p: string): Promise<boolean> => fileExists(p),
  read: (p: string): Promise<Buffer> => downloadFile(p),
  write: async (buf: Buffer, p: string, contentType: string): Promise<void> => {
    await uploadImageFromBuffer(buf, p, contentType)
  },
  sign: (p: string, hours: number): Promise<string> => generateSignedUrl(p, hours),
}

export function portraitId(photo: Buffer): string {
  return createHash('sha256').update(photo).digest('hex').slice(0, 24)
}

export const portraitMapPath = (id: string) => `users/${OWNER}/portraits/${id}.json`
export const portraitPngPath = (id: string) => `users/${OWNER}/portraits/${id}.png`
export const photoPath = (id: string, ext: string) => `users/${OWNER}/photos/${id}.${ext}`

// ---------------------------------------------------------------------------
// Stock portraits (no photo): committed maps, read once
// ---------------------------------------------------------------------------

const HERE = path.dirname(fileURLToPath(import.meta.url))
// Source runs from backend/services/pet-ornament, the build from backend/dist/...
const STOCK_DIRS = [path.join(HERE, '../../assets/pet-ornament'), path.join(HERE, '../../../assets/pet-ornament')]
const stockCache = new Map<string, PortraitMap>()

export function stockPortrait(pet: string): PortraitMap {
  const hit = stockCache.get(pet)
  if (hit) return hit
  if (!/^[a-z-]{1,20}$/.test(pet)) throw new Error(`No stock portrait for "${pet}"`)
  const dir = STOCK_DIRS.find((d) => existsSync(path.join(d, `${pet}.json`)))
  if (!dir) throw new Error(`No stock portrait for "${pet}"`)
  const map = decodeMap(readFileSync(path.join(dir, `${pet}.json`), 'utf8'))
  stockCache.set(pet, map)
  return map
}

// ---------------------------------------------------------------------------
// Customer portraits
// ---------------------------------------------------------------------------

/** A small in-process cache: the preview re-reads the same map on every keystroke of the name. */
const mapCache = new Map<string, PortraitMap>()
const MAP_CACHE_MAX = 200

export async function savePortrait(id: string, map: PortraitMap): Promise<void> {
  await blobStore.write(Buffer.from(encodeMap(map)), portraitMapPath(id), 'application/json')
  remember(id, map)
}

export async function loadPortrait(id: string): Promise<PortraitMap | null> {
  const hit = mapCache.get(id)
  if (hit) return hit
  if (!(await blobStore.exists(portraitMapPath(id)))) return null
  const map = decodeMap((await blobStore.read(portraitMapPath(id))).toString('utf8'))
  remember(id, map)
  return map
}

function remember(id: string, map: PortraitMap): void {
  if (mapCache.size >= MAP_CACHE_MAX) mapCache.delete(mapCache.keys().next().value as string)
  mapCache.set(id, map)
}

/** The map for a cart line: the customer's portrait, or the stock one for the pet. */
export async function mapFor(values: PetOrnamentValues): Promise<PortraitMap> {
  if (values.portrait) {
    const map = await loadPortrait(values.portrait)
    if (!map) throw new Error('That photo portrait has expired — please upload the photo again')
    return map
  }
  return stockPortrait(values.pet)
}

// ---------------------------------------------------------------------------
// Print files
// ---------------------------------------------------------------------------

export function printKey(template: PetOrnamentTemplate, values: PetOrnamentValues): string {
  return createHash('sha256')
    .update(JSON.stringify([template.version, template.font, values.pet, values.portrait, values.name]))
    .digest('hex')
    .slice(0, 24)
}

export function printDir(template: PetOrnamentTemplate, values: PetOrnamentValues): string {
  return `users/${OWNER}/geo-v${PET_GEOMETRY_VERSION}/${printKey(template, values)}`
}

/** What the print floor needs to load the AMS and assemble the parts. */
export interface PetPrintSpec {
  kind: 'pet-ornament'
  geometryVersion: number
  name: string
  pet: string
  sizeMm: { x: number; y: number; z: number }
  parts: Array<{ key: string; stl: string; slot: number; filament: string; filamentName: string; hex: string; z0: number; z1: number }>
  /** The settings the print check passed with (0.16 mm, 3 walls, 20% gyroid, ironing, Textured PEI). */
  process: string
}

export function printSpec(model: PetModel, dir: string, values: PetOrnamentValues): PetPrintSpec {
  return {
    kind: 'pet-ornament',
    geometryVersion: PET_GEOMETRY_VERSION,
    name: values.name,
    pet: values.pet,
    sizeMm: model.size,
    parts: model.parts.map((p) => {
      const f = filamentById(p.filament)!
      return { key: p.key, stl: `${dir}/${p.key}.stl`, slot: p.slot, filament: f.id, filamentName: `Bambu PLA Basic ${f.name}`, hex: f.hex, z0: p.z0, z1: p.z1 }
    }),
    process: '0.16mm Optimal @BBL A1',
  }
}

export interface StoredPetPrint {
  /** The print-spec.json path: what order_items.metadata.print_file_path points at. */
  path: string
  built: boolean
  spec: PetPrintSpec
}

/** Builds and uploads the STLs + spec unless they are already there. ~60 ms of geometry plus the uploads. */
export async function storePetPrint(template: PetOrnamentTemplate, values: PetOrnamentValues): Promise<StoredPetPrint> {
  const dir = printDir(template, values)
  const specPath = `${dir}/print-spec.json`
  const map = await mapFor(values)
  const model = buildPetModel(map, template.font, values.name)
  const spec = printSpec(model, dir, values)
  if (await blobStore.exists(specPath)) return { path: specPath, built: false, spec }
  for (const p of model.parts) await blobStore.write(toBinaryStl(p, `ITP pet ornament ${p.key}`), `${dir}/${p.key}.stl`, 'model/stl')
  await blobStore.write(Buffer.from(JSON.stringify(spec, null, 1)), specPath, 'application/json')
  return { path: specPath, built: true, spec }
}

export async function readPetPrintSpec(specPath: string): Promise<PetPrintSpec> {
  return JSON.parse((await blobStore.read(specPath)).toString('utf8'))
}

/** A download link for the print floor (V4 signing caps at 7 days). */
export function signPetFile(p: string, hours = 24 * 7 - 1): Promise<string> {
  return blobStore.sign(p, hours)
}
