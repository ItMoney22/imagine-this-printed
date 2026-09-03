/**
 * useStudioVoice — push-to-talk conversation with whatever mascot the host
 * configured, over whatever endpoint its adapter provides.
 *
 * One turn = record -> adapter.turn(audio) -> play the reply. Typing goes down
 * the exact same path with `text` instead of audio, so a quiet room, a denied
 * mic or a person who simply prefers typing is never a dead end.
 *
 * Deliberately request/response rather than a realtime socket. A realtime lane
 * bills per wall-clock minute with the browser holding the connection, so an
 * idle tab burns money nobody can cap. Here the cost is per utterance, idle is
 * free, and the host's server sees (and can rate-limit) every turn.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  StudioAdapter,
  StudioChatTurn,
  StudioTurnAction,
  StudioTurnResult,
  StudioVoiceStatus,
} from './types'

interface Options {
  adapter: StudioAdapter
  /** Board state the model reasons over — keep it small and plain. */
  getState: () => Record<string, unknown>
  /** Money moves: the STUDIO runs these against the metered endpoints. */
  onAction: (action: StudioTurnAction) => Promise<void> | void
  /** Pure state updates (product type, brief, quoted pricing). */
  onStatePatch: (patch: Record<string, unknown>) => void
  /** localStorage key for the mute preference. */
  mutePreferenceKey?: string
}

/** Below this, a recording is a stray tap, not speech. Don't pay to transcribe it. */
const MIN_SPEECH_BYTES = 1200

export function useStudioVoice({
  adapter,
  getState,
  onAction,
  onStatePatch,
  mutePreferenceKey = 'studio-kit-muted',
}: Options) {
  const supported = typeof adapter.turn === 'function'

  const [status, setStatus] = useState<StudioVoiceStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [muted, setMuted] = useState<boolean>(() => {
    try { return window.localStorage.getItem(mutePreferenceKey) === '1' } catch { return false }
  })
  const [conversation, setConversation] = useState<StudioChatTurn[]>([])

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const convoRef = useRef<StudioChatTurn[]>([])
  convoRef.current = conversation
  // Latest callbacks, so a re-render mid-turn never runs a stale handler.
  const cbRef = useRef({ adapter, getState, onAction, onStatePatch })
  cbRef.current = { adapter, getState, onAction, onStatePatch }
  // Read inside async turns without making them depend on the state value.
  const mutedRef = useRef(muted)
  mutedRef.current = muted

  useEffect(() => {
    try { window.localStorage.setItem(mutePreferenceKey, muted ? '1' : '0') } catch { /* private mode */ }
  }, [muted, mutePreferenceKey])

  const stopPlayback = useCallback(() => {
    const el = audioRef.current
    if (el) { el.pause(); el.src = '' }
  }, [])

  const speak = useCallback(async (url: string) => {
    if (mutedRef.current) return
    stopPlayback()
    const el = audioRef.current ?? new Audio()
    audioRef.current = el
    el.src = url
    setStatus('speaking')
    await new Promise<void>((resolve) => {
      el.onended = () => resolve()
      el.onerror = () => resolve()
      void el.play().catch(() => resolve())
    })
    setStatus('idle')
  }, [stopPlayback])

  /** One turn. Pass audio OR text. */
  const sendTurn = useCallback(async (payload: { audio?: Blob; text?: string }) => {
    const turnFn = cbRef.current.adapter.turn
    if (!turnFn) return null
    setError(null)
    setStatus('thinking')
    try {
      const turn: StudioTurnResult = await turnFn({
        ...payload,
        state: cbRef.current.getState(),
        history: convoRef.current.slice(-8),
      })

      setConversation((prev) => [
        ...prev,
        { role: 'user' as const, content: turn.userText },
        { role: 'assistant' as const, content: turn.reply },
      ].slice(-20))

      if (turn.statePatch && Object.keys(turn.statePatch).length > 0) {
        cbRef.current.onStatePatch(turn.statePatch)
      }

      // Speak first, THEN spend: hearing "this costs 40, here we go" before the
      // charge fires is the whole point of the money rule.
      if (turn.audioUrl) await speak(turn.audioUrl)
      else setStatus('idle')

      if (turn.action) await cbRef.current.onAction(turn.action)

      return turn
    } catch (e: any) {
      setError(e?.message || 'That did not go through')
      setStatus('idle')
      return null
    }
  }, [speak])

  const startRecording = useCallback(async () => {
    setError(null)
    stopPlayback()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      streamRef.current = stream
      chunksRef.current = []
      const rec = new MediaRecorder(stream)
      recorderRef.current = rec
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      rec.onstop = () => {
        streamRef.current?.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        chunksRef.current = []
        if (blob.size < MIN_SPEECH_BYTES) { setStatus('idle'); return }
        void sendTurn({ audio: blob })
      }
      rec.start()
      setStatus('recording')
    } catch {
      setError('I need microphone access to hear you — or just type instead.')
      setStatus('idle')
    }
  }, [sendTurn, stopPlayback])

  const stopRecording = useCallback(() => {
    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') rec.stop()
    recorderRef.current = null
  }, [])

  const toggleRecording = useCallback(() => {
    if (status === 'recording') stopRecording()
    else if (status === 'idle') void startRecording()
  }, [status, startRecording, stopRecording])

  const sendText = useCallback((text: string) => {
    const t = text.trim()
    if (!t) return
    void sendTurn({ text: t })
  }, [sendTurn])

  /**
   * Have the mascot react to something that just happened on the board. The
   * studio calls this once per moment; it is a normal turn, so he answers in
   * character and can act on it.
   */
  const nudge = useCallback((text: string) => {
    void sendTurn({ text })
  }, [sendTurn])

  useEffect(() => () => {
    if (recorderRef.current?.state !== 'inactive') recorderRef.current?.stop()
    streamRef.current?.getTracks().forEach((t) => t.stop())
    const el = audioRef.current
    if (el) { el.pause(); el.src = '' }
  }, [])

  return {
    supported,
    status,
    error,
    muted,
    setMuted,
    conversation,
    toggleRecording,
    sendText,
    nudge,
    stopPlayback,
    isBusy: status === 'thinking' || status === 'speaking',
  }
}
