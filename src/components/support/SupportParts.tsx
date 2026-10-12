// The pieces the help page (/help) and the contact page (/contact) share. Task 5878a61f, built to the mockup
// David approved on 2026-10-07 (approval dca0616d). Facts come from src/lib/help-facts.ts only.
import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight, Clock, MapPin, MessageCircle, Navigation, Package, Palette, Ruler, RotateCcw, Search, Send, Truck,
} from 'lucide-react'
import { HELP_TOPICS, PICKUP, type HelpTopicId } from '../../lib/help-facts'
import { SIZE_CHARTS } from '../../../backend/shared/size-charts'
import { openShopChat } from './chat-events'
import '../../styles/support.css'

export const TOPIC_ICONS: Record<HelpTopicId, React.ComponentType<{ className?: string }>> = {
  sizing: Ruler,
  turnaround: Clock,
  shipping: Truck,
  returns: RotateCcw,
  custom: Palette,
  pickup: MapPin,
}

/** Full-bleed photo hero with the copy on the left and Mr. Imagine waving on the right. */
export function SupportHero({ image, eyebrow, title, subtitle, children, mascot = true }: {
  image: string
  eyebrow: string
  title: React.ReactNode
  subtitle: string
  children?: React.ReactNode
  mascot?: boolean
}) {
  return (
    <section className="sp-hero">
      <img src={image} alt="" className="sp-hero-img" />
      <div className="relative mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pt-10 pb-12 sm:pt-16 sm:pb-20 flex items-end gap-6">
        <div className="max-w-xl flex-1">
          <p className="sp-rise inline-flex items-center gap-2 rounded-full bg-card border border-border px-3 py-1 text-xs font-semibold text-text-secondary">
            <span className="sp-live-dot w-2 h-2 rounded-full bg-primary" />
            {eyebrow}
          </p>
          <h1 className="sp-rise sp-d1 mt-4 font-display text-5xl sm:text-6xl lg:text-7xl leading-[1.02] text-text">{title}</h1>
          <p className="sp-rise sp-d2 mt-4 text-base sm:text-lg text-text-secondary max-w-md">{subtitle}</p>
          {children && <div className="sp-rise sp-d3 mt-6">{children}</div>}
        </div>
        {mascot && (
          <img
            src="/mr-imagine/mr-imagine-waving.png"
            alt="Mr. Imagine waving"
            className="sp-mascot hidden md:block w-56 lg:w-72 shrink-0 -mb-6 select-none pointer-events-none"
          />
        )}
      </div>
    </section>
  )
}

/** Search box. On /contact it jumps to the help page; on /help it filters in place. */
export function HelpSearch({ initial = '', onSearch }: { initial?: string; onSearch?: (q: string) => void }) {
  const [q, setQ] = useState(initial)
  const navigate = useNavigate()
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        if (onSearch) onSearch(q)
        else navigate(`/help${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`)
      }}
      className="flex items-center gap-2 rounded-2xl bg-card border border-border p-1.5 pl-4 shadow-lg max-w-lg"
    >
      <Search className="w-5 h-5 text-muted shrink-0" aria-hidden />
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); onSearch?.(e.target.value) }}
        placeholder="Search answers: sizing, shipping, returns"
        aria-label="Search answers"
        className="flex-1 min-w-0 bg-transparent py-2 text-text placeholder:text-muted focus:outline-none"
      />
      <button type="submit" className="sp-btn !py-2 !px-4 text-sm">Search</button>
    </form>
  )
}

/** The three big doors under the contact hero. */
export function SupportDoors({ signedIn }: { signedIn: boolean }) {
  const doors = [
    { tone: 'primary', img: '/support/door-answers.webp', Icon: Search, title: 'Quick answers', line: 'Sizing, shipping, returns and pickup, answered.', to: '/help' },
    { tone: 'accent', img: '/support/door-chat.webp', Icon: MessageCircle, title: 'Chat with us', line: 'Ask in the shop chat. A real person can step in.', chat: true },
    { tone: 'secondary', img: '/support/door-track.webp', Icon: Package, title: 'Track my order', line: signedIn ? 'See every order and its tracking.' : 'Your order email has a link to its live status.', to: signedIn ? '/account/orders' : '/help?q=track' },
  ] as const
  return (
    <div className="grid gap-5 sm:grid-cols-3">
      {doors.map((d, i) => {
        const body = (
          <>
            <img src={d.img} alt="" className="sp-door-img" style={d.img.includes('chat') ? { objectPosition: '50% 70%' } : undefined} />
            <span className="sp-door-chip"><d.Icon className="w-5 h-5" /></span>
            <span className="p-5 flex-1 flex flex-col">
              <span className="font-display text-2xl text-text">{d.title}</span>
              <span className="mt-1 text-sm text-muted flex-1">{d.line}</span>
              <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                {'chat' in d ? 'Open the chat' : 'Go'} <ArrowRight className="sp-arrow w-4 h-4" />
              </span>
            </span>
          </>
        )
        const cls = `sp-door sp-rise sp-d${i + 1}`
        return 'chat' in d
          ? <button key={d.title} type="button" data-tone={d.tone} className={cls} onClick={() => openShopChat()}>{body}</button>
          : <Link key={d.title} to={d.to} data-tone={d.tone} className={cls}>{body}</Link>
      })}
    </div>
  )
}

/** Six quick-answer cards, one per help topic. */
export function QuickAnswers() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {HELP_TOPICS.map((t, i) => {
        const Icon = TOPIC_ICONS[t.id]
        return (
          <Link key={t.id} to={`/help#${t.id}`} className={`sp-card sp-qa sp-rise sp-d${i + 1} flex items-start gap-3 p-4`}>
            <span className="sp-icon-chip w-10 h-10 rounded-full grid place-items-center shrink-0"><Icon className="w-5 h-5" /></span>
            <span className="min-w-0">
              <span className="block font-semibold text-text">{t.title}</span>
              <span className="block text-sm text-muted">{t.short}</span>
            </span>
          </Link>
        )
      })}
    </div>
  )
}

export function PickupCard({ compact = false }: { compact?: boolean }) {
  return (
    <div className="sp-card overflow-hidden">
      <div className="p-5">
        <p className="flex items-center gap-2 font-display text-2xl text-text">
          <MapPin className="w-6 h-6 text-primary" /> Free local pickup
        </p>
        <p className="mt-2 text-text-secondary">{PICKUP.street}<br />{PICKUP.cityLine}</p>
        <p className="mt-2 flex items-center gap-2 text-sm text-muted"><Clock className="w-4 h-4" /> {PICKUP.hours}</p>
        {!compact && <p className="mt-1 text-sm text-muted">Ready in about {PICKUP.readyDays} business days. Choose pickup at checkout.</p>}
      </div>
      <a href={PICKUP.mapsUrl} target="_blank" rel="noreferrer" className="block relative group" aria-label="Open the shop in Google Maps">
        <img src="/support/pickup-map.webp" alt="" className={`w-full object-cover ${compact ? 'h-32' : 'h-40'}`} />
        <span className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-card border border-border px-3 py-1.5 text-xs font-semibold text-primary shadow group-hover:border-primary">
          <Navigation className="w-3.5 h-3.5" /> Directions
        </span>
      </a>
    </div>
  )
}

export function SizeChart() {
  const [garment, setGarment] = useState<'tshirt' | 'hoodie'>('tshirt')
  const rows = SIZE_CHARTS[garment]
  const adult = rows.filter((r) => !r.size.startsWith('Y'))
  const youth = rows.filter((r) => r.size.startsWith('Y'))
  const table = (label: string, list: typeof rows) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="text-left text-xs font-semibold uppercase tracking-wide text-muted pb-2">{label}</caption>
        <thead>
          <tr className="text-left text-muted">
            <th className="py-1.5 pr-3 font-medium">Size</th>
            <th className="py-1.5 pr-3 font-medium">Chest, flat (in)</th>
            <th className="py-1.5 font-medium">Length (in)</th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.size} className="border-t border-border">
              <td className="py-1.5 pr-3 font-semibold text-text">{r.size}</td>
              <td className="py-1.5 pr-3 text-text-secondary">{r.widthIn}</td>
              <td className="py-1.5 text-text-secondary">{r.lengthIn}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
  return (
    <div className="sp-card p-4">
      <div className="flex gap-2 mb-3" role="tablist" aria-label="Garment">
        {(['tshirt', 'hoodie'] as const).map((g) => (
          <button
            key={g}
            role="tab"
            aria-selected={garment === g}
            onClick={() => setGarment(g)}
            className={`sp-chip ${garment === g ? 'sp-tint' : ''}`}
          >
            {g === 'tshirt' ? 'T-shirts' : 'Hoodies'}
          </button>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {table('Adult (unisex)', adult)}
        {table('Youth', youth)}
      </div>
      <p className="mt-3 text-xs text-muted">Chest is measured straight across, armpit to armpit, with the shirt laid flat. Length is shoulder to hem. Same numbers as the size chart on each product.</p>
    </div>
  )
}

/** "Still have a question?" for the bottom of every help page. */
export function HelpStrip({ orderNumber }: { orderNumber?: string | null }) {
  const contactTo = orderNumber ? `/contact?topic=order&order=${encodeURIComponent(orderNumber)}` : '/contact'
  return (
    <section className="sp-root mx-auto max-w-4xl px-4 sm:px-6 my-10">
      <div className="sp-banner p-6 sm:p-8">
        <img src="/support/door-chat.webp" alt="" className="sp-banner-img hidden sm:block" style={{ objectPosition: '50% 70%' }} />
        <div className="relative z-10 max-w-md">
          <h2 className="font-display text-3xl text-text">{orderNumber ? 'A question about this order?' : 'Still have a question?'}</h2>
          <p className="mt-2 text-text-secondary">
            {orderNumber ? `Message us and we will look up ${orderNumber} for you.` : 'Christina and the team read every message, usually within a day.'}
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" onClick={() => openShopChat()} className="sp-btn"><MessageCircle className="w-4 h-4" /> Chat with us</button>
            <Link to={contactTo} className="sp-btn-ghost"><Send className="w-4 h-4" /> Send a message</Link>
          </div>
          {!orderNumber && (
            <p className="mt-4 text-sm"><Link to="/help" className="text-primary font-semibold hover:underline">Browse quick answers</Link></p>
          )}
        </div>
      </div>
    </section>
  )
}
