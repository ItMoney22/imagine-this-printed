// The QR counter stand's three choices inside a seller's store (David 2026-10-26: "the qr stands also need to be
// added"): where the code points, the words under it and a logo, with the live preview of what prints. The same
// pieces and rules as ITP's own stand page (src/pages/QrStandOrder.tsx, backend/shared/qr-stand.ts); the store's
// checkout re-checks every field server-side (routes/vendor-store.ts readQrStandFields).
import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Loader2, X } from 'lucide-react'
import StandPreview from '../../components/qr-stand/StandPreview'
import { logoPrintFrom } from '../../lib/qr-stand/load-logo'
import { uploadLogo, LOGO_TYPES } from '../../lib/qr-stand/upload-logo'
import { QR_CAPTIONS, QR_FIELD, QR_LINK_MAX_BYTES, cleanQrCaption, normalizeQrLink, qrCaptionProblem, qrLinkProblem } from '../../../backend/shared/qr-stand'

export type StandChoice = { ready: boolean; personalization: Record<string, string> }

export default function StoreStandFields({ onChange }: { onChange: (c: StandChoice) => void }) {
  const [rawLink, setRawLink] = useState('')
  const [preset, setPreset] = useState<string>(QR_CAPTIONS[1])
  const [custom, setCustom] = useState('')
  const [logoPath, setLogoPath] = useState<string | null>(null)
  const [logoPrint, setLogoPrint] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const file = useRef<HTMLInputElement>(null)

  const link = normalizeQrLink(rawLink)
  const linkProblem = link ? qrLinkProblem(link) : null
  const caption = cleanQrCaption(preset === 'Custom' ? custom : preset)
  const captionProblem = qrCaptionProblem(caption)
  const ready = !!link && !linkProblem && !captionProblem && !busy

  useEffect(() => {
    onChange({
      ready,
      personalization: { [QR_FIELD.link]: link, [QR_FIELD.caption]: caption, ...(logoPath ? { [QR_FIELD.logoPath]: logoPath } : {}) },
    })
  }, [ready, link, caption, logoPath]) // eslint-disable-line react-hooks/exhaustive-deps

  async function take(f: File | undefined | null) {
    if (!f) return
    setProblem('')
    if (!LOGO_TYPES.test(f.type)) return setProblem('Use a PNG or JPG of your logo.')
    const print = await logoPrintFrom(f).catch(() => ({ dataUrl: null, problem: null }))
    if (print.problem) return setProblem(print.problem)
    setLogoPrint(print.dataUrl)
    setBusy(true)
    try {
      setLogoPath((await uploadLogo(f, () => {})).path)
    } catch (e: any) {
      setLogoPrint(null)
      setProblem(e?.message ?? 'The logo did not upload. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="text-sm font-semibold">1. Where should the code point?
        <input className="mt-1 w-full rounded-xl border border-[var(--vs-line)] px-3 h-11 font-normal outline-none focus:border-[var(--vs-primary)]"
          placeholder="yourshop.com or a payment link" value={rawLink} onChange={e => setRawLink(e.target.value)} />
        <span className="flex justify-between text-xs font-normal mt-1">
          <span className={linkProblem ? 'text-red-600' : 'text-[var(--vs-muted)]'}>{linkProblem || 'Your website, Google review, menu or payment link.'}</span>
          <span className="text-[var(--vs-muted)]">{new TextEncoder().encode(link).length}/{QR_LINK_MAX_BYTES}</span>
        </span>
      </label>

      <div>
        <p className="text-sm font-semibold mb-2">2. Words under the code</p>
        <div className="flex flex-wrap gap-2">
          {[...QR_CAPTIONS, 'Custom'].map(c => (
            <button key={c} type="button" aria-pressed={preset === c} onClick={() => setPreset(c)} className="vs-size h-9 px-3 rounded-lg border border-[var(--vs-line)] text-sm">{c}</button>
          ))}
        </div>
        {preset === 'Custom' && (
          <input className="mt-2 w-full rounded-xl border border-[var(--vs-line)] px-3 h-10 text-sm outline-none focus:border-[var(--vs-primary)]" placeholder="Your words" value={custom} onChange={e => setCustom(e.target.value)} />
        )}
        {preset === 'Custom' && custom && captionProblem && <p className="text-xs text-red-600 mt-1">{captionProblem}</p>}
      </div>

      <div>
        <p className="text-sm font-semibold mb-2">3. Your logo for the middle <span className="font-normal text-[var(--vs-muted)]">(optional)</span></p>
        {logoPrint ? (
          <div className="flex items-center gap-3">
            <img src={logoPrint} alt="" className="w-14 h-14 rounded-lg border border-[var(--vs-line)] object-contain bg-white" />
            {busy ? <span className="flex items-center gap-2 text-sm text-[var(--vs-muted)]"><Loader2 className="w-4 h-4 animate-spin" /> Uploading…</span> : <span className="text-sm">This is how it prints.</span>}
            <button type="button" className="ml-auto" onClick={() => { setLogoPath(null); setLogoPrint(null) }} aria-label="Remove the logo"><X className="w-5 h-5" /></button>
          </div>
        ) : (
          <button type="button" onClick={() => file.current?.click()} className="w-full rounded-xl border-2 border-dashed border-[var(--vs-line)] h-20 flex items-center justify-center gap-2 text-sm text-[var(--vs-muted)] hover:border-[var(--vs-primary)]">
            <ImagePlus className="w-5 h-5 text-[var(--vs-primary)]" /> Add your logo (PNG or JPG)
          </button>
        )}
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => take(e.target.files?.[0])} />
        {problem && <p className="text-xs text-red-600 mt-1">{problem}</p>}
      </div>

      <div className="rounded-2xl bg-[var(--vs-page)] p-3">
        <p className="text-xs font-semibold text-[var(--vs-primary)] mb-2">Live preview</p>
        <StandPreview link={link && !linkProblem ? link : 'https://imaginethisprinted.com'} caption={caption || ' '} logoSrc={logoPrint} className="w-40 mx-auto" label="Your stand" />
      </div>
    </div>
  )
}
