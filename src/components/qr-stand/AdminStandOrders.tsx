// The Orders page's QR counter stand editor (task deebfdca, built to David's
// approved admin mock of 2026-10-18): a row for each stand order, and on Open,
// the order's stand with its link, words and logo, a live preview, the print
// file's state, "Rebuild print file" and "Send to print".
//
// The print file is built on Earth (tools/qr-stand) and scan-checked there; this
// screen asks for it and watches. Send to print is only offered for a file that
// read back as the link it shows.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronRight, CircleCheck, FileText, ImageUp, QrCode, Trash2 } from 'lucide-react'
import { apiFetch } from '../../lib/api'
import { useToast } from '../../hooks/useToast'
import StandPreview from './StandPreview'
import { logoPrintFrom } from '../../lib/qr-stand/load-logo'
import { uploadLogo, LOGO_TYPES } from '../../lib/qr-stand/upload-logo'
import {
  QR_STAND,
  QR_CAPTIONS,
  QR_CAPTION_MAX,
  cleanQrCaption,
  normalizeQrLink,
  qrCaptionProblem,
  qrLinkProblem,
} from '../../../backend/shared/qr-stand'

export interface StandOrderSummary {
  orderId: string
  orderNumber: string
  customer: string
  quantity: number
  paid: boolean
  createdAt: string
}

interface BuildView {
  id: string
  status: 'queued' | 'building' | 'ready' | 'failed'
  link: string
  caption: string
  logoPath: string | null
  scanOk: boolean | null
  error: string | null
  builtAt: string | null
  createdAt: string
  faceUrl: string | null
  printStatus: 'requested' | 'sending' | 'sent' | 'failed' | null
  printError: string | null
  printJobId: string | null
  printPrinter: string | null
  printSentAt: string | null
}

interface StandView {
  lineIndex: number
  quantity: number
  link: string
  caption: string
  logoPath: string | null
  logoUrl: string | null
  /** When an admin last changed what the stand says (null = as ordered). */
  editedAt: string | null
  build: BuildView | null
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

export default function AdminStandOrders({ orders }: { orders: StandOrderSummary[] }) {
  const [open, setOpen] = useState<string | null>(null)
  if (!orders.length) return null
  return (
    <div className="space-y-4 mb-6">
      {orders.map((o) => (
        <div key={o.orderId}>
          <button
            type="button"
            onClick={() => setOpen((cur) => (cur === o.orderId ? null : o.orderId))}
            aria-expanded={open === o.orderId}
            className="w-full text-left flex items-center gap-3 rounded-xl border border-accent/40 border-l-4 border-l-accent bg-accent/5 px-4 py-3 hover:bg-accent/10 transition-colors"
          >
            <QrCode className="w-5 h-5 text-text shrink-0" aria-hidden="true" />
            <span className="flex-1 min-w-0 text-sm text-text">
              Order <span className="font-semibold">#{o.orderNumber}</span> · {o.customer || 'Customer'} · {QR_STAND.name} x {o.quantity} ·{' '}
              {money(QR_STAND.priceCents)} each (reg. {money(QR_STAND.wasCents)}) · {o.paid ? 'Paid' : 'Not paid yet'} · {day(o.createdAt)}
            </span>
            <span className="shrink-0 rounded-full bg-accent text-white text-xs font-semibold px-3 py-1">{open === o.orderId ? 'Close' : 'Open'}</span>
            <ChevronRight className={`w-4 h-4 text-muted shrink-0 transition-transform ${open === o.orderId ? 'rotate-90' : ''}`} aria-hidden="true" />
          </button>
          {open === o.orderId && <StandOrderEditor orderId={o.orderId} orderNumber={o.orderNumber} />}
        </div>
      ))}
    </div>
  )
}

function StandOrderEditor({ orderId, orderNumber }: { orderId: string; orderNumber: string }) {
  const [stands, setStands] = useState<StandView[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await apiFetch(`/api/admin/qr-stands/${orderId}`)
      setStands(data.stands ?? [])
      setError(null)
    } catch (e: any) {
      setError(e?.message ?? 'Could not load this order\'s stand.')
    }
  }, [orderId])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="mt-3 rounded-2xl border border-border bg-card shadow-soft p-5 sm:p-6">
      <h2 className="font-display text-2xl sm:text-3xl text-text">QR Counter Stand · Order #{orderNumber}</h2>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {!stands && !error && <p className="mt-3 text-sm text-muted">Opening the order…</p>}
      {stands && stands.length === 0 && <p className="mt-3 text-sm text-muted">This order has no stand on it.</p>}
      {stands?.map((s) => (
        <StandLineEditor key={s.lineIndex} orderId={orderId} stand={s} onChanged={load} multiple={stands.length > 1} />
      ))}
    </div>
  )
}

function StepStrip({ steps }: { steps: Array<{ label: string; done: boolean }> }) {
  return (
    <ol className="mt-5 grid grid-cols-4 gap-2" aria-label="Steps">
      {steps.map((s, i) => (
        <li key={s.label} className="flex flex-col items-center text-center relative">
          {i > 0 && (
            <span
              className={`absolute top-3.5 right-1/2 w-full h-0.5 -z-0 ${steps[i - 1].done ? 'bg-primary' : 'bg-border'}`}
              aria-hidden="true"
            />
          )}
          <span
            className={`relative z-10 w-7 h-7 rounded-full flex items-center justify-center border-2 ${
              s.done ? 'bg-primary border-primary text-white' : 'bg-card border-border'
            }`}
          >
            {s.done && <Check className="w-4 h-4" aria-hidden="true" />}
          </span>
          <span className="mt-2 text-xs sm:text-sm text-text">{s.label}</span>
          <span className="sr-only">{s.done ? 'done' : 'to do'}</span>
        </li>
      ))}
    </ol>
  )
}

function StandLineEditor({
  orderId,
  stand,
  onChanged,
  multiple,
}: {
  orderId: string
  stand: StandView
  onChanged: () => Promise<void>
  multiple: boolean
}) {
  const toast = useToast()
  const presetOf = (c: string) => ((QR_CAPTIONS as readonly string[]).includes(c) ? c : 'Custom')
  const [rawLink, setRawLink] = useState(stand.link)
  const [preset, setPreset] = useState(presetOf(stand.caption))
  const [custom, setCustom] = useState(presetOf(stand.caption) === 'Custom' ? stand.caption : '')
  const [logoPath, setLogoPath] = useState<string | null>(stand.logoPath)
  const [logoShown, setLogoShown] = useState<string | null>(null)
  const [logoPrint, setLogoPrint] = useState<string | null>(null)
  const [logoProblem, setLogoProblem] = useState<string | null>(null)
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const [busy, setBusy] = useState<'rebuild' | 'print' | null>(null)
  const [now, setNow] = useState(Date.now())
  const fileInput = useRef<HTMLInputElement>(null)

  // The stored logo, as it prints. A cross-origin image the canvas may not read
  // falls back to showing the file itself.
  useEffect(() => {
    let alive = true
    if (stand.logoUrl && logoPath === stand.logoPath) {
      setLogoShown(stand.logoUrl)
      logoPrintFrom(stand.logoUrl)
        .then((p) => alive && setLogoPrint(p.dataUrl))
        .catch(() => alive && setLogoPrint(stand.logoUrl))
    }
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stand.logoUrl])

  const link = normalizeQrLink(rawLink)
  const linkProblem = qrLinkProblem(link)
  const caption = cleanQrCaption(preset === 'Custom' ? custom : preset)
  const captionProblem = qrCaptionProblem(caption)
  const build = stand.build
  const matches = !!build && build.link === link && build.caption === caption && (build.logoPath ?? null) === (logoPath ?? null)
  const changed = link !== stand.link || caption !== stand.caption || (logoPath ?? null) !== (stand.logoPath ?? null)
  const building = !!build && (build.status === 'queued' || build.status === 'building')
  const printing = !!build && (build.printStatus === 'requested' || build.printStatus === 'sending')
  const ready = matches && build?.status === 'ready' && build.scanOk === true
  const sent = matches && build?.printStatus === 'sent'

  // Watch a build or a print hand-off until it settles.
  useEffect(() => {
    if (!building && !printing) return
    const tick = setInterval(() => setNow(Date.now()), 1000)
    const poll = setInterval(() => void onChanged(), 3000)
    return () => {
      clearInterval(tick)
      clearInterval(poll)
    }
  }, [building, printing, onChanged])

  async function takeFile(file: File | undefined | null) {
    if (!file) return
    if (!LOGO_TYPES.test(file.type)) {
      setLogoProblem('Use a PNG or JPG of the logo.')
      return
    }
    const print = await logoPrintFrom(file).catch(() => ({ dataUrl: null, problem: null }))
    if (print.problem) {
      setLogoProblem(print.problem)
      return
    }
    setLogoProblem(null)
    setUploadPct(0)
    try {
      const { path, url } = await uploadLogo(file, setUploadPct)
      setLogoPath(path)
      setLogoShown(url)
      setLogoPrint(print.dataUrl)
    } catch (e: any) {
      setLogoProblem(e?.message ?? 'The logo did not upload.')
    } finally {
      setUploadPct(null)
    }
  }

  async function rebuild() {
    if (linkProblem || captionProblem) {
      toast.warning('Check the stand', linkProblem ?? captionProblem ?? '')
      return
    }
    setBusy('rebuild')
    try {
      await apiFetch(`/api/admin/qr-stands/${orderId}/${stand.lineIndex}`, {
        method: 'POST',
        body: JSON.stringify({ link, caption, logoPath }),
      })
      await onChanged()
    } catch (e: any) {
      toast.error('Rebuild did not start', readError(e))
    } finally {
      setBusy(null)
    }
  }

  async function sendToPrint() {
    if (!build) return
    setBusy('print')
    try {
      await apiFetch(`/api/admin/qr-stands/builds/${build.id}/print`, { method: 'POST' })
      await onChanged()
    } catch (e: any) {
      toast.error('Not sent', readError(e))
    } finally {
      setBusy(null)
    }
  }

  const since = build ? Math.max(0, Math.round((now - Date.parse(build.createdAt)) / 1000)) : 0
  const steps = [
    { label: 'Open order', done: true },
    { label: 'Change link, words or logo', done: changed || !!stand.editedAt || !!build?.builtAt },
    { label: 'Rebuild print file', done: ready },
    { label: 'Send to print', done: sent },
  ]

  return (
    <div className="mt-2">
      {multiple && <p className="mt-4 text-sm font-semibold text-text">Stand {stand.lineIndex + 1} · quantity {stand.quantity}</p>}
      <StepStrip steps={steps} />

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8 rounded-xl border border-border p-4 sm:p-5">
        <div className="space-y-6">
          <div>
            <h3 className="flex items-center gap-3 font-body text-base font-semibold text-text mb-3">
              <span className="w-7 h-7 rounded-full bg-primary text-white text-sm flex items-center justify-center" aria-hidden="true">1</span>
              Link the code opens
            </h3>
            <input
              value={rawLink}
              onChange={(e) => setRawLink(e.target.value)}
              aria-label="Link the code opens"
              className={`w-full rounded-xl border bg-card px-4 py-3 text-text focus:outline-none focus:ring-2 focus:ring-primary/40 ${linkProblem ? 'border-red-500' : 'border-border'}`}
            />
            {linkProblem ? (
              <p className="mt-2 text-sm text-red-600" role="alert">{linkProblem}</p>
            ) : ready ? (
              <p className="mt-2 text-sm text-emerald-700 flex items-center gap-1.5">
                <CircleCheck className="w-4 h-4" aria-hidden="true" /> Scans OK
              </p>
            ) : null}
          </div>

          <div>
            <h3 className="flex items-center gap-3 font-body text-base font-semibold text-text mb-3">
              <span className="w-7 h-7 rounded-full bg-primary text-white text-sm flex items-center justify-center" aria-hidden="true">2</span>
              Words under the code
            </h3>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Words under the code">
              {[...QR_CAPTIONS, 'Custom'].map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={preset === c}
                  onClick={() => setPreset(c)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm min-h-[40px] ${
                    preset === c ? 'border-accent text-text bg-accent/5' : 'border-border text-muted hover:border-accent/50'
                  }`}
                >
                  {preset === c && <CircleCheck className="w-4 h-4 text-primary" aria-hidden="true" />}
                  {c}
                </button>
              ))}
            </div>
            {preset === 'Custom' && (
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                maxLength={QR_CAPTION_MAX}
                aria-label="Custom words"
                className="mt-3 w-full rounded-xl border border-border bg-card px-4 py-3 text-text focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            )}
            {preset === 'Custom' && captionProblem && <p className="mt-2 text-sm text-red-600">{captionProblem}</p>}
          </div>

          <div>
            <h3 className="flex items-center gap-3 font-body text-base font-semibold text-text mb-3">
              <span className="w-7 h-7 rounded-full bg-primary text-white text-sm flex items-center justify-center" aria-hidden="true">3</span>
              Logo in the middle
            </h3>
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 shrink-0 rounded-xl border border-border bg-bg flex items-center justify-center p-2">
                {logoShown ? <img src={logoShown} alt="The logo" className="max-w-full max-h-full" /> : <span className="text-xs text-muted">None</span>}
              </div>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 text-primary px-3 py-2 text-sm hover:bg-primary/5"
                >
                  <ImageUp className="w-4 h-4" aria-hidden="true" /> {logoPath ? 'Replace logo' : 'Add a logo'}
                </button>
                {logoPath && (
                  <button
                    type="button"
                    onClick={() => {
                      setLogoPath(null)
                      setLogoShown(null)
                      setLogoPrint(null)
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-accent/40 text-accent px-3 py-2 text-sm hover:bg-accent/5"
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" /> Remove
                  </button>
                )}
              </div>
            </div>
            {uploadPct !== null && (
              <div className="mt-3">
                <p className="text-xs text-muted mb-1">Uploading the logo… {uploadPct}%</p>
                <div className="h-1.5 rounded-full bg-border overflow-hidden">
                  <div className="h-full bg-primary transition-[width]" style={{ width: `${uploadPct}%` }} />
                </div>
              </div>
            )}
            {logoProblem && <p className="mt-2 text-sm text-red-600">{logoProblem}</p>}
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                void takeFile(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </div>
        </div>

        <div className="lg:border-l lg:border-border lg:pl-8">
          <h3 className="font-display text-xl text-text mb-3">Live preview</h3>
          <div className="rounded-xl bg-bg border border-border p-6 flex justify-center">
            <StandPreview link={linkProblem ? '' : link} caption={captionProblem ? '' : caption} logoSrc={logoPrint} className="w-full max-w-[280px] h-auto" />
          </div>
          {ready && build?.faceUrl && (
            <a href={build.faceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-primary hover:underline">
              See the print file's face
            </a>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-border p-4 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <FileText className="w-6 h-6 text-primary shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <PrintFileStatus build={build} matches={matches} changed={changed} building={building} since={since} />
          </div>
        </div>
        <div className="flex flex-col items-stretch sm:items-end gap-1">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={rebuild}
              disabled={busy !== null || building || uploadPct !== null}
              className="rounded-xl border border-primary text-primary font-semibold px-4 py-2.5 hover:bg-primary/5 disabled:opacity-50"
            >
              Rebuild print file
            </button>
            <button
              type="button"
              onClick={sendToPrint}
              disabled={!ready || busy !== null || printing || sent}
              className="rounded-xl bg-primary text-white font-semibold px-4 py-2.5 hover:bg-primary/90 disabled:opacity-50"
            >
              {sent ? 'Sent to print' : printing ? 'Sending…' : 'Send to print'}
            </button>
          </div>
          <p className="text-xs text-muted">Changes apply to this order only.</p>
        </div>
      </div>
    </div>
  )
}

function PrintFileStatus({
  build,
  matches,
  changed,
  building,
  since,
}: {
  build: BuildView | null
  matches: boolean
  changed: boolean
  building: boolean
  since: number
}) {
  if (!build) return <p className="text-sm text-text">Print file: <span className="text-muted">none yet. Rebuild to make it.</span></p>
  if (building) {
    // A real stage and real elapsed time, not a spinner (David 2026-09-02).
    const stage = build.status === 'queued' ? 'waiting for the builder' : 'building and scan-checking'
    const pct = Math.min(95, Math.round((since / 60) * 100))
    return (
      <div>
        <p className="text-sm text-text">Print file: <span className="text-muted">{stage} · {since}s</span></p>
        <div className="mt-2 h-1.5 rounded-full bg-border overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-primary transition-[width] duration-1000" style={{ width: `${Math.max(6, pct)}%` }} />
        </div>
      </div>
    )
  }
  if (build.status === 'failed') {
    return <p className="text-sm text-text">Print file: <span className="text-red-600">{build.error || 'the build failed'}. Fix it and rebuild.</span></p>
  }
  if (!matches || changed) {
    return <p className="text-sm text-text">Print file: <span className="text-amber-700">out of date. Rebuild to apply these changes.</span></p>
  }
  if (build.printStatus === 'sent') {
    return (
      <p className="text-sm text-text">
        Print file: <span className="text-emerald-700">sent to print{build.printPrinter ? ` on ${build.printPrinter}` : ''}</span>
      </p>
    )
  }
  if (build.printStatus === 'failed') {
    return <p className="text-sm text-text">Print file: <span className="text-red-600">ready, but sending failed: {build.printError}</span></p>
  }
  if (build.printStatus === 'requested' || build.printStatus === 'sending') {
    return <p className="text-sm text-text">Print file: <span className="text-muted">handing it to the print queue…</span></p>
  }
  return <p className="text-sm text-text">Print file: <span className="text-emerald-700">rebuilt from these changes · ready</span></p>
}

function readError(e: any): string {
  const m = String(e?.message ?? '')
  const json = m.match(/\{.*\}$/)
  if (json) {
    try {
      return JSON.parse(json[0]).error ?? m
    } catch {
      /* fall through */
    }
  }
  return m || 'Please try again.'
}
