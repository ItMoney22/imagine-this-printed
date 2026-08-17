// useMrImagineVoice — push-to-talk conversation with Mr. Imagine in his own
// cloned MiniMax voice (David 2026-08-10: "i like his minimax voice better
// then grok i think its more fun").
//
// Deliberately NOT the xAI realtime lane (see useMrImagineLive.ts, which the
// ADMIN studio still uses). The difference that matters beyond the voice:
// realtime bills per wall-clock minute the socket is open and the browser
// talks to xAI directly, so an idle tab burns money nobody can cap. Here every
// turn is one ordinary request to our own server — idle costs nothing, the
// spend is per utterance, and it is rate-limited and attributable.
//
// One turn = record → POST /turn (dictation + brain + voice) → play the reply.
// Typing works too: the same endpoint takes `text` instead of audio, so a
// quiet room or a denied mic is never a dead end.

import { useCallback, useEffect, useRef, useState } from 'react'
import { API_BASE } from '../lib/api'
import { supabase } from '../lib/supabase'

export type VoiceStatus = 'idle' | 'recording' | 'thinking' | 'speaking'

export interface TurnAction {
  name: 'generate_designs' | 'select_designs' | 'submit_product' | string
  args: Record<string, unknown>
}

export interface TurnResult {
  userText: string
  reply: string
  audioUrl: string | null
  statePatch: Record<string, unknown>
  action: TurnAction | null
}

interface Options {
  /** Board state the model reasons over — keep it small and plain. */
  getState: () => Record<string, unknown>
  /** Money moves: the PAGE runs these against the ITC-metered endpoints. */
  onAction: (action: TurnAction) => Promise<void> | void
  /** Pure state updates (product type, brief, quoted pricing). */
  onStatePatch: (patch: Record<string, unknown>) => void
}

export interface ChatTurn { role: 'user' | 'assistant'; content: string }

export function useMrImagineVoice({ getState, onAction, onStatePatch }: Options) {
  const [status, setStatus] = useState<VoiceStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [muted, setMuted] = useState<boolean>(() => {
    try { return window.localStorage.getItem('itp-mr-imagine-muted') === '1' } catch { return false }
  })
  const [conversation, setConversation] = useState<ChatTurn[]>([])

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const convoRef = useRef<ChatTurn[]>([])
  convoRef.current = conversation
  // Latest callbacks, so a re-render mid-turn never runs a stale handler.
  const cbRef = useRef({ getState, onAction, onStatePatch })
  cbRef.current = { getState, onAction, onStatePatch }

  useEffect(() => {
    try { window.localStorage.setItem('itp-mr-imagine-muted', muted ? '1' : '0') } catch { /* private mode */ }
  }, [muted])

  const stopPlayback = useCallback(() => {
    const el = audioRef.current
    if (el) { el.pause(); el.src = '' }
  }, [])

  const speak = useCallback(async (url: string) => {
    if (muted) return
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
  }, [muted, stopPlayback])

  /** One turn. Pass audio OR text. */
  const sendTurn = useCallback(async (payload: { audio?: Blob; text?: string }) => {
    setError(null)
    setStatus('thinking')
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token

      const form = new FormData()
      if (payload.audio) form.append('audio', payload.audio, 'turn.webm')
      if (payload.text) form.append('text', payload.text)
      form.append('state', JSON.stringify(cbRef.current.getState()))
      form.append('history', JSON.stringify(convoRef.current.slice(-8)))

      const res = await fetch(`${API_BASE}/api/creator/studio/turn`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: form,
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.error || `Turn failed (${res.status})`)
      }
      const turn = await res.json() as TurnResult

      setConversation((prev) => [
        ...prev,
        { role: 'user' as const, content: turn.userText },
        { role: 'assistant' as const, content: turn.reply },
      ].slice(-20))

      if (turn.statePatch && Object.keys(turn.statePatch).length > 0) {
        cbRef.current.onStatePatch(turn.statePatch)
      }

      // Speak first, THEN spend: hearing "this costs 40 ITC, here we go"
      // before the charge fires is the whole point of the money rule.
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
        // Too short to be speech — don't spend a transcription on a stray tap.
        if (blob.size < 1200) { setStatus('idle'); return }
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

  useEffect(() => () => {
    if (recorderRef.current?.state !== 'inactive') {
      recorderRef.current?.stop()
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    const el = audioRef.current
    if (el) { el.pause(); el.src = '' }
  }, [])

  return {
    status, error, muted, setMuted, conversation,
    toggleRecording, sendText, stopPlayback,
    isBusy: status === 'thinking' || status === 'speaking',
  }
}
