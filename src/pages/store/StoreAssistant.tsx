// Her store assistant (David 2026-10-26: "Gemini 3.8. Both have voice and text. So it responds TTS, Gemini TTS" ...
// "needs a image and likeness, needs to have memory built in" ... "she should be able to upload images and the
// assistant can assess the design to create a product out of it, it can go through the step flow").
// Type, talk (the mic records a voice note Gemini hears and answers in one call) or attach a picture of a design: the
// assistant looks it over like a print shop would, and when it could sell, its reply carries Make it a product, which
// drops the design into the Step Flow (customerStepFlow upload + adopt) and opens Create a design on this page at it.
// The chat lives on the server (/assistant/history), so it follows her to any device and the assistant remembers her
// between chats. Replies are read out in the assistant's own Gemini voice when "Read replies out loud" is on. Docked on
// wide screens, a sheet on a phone. Approved mocks: itp-crystal-store-manager-extras + -inbox round 1.
// Mockups (David 2026-10-29: "crystal gives him a image says mock this on a shirt he does it he comes up in a
// lightbox"): a reply that offers one carries Make the mockup with its price; pressing it charges that and the server
// renders it, this panel polls until the picture lands as its own reply, then opens it in the admin ImageLightbox.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Image as ImageIcon, Mic, Paperclip, Send, Shirt, Sparkles, Square, Volume2, VolumeX, X } from 'lucide-react'
import { vendorStoreApi, type AssistantMessage } from '../../lib/vendor-store'
import { customerStepFlow } from '../../lib/api'
import ProgressBar from '../../components/studio/ProgressBar'
import { ImageLightbox } from '../../components/admin/ImageLightbox'

const SUGGESTIONS = ['Write a description for my new shirt', 'Caption for Instagram', 'How did I do this week?']
const PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const PICTURE_MAX_BYTES = 15 * 1024 * 1024
// Upload plus adopt: quick for print-ready art, about half a minute when a small file is enlarged first.
const MAKE_EXPECTED_MS = 25000
// One product shot plus its check against her picture: usually under a minute.
const MOCKUP_EXPECTED_MS = 45000
const MOCKUP_POLL_MS = 2500
const cleanError = (e: any) => String(e?.message || e).replace(/^HTTP \d+: /, '').replace(/^\{"error":"(.*?)".*\}$/, '$1')

/** A message as the panel shows it: `localImage` is her own copy of a picture she just sent, shown at once. */
type ChatMessage = AssistantMessage & { localImage?: string }

function pickMime(): string {
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(m)) return m
  }
  return ''
}

const blobAsDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('That picture couldn’t be read'))
    reader.readAsDataURL(blob)
  })

function timeOf(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`
}

export default function StoreAssistant({ slug, ownerFirst, assistantName, faceUrl, open, onClose, onMakeProduct, onNeedStudio }: {
  slug: string
  ownerFirst: string
  /** Her first name (the store theme's assistantName). Without one she is just "Your store assistant". */
  assistantName?: string
  /** The assistant's face: the store theme's `assistant` art, else /stores/<slug>/assistant.webp. */
  faceUrl?: string
  open: boolean
  onClose: () => void
  /** A design is in the Step Flow: open Create a design on it. */
  onMakeProduct: (productId: string) => void
  /** Her design studio isn't turned on yet: show her where to turn it on. */
  onNeedStudio: () => void
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loaded, setLoaded] = useState(false)
  const [text, setText] = useState('')
  const [picture, setPicture] = useState<{ file: File; preview: string } | null>(null)
  const [busy, setBusy] = useState<'thinking' | 'speaking' | null>(null)
  const [thinking, setThinking] = useState({ label: 'Thinking…', startedAt: 0, expectedMs: 4000 })
  const [error, setError] = useState('')
  const [making, setMaking] = useState<{ key: string; stage: string; startedAt: number } | null>(null)
  const [makeError, setMakeError] = useState<{ key: string; text: string } | null>(null)
  const [mockupError, setMockupError] = useState<{ id: string; text: string } | null>(null)
  // The mockup open in the lightbox, by its reply's id.
  const [viewing, setViewing] = useState<string | null>(null)
  const watching = useRef(new Set<string>())
  const alive = useRef(true)
  const [faceOk, setFaceOk] = useState(true)
  const [speakOn, setSpeakOn] = useState(() => { try { return localStorage.getItem('vstore-assistant-speak') !== 'off' } catch { return true } })
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const audio = useRef<HTMLAudioElement | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const pictureInput = useRef<HTMLInputElement>(null)
  // The files she attached this visit, by their saved URL: Make it a product sends her original, not a download of it.
  const files = useRef(new Map<string, File>())
  const face = faceUrl || `/stores/${slug}/assistant.webp`

  // A reply's new state from the server (a mockup offer moving along), merged in place.
  const mergeMessage = (next: AssistantMessage) => setMessages(ms => ms.map(x => (x.id && x.id === next.id ? { ...x, ...next } : x)))

  /** Polls a mockup until it is done or failed; when its picture lands, it joins the chat and opens in the lightbox. */
  const watchMockup = (id: string) => {
    if (watching.current.has(id)) return
    watching.current.add(id)
    let misses = 0
    const tick = async () => {
      if (!alive.current) return
      try {
        const { message, result } = await vendorStoreApi.mockupStatus(slug, id)
        misses = 0
        mergeMessage(message)
        if (message.mockup?.status === 'rendering') return void setTimeout(tick, MOCKUP_POLL_MS)
        watching.current.delete(id)
        if (result?.id) {
          setMessages(ms => (ms.some(x => x.id === result.id) ? ms : [...ms, result]))
          setViewing(result.id)
        }
      } catch {
        if (++misses > 5) return void watching.current.delete(id)
        setTimeout(tick, MOCKUP_POLL_MS * 2)
      }
    }
    setTimeout(tick, MOCKUP_POLL_MS)
  }
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const makeMockup = async (m: ChatMessage) => {
    if (!m.id) return
    setMockupError(null)
    try {
      const { message } = await vendorStoreApi.makeMockup(slug, m.id)
      mergeMessage(message)
      if (message.mockup?.status === 'rendering') watchMockup(m.id)
    } catch (e) {
      setMockupError({ id: m.id, text: cleanError(e) })
    }
  }

  useEffect(() => {
    if (!open || loaded) return
    vendorStoreApi.history(slug)
      .then(({ messages: saved }) => {
        setMessages(m => [...saved, ...m])
        // A mockup still being made when she left picks up where it was.
        saved.forEach(x => x.id && x.mockup?.status === 'rendering' && watchMockup(x.id))
      })
      .catch(() => setError('Your earlier chat didn’t load.'))
      .finally(() => setLoaded(true))
  }, [open, loaded, slug])
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' }) }, [messages, busy, making])
  useEffect(() => { try { localStorage.setItem('vstore-assistant-speak', speakOn ? 'on' : 'off') } catch { /* ok */ } }, [speakOn])
  useEffect(() => {
    if (!recording) return
    const t = setInterval(() => setSeconds(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [recording])
  useEffect(() => () => { audio.current?.pause(); recorder.current?.stream.getTracks().forEach(t => t.stop()) }, [])

  const say = async (reply: string) => {
    if (!speakOn) return
    setBusy('speaking')
    try {
      const { audioUrl } = await vendorStoreApi.speak(slug, reply)
      audio.current?.pause()
      audio.current = new Audio(audioUrl)
      audio.current.onended = () => setBusy(null)
      await audio.current.play()
    } catch {
      setBusy(null)
    }
  }

  /** One turn. `shown` is her message already on screen (typed or with a picture); a voice note shows once heard. */
  const ask = async (turn: { text?: string; audio?: Blob; image?: File }, shown?: ChatMessage) => {
    setBusy('thinking')
    setError('')
    setThinking({
      label: turn.image ? 'Looking at your design…' : turn.audio ? 'Listening…' : 'Thinking…',
      startedAt: Date.now(),
      expectedMs: turn.image ? 9000 : 4000,
    })
    try {
      const answer = await vendorStoreApi.ask(slug, turn)
      if (turn.image && answer.imageUrl) files.current.set(answer.imageUrl, turn.image)
      const saved: ChatMessage[] = answer.messages.length === 2
        ? answer.messages
        : [
            { role: 'user', text: answer.heard || turn.text || '', imageUrl: answer.imageUrl, createdAt: new Date().toISOString() },
            { role: 'assistant', text: answer.reply, imageUrl: answer.makeProduct ? answer.imageUrl : null, makeProduct: answer.makeProduct, createdAt: new Date().toISOString() },
          ]
      if (shown?.localImage) saved[0] = { ...saved[0], localImage: shown.localImage }
      setMessages(m => [...m.filter(x => x !== shown), ...saved])
      setBusy(null)
      await say(answer.reply)
    } catch (e: any) {
      setError(e.message)
      setBusy(null)
    }
  }

  const send = (value = text) => {
    const v = value.trim()
    if ((!v && !picture) || busy === 'thinking') return
    const shown: ChatMessage = { role: 'user', text: v, localImage: picture?.preview, createdAt: new Date().toISOString() }
    setMessages(m => [...m, shown])
    setText('')
    const image = picture?.file
    setPicture(null)
    ask({ text: v || undefined, image }, shown)
  }

  const attach = (file: File | undefined) => {
    if (!file) return
    setError('')
    if (!PICTURE_TYPES.includes(file.type)) return setError('Attach a PNG, JPG or WEBP picture.')
    if (file.size > PICTURE_MAX_BYTES) return setError('That picture is over 15 MB.')
    setPicture({ file, preview: URL.createObjectURL(file) })
  }

  const toggleMic = async () => {
    if (recording) {
      recorder.current?.stop()
      return
    }
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = pickMime()
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunks.current = []
      r.ondataavailable = e => e.data.size && chunks.current.push(e.data)
      r.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        setRecording(false)
        const blob = new Blob(chunks.current, { type: (r.mimeType || 'audio/webm').replace(/;.*$/, '') })
        if (blob.size <= 2000) return
        // A picture waiting in the box goes with what she says about it.
        const image = picture?.file
        const shown: ChatMessage | undefined = picture ? { role: 'user', text: '', localImage: picture.preview, createdAt: new Date().toISOString() } : undefined
        if (shown) setMessages(m => [...m, shown])
        setPicture(null)
        ask({ audio: blob, image }, shown)
      }
      audio.current?.pause()
      r.start()
      recorder.current = r
      setSeconds(0)
      setRecording(true)
    } catch {
      setError('Allow the microphone to talk to your assistant.')
    }
  }

  const makeProduct = async (m: ChatMessage, key: string) => {
    if (making || !m.imageUrl) return
    setMakeError(null)
    setMaking({ key, stage: 'Saving your design…', startedAt: Date.now() })
    let productId: string | null = null
    try {
      // Her own file when she attached it this visit; after a reload, the copy her turn saved.
      const file = files.current.get(m.imageUrl)
      if (!file && !m.id) throw new Error('Attach the picture again, then press Make it a product.')
      const saved = file ? null : await vendorStoreApi.design(slug, m.id!)
      const image = file ? await blobAsDataUrl(file) : saved!.image
      ;({ productId } = await customerStepFlow.upload({ image, kind: 'tshirt', filename: file?.name || saved!.filename }))
      // Adopt BEFORE the builder learns the id, or its resume effect starts a second adopt (UploadDesignPanel).
      setMaking({ key, stage: 'Getting the print file ready…', startedAt: Date.now() })
      await customerStepFlow.adopt(productId)
      setMaking(null)
      onMakeProduct(productId)
    } catch (err: any) {
      // A draft whose design could not be brought in would sit in her builds with no way forward, so it goes.
      if (productId) await customerStepFlow.discardDraft(productId).catch(() => undefined)
      setMaking(null)
      if (err?.body?.code === 'creator_signup_required') {
        setMakeError({ key, text: 'Turn on the design studio first (one tap in Create a design), then press Make it a product again.' })
        onNeedStudio()
      } else {
        setMakeError({ key, text: err?.message || 'That didn’t work. Try again.' })
      }
    }
  }

  // Every mockup in the chat, so the lightbox steps through them all.
  const shots = messages.filter(m => m.id && m.mockup?.status === 'result' && m.imageUrl)
  const viewIndex = viewing ? shots.findIndex(m => m.id === viewing) : -1

  const faceIcon = (size: number) => faceOk
    ? <img src={face} alt="" width={size} height={size} onError={() => setFaceOk(false)} className="rounded-full object-cover shrink-0 bg-[var(--vs-page)]" style={{ width: size, height: size }} />
    : <span className="rounded-full grid place-items-center text-white shrink-0" style={{ width: size, height: size, background: 'var(--vs-primary)' }}><Sparkles className="w-1/2 h-1/2" /></span>

  if (!open) return null
  return (
    <aside className="vs-assistant fixed inset-x-0 bottom-0 z-50 h-[85vh] rounded-t-3xl xl:static xl:h-[calc(100vh-7rem)] xl:sticky xl:top-24 xl:rounded-3xl bg-white border border-[var(--vs-line)] shadow-2xl xl:shadow-none flex flex-col" aria-label={assistantName ? `${assistantName}, your store assistant` : 'Your store assistant'}>
      <div className="flex items-center gap-3 px-4 pt-4">
        {faceIcon(48)}
        <div className="flex-1 min-w-0">
          <p className="vs-display text-xl leading-tight">{assistantName || 'Your store assistant'}</p>
          {assistantName && <p className="text-xs text-[var(--vs-muted)]">Your store assistant</p>}
        </div>
        <button onClick={onClose} aria-label="Close the assistant"><X className="w-5 h-5" /></button>
      </div>
      <button onClick={() => { setSpeakOn(!speakOn); if (speakOn) audio.current?.pause() }} className="self-start mx-4 mt-2 flex items-center gap-2 text-sm text-[var(--vs-muted)]" aria-pressed={speakOn}>
        {speakOn ? <Volume2 className="w-4 h-4 text-[var(--vs-primary)]" /> : <VolumeX className="w-4 h-4" />} Read replies out loud {speakOn ? '(on)' : '(off)'}
      </button>

      <div ref={list} className="flex-1 overflow-auto px-4 py-3 flex flex-col gap-3">
        {loaded && messages.length === 0 && (
          <div className="flex items-start gap-2">
            {faceIcon(32)}
            <div className="rounded-2xl rounded-tl-md bg-[var(--vs-page)] p-4 text-sm">
              {assistantName ? `¡Hola ${ownerFirst}! Soy ${assistantName}, your store assistant.` : `Hi ${ownerFirst}!`} Ask me anything about your store, or tap the mic and just talk. I write descriptions and Instagram captions and tell you how your sales are doing. Attach a picture of a design with the paperclip and I’ll tell you how it will print, show it to you on a shirt, and help you make it a product.
            </div>
          </div>
        )}
        {messages.map((m, i) => {
          const key = m.id || `local-${i}`
          const shot = m.localImage || m.imageUrl
          if (m.role === 'user') {
            return (
              <div key={key} className="self-end max-w-[85%] flex flex-col items-end gap-1">
                {shot && <img src={shot} alt="Your design" className="max-h-44 max-w-full rounded-2xl border border-[var(--vs-line)] bg-[var(--vs-page)] object-contain" />}
                {m.text && <div className="rounded-2xl rounded-br-md px-4 py-2.5 text-sm text-white whitespace-pre-line" style={{ background: 'var(--vs-pink)' }}>{m.text}</div>}
                <span className="text-[11px] text-[var(--vs-muted)]">{timeOf(m.createdAt)}</span>
              </div>
            )
          }
          return (
            <div key={key} className="self-start max-w-[92%] flex items-start gap-2">
              {faceIcon(32)}
              <div className="min-w-0 flex flex-col gap-1">
                <div className="rounded-2xl rounded-tl-md bg-white border border-[var(--vs-line)] px-4 py-2.5 text-sm whitespace-pre-line">{m.text}</div>
                {m.makeProduct && m.imageUrl && (
                  <div className="flex flex-col gap-2 mt-1">
                    {making?.key === key ? (
                      <ProgressBar label={making.stage} startedAt={making.startedAt} expectedMs={MAKE_EXPECTED_MS} />
                    ) : (
                      <button onClick={() => makeProduct(m, key)} disabled={!!making} className="vs-btn-pink self-start rounded-xl px-4 h-10 text-sm font-semibold flex items-center gap-2">
                        <Shirt className="w-4 h-4" /> Make it a product
                      </button>
                    )}
                    {makeError?.key === key && <p className="text-sm text-red-600">{makeError.text}</p>}
                  </div>
                )}
                {m.id && m.mockup && m.mockup.status !== 'result' && m.mockup.status !== 'done' && (
                  <div className="flex flex-col gap-2 mt-1">
                    {m.mockup.status === 'rendering' ? (
                      <ProgressBar
                        label={m.mockup.stage || 'Making your mockup…'}
                        startedAt={m.mockup.startedAt ? Date.parse(m.mockup.startedAt) : undefined}
                        expectedMs={MOCKUP_EXPECTED_MS}
                      />
                    ) : (
                      <button onClick={() => makeMockup(m)} className="vs-btn-pink self-start rounded-xl px-4 h-10 text-sm font-semibold flex items-center gap-2">
                        <ImageIcon className="w-4 h-4" /> {m.mockup.status === 'failed' ? 'Try again' : 'Make the mockup'}{m.mockup.priceItc ? ` · ${m.mockup.priceItc} ITC` : ''}
                      </button>
                    )}
                    {m.mockup.status === 'failed' && m.mockup.error && mockupError?.id !== m.id && <p className="text-sm text-red-600">{m.mockup.error}</p>}
                    {mockupError?.id === m.id && (
                      <p className="text-sm text-red-600">
                        {mockupError.text}
                        {/Buy credits/.test(mockupError.text) && <> <a href="/wallet" className="font-semibold underline text-[var(--vs-primary)]">Buy credits</a></>}
                      </p>
                    )}
                  </div>
                )}
                {m.id && m.mockup?.status === 'result' && m.imageUrl && (
                  <button onClick={() => setViewing(m.id!)} aria-label={`See your picture on the ${m.mockup.label} big`}
                    className="self-start rounded-2xl overflow-hidden border border-[var(--vs-line)] bg-[var(--vs-page)] transition-transform hover:scale-[1.02] active:scale-[0.98]">
                    <img src={m.imageUrl} alt={`Your picture on a ${m.mockup.label}`} className="block w-56 max-w-full aspect-square object-cover" />
                  </button>
                )}
                <span className="text-[11px] text-[var(--vs-muted)]">{timeOf(m.createdAt)}</span>
              </div>
            </div>
          )
        })}
        {busy === 'thinking' && (
          <div className="self-start w-full max-w-[85%] flex items-start gap-2">
            {faceIcon(32)}
            <div className="flex-1 min-w-0 pt-1"><ProgressBar label={thinking.label} startedAt={thinking.startedAt} expectedMs={thinking.expectedMs} /></div>
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      {messages.length < 4 && (
        <div className="px-4 pb-2">
          <p className="text-xs font-semibold text-[var(--vs-primary)] mb-2">Quick suggestions</p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map(s => <button key={s} onClick={() => send(s)} className="rounded-full border border-[var(--vs-primary)]/30 text-[var(--vs-primary)] text-xs px-3 h-8 hover:bg-[var(--vs-page)]">{s}</button>)}
          </div>
        </div>
      )}

      <div className="p-4 pt-2 border-t border-[var(--vs-line)] flex flex-col items-center gap-3">
        {picture && (
          <div className="w-full flex items-center gap-3 rounded-xl bg-[var(--vs-page)] p-2">
            <img src={picture.preview} alt="Picture to send" className="w-12 h-12 rounded-lg object-contain bg-white border border-[var(--vs-line)]" />
            <p className="flex-1 min-w-0 text-xs text-[var(--vs-muted)] truncate">{picture.file.name}</p>
            <button onClick={() => setPicture(null)} aria-label="Remove the picture" className="w-8 h-8 grid place-items-center rounded-lg hover:bg-white"><X className="w-4 h-4" /></button>
          </div>
        )}
        <form className="w-full flex items-center gap-2" onSubmit={e => { e.preventDefault(); send() }}>
          <div className="flex-1 flex items-center rounded-xl border border-[var(--vs-line)] focus-within:border-[var(--vs-primary)] pl-1">
            <button type="button" onClick={() => pictureInput.current?.click()} disabled={busy === 'thinking'} aria-label="Attach a picture of a design" className="w-9 h-9 grid place-items-center rounded-lg text-[var(--vs-primary)] hover:bg-[var(--vs-page)] disabled:opacity-50">
              <Paperclip className="w-5 h-5" />
            </button>
            <input className="flex-1 min-w-0 px-2 h-11 outline-none text-sm bg-transparent" placeholder={picture ? 'Ask about it, or say “mock this on a shirt”…' : 'Type your message…'} value={text} onChange={e => setText(e.target.value)} />
          </div>
          <input ref={pictureInput} type="file" accept={PICTURE_TYPES.join(',')} className="hidden" onChange={e => { attach(e.target.files?.[0]); e.target.value = '' }} />
          <button type="submit" disabled={(!text.trim() && !picture) || busy === 'thinking'} className="w-11 h-11 rounded-xl grid place-items-center text-white disabled:opacity-50" style={{ background: 'var(--vs-primary)' }} aria-label="Send"><Send className="w-5 h-5" /></button>
        </form>
        <button onClick={toggleMic} disabled={busy === 'thinking'} aria-label={recording ? 'Stop and send' : 'Talk to your assistant'}
          className={`w-16 h-16 rounded-full grid place-items-center text-white shadow-lg transition-transform hover:scale-105 disabled:opacity-50 ${recording ? 'vs-recording' : ''}`}
          style={{ background: recording ? 'var(--vs-pink)' : 'var(--vs-primary)' }}>
          {recording ? <Square className="w-6 h-6" /> : <Mic className="w-7 h-7" />}
        </button>
        <p className="text-xs text-[var(--vs-muted)] -mt-1">{recording ? `Listening… ${seconds}s. Tap to send.` : busy === 'speaking' ? 'Speaking…' : 'Tap the mic to talk'}</p>
      </div>
      {viewIndex >= 0 && createPortal(
        <ImageLightbox
          images={shots.map(m => ({ url: m.imageUrl!, label: `Your picture on a ${m.mockup!.label}` }))}
          index={viewIndex}
          onIndexChange={i => setViewing(shots[i]?.id ?? null)}
          onClose={() => setViewing(null)}
        />,
        document.body
      )}
    </aside>
  )
}
