// Pet ornament — an Etsy sale in, the same print files as a site checkout out
// (task 5d007181, 2026-11-01).
//
// The Etsy listing (draft 4607572810) asks every buyer two required questions:
// the pet's name (max 12) and one photo. Checkout's petOrnamentForLine
// (routes/stripe.ts) builds a site line from the customer's picks; this builds
// an Etsy line from the transaction's personalization answers and then runs
// the SAME code: portrait.ts (photo -> drawing -> four-colour map, one paid
// call per new photo), store.ts (geometry -> one STL per colour +
// print-spec.json). The result is shaped like checkout's, so order_items gets
// the same keys and the print bridge sends the same petOrnamentParts.
//
// Decisions (noted in the task handoff):
//   - The pet type comes off the photo (pet-detect.ts); no new buyer question.
//   - A photo we cannot use (missing, unreadable, smaller than 256 px, or no
//     animal in it) HOLDS the line with a plain reason. It never falls back to
//     a stock pet: the buyer paid for THEIR pet. The team messages the buyer
//     and re-runs scripts/etsy-pet-order.ts with --photo (or --stock if the
//     buyer agrees to the stock design).
//   - More than one photo (a listing set to allow several): the largest one
//     (most pixels) is drawn; the rest are recorded.
//   - Never throws: money has already moved, so a failure is written on the
//     line, exactly like checkout.
import sharp from 'sharp'
import type { EtsyReceiptTransaction } from '../etsy.js'
import { downloadUpload, readPersonalization, typedAnswer, uploadUrls, type DownloadedFile } from '../etsy-personalization.js'
import { sniffImageContentType } from '../google-cloud-storage.js'
import { sanitizePetValues, type PetOrnamentTemplate } from '../../shared/pet-ornament.js'
import { sanitizeName } from '../../shared/name-print.js'
import { reviewFlags, type ReviewFlag } from '../team-plate/review-flags.js'
import { detectPet } from './pet-detect.js'
import { drawPortrait } from './portrait.js'
import { storePetPrint, type StoredPetPrint } from './store.js'

/** A photo smaller than this on its short side draws a mushy portrait. */
export const MIN_PHOTO_SIDE = 256
/** A listing allows at most 10 files; we look at no more than this many. */
const MAX_PHOTOS = 3

/** What was read and decided, kept on the order line (order_items.metadata.etsy_pet). */
export interface EtsyPetRecord {
  transactionId: number
  listingId: number
  /** The name answer as the buyer typed it (unescaped, before the 12-letter cap). */
  nameAnswer: string | null
  /** The photo that was drawn ('operator' when --photo supplied one). */
  photoUrl: string | null
  photoCandidates: number
  photo: { width: number; height: number; bytes: number; contentType: string; authed: boolean } | null
  pet: {
    id: string
    source: 'vision' | 'default' | 'operator' | 'stock'
    uncertain: boolean
    reason: string
    animal?: string
    confidence?: number
    modelId?: string
  } | null
  portraitId: string | null
}

export interface EtsyPetLine {
  /** Same keys as checkout: { pet, <name field>, portrait }. */
  values: Record<string, string>
  /** The print-spec.json path, or null when the line is held. */
  path: string | null
  status: 'ready' | 'failed'
  error?: string
  flags?: ReviewFlag[]
  etsy: EtsyPetRecord
  /** Not persisted: the built spec, for the command's local copy. */
  stored?: StoredPetPrint
}

export interface EtsyPetOptions {
  /** Etsy API headers, used only if Etsy refuses a plain photo download. */
  etsyHeaders?: () => Promise<Record<string, string>>
  /** Operator: the pet type, skipping the photo check. */
  pet?: string
  /** Operator: draw this photo instead of the one on the order (the buyer sent a better one). */
  photo?: Buffer
  /** Operator: print the stock design for the pet (the buyer agreed). */
  stock?: boolean
}

/**
 * order_items.metadata for a pet line: checkout's own keys (routes/stripe.ts
 * replaceOrderItems), so the print bridge reads it like a site order, plus
 * what Etsy said and what was decided (etsy_pet).
 */
export function petLineMeta(line: EtsyPetLine | undefined): Record<string, unknown> {
  if (!line) return {}
  return {
    personalization: line.values,
    print_file_path: line.path,
    print_file_error: line.error ?? null,
    print_file_status: line.status,
    personalization_flags: line.flags?.length ? line.flags : null,
    etsy_pet: line.etsy,
  }
}

/** Swappable so tests and the offline harness never call a model or GCS. */
export const etsyPetDeps = {
  fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
  detectPet,
  drawPortrait,
  storePetPrint,
}

interface Photo { url: string; bytes: Buffer; contentType: string; authed: boolean; width: number; height: number }

async function measure(file: DownloadedFile | { url: string; bytes: Buffer; contentType: string; authed: boolean }): Promise<Photo> {
  const meta = await sharp(file.bytes, { limitInputPixels: 50_000_000 }).metadata()
  if (!meta.width || !meta.height) throw new Error('the photo could not be read')
  // EXIF orientations 5-8 are rotated a quarter turn.
  const turned = (meta.orientation ?? 1) >= 5
  return { ...file, width: turned ? meta.height : meta.width, height: turned ? meta.width : meta.height }
}

export async function buildEtsyPetLine(
  txn: Pick<EtsyReceiptTransaction, 'transaction_id' | 'listing_id' | 'variations'>,
  template: PetOrnamentTemplate,
  opts: EtsyPetOptions = {}
): Promise<EtsyPetLine> {
  const key = template.field.key
  const record: EtsyPetRecord = {
    transactionId: txn.transaction_id, listingId: txn.listing_id, nameAnswer: null,
    photoUrl: null, photoCandidates: 0, photo: null, pet: null, portraitId: null,
  }
  const values: Record<string, string> = { pet: template.pets[0].id, [key]: '', portrait: '' }
  const held = (error: string, flags?: ReviewFlag[]): EtsyPetLine => ({ values, path: null, status: 'failed', error, flags, etsy: record })

  try {
    const answers = readPersonalization(txn)
    record.nameAnswer = typedAnswer(answers)
    const name = sanitizeName(record.nameAnswer, template.field.max)
    values[key] = name
    if (!name) return held('No pet name in the Etsy personalization answers')

    const operatorPet = opts.pet && template.pets.some((p) => p.id === opts.pet) ? opts.pet : null
    if (opts.pet && !operatorPet) return held(`"${opts.pet}" is not one of this ornament's pets (${template.pets.map((p) => p.id).join(', ')})`)

    let portrait = ''
    let pet = operatorPet ?? template.pets[0].id
    if (opts.stock) {
      record.pet = { id: pet, source: 'stock', uncertain: false, reason: `stock ${pet} design chosen by the team` }
    } else {
      // --- the photo -------------------------------------------------------
      let photos: Photo[] = []
      const problems: string[] = []
      if (opts.photo) {
        const contentType = sniffImageContentType(opts.photo)
        if (!contentType) return held('The photo given with --photo is not a JPEG, PNG or WebP')
        photos = [await measure({ url: 'operator', bytes: opts.photo, contentType, authed: false })]
      } else {
        const urls = uploadUrls(answers)
        record.photoCandidates = urls.length
        if (urls.length === 0) return held("The buyer's photo is missing from the Etsy order: message them for one, then re-run with --photo")
        for (const url of urls.slice(0, MAX_PHOTOS)) {
          try {
            photos.push(await measure(await downloadUpload(url, { fetch: etsyPetDeps.fetch as typeof fetch, etsyHeaders: opts.etsyHeaders })))
          } catch (err: any) {
            problems.push(err?.message ?? 'download failed')
          }
        }
        if (photos.length === 0) return held(`Could not use the buyer's photo: ${problems[0]}`)
      }
      const photo = photos.reduce((best, p) => (p.width * p.height > best.width * best.height ? p : best))
      record.photoUrl = photo.url
      record.photo = { width: photo.width, height: photo.height, bytes: photo.bytes.length, contentType: photo.contentType, authed: photo.authed }
      if (Math.min(photo.width, photo.height) < MIN_PHOTO_SIDE) {
        return held(`The buyer's photo is too small to draw (${photo.width}x${photo.height}, needs ${MIN_PHOTO_SIDE} px on the short side): message them for a bigger one`)
      }

      // --- which pet -------------------------------------------------------
      if (operatorPet) {
        record.pet = { id: operatorPet, source: 'operator', uncertain: false, reason: `${operatorPet} set by the team` }
      } else {
        const d = await etsyPetDeps.detectPet(photo.bytes, template.pets)
        record.pet = {
          id: d.pet, source: d.source, uncertain: d.uncertain, reason: d.reason,
          ...(d.vision ? { animal: d.vision.animal, confidence: d.vision.confidence, modelId: d.vision.modelId } : {}),
        }
        if (!d.usable) return held(`Could not use the buyer's photo: ${d.reason}. Message them for a clear photo of the pet`)
        pet = d.pet
      }

      // --- the portrait: the same call and cache as the site's upload -------
      const label = template.pets.find((p) => p.id === pet)!.label
      const drawn = await etsyPetDeps.drawPortrait(photo.bytes, label)
      portrait = drawn.id
      record.portraitId = drawn.id
    }

    // Re-checked exactly as checkout re-checks a cart line.
    const clean = sanitizePetValues(template, { pet, [key]: name, portrait })
    values.pet = clean.pet
    values[key] = clean.name
    values.portrait = clean.portrait

    const flags = reviewFlags({ fields: [{ key }] }, values)
    const uncut = sanitizeName(record.nameAnswer, 1000)
    if (uncut !== clean.name) flags.push({ field: key, reason: `name cut to ${template.field.max} letters from "${uncut}"` })
    if (record.pet?.uncertain) flags.push({ field: 'pet', reason: record.pet.reason })

    const stored = await etsyPetDeps.storePetPrint(template, clean)
    return { values, path: stored.path, status: 'ready', flags: flags.length ? flags : undefined, etsy: record, stored }
  } catch (err: any) {
    return held(err?.message ?? 'print files failed')
  }
}
