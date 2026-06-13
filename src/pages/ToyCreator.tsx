// src/pages/ToyCreator.tsx
// Kid-facing "DNA Mixing Lab" toy creator — 6-stage machine.
// Mr. Imagine hosts every stage; build stage has voice path + image-card path.
import confetti from 'canvas-confetti'
import {
  CheckCircle,
  Mic,
  MicOff,
  RefreshCw,
  RotateCcw,
  ShoppingCart,
  Volume2,
  VolumeX,
  Wand2,
  Zap,
  Minus,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { usdToItcLabel } from '../lib/itc-pricing'
import { Link, useNavigate } from 'react-router-dom'
import { Model3DViewer } from '../components/3d-models/Model3DViewer'
import { useCart } from '../context/CartContext'
import { useToast } from '../hooks/useToast'
import { apiFetch, API_BASE } from '../lib/api'
import { supabase } from '../lib/supabase'
import type { PrintSizeTier, SizeTierConfig, User3DModel } from '../types'

// ---------------------------------------------------------------------------
// Constants & types
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'itp-toy-creator-active'
const VOICE_MUTE_KEY = 'itp-toy-voice'

type Stage = 'build' | 'splicing' | 'reveal' | 'pick-size' | 'incubation' | 'alive'
type ColorMode = 'grey' | 'color4'

interface ToyParts {
  head: string      // mind slug
  body: string      // body slug
  strength: string  // strength slug
  extras: string[]  // powerup slugs
  freeText: string  // spoken or typed description
}

// Item card data ---------------------------------------------------------------

interface ItemCard {
  slug: string
  label: string
  phrase: string
}

const MIND_CARDS: ItemCard[] = [
  { slug: 'raptor',   label: 'Raptor',   phrase: 'the clever mind of a Raptor' },
  { slug: 'owl',      label: 'Owl',      phrase: 'the clever mind of an Owl' },
  { slug: 'fox',      label: 'Fox',      phrase: 'the clever mind of a Fox' },
  { slug: 'dolphin',  label: 'Dolphin',  phrase: 'the clever mind of a Dolphin' },
  { slug: 'octopus',  label: 'Octopus',  phrase: 'the clever mind of an Octopus' },
  { slug: 'robot',    label: 'Robot',    phrase: 'the clever mind of a Robot' },
  { slug: 'wizard',   label: 'Wizard',   phrase: 'the clever mind of a Wizard' },
  { slug: 'cat',      label: 'Cat',      phrase: 'the clever mind of a Cat' },
]

const STRENGTH_CARDS: ItemCard[] = [
  { slug: 'gorilla',   label: 'Gorilla',   phrase: 'the mighty strength of a Gorilla' },
  { slug: 't-rex',     label: 'T-Rex',     phrase: 'the mighty strength of a T-Rex' },
  { slug: 'bear',      label: 'Bear',      phrase: 'the mighty strength of a Bear' },
  { slug: 'rhino',     label: 'Rhino',     phrase: 'the mighty strength of a Rhino' },
  { slug: 'elephant',  label: 'Elephant',  phrase: 'the mighty strength of an Elephant' },
  { slug: 'bull',      label: 'Bull',      phrase: 'the mighty strength of a Bull' },
  { slug: 'tiger',     label: 'Tiger',     phrase: 'the mighty strength of a Tiger' },
  { slug: 'crocodile', label: 'Crocodile', phrase: 'the mighty strength of a Crocodile' },
]

const BODY_CARDS: ItemCard[] = [
  { slug: 'shark',     label: 'Shark',     phrase: 'the body of a Shark' },
  { slug: 'lion',      label: 'Lion',      phrase: 'the body of a Lion' },
  { slug: 'dragon',    label: 'Dragon',    phrase: 'the body of a Dragon' },
  { slug: 'unicorn',   label: 'Unicorn',   phrase: 'the body of a Unicorn' },
  { slug: 'wolf',      label: 'Wolf',      phrase: 'the body of a Wolf' },
  { slug: 'eagle',     label: 'Eagle',     phrase: 'the body of an Eagle' },
  { slug: 'panda',     label: 'Panda',     phrase: 'the body of a Panda' },
  { slug: 'cheetah',   label: 'Cheetah',   phrase: 'the body of a Cheetah' },
  { slug: 'axolotl',   label: 'Axolotl',   phrase: 'the body of an Axolotl' },
  { slug: 'dinosaur',  label: 'Dinosaur',  phrase: 'the body of a Dinosaur' },
  { slug: 'robot',     label: 'Robot',     phrase: 'the body of a Robot' },
  { slug: 'frog',      label: 'Frog',      phrase: 'the body of a Frog' },
]

const POWERUP_CARDS: ItemCard[] = [
  { slug: 'mighty-wings',  label: 'Mighty Wings',  phrase: 'equipped with mighty wings' },
  { slug: 'hero-armor',    label: 'Hero Armor',    phrase: 'equipped with hero armor' },
  { slug: 'laser-eyes',    label: 'Laser Eyes',    phrase: 'equipped with laser eyes' },
  { slug: 'rocket-boots',  label: 'Rocket Boots',  phrase: 'equipped with rocket boots' },
  { slug: 'royal-crown',   label: 'Royal Crown',   phrase: 'equipped with a royal crown' },
  { slug: 'super-cape',    label: 'Super Cape',    phrase: 'equipped with a super cape' },
  { slug: 'ice-powers',    label: 'Ice Powers',    phrase: 'equipped with ice powers' },
  { slug: 'fire-breath',   label: 'Fire Breath',   phrase: 'equipped with fire breath' },
]

// Voice bubble text per key ---------------------------------------------------
const VOICE_LINES: Record<string, string> = {
  intro:       "Hi there! I'm Mr. Imagine! What awesome creature are we making today? Tap the microphone and TELL me — or build it piece by piece!",
  listening:   "Ooooh, I'm listening!",
  'got-it':    "That sounds AMAZING! Let's mix that DNA!",
  splicing:    "Mixing your creature's DNA right now... this is going to be EPIC!",
  reveal:      "TA-DAAA! Look what we made together! Do you LOVE it?",
  'pick-size': "How big should your creature be? Pick a size!",
  incubation:  "Your creature is growing in my lab right now! Almost there...",
  alive:       "Ta-daa! Your creature is fully alive! We print it in matte grey... so YOU get to paint it any way you want!",
  'alive-color': "Ta-daa! Your creature is fully alive! And it comes printed in FULL color... ready right out of the box!",
  error:       "Uh oh! The DNA got a little tangled! Don't worry — let's try again!",
}

// Map stage → voice key
const STAGE_VOICE: Record<Stage, string> = {
  build:       'intro',
  splicing:    'splicing',
  reveal:      'reveal',
  'pick-size': 'pick-size',
  incubation:  'incubation',
  alive:       'alive',
}

// Size config -----------------------------------------------------------------
const TIER_SECONDS: Record<PrintSizeTier, number> = {
  mini: 60, small: 90, medium: 120, large: 180,
}

const SIZE_REFS: Record<PrintSizeTier, string> = {
  mini:   'Pocket buddy',
  small:  'Hand-sized hero',
  medium: 'Desk guardian',
  large:  'Shelf TITAN',
}

// ---------------------------------------------------------------------------
// Asymptotic progress hook
// ---------------------------------------------------------------------------
function useAsymptoticProgress(active: boolean, expectedSeconds: number) {
  const [progress, setProgress] = useState(0)
  const startRef = useRef<number | null>(null)

  useEffect(() => {
    if (!active) { setProgress(0); startRef.current = null; return }
    startRef.current = Date.now()
    const id = setInterval(() => {
      const elapsed = (Date.now() - (startRef.current ?? Date.now())) / 1000
      const k = 1 / expectedSeconds
      setProgress(Math.min(90, 90 * (1 - Math.exp(-k * elapsed))))
    }, 400)
    return () => clearInterval(id)
  }, [active, expectedSeconds])

  return progress
}

// ---------------------------------------------------------------------------
// Mr. Imagine Host — persistent mascot + typewriter bubble
// ---------------------------------------------------------------------------
interface MrImagineHostProps {
  voiceKey: string
  large?: boolean
  muted: boolean
  onToggleMute: () => void
  pendingPlayRef: React.MutableRefObject<string | null>
  audioRef: React.MutableRefObject<HTMLAudioElement | null>
  hasPlayed: boolean
  setHasPlayed: (v: boolean) => void
}

function MrImagineHost({
  voiceKey, large, muted, onToggleMute,
  pendingPlayRef, audioRef, hasPlayed, setHasPlayed,
}: MrImagineHostProps) {
  const text = VOICE_LINES[voiceKey] ?? ''
  const [displayed, setDisplayed] = useState('')
  const [showHint, setShowHint] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const charRef = useRef(0)

  // When a new line comes in, pop the host back open so the user sees it
  useEffect(() => {
    if (!large) setMinimized(false)
  }, [voiceKey, large])

  // Typewriter effect
  useEffect(() => {
    charRef.current = 0
    setDisplayed('')
    if (!text) return
    const id = setInterval(() => {
      charRef.current += 1
      setDisplayed(text.slice(0, charRef.current))
      if (charRef.current >= text.length) clearInterval(id)
    }, 30)
    return () => clearInterval(id)
  }, [text])

  // Play voice clip
  useEffect(() => {
    const src = `/toy-creator/voice/${voiceKey}.mp3`
    if (muted) return

    const doPlay = () => {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0 }
      const a = new Audio(src)
      audioRef.current = a
      a.play().then(() => {
        setHasPlayed(true)
        setShowHint(false)
        pendingPlayRef.current = null
      }).catch(() => {
        pendingPlayRef.current = src
        setShowHint(true)
      })
    }
    doPlay()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceKey, muted])

  if (large) {
    return (
      <div className="flex flex-col items-center gap-4">
        <img
          src="/mr-imagine/mr-imagine-waving.png"
          alt="Mr. Imagine"
          className="w-36 h-36 sm:w-48 sm:h-48 object-contain drop-shadow-2xl"
          style={{ filter: 'drop-shadow(0 0 24px rgba(217,70,239,0.6))' }}
        />
        {/* Speech bubble */}
        <div className="relative max-w-sm w-full bg-white rounded-3xl px-5 py-4 shadow-xl" style={{ boxShadow: '0 0 24px rgba(217,70,239,0.35)' }}>
          <div
            className="absolute -top-3 left-1/2 -translate-x-1/2 w-0 h-0"
            style={{ borderLeft: '10px solid transparent', borderRight: '10px solid transparent', borderBottom: '12px solid white' }}
          />
          <p className="text-gray-800 text-sm sm:text-base font-bold leading-snug min-h-[3rem]">{displayed}<span className="animate-pulse">|</span></p>
        </div>
        {/* Mute + hint */}
        <div className="flex flex-col items-center gap-1">
          <button
            onClick={onToggleMute}
            className="flex items-center gap-2 text-gray-500 hover:text-gray-700 text-xs font-semibold transition-colors px-3 py-1.5 rounded-full border border-gray-300 hover:border-gray-400"
            aria-label={muted ? 'Unmute Mr. Imagine' : 'Mute Mr. Imagine'}
          >
            {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            {muted ? 'Voice off' : 'Voice on'}
          </button>
          {showHint && !hasPlayed && (
            <p className="text-gray-400 text-xs animate-pulse">Tap anywhere to hear Mr. Imagine</p>
          )}
        </div>
      </div>
    )
  }

  // Minimized: a small notification chip pinned top-center (clear of the
  // sidebar and the bottom help button). Tap to pop Mr. Imagine back open.
  if (minimized) {
    return (
      <button
        onClick={() => setMinimized(false)}
        className="fixed top-3 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-2 bg-white rounded-full pl-1.5 pr-3 py-1.5 shadow-lg border border-purple-200 hover:border-purple-400 transition-colors animate-bounce"
        style={{ animationDuration: '2.5s', boxShadow: '0 0 14px rgba(217,70,239,0.3)' }}
        aria-label="Show Mr. Imagine"
      >
        <img src="/mr-imagine/mr-imagine-waving.png" alt="Mr. Imagine" className="w-7 h-7 object-contain" />
        <span className="text-xs font-bold text-purple-700">Mr. Imagine</span>
        <span className="w-2 h-2 rounded-full bg-fuchsia-500" />
      </button>
    )
  }

  // Docked lightbox — pinned to the RIGHT edge, vertically centered, so it
  // never sits over the bottom help button. Minimize collapses it to the top
  // notification chip above.
  return (
    <div className="fixed top-1/2 -translate-y-1/2 right-3 z-[70] flex flex-col items-center gap-2 w-[200px]">
      <div className="relative bg-white rounded-2xl px-4 py-3 shadow-xl w-full" style={{ boxShadow: '0 0 16px rgba(217,70,239,0.3)' }}>
        <button
          onClick={() => setMinimized(true)}
          className="absolute -top-2 -right-2 w-6 h-6 flex items-center justify-center bg-white border border-purple-200 rounded-full text-gray-400 hover:text-gray-700 hover:border-purple-400 shadow-sm transition-colors"
          aria-label="Minimize Mr. Imagine"
        >
          <Minus size={13} />
        </button>
        <img
          src="/mr-imagine/mr-imagine-waving.png"
          alt="Mr. Imagine"
          className="w-14 h-14 object-contain mx-auto mb-1.5 drop-shadow-lg"
          style={{ filter: 'drop-shadow(0 0 10px rgba(217,70,239,0.5))' }}
        />
        <p className="text-gray-800 text-xs font-bold leading-snug text-center">{displayed}<span className="animate-pulse text-fuchsia-500">|</span></p>
        <button
          onClick={onToggleMute}
          className="mt-1.5 mx-auto flex items-center gap-1 text-gray-400 hover:text-gray-600 text-[10px] transition-colors"
          aria-label={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? <VolumeX size={10} /> : <Volume2 size={10} />}
          {muted ? 'Voice off' : 'Voice on'}
        </button>
        {showHint && !hasPlayed && (
          <p className="text-gray-400 text-[10px] mt-0.5 animate-pulse text-center">Tap to hear me!</p>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Item card component
// ---------------------------------------------------------------------------
interface ItemCardProps {
  category: string
  card: ItemCard
  selected: boolean
  accentColor: 'fuchsia' | 'cyan' | 'emerald' | 'yellow'
  onToggle: () => void
}

const ACCENT_RING: Record<string, string> = {
  fuchsia: 'border-purple-600 bg-purple-50 shadow-[0_0_14px_rgba(147,51,234,0.35)]',
  cyan:    'border-purple-500 bg-purple-50 shadow-[0_0_14px_rgba(147,51,234,0.30)]',
  emerald: 'border-purple-500 bg-purple-50 shadow-[0_0_14px_rgba(147,51,234,0.30)]',
  yellow:  'border-purple-500 bg-purple-50 shadow-[0_0_14px_rgba(147,51,234,0.30)]',
}
const ACCENT_RING_HOVER: Record<string, string> = {
  fuchsia: 'hover:border-purple-400',
  cyan:    'hover:border-purple-400',
  emerald: 'hover:border-purple-400',
  yellow:  'hover:border-purple-400',
}

function ItemCardButton({ category, card, selected, accentColor, onToggle }: ItemCardProps) {
  const ringClass = selected
    ? `${ACCENT_RING[accentColor]} scale-105`
    : `border-purple-200 bg-white shadow-sm ${ACCENT_RING_HOVER[accentColor]}`

  return (
    <button
      onClick={onToggle}
      className={`relative flex flex-col rounded-2xl border-2 cursor-pointer transition-all duration-200 overflow-hidden select-none ${ringClass}`}
      aria-pressed={selected}
      style={{ aspectRatio: '1 / 1.25' }}
    >
      <div className="flex-1 w-full overflow-hidden rounded-t-xl">
        <img
          src={`/toy-creator/items/${category}-${card.slug}.webp`}
          alt={card.label}
          loading="lazy"
          className="w-full h-full object-cover"
        />
      </div>
      <div className="w-full bg-white/95 px-1.5 py-1 text-center border-t border-purple-100">
        <span className="text-[10px] sm:text-xs font-black text-gray-800 uppercase tracking-wide leading-none block truncate">
          {card.label}
        </span>
      </div>
      {selected && (
        <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-purple-600 flex items-center justify-center">
          <CheckCircle size={12} className="text-white" />
        </div>
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------
// DNA Helix animation — orbits images instead of emoji
// ---------------------------------------------------------------------------
function DnaHelix({ mindImg, bodyImg }: { mindImg: string; bodyImg: string }) {
  const dots = Array.from({ length: 16 }, (_, i) => i)
  return (
    <div className="relative w-40 h-64 mx-auto select-none" aria-hidden="true">
      {dots.map((i) => {
        const angle = (i / dots.length) * Math.PI * 2
        const x = 50 + 28 * Math.sin(angle)
        const y = (i / dots.length) * 100
        return (
          <span
            key={`a${i}`}
            className="absolute w-3 h-3 rounded-full bg-purple-500 opacity-80 shadow-[0_0_8px_rgba(147,51,234,0.7)]"
            style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%,-50%)', animation: `dna-pulse 2s ease-in-out ${i * 0.12}s infinite alternate` }}
          />
        )
      })}
      {dots.map((i) => {
        const angle = (i / dots.length) * Math.PI * 2 + Math.PI
        const x = 50 + 28 * Math.sin(angle)
        const y = (i / dots.length) * 100
        return (
          <span
            key={`b${i}`}
            className="absolute w-3 h-3 rounded-full bg-fuchsia-500 opacity-80 shadow-[0_0_8px_rgba(217,70,239,0.7)]"
            style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%,-50%)', animation: `dna-pulse 2s ease-in-out ${i * 0.12 + 0.06}s infinite alternate` }}
          />
        )
      })}
      {dots.map((i) => {
        const y = (i / dots.length) * 100
        return (
          <span key={`r${i}`} className="absolute h-px bg-purple-200" style={{ left: '20%', right: '20%', top: `${y}%` }} />
        )
      })}
      {/* Orbiting images */}
      <img
        src={mindImg}
        alt="Mind"
        className="absolute w-10 h-10 rounded-full object-cover border-2 border-purple-500"
        style={{ top: '20%', left: '50%', transform: 'translate(-50%,-50%)', animation: 'orbit-head 3s linear infinite' }}
      />
      <img
        src={bodyImg}
        alt="Body"
        className="absolute w-10 h-10 rounded-full object-cover border-2 border-fuchsia-500"
        style={{ top: '80%', left: '50%', transform: 'translate(-50%,-50%)', animation: 'orbit-body 3s linear infinite reverse' }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Growth tank animation for incubation
// ---------------------------------------------------------------------------
function GrowthTank({ conceptUrl }: { conceptUrl: string | null }) {
  const bubbles = Array.from({ length: 8 }, (_, i) => i)
  return (
    <div
      className="relative mx-auto rounded-[40%] overflow-hidden border-4 border-purple-300 shadow-[0_0_40px_rgba(147,51,234,0.25)]"
      style={{ width: 220, height: 280 }}
      aria-hidden="true"
    >
      <div className="absolute inset-0 bg-gradient-to-b from-purple-50/90 to-fuchsia-50/90" />
      <div className="absolute left-0 right-0 h-1 bg-purple-400/40" style={{ animation: 'scan-line 2s linear infinite' }} />
      {conceptUrl && (
        <img
          src={conceptUrl}
          alt="Incubating creature"
          className="absolute inset-4 object-contain opacity-70"
          style={{ filter: 'brightness(0.85) saturate(0.5) drop-shadow(0 0 12px rgba(147,51,234,0.6))', animation: 'pulse-glow 2s ease-in-out infinite' }}
        />
      )}
      {bubbles.map((i) => (
        <span
          key={i}
          className="absolute rounded-full bg-purple-300/40 border border-purple-300/50"
          style={{
            width: 8 + (i % 3) * 6, height: 8 + (i % 3) * 6,
            left: `${10 + (i * 11) % 75}%`, bottom: '-10%',
            animation: `bubble-rise ${2 + (i * 0.4)}s ease-in ${i * 0.35}s infinite`,
          }}
        />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Floating soft orbs for light background
// ---------------------------------------------------------------------------
interface OrbConfig { size: number; top: string; left?: string; right?: string; color: string; dur: string }
function CosmicOrbs() {
  const orbs: OrbConfig[] = [
    { size: 320, top: '5%',  left: '-8%',  color: 'rgba(196,181,253,0.30)',  dur: '20s' },
    { size: 240, top: '60%', right: '-6%', color: 'rgba(233,213,255,0.35)',   dur: '25s' },
    { size: 180, top: '30%', left: '70%',  color: 'rgba(221,214,254,0.25)',   dur: '18s' },
    { size: 140, top: '80%', left: '20%',  color: 'rgba(245,243,255,0.40)',  dur: '22s' },
  ]
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
      {orbs.map((o, i) => (
        <div key={i} className="absolute rounded-full blur-3xl"
          style={{ width: o.size, height: o.size, top: o.top, left: o.left, right: o.right,
            background: o.color, animation: `float-orb ${o.dur} ease-in-out infinite alternate`, animationDelay: `${i * 3}s` }} />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Holographic creature card
// ---------------------------------------------------------------------------
function CreatureCard({ parts }: { parts: ToyParts }) {
  const mindCard    = MIND_CARDS.find(c => c.slug === parts.head)
  const strengthCard = STRENGTH_CARDS.find(c => c.slug === parts.strength)
  const bodyCard    = BODY_CARDS.find(c => c.slug === parts.body)
  const powerCards  = POWERUP_CARDS.filter(c => parts.extras.includes(c.slug))

  const hasAny = mindCard || strengthCard || bodyCard || powerCards.length > 0

  return (
    <div
      className="rounded-3xl border-2 border-purple-200 p-5 space-y-3 bg-white shadow-md"
      style={{
        background: 'linear-gradient(135deg, rgba(245,243,255,1) 0%, rgba(250,245,255,1) 60%, rgba(253,244,255,1) 100%)',
        boxShadow: '0 4px 20px rgba(147,51,234,0.10)',
      }}
    >
      <p className="text-center text-xs font-black text-purple-600 uppercase tracking-widest">Creature DNA</p>
      {!hasAny ? (
        <p className="text-center text-gray-400 text-sm py-4">Pick traits to see your creature come to life...</p>
      ) : (
        <div className="space-y-2">
          <StatRow label="MIND" card={mindCard} accent="fuchsia" category="mind" />
          <StatRow label="STRENGTH" card={strengthCard} accent="red" category="strength" />
          <StatRow label="BODY" card={bodyCard} accent="cyan" category="body" />
          {powerCards.length > 0 && (
            <div className="flex items-start gap-2 pt-1">
              <span className="text-purple-600 font-black text-xs uppercase tracking-widest w-20 shrink-0 pt-0.5">POWERS</span>
              <div className="flex flex-wrap gap-1">
                {powerCards.map(p => (
                  <span key={p.slug} className="bg-purple-100 text-purple-700 text-xs font-bold px-2 py-0.5 rounded-full border border-purple-200">
                    {p.label}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StatRow({ label, card, accent, category }: { label: string; card: ItemCard | undefined; accent: string; category: string }) {
  const accentMap: Record<string, string> = { fuchsia: 'text-purple-600', cyan: 'text-purple-500', red: 'text-fuchsia-600' }
  if (!card) {
    return (
      <div className="flex items-center gap-2">
        <span className={`font-black text-xs uppercase tracking-widest w-20 shrink-0 ${accentMap[accent] ?? 'text-gray-400'} opacity-50`}>{label}</span>
        <span className="text-gray-300 text-xs">???</span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2">
      <span className={`font-black text-xs uppercase tracking-widest w-20 shrink-0 ${accentMap[accent] ?? 'text-gray-600'}`}>{label}</span>
      <img src={`/toy-creator/items/${category}-${card.slug}.webp`} alt={card.label} loading="lazy"
        className="w-7 h-7 rounded-lg object-cover border border-purple-200 shadow-sm" />
      <span className="text-gray-800 font-bold text-sm">{card.label}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function ToyCreator() {
  const { addToCart } = useCart()
  const toast = useToast()
  const navigate = useNavigate()

  // Stage machine
  const [stage, setStage] = useState<Stage>('build')

  // Builder state
  const [parts, setParts] = useState<ToyParts>({ head: '', body: '', strength: '', extras: [], freeText: '' })

  // Active model
  const [model, setModel] = useState<User3DModel | null>(null)
  const [modelId, setModelId] = useState<string | null>(null)

  // Size tiers
  const [sizeTiers, setSizeTiers] = useState<SizeTierConfig[]>([])
  const [selectedTier, setSelectedTier] = useState<PrintSizeTier>('small')

  // Color mode
  const [colorMode, setColorMode] = useState<ColorMode>('grey')

  // Order state
  const [includePaintKit, setIncludePaintKit] = useState(false)
  const [isOrdering, setIsOrdering] = useState(false)
  const [orderedProduct, setOrderedProduct] = useState<Record<string, unknown> | null>(null)

  // Remix state
  const [showRemixPanel, setShowRemixPanel] = useState(false)
  const [remixInstruction, setRemixInstruction] = useState('')
  const [isRemixing, setIsRemixing] = useState(false)

  // Wallet
  const [itcBalance, setItcBalance] = useState<number | null>(null)

  // Voice state
  const [muted, setMuted] = useState<boolean>(() => {
    try { return localStorage.getItem(VOICE_MUTE_KEY) === 'false' ? false : false } catch { return false }
  })
  const [hasPlayed, setHasPlayed] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const pendingPlayRef = useRef<string | null>(null)
  const [currentVoiceKey, setCurrentVoiceKey] = useState<string>('intro')

  // Recording state (Path A)
  const [isRecording, setIsRecording] = useState(false)
  const [transcript, setTranscript] = useState<string | null>(null)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [transcriptConfirmed, setTranscriptConfirmed] = useState(false)
  const [editedTranscript, setEditedTranscript] = useState('')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  // Reduce motion
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // Polling ref
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Status lines
  const mindCard = MIND_CARDS.find(c => c.slug === parts.head)
  const bodyCard = BODY_CARDS.find(c => c.slug === parts.body)
  const splicingLines = mindCard && bodyCard
    ? [
        `Extracting ${mindCard.label} DNA...`,
        `Splicing in ${bodyCard.label} genes...`,
        'Stabilizing the genome...',
        'Growing your creature...',
        'Almost done cooking...',
      ]
    : ['Mixing magical DNA...', 'Stabilizing the genome...', 'Growing your creature...']

  const incubationLines = [
    'Printing bones...',
    'Wrapping it in 3D skin...',
    'Teaching it to stand...',
    'Polishing for the printer...',
    'Final quality check...',
  ]

  const [statusLineIdx, setStatusLineIdx] = useState(0)
  const statusLines = stage === 'splicing' ? splicingLines : incubationLines

  const expectedIncubationSeconds = sizeTiers.find(t => t.tier === selectedTier)?.approxSeconds ?? TIER_SECONDS[selectedTier]
  const splicingProgress  = useAsymptoticProgress(stage === 'splicing', 45)
  const incubationProgress = useAsymptoticProgress(stage === 'incubation', expectedIncubationSeconds)

  // ---------------------------------------------------------------------------
  // Document-level pointer listener for deferred autoplay
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const handler = () => {
      if (pendingPlayRef.current && !muted) {
        const src = pendingPlayRef.current
        pendingPlayRef.current = null
        if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0 }
        const a = new Audio(src)
        audioRef.current = a
        a.play().then(() => setHasPlayed(true)).catch(() => {})
      }
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [muted])

  // Persist mute pref
  useEffect(() => {
    try { localStorage.setItem(VOICE_MUTE_KEY, String(muted)) } catch { /* noop */ }
  }, [muted])

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const savedId = localStorage.getItem(STORAGE_KEY)
    if (savedId) restoreModel(savedId)
    fetchWallet()
    fetchSizeTiers()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchWallet = async () => {
    try {
      const res = await apiFetch('/api/wallet/get')
      if (res?.wallet?.itc_balance != null) setItcBalance(Number(res.wallet.itc_balance))
    } catch { /* non-critical */ }
  }

  const fetchSizeTiers = async () => {
    try {
      const res = await apiFetch('/api/3d-models/size-tiers')
      const tiers: SizeTierConfig[] = res?.tiers ?? []
      if (tiers.length) setSizeTiers(tiers)
    } catch { /* keep defaults */ }
  }

  const restoreModel = async (id: string) => {
    try {
      const res = await apiFetch(`/api/3d-models/${id}`)
      if (!res?.ok || !res?.model) return
      const m: User3DModel = res.model
      setModel(m)
      setModelId(m.id)
      // Restore color mode from model metadata so alive voice plays the right clip
      const restoredColorMode: ColorMode =
        (m.metadata?.color_mode === 'color4') ? 'color4' : 'grey'
      setColorMode(restoredColorMode)
      jumpToStageForStatus(m.status, restoredColorMode)
    } catch {
      localStorage.removeItem(STORAGE_KEY)
    }
  }

  const jumpToStageForStatus = (status: User3DModel['status'], overrideColorMode?: ColorMode) => {
    switch (status) {
      case 'queued':
      case 'generating_concept':
        switchStage('splicing', overrideColorMode); break
      case 'awaiting_approval':
        switchStage('reveal', overrideColorMode); break
      case 'awaiting_3d_generation':
        switchStage('pick-size', overrideColorMode); break
      case 'generating_angles':
      case 'generating_3d':
        switchStage('incubation', overrideColorMode); break
      case 'ready':
        switchStage('alive', overrideColorMode); break
      case 'failed':
        switchStage('splicing', overrideColorMode); break
      default: break
    }
  }

  const switchStage = (s: Stage, overrideColorMode?: ColorMode) => {
    setStage(s)
    const cm = overrideColorMode ?? colorMode
    let vk: string
    if (s === 'splicing' && model?.status === 'failed') {
      vk = 'error'
    } else if (s === 'alive') {
      vk = cm === 'color4' ? 'alive-color' : 'alive'
    } else {
      vk = STAGE_VOICE[s]
    }
    setCurrentVoiceKey(vk)
  }

  // ---------------------------------------------------------------------------
  // Polling
  // ---------------------------------------------------------------------------
  const startPolling = useCallback((id: string) => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const res = await apiFetch(`/api/3d-models/${id}`)
        if (!res?.ok) return
        const m: User3DModel = res.model
        setModel(m)
        if (m.status === 'awaiting_approval') {
          stopPolling(); switchStage('reveal')
        } else if (m.status === 'awaiting_3d_generation') {
          stopPolling(); switchStage('pick-size')
        } else if (m.status === 'ready') {
          stopPolling(); switchStage('alive'); fireConfetti()
        } else if (m.status === 'failed') {
          stopPolling()
          setCurrentVoiceKey('error')
        }
      } catch { /* polling errors silently ignored */ }
    }, 3000)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  useEffect(() => { return () => stopPolling() }, [])

  // Cycle status lines
  useEffect(() => {
    if (stage !== 'splicing' && stage !== 'incubation') return
    const lines = stage === 'splicing' ? splicingLines : incubationLines
    setStatusLineIdx(0)
    const id = setInterval(() => setStatusLineIdx(prev => (prev + 1) % lines.length), 3500)
    return () => clearInterval(id)
  }, [stage]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Confetti
  // ---------------------------------------------------------------------------
  const fireConfetti = () => {
    if (prefersReduced) return
    confetti({ particleCount: 180, spread: 100, origin: { y: 0.55 } })
    setTimeout(() => confetti({ particleCount: 80, spread: 70, origin: { y: 0.4, x: 0.3 } }), 400)
    setTimeout(() => confetti({ particleCount: 80, spread: 70, origin: { y: 0.4, x: 0.7 } }), 700)
  }

  // ---------------------------------------------------------------------------
  // Voice recording (Path A)
  // ---------------------------------------------------------------------------
  const handleStartRecord = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      chunksRef.current = []
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        await handleTranscribe(new Blob(chunksRef.current, { type: 'audio/webm' }))
      }
      recorderRef.current = mr
      mr.start()
      setIsRecording(true)

      // Play listening clip
      setCurrentVoiceKey('listening')
    } catch {
      toast.error('Microphone blocked', 'We could not access your mic. Type your idea below instead!')
    }
  }

  const handleStopRecord = () => {
    recorderRef.current?.stop()
    recorderRef.current = null
    setIsRecording(false)
  }

  const handleTranscribe = async (blob: Blob) => {
    setIsTranscribing(true)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token

      const fd = new FormData()
      fd.append('audio', blob, 'recording.webm')
      fd.append('prompt', 'A child describing a fantasy creature toy they want to create: animal mash-ups, super powers, accessories, colors.')

      const headers: Record<string, string> = {}
      if (token) headers['Authorization'] = `Bearer ${token}`

      const res = await fetch(`${API_BASE}/api/ai/transcribe`, { method: 'POST', headers, body: fd })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json() as { text?: string }
      const text = json.text ?? ''
      setTranscript(text)
      setEditedTranscript(text)
    } catch {
      toast.error('Oops!', 'Could not understand the audio. Try typing it below!')
    } finally {
      setIsTranscribing(false)
    }
  }

  const handleConfirmTranscript = () => {
    setParts(p => ({ ...p, freeText: editedTranscript }))
    setTranscriptConfirmed(true)
    setCurrentVoiceKey('got-it')
  }

  // ---------------------------------------------------------------------------
  // Prompt builder
  // ---------------------------------------------------------------------------
  const buildPrompt = () => {
    const phrases: string[] = []
    if (parts.head)     phrases.push(MIND_CARDS.find(c => c.slug === parts.head)?.phrase ?? '')
    if (parts.strength) phrases.push(STRENGTH_CARDS.find(c => c.slug === parts.strength)?.phrase ?? '')
    if (parts.body)     phrases.push(BODY_CARDS.find(c => c.slug === parts.body)?.phrase ?? '')
    parts.extras.forEach(slug => {
      const p = POWERUP_CARDS.find(c => c.slug === slug)
      if (p) phrases.push(p.phrase)
    })
    const base = phrases.filter(Boolean).join(', ')
    const full = base ? `a fantasy creature toy with ${base}` : ''
    const spoken = parts.freeText.trim()
    return spoken ? (full ? `${full}. ${spoken}` : spoken) : full
  }

  const canMix = (parts.body.length > 0) || (parts.head.length > 0 && parts.strength.length > 0) || (transcriptConfirmed && parts.freeText.trim().length > 3)

  // ---------------------------------------------------------------------------
  // Create model
  // ---------------------------------------------------------------------------
  const handleMix = async () => {
    if (!canMix) return
    const prompt = buildPrompt()
    switchStage('splicing')

    try {
      const res = await apiFetch('/api/3d-models/create', {
        method: 'POST',
        body: JSON.stringify({
          prompt,
          style: 'cartoon',
          source: 'toy_creator',
          color_mode: colorMode,
          toy_parts: {
            head: parts.head,
            body: parts.body,
            extras: [parts.strength, ...parts.extras].filter(Boolean),
            mind: parts.head,
            strength: parts.strength,
            spoken: parts.freeText.trim() || undefined,
          },
        }),
      })

      if (!res?.ok) throw new Error(res?.error ?? 'Failed to create model')
      const m: User3DModel = res.model
      setModel(m)
      setModelId(m.id)
      localStorage.setItem(STORAGE_KEY, m.id)
      startPolling(m.id)
      fetchWallet()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to mix the DNA. Try again!'
      toast.error('Oops!', msg)
      switchStage('build')
    }
  }

  // ---------------------------------------------------------------------------
  // Approve concept
  // ---------------------------------------------------------------------------
  const handleApprove = async () => {
    if (!modelId) return
    try {
      await apiFetch(`/api/3d-models/${modelId}/approve`, { method: 'POST' })
      switchStage('pick-size')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to approve. Try again!'
      toast.error('Oops!', msg)
    }
  }

  const handleRevealConfetti = () => {
    if (!prefersReduced) confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } })
  }

  // ---------------------------------------------------------------------------
  // Generate 3D
  // ---------------------------------------------------------------------------
  const handleGenerate3D = async () => {
    if (!modelId) return
    try {
      const res = await apiFetch(`/api/3d-models/${modelId}/generate-3d`, {
        method: 'POST',
        body: JSON.stringify({ size: selectedTier }),
      })
      if (!res?.ok && !res?.model) throw new Error(res?.error ?? 'Failed to start generation')
      if (res.model) setModel(res.model as User3DModel)
      switchStage('incubation')
      startPolling(modelId)
      fetchWallet()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to start 3D generation'
      toast.error('Oops!', msg)
    }
  }

  // ---------------------------------------------------------------------------
  // Order
  // ---------------------------------------------------------------------------
  const handleOrder = async () => {
    if (!modelId) return
    setIsOrdering(true)
    try {
      const res = await apiFetch(`/api/3d-models/${modelId}/order`, {
        method: 'POST',
        body: JSON.stringify({
          include_paint_kit: colorMode === 'grey' ? includePaintKit : false,
          color_mode: colorMode,
        }),
      })
      if (!res?.ok) throw new Error(res?.error ?? 'Failed to create order')
      const product = res.product as Record<string, unknown>
      addToCart(product as unknown as Parameters<typeof addToCart>[0], 1)
      setOrderedProduct(product)
      toast.success('Added to cart!', 'Your creature is ready to print!')
      localStorage.removeItem(STORAGE_KEY)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not add to cart'
      toast.error('Order failed', msg)
    } finally {
      setIsOrdering(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Start over / retry
  // ---------------------------------------------------------------------------
  const startOver = () => {
    stopPolling()
    setStage('build')
    setCurrentVoiceKey('intro')
    setModel(null)
    setModelId(null)
    setOrderedProduct(null)
    setIncludePaintKit(false)
    setColorMode('grey')
    setTranscript(null)
    setTranscriptConfirmed(false)
    setEditedTranscript('')
    localStorage.removeItem(STORAGE_KEY)
  }

  const handleRetry = () => {
    startOver()
    setParts(p => ({ ...p })) // keep parts
  }

  // ---------------------------------------------------------------------------
  // Remix model — POST /api/3d-models/:id/remix
  // ---------------------------------------------------------------------------
  const handleRemix = async () => {
    if (!modelId || !remixInstruction.trim()) return
    setIsRemixing(true)
    try {
      const res = await apiFetch(`/api/3d-models/${modelId}/remix`, {
        method: 'POST',
        body: JSON.stringify({ instruction: remixInstruction.trim() }),
      })
      if (!res?.ok) throw new Error(res?.error ?? 'Remix failed')
      const newModel: User3DModel = res.model
      setModel(newModel)
      setModelId(newModel.id)
      localStorage.setItem(STORAGE_KEY, newModel.id)
      setShowRemixPanel(false)
      setRemixInstruction('')
      fetchWallet()
      // Re-enter the splicing stage so the existing polling/stage machine takes over
      switchStage('splicing')
      startPolling(newModel.id)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not remix. Try again!'
      toast.error('Remix failed', msg)
    } finally {
      setIsRemixing(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Computed helpers
  // ---------------------------------------------------------------------------
  const selectedTierConfig = sizeTiers.find(t => t.tier === selectedTier)
  const basePrintPrice = model?.print_price_usd ?? selectedTierConfig?.printPriceUsd ?? 0
  // For color4, backend applies +30%; for grey, paint kit is +$15. Use returned product price when available.
  const orderedProductPrice = orderedProduct
    ? (typeof orderedProduct.price === 'number' ? orderedProduct.price : Number(orderedProduct.price ?? 0))
    : null
  const totalPrice = orderedProductPrice
    ?? (colorMode === 'color4'
      ? basePrintPrice * 1.3
      : basePrintPrice + (includePaintKit ? 15 : 0))
  const isFailed = model?.status === 'failed'

  // For DNA helix orbit images
  const orbitMindSrc = parts.head
    ? `/toy-creator/items/mind-${parts.head}.webp`
    : '/mr-imagine/mr-imagine-waving.png'
  const orbitBodySrc = parts.body
    ? `/toy-creator/items/body-${parts.body}.webp`
    : '/mr-imagine/mr-imagine-waving.png'

  // Host props shared across stages
  const hostProps = {
    muted,
    onToggleMute: () => setMuted(m => !m),
    pendingPlayRef,
    audioRef,
    hasPlayed,
    setHasPlayed,
  }

  // ---------------------------------------------------------------------------
  // STAGE 1 — BUILD
  // ---------------------------------------------------------------------------
  const renderBuild = () => (
    <div className="w-full max-w-5xl mx-auto px-4 py-8 space-y-10">
      {/* Mr. Imagine hero host */}
      <div className="flex flex-col items-center gap-2">
        <MrImagineHost voiceKey={currentVoiceKey} large {...hostProps} />
        <div className="flex items-center gap-3 mt-4">
          <img src="/icons/icon-toy-creator.webp" alt="Toy Creator" className="w-12 h-12 rounded-xl object-contain shadow-sm" />
          <h1 className="text-4xl sm:text-5xl font-black text-gray-900 tracking-tight text-center">
            TOY CREATOR
          </h1>
        </div>
        <p className="text-purple-600 font-semibold text-lg">DNA Mixing Lab</p>
        {itcBalance !== null && (
          <p className="text-gray-500 text-sm flex items-center gap-1.5">
            <img src="/itc-coin.png" alt="ITC" className="w-4 h-4 object-contain" />
            <span>Your coins: <span className="text-purple-700 font-bold">{itcBalance}</span></span>
          </p>
        )}
      </div>

      {/* PATH A — voice */}
      <div className="rounded-3xl border-2 border-purple-200 p-6 space-y-4 bg-white shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center font-black text-white text-sm">A</div>
          <h2 className="text-xl font-black text-gray-900 uppercase tracking-wider">Tell Mr. Imagine</h2>
          <span className="text-purple-500 text-sm font-semibold">(primary)</span>
        </div>

        <div className="flex flex-col items-center gap-4">
          {/* Mic button */}
          {!transcript && !isTranscribing && (
            <button
              onPointerDown={handleStartRecord}
              onPointerUp={handleStopRecord}
              onPointerLeave={() => { if (isRecording) handleStopRecord() }}
              className={`w-28 h-28 rounded-full flex items-center justify-center transition-all duration-200 select-none ${
                isRecording
                  ? 'bg-red-500 shadow-[0_0_40px_rgba(239,68,68,0.9)] scale-110 animate-pulse'
                  : 'bg-gradient-to-br from-fuchsia-500 to-purple-600 shadow-[0_0_30px_rgba(217,70,239,0.7)] hover:scale-110 hover:shadow-[0_0_50px_rgba(217,70,239,0.9)]'
              }`}
              aria-label={isRecording ? 'Stop recording' : 'Hold to record your idea'}
            >
              {isRecording ? <MicOff size={40} className="text-white" /> : <Mic size={40} className="text-white" />}
            </button>
          )}
          {isRecording && <p className="text-red-500 font-bold text-sm animate-pulse">Release to stop recording...</p>}
          {!isRecording && !transcript && !isTranscribing && (
            <p className="text-gray-400 text-sm">Hold the mic and describe your creature!</p>
          )}

          {/* Transcribing spinner */}
          {isTranscribing && (
            <div className="flex items-center gap-3 text-purple-600">
              <div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
              <span className="font-bold">Listening to your idea...</span>
            </div>
          )}

          {/* Transcript confirmation */}
          {transcript && !transcriptConfirmed && (
            <div className="w-full space-y-3">
              <p className="text-gray-600 text-sm text-center font-semibold">Did I hear that right?</p>
              <textarea
                value={editedTranscript}
                onChange={e => setEditedTranscript(e.target.value)}
                rows={2}
                className="w-full rounded-2xl border-2 border-purple-300 bg-white text-gray-800 placeholder-gray-300 px-4 py-3 text-sm focus:outline-none focus:border-purple-500 transition-colors resize-none"
              />
              <div className="flex gap-3">
                <button
                  onClick={handleConfirmTranscript}
                  disabled={!editedTranscript.trim()}
                  className="flex-1 py-3 rounded-2xl font-black text-white bg-gradient-to-r from-green-600 to-emerald-600 hover:scale-105 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  YES — MIX IT!
                </button>
                <button
                  onClick={() => { setTranscript(null); setEditedTranscript('') }}
                  className="flex-1 py-3 rounded-2xl font-black text-gray-700 bg-gray-100 border border-gray-300 hover:scale-105 transition-all flex items-center justify-center gap-2"
                >
                  <RotateCcw size={16} />
                  Try again
                </button>
              </div>
            </div>
          )}

          {transcriptConfirmed && (
            <div className="w-full p-3 rounded-2xl bg-green-50 border border-green-300 flex items-center gap-3">
              <CheckCircle size={18} className="text-green-600 shrink-0" />
              <p className="text-green-700 text-sm font-bold truncate">{parts.freeText}</p>
              <button onClick={() => { setTranscriptConfirmed(false); setTranscript(null); setEditedTranscript('') }}
                className="ml-auto text-gray-400 hover:text-gray-600 shrink-0" aria-label="Clear">
                <RefreshCw size={14} />
              </button>
            </div>
          )}

          {/* Fallback type */}
          <div className="w-full">
            <p className="text-gray-400 text-xs text-center mb-2">...or type it instead</p>
            <textarea
              value={transcriptConfirmed ? '' : parts.freeText}
              onChange={e => {
                if (transcriptConfirmed) return
                setParts(p => ({ ...p, freeText: e.target.value }))
              }}
              placeholder="A dragon with rocket boots and a birthday hat..."
              rows={2}
              disabled={transcriptConfirmed}
              className="w-full rounded-2xl border-2 border-gray-200 bg-white text-gray-800 placeholder-gray-300 px-4 py-3 text-sm focus:outline-none focus:border-purple-400 transition-colors resize-none disabled:opacity-30"
            />
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="flex items-center gap-4">
        <div className="flex-1 h-px bg-gray-200" />
        <span className="text-gray-400 font-bold text-sm uppercase tracking-widest">or</span>
        <div className="flex-1 h-px bg-gray-200" />
      </div>

      {/* PATH B — card picker */}
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-purple-500 flex items-center justify-center font-black text-white text-sm">B</div>
          <h2 className="text-xl font-black text-gray-900 uppercase tracking-wider">Build it piece by piece</h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Picker columns */}
          <div className="lg:col-span-2 space-y-6">
            {/* MIND */}
            <div className="space-y-3">
              <h3 className="text-lg font-black text-purple-600 uppercase tracking-widest">Mind of...</h3>
              <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                {MIND_CARDS.map(card => (
                  <ItemCardButton
                    key={card.slug} category="mind" card={card}
                    selected={parts.head === card.slug} accentColor="fuchsia"
                    onToggle={() => setParts(p => ({ ...p, head: p.head === card.slug ? '' : card.slug }))}
                  />
                ))}
              </div>
            </div>

            {/* STRENGTH */}
            <div className="space-y-3">
              <h3 className="text-lg font-black text-fuchsia-600 uppercase tracking-widest">Strength of...</h3>
              <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                {STRENGTH_CARDS.map(card => (
                  <ItemCardButton
                    key={card.slug} category="strength" card={card}
                    selected={parts.strength === card.slug} accentColor="fuchsia"
                    onToggle={() => setParts(p => ({ ...p, strength: p.strength === card.slug ? '' : card.slug }))}
                  />
                ))}
              </div>
            </div>

            {/* BODY */}
            <div className="space-y-3">
              <h3 className="text-lg font-black text-purple-500 uppercase tracking-widest">Body of...</h3>
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                {BODY_CARDS.map(card => (
                  <ItemCardButton
                    key={card.slug} category="body" card={card}
                    selected={parts.body === card.slug} accentColor="cyan"
                    onToggle={() => setParts(p => ({ ...p, body: p.body === card.slug ? '' : card.slug }))}
                  />
                ))}
              </div>
            </div>

            {/* POWER-UPS */}
            <div className="space-y-3">
              <h3 className="text-lg font-black text-purple-600 uppercase tracking-widest flex items-center gap-2">
                <Zap size={18} /> Power-Ups
                <span className="text-gray-400 text-sm font-normal">(pick up to 3)</span>
              </h3>
              <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                {POWERUP_CARDS.map(card => {
                  const maxed = parts.extras.length >= 3 && !parts.extras.includes(card.slug)
                  return (
                    <ItemCardButton
                      key={card.slug} category="powerup" card={card}
                      selected={parts.extras.includes(card.slug)} accentColor="yellow"
                      onToggle={() => {
                        if (maxed) return
                        setParts(p => ({
                          ...p,
                          extras: p.extras.includes(card.slug)
                            ? p.extras.filter(e => e !== card.slug)
                            : [...p.extras, card.slug],
                        }))
                      }}
                    />
                  )
                })}
              </div>
            </div>
          </div>

          {/* Creature card panel */}
          <div className="lg:col-span-1">
            <div className="sticky top-20 space-y-4">
              <CreatureCard parts={parts} />
            </div>
          </div>
        </div>
      </div>

      {/* Color mode chooser */}
      <div className="space-y-4">
        <h3 className="text-lg font-black text-gray-900 uppercase tracking-widest text-center">How should we color it?</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Paint yourself */}
          <button
            onClick={() => setColorMode('grey')}
            className={`rounded-3xl border-4 p-5 text-left transition-all duration-200 ${
              colorMode === 'grey'
                ? 'border-purple-600 bg-purple-50 shadow-[0_4px_20px_rgba(147,51,234,0.20)] scale-[1.02]'
                : 'border-purple-100 bg-white shadow-sm hover:border-purple-300'
            }`}
            aria-pressed={colorMode === 'grey'}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="w-10 h-10 rounded-2xl bg-gray-100 border-2 border-gray-300 flex items-center justify-center shrink-0">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 text-gray-600">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42" />
                </svg>
              </div>
              {colorMode === 'grey' && <CheckCircle size={20} className="text-purple-600 shrink-0" />}
            </div>
            <p className="font-black text-gray-900 text-base">Paint it yourself</p>
            <p className="text-gray-500 text-sm mt-1 leading-snug">Printed in matte grey — a blank canvas for your brushes</p>
          </button>

          {/* Full color print */}
          <button
            onClick={() => setColorMode('color4')}
            className={`rounded-3xl border-4 p-5 text-left transition-all duration-200 ${
              colorMode === 'color4'
                ? 'border-purple-600 bg-purple-50 shadow-[0_4px_20px_rgba(147,51,234,0.20)] scale-[1.02]'
                : 'border-purple-100 bg-white shadow-sm hover:border-purple-300'
            }`}
            aria-pressed={colorMode === 'color4'}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-purple-400 to-fuchsia-500 flex items-center justify-center shrink-0">
                <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={1.8} className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.098 19.902a3.75 3.75 0 005.304 0l6.401-6.402M6.75 21A3.75 3.75 0 013 17.25V4.125C3 3.504 3.504 3 4.125 3h5.25c.621 0 1.125.504 1.125 1.125v4.072M6.75 21a3.75 3.75 0 003.75-3.75V8.197M6.75 21h13.125c.621 0 1.125-.504 1.125-1.125v-5.25c0-.621-.504-1.125-1.125-1.125h-4.072M10.5 8.197l2.88-2.88c.438-.439 1.15-.439 1.59 0l3.712 3.713c.44.44.44 1.152 0 1.59l-2.879 2.88M6.75 17.25h.008v.008H6.75v-.008z" />
                </svg>
              </div>
              {colorMode === 'color4' && <CheckCircle size={20} className="text-purple-600 shrink-0" />}
            </div>
            <p className="font-black text-gray-900 text-base flex items-center gap-2">
              Full color print
              <span className="text-xs font-bold text-purple-600 bg-purple-100 px-2 py-0.5 rounded-full border border-purple-200">+30%</span>
            </p>
            <p className="text-gray-500 text-sm mt-1 leading-snug">Printed in up to 4 colors — ready right out of the box</p>
          </button>
        </div>
      </div>

      {/* CTA */}
      <div className="flex flex-col items-center gap-3 pb-8">
        <button
          onClick={handleMix}
          disabled={!canMix}
          className={`relative px-10 py-5 rounded-full text-2xl sm:text-3xl font-black text-white tracking-tight transition-all duration-200 ${
            canMix
              ? 'bg-gradient-to-r from-fuchsia-600 via-purple-600 to-indigo-600 shadow-[0_0_30px_rgba(168,85,247,0.7)] hover:scale-105 hover:shadow-[0_0_50px_rgba(168,85,247,0.9)] active:scale-95'
              : 'bg-white/10 text-white/30 cursor-not-allowed'
          }`}
        >
          MIX THE DNA!
          {canMix && (
            <span className="block text-xs font-medium text-white/60 mt-0.5">
              uses 20 coins{' '}
              <img src="/itc-coin.png" alt="ITC" className="inline w-3 h-3 object-contain" />
            </span>
          )}
        </button>
        {!canMix && (
          <p className="text-gray-400 text-sm">Pick a Body — or Mind + Strength — or tell Mr. Imagine your idea first</p>
        )}
      </div>
    </div>
  )

  // ---------------------------------------------------------------------------
  // STAGE 2 — SPLICING
  // ---------------------------------------------------------------------------
  const renderSplicing = () => (
    <div className="w-full max-w-lg mx-auto px-4 py-12 flex flex-col items-center gap-8 text-center">
      {isFailed ? (
        <>
          <h2 className="text-3xl font-black text-gray-900">The DNA got tangled!</h2>
          <p className="text-gray-600 text-lg">
            Something went wrong in the lab. Your coins are safe — no charge if it failed at the start.
          </p>
          {model?.error_message && (
            <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-xl px-4 py-2">{model.error_message}</p>
          )}
          <button
            onClick={handleRetry}
            className="px-8 py-4 rounded-full text-xl font-black text-white bg-gradient-to-r from-orange-600 to-red-600 hover:scale-105 transition-all shadow-lg flex items-center gap-3"
          >
            <RefreshCw size={22} />
            Try Again
          </button>
        </>
      ) : (
        <>
          <h2 className="text-3xl font-black text-gray-900">DNA SPLICING IN PROGRESS!</h2>

          {prefersReduced ? (
            <div className="flex items-center gap-3 text-purple-600 text-lg">
              <div className="w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
              <span>Lab working hard...</span>
            </div>
          ) : (
            <DnaHelix mindImg={orbitMindSrc} bodyImg={orbitBodySrc} />
          )}

          <p
            key={statusLineIdx}
            className="text-purple-600 text-lg font-semibold min-h-[1.75rem]"
            style={{ animation: prefersReduced ? 'none' : 'fade-in 0.4s ease' }}
          >
            {statusLines[statusLineIdx]}
          </p>

          <div className="w-full max-w-xs">
            <div className="h-3 rounded-full bg-purple-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-purple-500 to-fuchsia-500 transition-all duration-500"
                style={{ width: `${splicingProgress}%` }}
              />
            </div>
            <p className="text-gray-400 text-xs mt-1.5">{Math.round(splicingProgress)}% complete</p>
          </div>

          <p className="text-gray-400 text-sm">This usually takes about 30–60 seconds...</p>
        </>
      )}
    </div>
  )

  // ---------------------------------------------------------------------------
  // STAGE 3 — REVEAL
  // ---------------------------------------------------------------------------
  const renderReveal = () => (
    <div className="w-full max-w-lg mx-auto px-4 py-12 flex flex-col items-center gap-8 text-center">
      <h2 className="text-4xl font-black text-gray-900">YOUR CREATURE IS BORN!</h2>

      {model?.concept_image_url ? (
        <div
          className="relative w-72 h-72 sm:w-80 sm:h-80 rounded-3xl overflow-hidden border-4 border-purple-400 shadow-[0_0_30px_rgba(147,51,234,0.35)]"
        >
          <img
            src={model.concept_image_url}
            alt="Your creature concept"
            className="w-full h-full object-cover"
            onLoad={handleRevealConfetti}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
        </div>
      ) : (
        <div className="w-72 h-72 rounded-3xl bg-purple-50 border-4 border-purple-200 flex items-center justify-center">
          <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-4 w-full max-w-xs">
        <button
          onClick={handleApprove}
          className="flex-1 px-6 py-4 rounded-2xl text-lg font-black text-white bg-gradient-to-r from-green-600 to-emerald-600 hover:scale-105 active:scale-95 transition-all shadow-lg"
        >
          I LOVE IT — BUILD IT IN 3D!
        </button>
        <button
          onClick={handleRetry}
          className="flex-1 px-6 py-4 rounded-2xl text-lg font-black text-gray-700 bg-gray-100 border-2 border-gray-300 hover:bg-gray-200 hover:scale-105 transition-all flex items-center justify-center gap-2"
        >
          <RefreshCw size={18} />
          Mix Again
        </button>
      </div>
    </div>
  )

  // ---------------------------------------------------------------------------
  // STAGE 4 — PICK SIZE
  // ---------------------------------------------------------------------------
  const renderPickSize = () => (
    <div className="w-full max-w-2xl mx-auto px-4 py-10 space-y-8">
      <div className="text-center">
        <h2 className="text-4xl font-black text-gray-900">HOW BIG?!</h2>
        <p className="text-gray-500 mt-2 text-lg">Choose how big your toy should be printed</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {(sizeTiers.length ? sizeTiers : (
          [
            { tier: 'mini',   label: 'Mini',   printHeightMm: 50,  itcCost: 50,  printPriceUsd: 5.99,  approxSeconds: 60 },
            { tier: 'small',  label: 'Small',  printHeightMm: 100, itcCost: 80,  printPriceUsd: 11.99, approxSeconds: 90 },
            { tier: 'medium', label: 'Medium', printHeightMm: 150, itcCost: 140, printPriceUsd: 18.99, approxSeconds: 120 },
            { tier: 'large',  label: 'Large',  printHeightMm: 200, itcCost: 220, printPriceUsd: 29.99, approxSeconds: 180 },
          ] as Partial<SizeTierConfig>[]
        )).map((tier) => {
          const t = tier as SizeTierConfig
          const isSelected = selectedTier === t.tier
          const ref = SIZE_REFS[t.tier as PrintSizeTier] ?? t.label
          return (
            <button
              key={t.tier}
              onClick={() => setSelectedTier(t.tier as PrintSizeTier)}
              className={`p-5 rounded-3xl border-4 text-left transition-all duration-200 ${
                isSelected
                  ? 'border-purple-600 bg-purple-50 shadow-[0_4px_20px_rgba(147,51,234,0.20)] scale-102'
                  : 'border-purple-100 bg-white shadow-sm hover:border-purple-300 hover:scale-101'
              }`}
              aria-pressed={isSelected}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className={`text-xl font-black ${isSelected ? 'text-purple-700' : 'text-gray-800'}`}>{ref}</p>
                  <p className="text-gray-400 text-sm mt-0.5">{(t.printHeightMm / 10).toFixed(0)}cm tall</p>
                </div>
                {isSelected && <CheckCircle size={22} className="text-purple-600 shrink-0" />}
              </div>
              <div className="mt-3 flex items-baseline gap-3">
                <span className={`text-2xl font-black ${isSelected ? 'text-purple-600' : 'text-gray-700'}`}>
                  {t.itcCost} coins
                </span>
                <span className="text-gray-400 text-sm">+ ${t.printPriceUsd} to print</span>
              </div>
              {t.approxSeconds && (
                <p className="text-gray-300 text-xs mt-1">~{Math.round(t.approxSeconds / 60)}min to generate</p>
              )}
            </button>
          )
        })}
      </div>

      <div className="flex justify-center">
        <button
          onClick={handleGenerate3D}
          className="px-10 py-4 rounded-full text-2xl font-black text-white bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:scale-105 active:scale-95 transition-all shadow-[0_0_30px_rgba(168,85,247,0.7)]"
        >
          GROW IT IN 3D!
        </button>
      </div>
    </div>
  )

  // ---------------------------------------------------------------------------
  // STAGE 5 — INCUBATION
  // ---------------------------------------------------------------------------
  const renderIncubation = () => (
    <div className="w-full max-w-lg mx-auto px-4 py-12 flex flex-col items-center gap-8 text-center">
      <h2 className="text-3xl font-black text-gray-900">INCUBATION CHAMBER</h2>
      <p className="text-gray-500 text-lg">Your creature is growing in 3D...</p>

      {prefersReduced ? (
        <div className="flex items-center gap-3 text-purple-600 text-lg animate-pulse">
          <div className="w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
          <span>Growing...</span>
        </div>
      ) : (
        <GrowthTank conceptUrl={model?.concept_image_url ?? null} />
      )}

      <p
        key={statusLineIdx}
        className="text-purple-600 text-lg font-semibold min-h-[1.75rem]"
        style={{ animation: prefersReduced ? 'none' : 'fade-in 0.4s ease' }}
      >
        {statusLines[statusLineIdx]}
      </p>

      <div className="w-full max-w-xs">
        <div className="h-4 rounded-full bg-purple-100 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-purple-500 to-fuchsia-500 transition-all duration-500"
            style={{ width: `${incubationProgress}%` }}
          />
        </div>
        <p className="text-gray-400 text-xs mt-1.5">{Math.round(incubationProgress)}% grown</p>
      </div>

      <p className="text-gray-400 text-sm">
        This takes {Math.round(expectedIncubationSeconds / 60)}–{Math.round(expectedIncubationSeconds / 60) + 1} minutes. Don't close this page!
      </p>
    </div>
  )

  // ---------------------------------------------------------------------------
  // STAGE 6 — ALIVE
  // ---------------------------------------------------------------------------
  const renderAlive = () => (
    <div className="w-full max-w-2xl mx-auto px-4 py-10 space-y-8">
      <div className="text-center space-y-2">
        <h2 className="text-5xl font-black text-gray-900">IT'S ALIVE!!!</h2>
        <p className="text-purple-600 text-xl font-semibold">Here's your creature!</p>
        {colorMode === 'color4' ? (
          <p className="text-gray-500">
            Printed in <strong className="text-gray-900">up to 4 colors</strong> — ready right out of the box!
          </p>
        ) : (
          <p className="text-gray-500">
            We print it in matte grey so <strong className="text-gray-900">YOU</strong> get to paint it.
          </p>
        )}
      </div>

      <div className="aspect-square w-full max-w-sm mx-auto rounded-3xl overflow-hidden border-4 border-purple-300 shadow-[0_4px_30px_rgba(147,51,234,0.25)]">
        {model?.glb_url ? (
          <Model3DViewer glbUrl={model.glb_url} alt="Your 3D toy" className="w-full h-full" autoRotate />
        ) : model?.concept_image_url ? (
          <img src={model.concept_image_url} alt="Your creature" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-purple-50">
            <div className="w-16 h-16 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {orderedProduct ? (
        <div className="text-center space-y-4">
          <div className="inline-flex px-6 py-3 rounded-2xl bg-green-50 border-2 border-green-400 text-green-700 font-black text-xl items-center gap-3">
            <ShoppingCart size={20} />
            Added to cart!
          </div>
          {orderedProductPrice != null && (
            <p className="text-gray-500 text-sm">
              Order total: <span className="font-bold text-purple-700">${orderedProductPrice.toFixed(2)}</span>
            </p>
          )}
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={() => navigate('/cart')}
              className="px-8 py-3 rounded-full font-black text-white text-lg bg-gradient-to-r from-green-600 to-emerald-600 hover:scale-105 transition-all flex items-center gap-2"
            >
              <ShoppingCart size={18} /> Go to cart
            </button>
            <button
              onClick={startOver}
              className="px-8 py-3 rounded-full font-black text-gray-700 text-lg bg-gray-100 border-2 border-gray-300 hover:scale-105 transition-all flex items-center gap-2"
            >
              <RefreshCw size={18} /> Make another creature
            </button>
          </div>
          <p className="text-gray-400 text-sm">
            Saved to My Designs —{' '}
            <Link to="/my-designs?tab=3d-models" className="text-purple-600 hover:text-purple-500 underline">
              find it any time!
            </Link>
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-purple-50 border border-purple-200 rounded-2xl px-5 py-4">
            <div className="space-y-1">
              <span className="text-gray-800 font-bold text-lg">Your Toy</span>
              {colorMode === 'color4' && (
                <span className="block text-xs font-bold text-purple-600 bg-purple-100 px-2 py-0.5 rounded-full border border-purple-200 w-fit">
                  Full color — up to 4 colors
                </span>
              )}
            </div>
            <span className="text-3xl font-black text-purple-700">${basePrintPrice.toFixed(2)}</span>
          </div>

          {/* Paint kit — only available for grey prints */}
          {colorMode === 'grey' && (
            <button
              onClick={() => setIncludePaintKit(p => !p)}
              className={`w-full p-5 rounded-3xl border-4 text-left transition-all ${
                includePaintKit
                  ? 'border-purple-600 bg-purple-50 shadow-md'
                  : 'border-purple-100 bg-white shadow-sm hover:border-purple-300'
              }`}
              aria-pressed={includePaintKit}
            >
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-purple-100 flex items-center justify-center shrink-0">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-6 h-6 text-purple-600">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42" />
                  </svg>
                </div>
                <div className="flex-1">
                  <p className="font-black text-gray-800 text-lg flex items-center gap-2">
                    Painting Kit
                    <span className="text-purple-600 text-base">+$15</span>
                    {includePaintKit && <CheckCircle size={16} className="text-green-600" />}
                  </p>
                  <p className="text-gray-500 text-sm">Brushes + paints to bring your creature to life!</p>
                </div>
              </div>
            </button>
          )}

          <div className="flex items-center justify-between bg-gradient-to-r from-purple-50 to-fuchsia-50 rounded-2xl px-5 py-4 border border-purple-200">
            <span className="text-gray-800 font-bold text-xl">Total</span>
            <div className="text-right">
              <span className="text-4xl font-black text-purple-700">${totalPrice.toFixed(2)}</span>
              <p className="text-sm font-semibold text-purple-500 mt-0.5">or pay {usdToItcLabel(totalPrice)} with coins</p>
            </div>
          </div>

          <button
            onClick={handleOrder}
            disabled={isOrdering}
            className="w-full py-5 rounded-full text-2xl font-black text-white bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:scale-105 active:scale-95 transition-all shadow-[0_4px_20px_rgba(147,51,234,0.4)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
          >
            {isOrdering ? (
              <><div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" /> Adding...</>
            ) : (
              <><ShoppingCart size={26} /> ADD TO CART</>
            )}
          </button>

          {/* Secondary actions */}
          <div className="flex flex-col items-center gap-3">
            <div className="flex flex-wrap justify-center gap-4">
              <button
                onClick={() => setShowRemixPanel(p => !p)}
                className="flex items-center gap-2 text-purple-600 hover:text-purple-800 text-sm font-bold transition-colors"
              >
                <Wand2 size={15} />
                Remix this creature
              </button>
              <button onClick={startOver} className="text-gray-400 hover:text-gray-600 text-sm underline transition-colors">
                Make another creature instead
              </button>
            </div>

            {/* Remix panel */}
            {showRemixPanel && (
              <div className="w-full rounded-3xl border-2 border-purple-200 bg-white p-5 space-y-3 shadow-md">
                <p className="text-gray-800 font-black text-sm">Keep what you love — change only what you ask</p>
                <textarea
                  value={remixInstruction}
                  onChange={e => setRemixInstruction(e.target.value)}
                  placeholder="Keep my creature but... give it dragon wings instead"
                  rows={2}
                  className="w-full rounded-2xl border-2 border-gray-200 bg-white text-gray-800 placeholder-gray-300 px-4 py-3 text-sm focus:outline-none focus:border-purple-400 transition-colors resize-none"
                />
                <div className="flex items-center justify-between gap-2">
                  <p className="text-gray-400 text-xs flex items-center gap-1">
                    uses 20 coins{' '}
                    <img src="/itc-coin.png" alt="ITC" className="inline w-3 h-3 object-contain" />
                  </p>
                  <button
                    onClick={handleRemix}
                    disabled={isRemixing || !remixInstruction.trim()}
                    className="px-5 py-2.5 rounded-full font-black text-white text-sm bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:scale-105 active:scale-95 transition-all shadow-md disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {isRemixing ? (
                      <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Remixing...</>
                    ) : (
                      <><Wand2 size={14} /> REMIX IT</>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )

  // ---------------------------------------------------------------------------
  // Page shell
  // ---------------------------------------------------------------------------
  return (
    <>
      <style>{`
        @keyframes dna-pulse {
          from { opacity: 0.5; transform: translate(-50%,-50%) scale(0.85); }
          to   { opacity: 1;   transform: translate(-50%,-50%) scale(1.15); }
        }
        @keyframes orbit-head {
          0%   { transform: translate(-50%,-50%) translateX(30px) rotate(0deg); }
          100% { transform: translate(-50%,-50%) translateX(-30px) rotate(360deg); }
        }
        @keyframes orbit-body {
          0%   { transform: translate(-50%,-50%) translateX(-30px) rotate(0deg); }
          100% { transform: translate(-50%,-50%) translateX(30px) rotate(360deg); }
        }
        @keyframes bubble-rise {
          0%   { transform: translateY(0)    scale(1);   opacity: 0.7; }
          80%  { opacity: 0.4; }
          100% { transform: translateY(-300px) scale(0.6); opacity: 0; }
        }
        @keyframes scan-line {
          0%   { top: 0%; }
          100% { top: 100%; }
        }
        @keyframes pulse-glow {
          0%, 100% { filter: brightness(0.85) saturate(0.5) drop-shadow(0 0 8px rgba(147,51,234,0.4)); }
          50%      { filter: brightness(1.0) saturate(0.7) drop-shadow(0 0 20px rgba(147,51,234,0.8)); }
        }
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes float-orb {
          from { transform: translate(0, 0) scale(1); }
          to   { transform: translate(30px, 20px) scale(1.08); }
        }
        .scale-101 { transform: scale(1.01); }
        .scale-102 { transform: scale(1.02); }
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
        }
      `}</style>

      <div
        className="min-h-screen relative overflow-x-hidden bg-gradient-to-b from-white via-purple-50 to-white"
      >
        <CosmicOrbs />

        {/* Stage indicator dots */}
        <div className="sticky top-0 z-20 flex justify-center pt-4 pb-2 gap-2 backdrop-blur-sm bg-white/70 border-b border-purple-100">
          {(['build', 'splicing', 'reveal', 'pick-size', 'incubation', 'alive'] as Stage[]).map((s, i) => (
            <div
              key={s}
              className={`rounded-full transition-all duration-300 ${
                stage === s
                  ? 'w-6 h-3 bg-purple-600 shadow-[0_0_8px_rgba(147,51,234,0.5)]'
                  : i < (['build', 'splicing', 'reveal', 'pick-size', 'incubation', 'alive'] as Stage[]).indexOf(stage)
                    ? 'w-3 h-3 bg-purple-400'
                    : 'w-3 h-3 bg-purple-200'
              }`}
              aria-label={`Step ${i + 1}`}
            />
          ))}
        </div>

        {/* Main content */}
        <div className="relative z-10 flex flex-col items-center min-h-[calc(100vh-56px)]">
          {stage === 'build'      && renderBuild()}
          {stage === 'splicing'   && renderSplicing()}
          {stage === 'reveal'     && renderReveal()}
          {stage === 'pick-size'  && renderPickSize()}
          {stage === 'incubation' && renderIncubation()}
          {stage === 'alive'      && renderAlive()}
        </div>

        {/* Mr. Imagine docked host on all stages except build */}
        {stage !== 'build' && (
          <MrImagineHost
            voiceKey={currentVoiceKey}
            large={false}
            {...hostProps}
          />
        )}
      </div>
    </>
  )
}
