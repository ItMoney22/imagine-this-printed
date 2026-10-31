// 3D name gifts — seed the two DRAFT products (task bf353160, 2026-10-28).
//
//   cd backend && npx tsx --env-file=<backend .env> scripts/name-gifts-seed.ts            # dry run: renders the images to <tmp>/name-gifts-out
//   cd backend && npx tsx --env-file=<backend .env> scripts/name-gifts-seed.ts --apply    # uploads the images, inserts the drafts
//
// Status 'draft' (invisible to the storefront and to guests by RLS); nothing
// reaches a customer until David says yes on the APPROVE card and the drafts
// are flipped to 'active'. Idempotent: a product that already exists by name
// is updated in place, never duplicated.
//
// The images are the model's own outline seen from above (the same drawing
// the product page shows a customer), with an example name. They are
// placeholders for the real photos of the first printed sample.
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { createClient } from '@supabase/supabase-js'
import { buildNameModel, toPreviewSvg } from '../services/name-print/geometry.js'
import { NAME_MAX, type NamePrintTemplate } from '../shared/name-print.js'

const APPLY = process.argv.includes('--apply')
const OUT = path.join(tmpdir(), 'name-gifts-out')

// Christmas red plate, name in white: one filament change at the plate top.
const RED = { name: 'Red', hex: '#B3262E' }
const WHITE = { name: 'White', hex: '#F4F1EA' }

interface Seed {
  slug: string
  template: NamePrintTemplate
  name: string
  price: number
  description: string
  metaTitle: string
  metaDescription: string
  keywords: string
  cover: string
  lineup: string[]
}

const SEEDS: Seed[] = [
  {
    slug: 'personalized-name-ornament',
    template: {
      version: 1,
      shape: 'ornament',
      font: 'brush-script',
      field: { key: 'name', label: 'Name on the ornament', max: NAME_MAX.ornament },
      colours: { plate: RED, letters: WHITE },
      upcharge: 0,
    },
    name: 'Personalized Name Ornament',
    price: 16.99,
    description: [
      'A Christmas ornament with the name you choose raised across the front in white script, on a red ornament with a raised white rim.',
      'Type the name on this page and you see it on the ornament as you type. We 3D print exactly what you type, capitals included, up to 12 characters.',
      'About 2.6 in wide and 3.1 in tall (67 x 79 mm), with a hanging hole in the cap. Ribbon or hook not included.',
      'Made to order in PLA plastic and ships within 3 business days.',
    ].join('\n\n'),
    metaTitle: 'Personalized Name Ornament | 3D Printed Christmas Ornament',
    metaDescription: 'A red Christmas ornament with any name raised in white script. Type the name, see it as you type, made to order and ships in 3 business days.',
    keywords: 'personalized ornament, name ornament, custom christmas ornament, 3d printed ornament, christmas gift with name, family ornament',
    cover: 'Emma',
    lineup: ['Liam', 'Grandma', 'Ava'],
  },
  {
    slug: 'personalized-name-keychain',
    template: {
      version: 1,
      shape: 'keychain',
      font: 'brush-script',
      field: { key: 'name', label: 'Name on the keychain', max: NAME_MAX.keychain },
      colours: { plate: RED, letters: WHITE },
      upcharge: 0,
    },
    name: 'Personalized Name Keychain',
    price: 9.99,
    description: [
      'A keychain tag with the name you choose raised in white script on a red tag.',
      'Type the name on this page and you see it on the tag as you type. We 3D print exactly what you type, capitals included, up to 10 characters.',
      'About 2 in long and 0.7 in tall (50 x 18 mm), with a hole for a key ring. Key ring not included.',
      'Made to order in PLA plastic and ships within 3 business days.',
    ].join('\n\n'),
    metaTitle: 'Personalized Name Keychain | 3D Printed Name Tag',
    metaDescription: 'A red keychain tag with any name raised in white script. Type the name, see it as you type, made to order and ships in 3 business days.',
    keywords: 'name keychain, personalized keychain, custom name tag, 3d printed keychain, stocking stuffer with name, bag tag',
    cover: 'Noah',
    lineup: ['Mia', 'Jackson', 'Dad'],
  },
]

// Image backdrop: a warm paper white. An image file, not UI, so no tokens apply.
const BACKDROP = '#F7F3EE'

async function renderSvg(svg: string, size: number): Promise<Buffer> {
  return sharp(Buffer.from(svg), { density: 600 }).resize(size, size, { fit: 'contain', background: BACKDROP }).png().toBuffer()
}

async function coverImage(seed: Seed): Promise<Buffer> {
  const m = buildNameModel(seed.template.shape, seed.template.font, seed.cover)
  const art = await renderSvg(toPreviewSvg(m, { plate: RED.hex, letters: WHITE.hex }), 1240)
  return sharp({ create: { width: 1600, height: 1600, channels: 3, background: BACKDROP } })
    .composite([{ input: art, left: 180, top: 180 }])
    .png()
    .toBuffer()
}

async function lineupImage(seed: Seed): Promise<Buffer> {
  const tiles = await Promise.all(
    seed.lineup.map((name) => {
      const m = buildNameModel(seed.template.shape, seed.template.font, name)
      return renderSvg(toPreviewSvg(m, { plate: RED.hex, letters: WHITE.hex }), 500)
    })
  )
  return sharp({ create: { width: 1600, height: 1600, channels: 3, background: BACKDROP } })
    .composite(tiles.map((input, i) => ({ input, left: 25 + i * 525, top: 550 })))
    .png()
    .toBuffer()
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const supabase = APPLY ? createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) : null
  const upload = APPLY ? (await import('../services/google-cloud-storage.js')).uploadImageFromBuffer : null

  for (const seed of SEEDS) {
    const images = [await coverImage(seed), await lineupImage(seed)]
    images.forEach((buf, i) => writeFileSync(path.join(OUT, `${seed.slug}-${i + 1}.png`), buf))
    console.log(`${seed.slug}: rendered ${images.length} images to ${OUT}`)
    if (!APPLY) continue

    const urls: string[] = []
    for (const [i, buf] of images.entries()) {
      const { publicUrl } = await upload!(buf, `products/name-gifts/${seed.slug}-${i + 1}.png`, 'image/png')
      urls.push(publicUrl)
    }

    const row = {
      name: seed.name,
      description: seed.description,
      price: seed.price,
      images: urls,
      category: '3d-prints',
      status: 'draft',
      is_active: true,
      approved: false,
      product_type: 'physical',
      sizes: [],
      colors: [],
      print_locations: [],
      meta_title: seed.metaTitle,
      meta_description: seed.metaDescription,
      search_keywords: seed.keywords,
      alt_text: `${seed.name}, shown with an example name`,
    }

    const { data: existing, error: findErr } = await supabase!.from('products').select('id, metadata').eq('name', seed.name).maybeSingle()
    if (findErr) throw new Error(findErr.message)
    const metadata = {
      ...(existing?.metadata ?? {}),
      name_print: seed.template,
      // magnet_sockets 0: the print bridge defaults a 3D print to 2 magnets.
      print3d: { enabled: true, material: 'PLA', magnet_sockets: 0, color_mode: 'grey' },
      source: 'name_gifts_bf353160',
    }
    if (existing) {
      const { error } = await supabase!.from('products').update({ ...row, metadata }).eq('id', existing.id)
      if (error) throw new Error(error.message)
      console.log(`${seed.slug}: updated draft ${existing.id}`)
    } else {
      const { data, error } = await supabase!.from('products').insert({ ...row, metadata }).select('id').single()
      if (error) throw new Error(error.message)
      console.log(`${seed.slug}: inserted draft ${data.id}`)
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
