/**
 * Custom QR Counter Stand routes (task deebfdca).
 *
 *   POST /api/qr-stand/logo                       anyone (guests order too): store a logo, get its path
 *   GET  /api/admin/qr-stands/:orderId            admin/manager: the order's stands + latest print file
 *   POST /api/admin/qr-stands/:orderId/:line      admin/manager: save link/caption/logo + rebuild
 *   POST /api/admin/qr-stands/builds/:id/print    admin/manager: send a scanned-back file to the printers
 *   POST /api/qr-stand/builder/claim              Earth builder (print-bridge token)
 *   POST /api/qr-stand/builder/:id/result         Earth builder: 3mf + face png + scan result
 *   POST /api/qr-stand/builder/print/claim        Earth builder: next print request
 *   POST /api/qr-stand/builder/print/:id/result   Earth builder: what the print queue said
 */
import { Router, Request, Response } from 'express'
import multer from 'multer'
import sharp from 'sharp'
import { randomUUID } from 'crypto'
import { supabase } from '../lib/supabase.js'
import { requireAuth, requireRole } from '../middleware/supabaseAuth.js'
import { publicWriteLimiter } from '../middleware/rate-limits.js'
import { requireBridgeAuth } from './print-bridge.js'
import { uploadImageFromBuffer, getSignedUrl } from '../services/google-cloud-storage.js'
import {
  QR_LOGO_PREFIX,
  QR_FIELD,
  isQrLogoPath,
  normalizeQrLink,
  qrLinkProblem,
  cleanQrCaption,
  qrCaptionProblem,
} from '../shared/qr-stand.js'
import {
  standLinesOfOrder,
  latestBuilds,
  queueBuild,
  requestPrint,
  claimNextBuild,
  completeBuild,
  claimNextPrint,
  completePrint,
  type BuildRow,
} from '../services/qr-stand-builds.js'

export const qrStandRouter = Router()
export const adminQrStandRouter = Router()

/** A logo is a few hundred KB; a phone photo of one can be several MB. */
const LOGO_MAX_BYTES = 10 * 1024 * 1024
const logoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: LOGO_MAX_BYTES, files: 1 } })
/** A stand's 3mf is ~90 KB and its face png ~8 KB; anything near this is wrong. */
const builderUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 2 } })

// ---------------------------------------------------------------------------
// Customer: the logo for the centre square
// ---------------------------------------------------------------------------

qrStandRouter.post('/logo', publicWriteLimiter, logoUpload.single('logo'), async (req: Request, res: Response): Promise<any> => {
  const file = req.file
  if (!file?.buffer?.length) return res.status(400).json({ error: 'Choose a PNG or JPG of your logo.' })
  let png: Buffer
  try {
    // Re-encoded, never stored as sent: it strips whatever rode along in the
    // upload and gives the builder one format. Alpha is kept, it marks the
    // background on a transparent logo.
    png = await sharp(file.buffer, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer()
  } catch {
    return res.status(400).json({ error: 'That file is not a picture we can read. Try a PNG or JPG.' })
  }
  try {
    const path = `${QR_LOGO_PREFIX}${randomUUID()}.png`
    const { publicUrl } = await uploadImageFromBuffer(png, path, 'image/png')
    return res.json({ path, url: publicUrl })
  } catch (err: any) {
    req.log?.error({ err }, '[qr-stand] logo upload failed')
    return res.status(500).json({ error: 'The logo did not save. Please try again.' })
  }
})

// ---------------------------------------------------------------------------
// Admin: open an order's stands, change them, rebuild, send to print
// ---------------------------------------------------------------------------

adminQrStandRouter.use(requireAuth, requireRole(['admin', 'manager']))

async function buildView(build: BuildRow | undefined) {
  if (!build) return null
  return {
    id: build.id,
    status: build.status,
    link: build.link,
    caption: build.caption,
    logoPath: build.logo_path,
    scanOk: build.scan_ok,
    error: build.error,
    builtAt: build.built_at,
    createdAt: build.created_at,
    faceUrl: build.face_path ? await getSignedUrl(build.face_path, 60).catch(() => null) : null,
    printStatus: build.print_status,
    printError: build.print_error,
    printJobId: build.print_job_id,
    printPrinter: build.print_printer,
    printSentAt: build.print_sent_at,
  }
}

async function standsView(orderId: string) {
  const [lines, builds] = await Promise.all([standLinesOfOrder(orderId), latestBuilds(orderId)])
  return Promise.all(
    lines.map(async (line) => ({
      lineIndex: line.lineIndex,
      quantity: line.quantity,
      link: line.stand.link,
      caption: line.stand.caption,
      logoPath: line.stand.logo_path,
      logoUrl: line.stand.logo_path ? await getSignedUrl(line.stand.logo_path, 60).catch(() => null) : null,
      editedAt: line.stand.edited_at ?? null,
      build: await buildView(builds.get(line.lineIndex)),
    }))
  )
}

adminQrStandRouter.get('/:orderId', async (req: Request, res: Response): Promise<any> => {
  try {
    return res.json({ stands: await standsView(req.params.orderId) })
  } catch (err: any) {
    req.log?.error({ err }, '[qr-stand] admin view failed')
    return res.status(500).json({ error: 'Could not load this order\'s stands.' })
  }
})

adminQrStandRouter.post('/:orderId/:line', async (req: Request, res: Response): Promise<any> => {
  const orderId = req.params.orderId
  const lineIndex = Number(req.params.line)
  const link = normalizeQrLink(req.body?.link)
  const caption = cleanQrCaption(req.body?.caption)
  const logoPath = req.body?.logoPath == null || req.body?.logoPath === '' ? null : req.body.logoPath
  const problem = qrLinkProblem(link) ?? qrCaptionProblem(caption) ?? (logoPath && !isQrLogoPath(logoPath) ? 'Upload the logo again.' : null)
  if (problem) return res.status(400).json({ error: problem })

  try {
    const line = (await standLinesOfOrder(orderId)).find((l) => l.lineIndex === lineIndex)
    if (!line) return res.status(404).json({ error: 'That order has no stand at that line.' })

    // The order line itself carries what the stand says, so every other screen
    // (the order list, the packing slip, the customer's own order page) agrees.
    const { data: row } = await supabase.from('order_items').select('metadata').eq('id', line.orderItemId).single()
    const meta = (row?.metadata ?? {}) as Record<string, any>
    meta.qr_stand = {
      ...meta.qr_stand,
      link,
      caption,
      logo_path: logoPath,
      edited_at: new Date().toISOString(),
      edited_by: req.user?.id ?? null,
    }
    meta.personalization = {
      ...(meta.personalization ?? {}),
      [QR_FIELD.link]: link,
      [QR_FIELD.caption]: caption,
    }
    const { error: upErr } = await supabase.from('order_items').update({ metadata: meta }).eq('id', line.orderItemId)
    if (upErr) throw new Error(upErr.message)

    const build = await queueBuild({ orderId, lineIndex, link, caption, logoPath, requestedBy: req.user?.id ?? null })
    return res.json({ build: await buildView(build) })
  } catch (err: any) {
    req.log?.error({ err, orderId }, '[qr-stand] admin rebuild failed')
    return res.status(500).json({ error: 'Could not start the rebuild. Please try again.' })
  }
})

adminQrStandRouter.post('/builds/:id/print', async (req: Request, res: Response): Promise<any> => {
  const out = await requestPrint(req.params.id)
  if (!out.ok) return res.status(409).json({ error: out.error })
  return res.json({ build: await buildView(out.build) })
})

// ---------------------------------------------------------------------------
// Builder on Earth (tools/qr-stand/builder.mjs)
// ---------------------------------------------------------------------------

qrStandRouter.post('/builder/claim', requireBridgeAuth, async (_req: Request, res: Response): Promise<any> => {
  const next = await claimNextBuild()
  if (!next) return res.json({ build: null })
  const b = next.build
  return res.json({
    build: { id: b.id, orderId: b.order_id, lineIndex: b.line_index, link: b.link, caption: b.caption, hasLogo: !!b.logo_path },
    logoUrl: next.logoUrl,
  })
})

qrStandRouter.post(
  '/builder/:id/result',
  requireBridgeAuth,
  builderUpload.fields([{ name: 'threemf', maxCount: 1 }, { name: 'face', maxCount: 1 }]),
  async (req: Request, res: Response): Promise<any> => {
    const id = req.params.id
    let result: any = {}
    try {
      result = JSON.parse(String(req.body?.result ?? '{}'))
    } catch {
      return res.status(400).json({ error: 'result must be JSON' })
    }
    const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>
    const threemf = files.threemf?.[0]
    const face = files.face?.[0]
    const { data: row } = await supabase.from('qr_stand_builds').select('order_id').eq('id', id).maybeSingle()
    if (!row) return res.status(404).json({ error: 'no such build' })
    const base = `qr-stand-builds/${row.order_id}/${id}`
    try {
      // The bytes are checked, not trusted: a 3mf is a zip, a png says so.
      const threemfPath = threemf && threemf.buffer.subarray(0, 2).toString() === 'PK'
        ? (await uploadImageFromBuffer(threemf.buffer, `${base}.3mf`, 'model/3mf')).path
        : null
      const facePath = face && face.buffer.subarray(1, 4).toString() === 'PNG'
        ? (await uploadImageFromBuffer(face.buffer, `${base}-face.png`, 'image/png')).path
        : null
      const done = await completeBuild(id, {
        ok: result.ok === true,
        error: typeof result.error === 'string' ? result.error.slice(0, 500) : null,
        threemfPath,
        facePath,
        scanOk: typeof result.scan_ok === 'boolean' ? result.scan_ok : null,
        scanText: Array.isArray(result.scan_text) ? result.scan_text.join('\n').slice(0, 500) : null,
        qrVersion: Number.isFinite(result.qr_version) ? result.qr_version : null,
        logoMode: typeof result.logo === 'string' ? result.logo : null,
      })
      if (!done) return res.status(409).json({ error: 'build is not being built (claimed by another builder?)' })
      return res.json({ ok: true, status: done.status })
    } catch (err: any) {
      req.log?.error({ err, id }, '[qr-stand] builder result failed')
      return res.status(500).json({ error: 'could not store the result' })
    }
  }
)

qrStandRouter.post('/builder/print/claim', requireBridgeAuth, async (_req: Request, res: Response): Promise<any> => {
  const next = await claimNextPrint()
  if (!next) return res.json({ build: null })
  const b = next.build
  const { data: order } = await supabase.from('orders').select('order_number').eq('id', b.order_id).maybeSingle()
  return res.json({
    build: { id: b.id, orderId: b.order_id, orderNumber: order?.order_number ?? null, lineIndex: b.line_index, caption: b.caption },
    threemfUrl: next.threemfUrl,
  })
})

qrStandRouter.post('/builder/print/:id/result', requireBridgeAuth, async (req: Request, res: Response): Promise<any> => {
  const done = await completePrint(req.params.id, {
    ok: req.body?.ok === true,
    jobId: typeof req.body?.jobId === 'string' ? req.body.jobId : null,
    printer: typeof req.body?.printer === 'string' ? req.body.printer.slice(0, 60) : null,
    error: typeof req.body?.error === 'string' ? req.body.error.slice(0, 500) : null,
  })
  if (!done) return res.status(409).json({ error: 'print is not being sent' })
  return res.json({ ok: true, printStatus: done.print_status })
})
