// useMrImagineLive — live voice conversation with Mr. Imagine, browser-direct
// to xAI Grok realtime. Ported from the Watchtower dashboard's proven
// use-agent-live lane (david-trinidad-com), adapted for the ITP admin builder:
//
//   - token minted by OUR backend (POST /api/ai/realtime/token, admin-gated),
//     so the xAI key never reaches the browser
//   - the PAGE owns the tools: definitions come in via options, execution goes
//     back out through onToolCall, because every tool mutates the build board
//   - sendBoardUpdate() lets the page push job progress INTO the conversation
//     ("designs are ready") so Mr. Imagine announces it instead of the admin
//     staring at a spinner
//
// xAI realtime quirks this handles (each one verified live in Watchtower):
//   - server_vad commits + transcribes the user's turn but does NOT auto-reply:
//     send response.create on input_audio_buffer.committed
//   - the same function call arrives as BOTH response.function_call_arguments.done
//     AND response.output_item.done — dedup by call_id or every tool fires twice
//   - queued audio keeps playing over the user: on speech_started, stop every
//     scheduled buffer AND send response.cancel

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '../lib/api'

const SAMPLE_RATE = 24000
const XAI_REALTIME_BASE = 'wss://api.x.ai/v1/realtime'

export type MrImagineStatus = 'idle' | 'connecting' | 'listening' | 'speaking' | 'error'

export interface MrImagineToolDef {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ToolActivity {
  id: number
  name: string
  label: string
  status: 'running' | 'done' | 'failed'
}

export interface UseMrImagineLiveOptions {
  tools: MrImagineToolDef[]
  /** Execute a tool call from Mr. Imagine; the resolved value is sent back to
   *  the model as the tool output. Throw to report failure. */
  onToolCall: (name: string, args: Record<string, unknown>) => Promise<unknown>
}

interface RealtimeTokenResponse {
  token: string
  model: string
  voice: string
  instructions: string
}

export function useMrImagineLive({ tools, onToolCall }: UseMrImagineLiveOptions) {
  const [status, setStatus] = useState<MrImagineStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [agentTranscript, setAgentTranscript] = useState('')
  const [userTranscript, setUserTranscript] = useState('')
  const [toolActivity, setToolActivity] = useState<ToolActivity[]>([])
  const activityIdRef = useRef(0)

  // Keep the latest tool defs/handler in refs so a re-render mid-call never
  // rewires the socket or runs a stale handler.
  const toolsRef = useRef(tools)
  toolsRef.current = tools
  const onToolCallRef = useRef(onToolCall)
  onToolCallRef.current = onToolCall

  const wsRef = useRef<WebSocket | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const inputCtxRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const workletNodeRef = useRef<AudioWorkletNode | null>(null)
  const playbackSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const pendingSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set())

  const pcm16ToFloat32 = useCallback((base64: string): Float32Array => {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const int16 = new Int16Array(bytes.buffer)
    const float32 = new Float32Array(int16.length)
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 0x8000
    return float32
  }, [])

  const float32ToPcm16Base64 = useCallback((float32: Float32Array): string => {
    const int16 = new Int16Array(float32.length)
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]))
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
    }
    const bytes = new Uint8Array(int16.buffer)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    return btoa(binary)
  }, [])

  const playChunk = useCallback((float32: Float32Array) => {
    if (!audioCtxRef.current) return
    const ctx = audioCtxRef.current
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
    const buf = ctx.createBuffer(1, float32.length, SAMPLE_RATE)
    buf.getChannelData(0).set(float32)
    const now = ctx.currentTime
    const source = ctx.createBufferSource()
    source.buffer = buf
    source.connect(ctx.destination)
    const startAt = playbackSourceRef.current
      ? Math.max(now, (playbackSourceRef.current as unknown as { _endAt?: number })._endAt || now)
      : now
    source.start(startAt)
    ;(source as unknown as { _endAt?: number })._endAt = startAt + buf.duration
    playbackSourceRef.current = source
    pendingSourcesRef.current.add(source)
    source.onended = () => { pendingSourcesRef.current.delete(source) }
  }, [])

  const interruptPlayback = useCallback(() => {
    for (const s of pendingSourcesRef.current) {
      try { s.stop() } catch { /* already ended */ }
      try { s.disconnect() } catch { /* noop */ }
    }
    pendingSourcesRef.current.clear()
    playbackSourceRef.current = null
  }, [])

  const teardown = useCallback(() => {
    try { workletNodeRef.current?.disconnect() } catch { /* noop */ }
    try { streamRef.current?.getTracks().forEach((t) => t.stop()) } catch { /* noop */ }
    try { wsRef.current?.close() } catch { /* noop */ }
    try { inputCtxRef.current?.close() } catch { /* noop */ }
    try { audioCtxRef.current?.close() } catch { /* noop */ }
    workletNodeRef.current = null
    streamRef.current = null
    wsRef.current = null
    inputCtxRef.current = null
    audioCtxRef.current = null
    playbackSourceRef.current = null
    pendingSourcesRef.current.clear()
  }, [])

  const stop = useCallback(() => {
    teardown()
    setStatus('idle')
    setAgentTranscript('')
    setUserTranscript('')
  }, [teardown])

  /** Push a build-board event into the conversation and have Mr. Imagine react
   *  out loud. Used for job completions/failures the admin shouldn't have to
   *  narrate themselves. */
  const sendBoardUpdate = useCallback((text: string) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    try {
      ws.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: `[BUILD BOARD] ${text}` }],
        },
      }))
      ws.send(JSON.stringify({ type: 'response.create' }))
    } catch { /* ws closing */ }
  }, [])

  const start = useCallback(async () => {
    setError(null)
    setStatus('connecting')
    setAgentTranscript('')
    setUserTranscript('')
    setToolActivity([])

    try {
      // Create + resume the playback AudioContext synchronously, before any
      // await — start() runs straight from the talk-button tap, and iOS Safari
      // only lets a gesture-bound context leave "suspended". Created later, the
      // whole call works but Mr. Imagine is inaudible.
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!AC) throw new Error("This browser doesn't support AudioContext.")
      audioCtxRef.current = new AC({ sampleRate: SAMPLE_RATE })
      if (audioCtxRef.current.state === 'suspended') {
        await audioCtxRef.current.resume().catch(() => {})
      }

      const tok = await apiFetch('/api/ai/realtime/token', { method: 'POST', body: '{}' }) as RealtimeTokenResponse
      if (!tok?.token) throw new Error('Could not start the live line.')

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, sampleRate: SAMPLE_RATE, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      streamRef.current = stream

      const inputCtx = new AC({ sampleRate: SAMPLE_RATE })
      inputCtxRef.current = inputCtx
      await inputCtx.audioWorklet.addModule('/audio-worklets/pcm-capture.js')
      const micSource = inputCtx.createMediaStreamSource(stream)
      const node = new AudioWorkletNode(inputCtx, 'pcm-capture')
      workletNodeRef.current = node
      micSource.connect(node)

      const url = `${XAI_REALTIME_BASE}?model=${encodeURIComponent(tok.model || 'grok-voice-latest')}`
      const ws = new WebSocket(url, ['realtime', `xai-client-secret.${tok.token}`])
      wsRef.current = ws

      let micWired = false
      const wireMic = () => {
        if (micWired || ws.readyState !== WebSocket.OPEN) return
        micWired = true
        setStatus('listening')
        node.port.onmessage = (e: MessageEvent<Float32Array>) => {
          if (ws.readyState !== WebSocket.OPEN) return
          ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: float32ToPcm16Base64(e.data) }))
        }
      }

      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: 'session.update',
          session: {
            voice: tok.voice,
            instructions: tok.instructions,
            turn_detection: { type: 'server_vad', threshold: 0.3, silence_duration_ms: 200, prefix_padding_ms: 200 },
            audio: {
              input: { format: { type: 'audio/pcm', rate: SAMPLE_RATE } },
              output: { format: { type: 'audio/pcm', rate: SAMPLE_RATE } },
            },
            tools: toolsRef.current,
          },
        }))
      }

      ws.onerror = () => {
        setError('Voice connection error. Try again.')
        setStatus('error')
      }
      ws.onclose = () => { setStatus((s) => (s === 'error' ? s : 'idle')) }

      const sendToolOutput = (callId: string, output: unknown) => {
        try {
          ws.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(output) } }))
          ws.send(JSON.stringify({ type: 'response.create' }))
        } catch { /* ws closing */ }
      }

      const handledCalls = new Set<string>()
      const handleToolCall = async (raw: Record<string, unknown>) => {
        let name: string | undefined, callId: string | undefined, argsStr: string | undefined
        if (raw.type === 'response.function_call_arguments.done') {
          name = raw.name as string; callId = raw.call_id as string; argsStr = raw.arguments as string
        } else {
          const item = raw.item as Record<string, unknown> | undefined
          if (!item || item.type !== 'function_call') return
          name = item.name as string; callId = (item.call_id || item.id) as string; argsStr = item.arguments as string
        }
        if (!name || !callId) return
        if (handledCalls.has(callId)) return
        handledCalls.add(callId)

        let args: Record<string, unknown> = {}
        try { args = JSON.parse(argsStr || '{}') } catch { /* no args */ }

        const activityId = ++activityIdRef.current
        const label = String(args.title || args.prompt || args.type || args.size_tier || '')
        setToolActivity((prev) => [...prev.slice(-9), { id: activityId, name: name!, label, status: 'running' }])
        try {
          const output = await onToolCallRef.current(name, args)
          setToolActivity((prev) => prev.map((a) => (a.id === activityId ? { ...a, status: 'done' } : a)))
          sendToolOutput(callId, output ?? { ok: true })
        } catch (err) {
          setToolActivity((prev) => prev.map((a) => (a.id === activityId ? { ...a, status: 'failed' } : a)))
          sendToolOutput(callId, { error: err instanceof Error ? err.message : 'tool failed' })
        }
      }

      ws.onmessage = (evt) => {
        let msg: { type?: string; delta?: string; transcript?: string; error?: unknown; item?: { content?: Array<{ transcript?: string }> } }
        try { msg = JSON.parse(evt.data) } catch { return }

        if (msg.type === 'response.function_call_arguments.done' || msg.type === 'response.output_item.done') {
          void handleToolCall(msg as unknown as Record<string, unknown>)
          return
        }

        switch (msg.type) {
          case 'session.created':
          case 'session.updated':
            wireMic()
            // Greet first so the studio comes alive the moment the line opens.
            try { ws.send(JSON.stringify({ type: 'response.create' })) } catch { /* noop */ }
            break
          case 'response.output_audio.delta':
          case 'response.audio.delta':
            if (msg.delta) {
              setStatus('speaking')
              playChunk(pcm16ToFloat32(msg.delta))
            }
            break
          case 'response.output_audio_transcript.delta':
          case 'response.audio_transcript.delta':
          case 'response.text.delta':
            if (msg.delta) setAgentTranscript((prev) => prev + msg.delta)
            break
          case 'conversation.item.input_audio_transcription.completed': {
            const t = msg.transcript || msg.item?.content?.[0]?.transcript
            if (t) setUserTranscript(t)
            break
          }
          case 'input_audio_buffer.committed':
            // xAI commits + transcribes the turn but does NOT auto-reply —
            // without this Mr. Imagine greets once and then goes silent.
            try { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'response.create' })) } catch { /* noop */ }
            break
          case 'input_audio_buffer.speech_started':
            setStatus((prev) => {
              if (prev === 'speaking') {
                interruptPlayback()
                try { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'response.cancel' })) } catch { /* noop */ }
                return 'listening'
              }
              return prev
            })
            setAgentTranscript('')
            break
          case 'response.done':
            setStatus('listening')
            break
          case 'error': {
            const em = typeof msg.error === 'string' ? msg.error : (msg.error as { message?: string })?.message
            setError(em || 'Voice error.')
            setStatus('error')
            break
          }
          default:
            break
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the live conversation.')
      teardown()
      setStatus('error')
    }
  }, [float32ToPcm16Base64, pcm16ToFloat32, playChunk, interruptPlayback, teardown])

  useEffect(() => () => { teardown() }, [teardown])

  return { status, error, agentTranscript, userTranscript, toolActivity, start, stop, sendBoardUpdate }
}
