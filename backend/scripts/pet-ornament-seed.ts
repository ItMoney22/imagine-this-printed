// Create-your-own pet ornament — seed the product (task 81358f3a, 2026-11-01).
//
//   cd backend && npx tsx --env-file=<backend .env> scripts/pet-ornament-seed.ts            # dry run: renders the images to <tmp>/pet-ornament-out
//   cd backend && npx tsx --env-file=<backend .env> scripts/pet-ornament-seed.ts --apply    # uploads the images, inserts/updates the DRAFT
//   ... --apply --activate                                                                # same, and puts it on sale
//
// Idempotent: a product that already exists by name is updated in place.
// Images: the hero (our own stock cat on a tree, public/pet-ornament/hero.webp),
// the three stock designs with example names, and the stock cat ornament
// alone. All drawn from the house's own stock portraits — never a customer
// photo and never a third-party photo.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { createClient } from '@supabase/supabase-js'
import { PET_NAME_MAX, PETS, type PetOrnamentTemplate } from '../shared/pet-ornament.js'
import { buildPetModel, toPetPreviewSvg } from '../services/pet-ornament/geometry.js'
import { stockPortrait } from '../services/pet-ornament/store.js'

const APPLY = process.argv.includes('--apply')
const ACTIVATE = process.argv.includes('--activate')
const OUT = path.join(tmpdir(), 'pet-ornament-out')
const HERE = path.dirname(fileURLToPath(import.meta.url))

const NAME = 'Create Your Own Pet Ornament'
// $19.99: the name ornament is $16.99; this one adds the portrait and up to
// three more colours. Our cost is about $0.40 (17 g PLA + one ~$0.02 drawing)
// and 1 h 15 min of printer time — volume over margin for the holiday window.
const PRICE = 19.99

const TEMPLATE: PetOrnamentTemplate = {
  version: 1,
  pets: PETS,
  font: 'brush-script',
  field: { key: 'name', label: "Your pet's name", max: PET_NAME_MAX },
  photo: true,
  upcharge: 0,
}

const DESCRIPTION = [
  'A Christmas ornament of YOUR pet, with their name. Pick cat, dog or bunny, type the name, and add a photo of your pet if you like: we draw your pet as a bold, flat cartoon portrait and 3D print it in up to four colours. No photo? You get our own cute design for your pet.',
  'You see your ornament on this page before you order, and you can try another photo as many times as you like. We print exactly the name you type, capitals included, up to 12 characters.',
  'About 2.6 in wide and 3.1 in tall (67 x 79 mm), with a hanging hole in the cap. Ribbon or hook not included.',
  'Made to order in PLA plastic and ships within 3 business days.',
].join('\n\n')

const BACKDROP = '#F7F3EE'

async function renderSvg(svg: string, size: number): Promise<Buffer> {
  return sharp(Buffer.from(svg), { density: 600 }).resize(size, size, { fit: 'contain', background: BACKDROP }).png().toBuffer()
}

async function single(pet: string, name: string): Promise<Buffer> {
  const art = await renderSvg(toPetPreviewSvg(buildPetModel(stockPortrait(pet), TEMPLATE.font, name)), 1240)
  return sharp({ create: { width: 1600, height: 1600, channels: 3, background: BACKDROP } }).composite([{ input: art, left: 180, top: 180 }]).png().toBuffer()
}

async function lineup(): Promise<Buffer> {
  const picks: Array<[string, string]> = [['cat', 'Biscuit'], ['dog', 'Rosie'], ['bunny', 'Clover']]
  const tiles = await Promise.all(picks.map(([pet, name]) => renderSvg(toPetPreviewSvg(buildPetModel(stockPortrait(pet), TEMPLATE.font, name)), 500)))
  return sharp({ create: { width: 1600, height: 1600, channels: 3, background: BACKDROP } })
    .composite(tiles.map((input, i) => ({ input, left: 25 + i * 525, top: 550 })))
    .png()
    .toBuffer()
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const hero = await sharp(readFileSync(path.join(HERE, '../../public/pet-ornament/hero.webp'))).png().toBuffer()
  const images = [await sharp(hero).resize(1600, 1600, { fit: 'cover' }).png().toBuffer(), await lineup(), await single('cat', 'Biscuit')]
  images.forEach((buf, i) => writeFileSync(path.join(OUT, `pet-ornament-${i + 1}.png`), buf))
  console.log(`rendered ${images.length} images to ${OUT}`)
  if (!APPLY) return

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { uploadImageFromBuffer } = await import('../services/google-cloud-storage.js')
  const urls: string[] = []
  for (const [i, buf] of images.entries()) urls.push((await uploadImageFromBuffer(buf, `products/pet-ornament/pet-ornament-${i + 1}.png`, 'image/png')).publicUrl)

  const row = {
    name: NAME,
    description: DESCRIPTION,
    price: PRICE,
    images: urls,
    category: '3d-prints',
    status: ACTIVATE ? 'active' : 'draft',
    is_active: true,
    approved: ACTIVATE,
    product_type: 'physical',
    sizes: [],
    colors: [],
    print_locations: [],
    meta_title: 'Custom Pet Ornament From Your Photo | 3D Printed Cat & Dog Ornament',
    meta_description: "Your pet's portrait and name on a 3D printed Christmas ornament. Add a photo, see your ornament before you order, made to order and ships in 3 business days.",
    search_keywords: 'custom pet ornament, pet ornament with name, cat ornament personalized, dog ornament personalized, pet photo ornament, pet memorial ornament, 3d printed ornament',
    alt_text: 'Create your own pet ornament: a cat portrait ornament with the name Biscuit on a Christmas tree',
  }
  const { data: existing, error: findErr } = await supabase.from('products').select('id, metadata').eq('name', NAME).maybeSingle()
  if (findErr) throw new Error(findErr.message)
  const metadata = {
    ...(existing?.metadata ?? {}),
    pet_ornament: TEMPLATE,
    // magnet_sockets 0: the print bridge defaults a 3D print to 2 magnets.
    print3d: { enabled: true, material: 'PLA', magnet_sockets: 0, color_mode: 'grey' },
    source: 'pet_ornament_81358f3a',
  }
  if (existing) {
    const { error } = await supabase.from('products').update({ ...row, metadata }).eq('id', existing.id)
    if (error) throw new Error(error.message)
    console.log(`updated ${row.status} ${existing.id}`)
  } else {
    const { data, error } = await supabase.from('products').insert({ ...row, metadata }).select('id').single()
    if (error) throw new Error(error.message)
    console.log(`inserted ${row.status} ${data.id}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
