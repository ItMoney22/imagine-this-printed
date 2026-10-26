// Her store assistant (David 2026-10-26: "Gemini 3.8. Both have voice and text. So it responds TTS, Gemini TTS").
// Type or talk: the mic records a voice note (MediaRecorder) that Gemini hears and answers in one call; replies are
// read out in the assistant's own Gemini voice when "Read replies out loud" is on. Docked on wide screens, a sheet
// on a phone. Approved mock: itp-crystal-store-manager-extras round 1.
import { useEffect, useRef, useState } from 'react'
import { Loader2, Mic, Send, Sparkles, Square, Volume2, VolumeX, X } from 'lucide-react'
import { vendorStoreApi, type AssistantMessage } from '../../lib/vendor-store'

const SUGGESTIONS = ['Write a description for my new shirt', 'Caption for Instagram', 'How did I do this week?']

function pickMime(): string {
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(m)) return m
  }
  return ''
}

const store = (k: string) => ({
  get: <T,>(fallback: T): T => { try { const v = sessionStorage.getItem(k); return v ? JSON.parse(v) : fallback } catch { return fallback } },
  set: (v: unknown) => { try { sessionStorage.setItem(k, JSON.stringify(v)) } catch { /* private mode */ } },
})

export default function StoreAssistant({ slug, ownerFirst, open, onClose }: { slug: string; ownerFirst: string; open: boolean; onClose: () => void }) {
  const chatKey = store(`vstore-assistant:${slug}`)
  const [messages, setMessages] = useState<AssistantMessage[]>(() => chatKey.get<AssistantMessage[]>([]))
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<'thinking' | 'speaking' | null>(null)
  const [error, setError] = useState('')
  const [speakOn, setSpeakOn] = useState(() => { try { return localStorage.getItem('vstore-assistant-speak') !== 'off' } catch { return true } })
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const audio = useRef<HTMLAudioElement | null>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => { chatKey.set(messages.slice(-30)); list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' }) }, [messages]) // eslint-disable-line react-hooks/exhaustive-deps
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

  const ask = async (history: AssistantMessage[], voice?: Blob) => {
    setBusy('thinking')
    setError('')
    try {
      const { heard, reply } = await vendorStoreApi.ask(slug, history, voice)
      const next: AssistantMessage[] = [...history, ...(heard ? [{ role: 'user' as const, text: heard }] : []), { role: 'assistant', text: reply }]
      setMessages(next)
      setBusy(null)
      await say(reply)
    } catch (e: any) {
      setError(e.message)
      setBusy(null)
    }
  }

  const send = (value = text) => {
    const v = value.trim()
    if (!v || busy === 'thinking') return
    const history: AssistantMessage[] = [...messages, { role: 'user', text: v }]
    setMessages(history)
    setText('')
    ask(history)
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
        if (blob.size > 2000) ask(messages, blob)
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

  if (!open) return null
  return (
    <aside className="vs-assistant fixed inset-x-0 bottom-0 z-50 h-[85vh] rounded-t-3xl xl:static xl:h-[calc(100vh-7rem)] xl:sticky xl:top-24 xl:rounded-3xl bg-white border border-[var(--vs-line)] shadow-2xl xl:shadow-none flex flex-col" aria-label="Your store assistant">
      <div className="flex items-center gap-3 px-4 pt-4">
        <span className="w-9 h-9 rounded-full grid place-items-center text-white" style={{ background: 'var(--vs-primary)' }}><Sparkles className="w-5 h-5" /></span>
        <p className="vs-display text-xl flex-1">Your store assistant</p>
        <button onClick={onClose} aria-label="Close the assistant"><X className="w-5 h-5" /></button>
      </div>
      <button onClick={() => { setSpeakOn(!speakOn); if (speakOn) audio.current?.pause() }} className="self-start mx-4 mt-2 flex items-center gap-2 text-sm text-[var(--vs-muted)]" aria-pressed={speakOn}>
        {speakOn ? <Volume2 className="w-4 h-4 text-[var(--vs-primary)]" /> : <VolumeX className="w-4 h-4" />} Read replies out loud {speakOn ? '(on)' : '(off)'}
      </button>

      <div ref={list} className="flex-1 overflow-auto px-4 py-3 flex flex-col gap-3">
        {messages.length === 0 && (
          <div className="rounded-2xl bg-[var(--vs-page)] p-4 text-sm">
            Hi {ownerFirst}! Ask me anything about your store, or tap the mic and just talk. I can write descriptions and Instagram captions, and tell you how your sales are doing.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-line ${m.role === 'user' ? 'self-end text-white rounded-br-md' : 'self-start bg-white border border-[var(--vs-line)] rounded-bl-md'}`}
            style={m.role === 'user' ? { background: 'var(--vs-pink)' } : undefined}>
            {m.text}
          </div>
        ))}
        {busy === 'thinking' && <div className="self-start flex items-center gap-2 text-sm text-[var(--vs-muted)]"><Loader2 className="w-4 h-4 animate-spin" /> Thinking…</div>}
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
        <form className="w-full flex items-center gap-2" onSubmit={e => { e.preventDefault(); send() }}>
          <input className="flex-1 rounded-xl border border-[var(--vs-line)] px-3 h-11 outline-none focus:border-[var(--vs-primary)] text-sm" placeholder="Type your message…" value={text} onChange={e => setText(e.target.value)} />
          <button type="submit" disabled={!text.trim() || busy === 'thinking'} className="w-11 h-11 rounded-xl grid place-items-center text-white disabled:opacity-50" style={{ background: 'var(--vs-primary)' }} aria-label="Send"><Send className="w-5 h-5" /></button>
        </form>
        <button onClick={toggleMic} disabled={busy === 'thinking'} aria-label={recording ? 'Stop and send' : 'Talk to your assistant'}
          className={`w-16 h-16 rounded-full grid place-items-center text-white shadow-lg transition-transform hover:scale-105 disabled:opacity-50 ${recording ? 'vs-recording' : ''}`}
          style={{ background: recording ? 'var(--vs-pink)' : 'var(--vs-primary)' }}>
          {recording ? <Square className="w-6 h-6" /> : <Mic className="w-7 h-7" />}
        </button>
        <p className="text-xs text-[var(--vs-muted)] -mt-1">{recording ? `Listening… ${seconds}s. Tap to send.` : busy === 'speaking' ? 'Speaking…' : 'Tap the mic to talk'}</p>
      </div>
    </aside>
  )
}
