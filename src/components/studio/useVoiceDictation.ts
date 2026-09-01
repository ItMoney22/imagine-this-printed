// Voice input for the Idea step — the free browser Web Speech API
// (SpeechRecognition), not a paid realtime model. Mr. Imagine's xAI realtime
// voice stays Live Studio's thing; this is a plain "speak the idea" mic.
//
// Not every browser ships this (notably Firefox desktop as of this writing),
// so `supported` is exposed for a graceful "voice not supported in this
// browser" fallback rather than a broken mic button.
import { useCallback, useEffect, useRef, useState } from 'react'

// Minimal shape of the (non-standardized) SpeechRecognition API — typed by
// hand rather than pulled from lib.dom, since browser coverage of these types
// varies by TS/lib version.
interface SpeechRecognitionResultLike {
  isFinal: boolean
  0: { transcript: string }
}
interface SpeechRecognitionEventLike {
  resultIndex: number
  results: ArrayLike<SpeechRecognitionResultLike>
}
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: unknown) => void) | null
  onend: (() => void) | null
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

/**
 * `onChange` is called with the FULL dictated text every time a result comes
 * in (finalized words locked in, plus the current interim tail appended) —
 * the caller just sets it straight onto the textarea, same as typing.
 */
export function useVoiceDictation(onChange: (fullText: string) => void) {
  const supported = useRef(getSpeechRecognitionCtor() !== null).current
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  // Text already finalized this session, so a fresh interim chunk appends
  // instead of replacing everything typed/spoken before it.
  const finalTextRef = useRef('')

  const start = useCallback((baseText: string) => {
    if (!supported || listening) return
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor) return

    finalTextRef.current = baseText
    const recognition = new Ctor()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onresult = (event) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const transcript = result[0]?.transcript ?? ''
        if (result.isFinal) {
          finalTextRef.current = [finalTextRef.current.trim(), transcript.trim()].filter(Boolean).join(' ')
        } else {
          interim += transcript
        }
      }
      const fullText = interim ? [finalTextRef.current.trim(), interim].filter(Boolean).join(' ') : finalTextRef.current
      onChangeRef.current(fullText)
    }
    recognition.onerror = () => setListening(false)
    recognition.onend = () => setListening(false)

    recognitionRef.current = recognition
    recognition.start()
    setListening(true)
  }, [supported, listening])

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
    setListening(false)
  }, [])

  // Stop the mic if the component unmounts mid-dictation.
  useEffect(() => () => { recognitionRef.current?.stop() }, [])

  return { supported, listening, start, stop }
}
