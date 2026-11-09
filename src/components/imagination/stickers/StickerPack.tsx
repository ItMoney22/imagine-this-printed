// Sticker Pack — one picture in, a pack of die-cut stickers out (David 2026-11-08: "i give you the image and i chose
// how many stickers i want the diff sticker types ... so clients can use esp crystal"). Mock: page_mockup_approvals
// 280d7fb3. Each sticker is one Flare call (op 'sticker'), so pricing, refunds and limits are the Flare Lab's own.
import React, { useEffect, useRef, useState } from 'react'
import { X, Sticker, Upload, RefreshCw, Download, Check, Sparkles, Loader2, ImagePlus, LayoutGrid } from 'lucide-react'
import { apiErrorMessage, flareApi } from '../../../lib/api'
import { zipStore } from '../../../lib/zip-store'
import {
  DEFAULT_STICKER_ITC,
  DEFAULT_TYPES,
  PACK_CONCURRENCY,
  PACK_SIZES,
  STICKER_TYPES,
  planPack,
  stickerExample,
  stickerFileName,
  stickerLabel,
  type StickerTypeId,
} from './stickerPlan'

interface Slot {
  style: string
  variant: number
  status: 'waiting' | 'making' | 'done' | 'failed'
  url?: string
  error?: string
}

export interface StickerPackProps {
  isOpen: boolean
  onClose: () => void
  /** The design open in the station, used as the picture until they pick another. */
  imageUrl?: string | null
  isAdmin?: boolean
  /** Put finished stickers into the station's designs. */
  onAddNew?: (urls: string[], label: string) => void
  /** Called after any paid run so the wallet balance on screen can refresh. */
  onSpent?: () => void
}

const OUT_OF_ITC = /^HTTP 402/

/** The backend takes https or a data URL; a local upload is shrunk to 1536 px so the request stays small. */
async function toSendable(url: string): Promise<string> {
  if (/^https:\/\//i.test(url) || /^http:\/\/localhost/i.test(url)) return url
  const blob = await (await fetch(url)).blob()
  const bmp = await createImageBitmap(blob)
  const scale = Math.min(1, 1536 / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * scale)
  c.height = Math.round(bmp.height * scale)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  return /png|webp/i.test(blob.type) ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.92)
}

const StickerPack: React.FC<StickerPackProps> = ({ isOpen, onClose, imageUrl, isAdmin, onAddNew, onSpent }) => {
  const [source, setSource] = useState<string | null>(imageUrl ?? null)
  const [count, setCount] = useState<number>(8)
  const [types, setTypes] = useState<StickerTypeId[]>(DEFAULT_TYPES)
  const [words, setWords] = useState('')
  const [perSticker, setPerSticker] = useState(DEFAULT_STICKER_ITC)
  const [slots, setSlots] = useState<Slot[]>([])
  const [running, setRunning] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [zipping, setZipping] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const resultsRef = useRef<HTMLElement | null>(null)
  const sendable = useRef<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    setSource((s) => s ?? imageUrl ?? null)
    flareApi
      .pricing()
      .then((p) => p?.perImage?.high && setPerSticker(p.perImage.high))
      .catch(() => {})
  }, [isOpen, imageUrl])

  // The pack fills in below the fold: once its grid is on screen, take them to it so they watch it happen.
  const [jumpToResults, setJumpToResults] = useState(false)
  useEffect(() => {
    if (!jumpToResults || !resultsRef.current) return
    setJumpToResults(false)
    resultsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [jumpToResults, slots.length])

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !running && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, running, onClose])

  if (!isOpen) return null

  const cost = isAdmin ? 0 : perSticker * count
  const done = slots.filter((s) => s.status === 'done')
  const finished = slots.filter((s) => s.status === 'done' || s.status === 'failed').length
  const ready = !!source && types.length > 0 && !running

  const toggleType = (id: StickerTypeId) =>
    setTypes((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]))

  const pickFile = (files: FileList | null) => {
    const f = files?.[0]
    if (!f) return
    if (!/^image\//.test(f.type)) {
      setNotice('That file is not a picture. Use a JPG or PNG.')
      return
    }
    sendable.current = null
    setNotice(null)
    setSource(URL.createObjectURL(f))
  }

  const patch = (i: number, next: Partial<Slot>) =>
    setSlots((all) => all.map((s, k) => (k === i ? { ...s, ...next } : s)))

  /** Make one sticker into slot i. Returns false when the wallet ran dry, so the pack stops asking. */
  const makeOne = async (i: number, slot: Pick<Slot, 'style' | 'variant'>, img: string): Promise<boolean> => {
    patch(i, { status: 'making', error: undefined })
    try {
      const out = await flareApi.run({
        op: 'sticker',
        imageUrl: img,
        stickerStyle: slot.style,
        variant: slot.variant,
        prompt: slot.style === 'bubble' ? words.trim() : '',
        quality: 'high',
      })
      const url = out.images?.[0]?.url
      patch(i, url ? { status: 'done', url } : { status: 'failed', error: 'Nothing came back. Try this one again.' })
      return true
    } catch (err) {
      const broke = err instanceof Error && OUT_OF_ITC.test(err.message)
      patch(i, { status: 'failed', error: apiErrorMessage(err, 'This sticker could not be made. Try it again.') })
      return !broke
    }
  }

  const makePack = async () => {
    if (!source || types.length === 0) return
    setNotice(null)
    setRunning(true)
    try {
      const img = sendable.current ?? (sendable.current = await toSendable(source))
      const plan = planPack(count, types)
      setSlots(plan.map((p) => ({ ...p, status: 'waiting' })))
      setJumpToResults(true)
      let next = 0
      let stop = false
      const worker = async () => {
        while (!stop && next < plan.length) {
          const i = next++
          if (!(await makeOne(i, plan[i], img))) stop = true
        }
      }
      await Promise.all(Array.from({ length: Math.min(PACK_CONCURRENCY, plan.length) }, worker))
      if (stop) {
        setSlots((all) => all.map((s) => (s.status === 'waiting' ? { ...s, status: 'failed', error: 'Top up your ITC to finish the pack.' } : s)))
        setNotice('Your ITC ran out part way. Top up your wallet, then press the arrows on the empty ones.')
      }
    } catch {
      setNotice('That picture could not be read. Try a JPG or PNG photo.')
    } finally {
      setRunning(false)
      onSpent?.()
    }
  }

  const reroll = async (i: number) => {
    if (running || !source) return
    setRunning(true)
    try {
      const img = sendable.current ?? (sendable.current = await toSendable(source))
      await makeOne(i, slots[i], img)
    } finally {
      setRunning(false)
      onSpent?.()
    }
  }

  const downloadPack = async () => {
    setZipping(true)
    setNotice(null)
    try {
      const files = await Promise.all(
        slots.map(async (s, i) => {
          if (s.status !== 'done' || !s.url) return null
          const buf = await (await fetch(s.url)).arrayBuffer()
          return { name: stickerFileName(i, s.style), data: new Uint8Array(buf) }
        })
      )
      const zip = zipStore(files.filter((f): f is { name: string; data: Uint8Array } => !!f))
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }))
      a.download = 'sticker-pack.zip'
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 4000)
    } catch {
      setNotice('The download was blocked. Open each sticker and save it instead.')
    } finally {
      setZipping(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-stretch justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Sticker Pack">
      <div className="bg-bg text-text w-full max-w-6xl sm:rounded-2xl border border-text/10 shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b st-divider bg-card">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-fuchsia-500 to-violet-600 flex items-center justify-center text-white shrink-0">
              <Sticker className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              <p className="font-bold leading-tight">Sticker Pack</p>
              <p className="text-xs text-muted truncate">One picture, a whole pack of stickers</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={running} className="p-2 rounded-lg st-link text-muted disabled:opacity-40" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Hero */}
          <section className="sp-hero relative overflow-hidden">
            <img src="/station/stickers/hero.webp" alt="" className="sp-hero-art absolute inset-0 w-full h-full object-cover" />
            <div className="sp-hero-fade absolute inset-0" />
            <div className="relative px-5 sm:px-10 py-8 sm:py-12 max-w-xl st-rise">
              <p className="flex items-center gap-2 text-xs font-semibold mb-3">
                <span className="w-2 h-2 rounded-full bg-emerald-500 st-pulse" /> Ready to create
              </p>
              <h2 className="text-3xl sm:text-5xl font-black uppercase leading-[0.95] tracking-tight">
                Turn one photo into a <span className="st-hero-word">sticker</span> pack
              </h2>
              <p className="mt-3 text-sm sm:text-base opacity-80">
                Upload one picture, pick how many and which kinds, and Imagination makes the whole pack.
              </p>
            </div>
          </section>

          {/* Three steps */}
          <section className="grid gap-3 p-3 sm:p-5 md:grid-cols-[1fr_1fr_1.6fr]">
            <div className="bg-card rounded-2xl p-4 st-ring">
              <StepTitle n={1} title="Your picture" />
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => pickFile(e.target.files)} />
              {source ? (
                <img src={source} alt="Your picture" className="w-full aspect-square object-cover rounded-xl st-ring" />
              ) : (
                <button type="button" onClick={() => fileRef.current?.click()} className="st-drop w-full aspect-square rounded-xl flex flex-col items-center justify-center gap-2 text-sm text-muted">
                  <Upload className="w-6 h-6 text-primary" />
                  Upload a photo
                </button>
              )}
              {source && (
                <button type="button" onClick={() => fileRef.current?.click()} disabled={running} className="mt-3 w-full st-pill rounded-lg py-2 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
                  <ImagePlus className="w-4 h-4" /> Change picture
                </button>
              )}
              <p className="mt-2 text-[11px] text-muted">A pet, a person, a logo or a product. One clear subject works best.</p>
            </div>

            <div className="bg-card rounded-2xl p-4 st-ring">
              <StepTitle n={2} title="How many" />
              <div className="grid grid-cols-4 gap-2">
                {PACK_SIZES.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setCount(n)}
                    disabled={running}
                    aria-pressed={count === n}
                    className={`rounded-xl py-3 text-lg font-bold transition-colors ${count === n ? 'bg-primary text-white shadow-md' : 'st-toggle bg-bg'}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted">
                {isAdmin ? 'Free for the team.' : `${perSticker} ITC a sticker. You only pay for the ones that come out.`}
              </p>
            </div>

            <div className="bg-card rounded-2xl p-4 st-ring">
              <StepTitle n={3} title="Sticker types" />
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {STICKER_TYPES.map((t) => {
                  const on = types.includes(t.id)
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => toggleType(t.id)}
                      disabled={running}
                      aria-pressed={on}
                      className={`sp-type relative rounded-xl p-1.5 text-center ${on ? 'sp-type-on' : 'st-toggle bg-bg'}`}
                    >
                      <span className={`absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center ${on ? 'bg-primary text-white' : 'st-ring bg-card'}`}>
                        {on && <Check className="w-3 h-3" />}
                      </span>
                      <img src={stickerExample(t.id)} alt="" loading="lazy" className="w-full aspect-square object-contain" />
                      <span className="block text-[11px] font-semibold leading-tight mt-0.5">{t.label}</span>
                    </button>
                  )
                })}
              </div>
              {types.includes('bubble') && (
                <label className="block mt-3 text-xs font-semibold">
                  Speech bubble words <span className="font-normal text-muted">(optional)</span>
                  <input
                    value={words}
                    onChange={(e) => setWords(e.target.value.slice(0, 40))}
                    placeholder="Good boy!"
                    className="mt-1 w-full rounded-lg bg-bg st-input px-3 py-2 text-sm font-normal"
                  />
                </label>
              )}
            </div>
          </section>

          <div className="px-3 sm:px-5">
            <button
              type="button"
              onClick={makePack}
              disabled={!ready}
              className="w-full rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white py-4 font-bold text-lg shadow-lg disabled:opacity-50 flex flex-col items-center"
            >
              <span className="flex items-center gap-2">
                {running ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                {running ? `Making your stickers… ${finished} of ${slots.length}` : 'Make my pack'}
              </span>
              <span className="text-xs font-medium opacity-85">
                {!source ? 'Add your picture first' : types.length === 0 ? 'Pick at least one sticker type' : `${count} stickers, ${cost ? `${cost} ITC` : 'free'}`}
              </span>
            </button>
            {notice && <p className="mt-3 text-sm text-center text-rose-600">{notice}</p>}
          </div>

          {/* Results */}
          {slots.length > 0 && (
            <section ref={resultsRef} className="p-3 sm:p-5 scroll-mt-2">
              <div className="sp-band rounded-2xl px-5 py-5 mb-4 text-white">
                <p className="text-xs font-semibold opacity-80 uppercase tracking-wider">Your stickers</p>
                <p className="text-2xl sm:text-3xl font-black uppercase">
                  {done.length} of {slots.length} ready
                </p>
                <p className="text-sm opacity-85">Same picture, {new Set(slots.map((s) => s.style)).size} styles.</p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {slots.map((s, i) => (
                  <figure key={i} className="bg-card rounded-2xl p-2 st-ring st-rise">
                    <div className="sp-check relative aspect-square rounded-xl overflow-hidden flex items-center justify-center">
                      {s.status === 'done' && s.url && <img src={s.url} alt={stickerLabel(s.style)} className="w-full h-full object-contain sp-drop" />}
                      {(s.status === 'waiting' || s.status === 'making') && (
                        <span className="flex flex-col items-center gap-2 text-xs text-muted">
                          <Loader2 className={`w-6 h-6 text-primary ${s.status === 'making' ? 'animate-spin' : 'opacity-40'}`} />
                          {s.status === 'making' ? 'Drawing…' : 'Waiting'}
                        </span>
                      )}
                      {s.status === 'failed' && <span className="px-3 text-center text-xs text-rose-600">{s.error}</span>}
                      {(s.status === 'done' || s.status === 'failed') && (
                        <button
                          type="button"
                          onClick={() => reroll(i)}
                          disabled={running}
                          title={isAdmin ? 'Make this one again' : `Make this one again (${perSticker} ITC)`}
                          className="absolute top-2 right-2 w-8 h-8 rounded-full bg-card st-ring flex items-center justify-center text-primary disabled:opacity-40"
                        >
                          <RefreshCw className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    <figcaption className="mt-2 flex items-center justify-between gap-2">
                      <span className="st-chip rounded-full px-2 py-0.5 text-[11px] font-semibold">{stickerLabel(s.style)}</span>
                      {s.status === 'done' && s.url && (
                        <a href={s.url} target="_blank" rel="noreferrer" className="text-xs text-muted st-link rounded px-1.5 py-0.5">
                          Open
                        </a>
                      )}
                    </figcaption>
                  </figure>
                ))}
              </div>

              {done.length > 0 && !running && (
                <div className="mt-4 grid sm:grid-cols-2 gap-3">
                  {onAddNew && (
                    <button
                      type="button"
                      onClick={() => {
                        onAddNew(done.map((s) => s.url!), 'Sticker Pack')
                        onClose()
                      }}
                      className="rounded-xl st-pill py-3 font-semibold flex items-center justify-center gap-2"
                    >
                      <LayoutGrid className="w-4 h-4" /> Add all to my designs
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={downloadPack}
                    disabled={zipping}
                    className="rounded-xl bg-primary text-white py-3 font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    {zipping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Download pack
                  </button>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

const StepTitle: React.FC<{ n: number; title: string }> = ({ n, title }) => (
  <p className="flex items-center gap-2 font-bold mb-3">
    <span className="w-6 h-6 rounded-full bg-primary text-white text-xs flex items-center justify-center">{n}</span>
    {title}
  </p>
)

export default StickerPack
