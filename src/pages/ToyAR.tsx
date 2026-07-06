// src/pages/ToyAR.tsx
// Public AR "comes to life" page for NFC-enabled toy figurines.
// Route: /ar/:modelId (no auth required)
// model-viewer is injected imperatively (same pattern as Model3DViewer.tsx)
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ArData {
  ok: boolean
  name: string
  glb_url: string
  concept_image_url: string | null
  video_url: string | null
}

// ---------------------------------------------------------------------------
// model-viewer script injector — once per page load
// ---------------------------------------------------------------------------

const MV_CDN = 'https://ajax.googleapis.com/ajax/libs/model-viewer/3.5.0/model-viewer.min.js'

function ensureModelViewerScript() {
  if (document.querySelector(`script[src="${MV_CDN}"]`)) return
  const script = document.createElement('script')
  script.type = 'module'
  script.src = MV_CDN
  script.async = true
  document.head.appendChild(script)
}

// ---------------------------------------------------------------------------
// Loading state
// ---------------------------------------------------------------------------

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-purple-50 flex flex-col items-center justify-center gap-6 px-4">
      <div
        className="w-24 h-24 flex items-center justify-center"
        style={{ animation: 'ar-pulse 1.8s ease-in-out infinite' }}
      >
        <img
          src="/mr-imagine/mr-imagine-waving.png"
          alt="Imagine This Printed"
          className="w-full h-full object-contain"
        />
      </div>
      <p className="text-purple-600 font-bold text-lg animate-pulse">Loading your creature...</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 404 state
// ---------------------------------------------------------------------------

function NotFoundScreen() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-purple-50 flex flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="w-20 h-20 rounded-full bg-purple-100 flex items-center justify-center">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-10 h-10 text-purple-400">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
      </div>
      <h1 className="text-2xl font-black text-gray-900">This creature hasn't hatched yet</h1>
      <p className="text-gray-500 max-w-xs leading-relaxed">
        The AR experience for this toy hasn't been set up yet. Check back after the figurine ships!
      </p>
      <Link
        to="/toy-creator"
        className="mt-2 inline-flex items-center gap-2 px-6 py-3 rounded-full font-bold text-white bg-gradient-to-r from-purple-600 to-fuchsia-600 shadow-lg hover:scale-105 transition-transform"
      >
        Make your own creature
      </Link>
    </div>
  )
}

// ---------------------------------------------------------------------------
// model-viewer host component (imperative DOM, same as Model3DViewer.tsx)
// ---------------------------------------------------------------------------

interface ModelViewerHostProps {
  data: ArData
}

function ModelViewerHost({ data }: ModelViewerHostProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ensureModelViewerScript()
    const container = containerRef.current
    if (!container) return

    // Remove any prior instance
    const prior = container.querySelector('model-viewer')
    if (prior) prior.remove()

    const mv = document.createElement('model-viewer')
    mv.setAttribute('src', data.glb_url)
    mv.setAttribute('alt', `3D model of ${data.name}`)
    mv.setAttribute('auto-rotate', '')
    mv.setAttribute('camera-controls', '')
    mv.setAttribute('ar', '')
    mv.setAttribute('ar-modes', 'webxr scene-viewer quick-look')
    mv.setAttribute('shadow-intensity', '1')
    if (data.concept_image_url) mv.setAttribute('poster', data.concept_image_url)

    mv.style.cssText = [
      'width:100%',
      'aspect-ratio:1/1',
      'border-radius:1.5rem',
      'border:2px solid #e9d5ff',
      'box-shadow:0 4px 30px rgba(147,51,234,0.15)',
      'background:linear-gradient(135deg,#faf5ff,#f3e8ff)',
    ].join(';')

    // AR button slot
    const arBtn = document.createElement('button')
    arBtn.setAttribute('slot', 'ar-button')
    arBtn.textContent = 'See it in your room'
    arBtn.style.cssText = [
      'position:absolute',
      'bottom:1rem',
      'left:50%',
      'transform:translateX(-50%)',
      'background:linear-gradient(135deg,#9333ea,#c026d3)',
      'color:white',
      'border:none',
      'border-radius:9999px',
      'padding:0.625rem 1.5rem',
      'font-weight:900',
      'font-size:0.875rem',
      'cursor:pointer',
      'box-shadow:0 4px 16px rgba(147,51,234,0.5)',
      'letter-spacing:0.05em',
      'text-transform:uppercase',
    ].join(';')
    mv.appendChild(arBtn)

    container.appendChild(mv)
    return () => { mv.remove() }
  }, [data])

  return <div ref={containerRef} className="w-full" aria-label={`3D model of ${data.name}`} />
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ToyAR() {
  const { modelId } = useParams<{ modelId: string }>()
  const [status, setStatus] = useState<'loading' | '404' | 'ready'>('loading')
  const [data, setData] = useState<ArData | null>(null)
  const [videoOpen, setVideoOpen] = useState(false)

  useEffect(() => {
    if (!modelId) { setStatus('404'); return }

    const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''
    void fetch(`${base}/api/3d-models/public/${modelId}/ar`)
      .then(async res => {
        if (res.status === 404) { setStatus('404'); return }
        if (!res.ok) { setStatus('404'); return }
        const json = await res.json() as ArData
        if (!json.ok) { setStatus('404'); return }
        // glb_url can be null if AR/NFC was enabled before the 3D mesh finished —
        // show the friendly 404 instead of pointing the viewer at an empty src.
        if (!json.glb_url) { setStatus('404'); return }
        setData(json)
        setStatus('ready')
      })
      .catch(() => setStatus('404'))
  }, [modelId])

  if (status === 'loading') return <LoadingScreen />
  if (status === '404' || !data) return <NotFoundScreen />

  return (
    <>
      <style>{`
        @keyframes ar-pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50%       { transform: scale(1.1); opacity: 0.8; }
        }
        @keyframes ar-float {
          0%, 100% { transform: translateY(0); }
          50%       { transform: translateY(-8px); }
        }
        .ar-hint-bounce {
          animation: ar-float 2.4s ease-in-out infinite;
        }
      `}</style>

      <div className="min-h-screen bg-gradient-to-b from-white via-purple-50 to-white flex flex-col">

        {/* Header */}
        <header className="px-5 pt-8 pb-4 text-center space-y-1">
          <p className="text-xs text-purple-400 font-bold uppercase tracking-widest">Imagine This Printed</p>
          <h1 className="text-3xl sm:text-4xl font-black text-gray-900 leading-tight">{data.name}</h1>
        </header>

        {/* Video section — shown above viewer when available and opened */}
        {data.video_url && (
          <div className="px-4 max-w-lg mx-auto w-full mb-2">
            {videoOpen ? (
              <div className="rounded-2xl overflow-hidden border-2 border-purple-200 shadow-lg bg-black">
                <video
                  src={data.video_url}
                  controls
                  playsInline
                  autoPlay
                  className="w-full"
                  aria-label="Creature come-alive video"
                />
              </div>
            ) : (
              <button
                onClick={() => setVideoOpen(true)}
                className="w-full flex items-center justify-center gap-3 py-3 rounded-2xl border-2 border-purple-300 bg-white text-purple-700 font-black text-base hover:bg-purple-50 hover:border-purple-400 transition-colors shadow-sm"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 shrink-0">
                  <path d="M8 5.14v14l11-7-11-7z" />
                </svg>
                Watch it come alive
              </button>
            )}
          </div>
        )}

        {/* model-viewer */}
        <div className="flex-1 flex flex-col items-center px-4 pb-4">
          <div className="w-full max-w-lg mx-auto">
            {/* AR hint */}
            <div className="flex justify-center mb-3">
              <span className="ar-hint-bounce inline-flex items-center gap-2 text-xs font-bold text-purple-600 bg-purple-50 border border-purple-200 px-4 py-2 rounded-full shadow-sm">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 shrink-0">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 7.125C2.25 6.504 2.754 6 3.375 6h6c.621 0 1.125.504 1.125 1.125v3.75c0 .621-.504 1.125-1.125 1.125h-6a1.125 1.125 0 01-1.125-1.125v-3.75zM14.25 8.625c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v8.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-8.25zM3.75 16.125c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v2.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-2.25z" />
                </svg>
                Tap the AR button to see it in your room
              </span>
            </div>

            <ModelViewerHost data={data} />
          </div>
        </div>

        {/* Footer */}
        <footer className="text-center px-4 pb-8 space-y-3">
          <p className="text-gray-400 text-sm">
            Made at{' '}
            <Link to="/" className="text-purple-600 hover:text-purple-500 font-semibold transition-colors">
              Imagine This Printed
            </Link>
          </p>
          <Link
            to="/toy-creator"
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full border-2 border-purple-200 text-purple-700 font-bold text-sm hover:bg-purple-50 hover:border-purple-300 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 shrink-0">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Make your own creature
          </Link>
        </footer>
      </div>
    </>
  )
}
