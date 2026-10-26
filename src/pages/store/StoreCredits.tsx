// Her ITC credits in the store manager (David 2026-10-26: "if she needs to do image generation, the flow to create a
// shirt ... It'll run off a credit"). Balance + prices from GET /manage/:slug/credits; she buys on /wallet; the doors
// open the AI tools that already charge ITC (Creator Studio's design flow, Imagination Station). Approved mock:
// page_mockup_approvals for itp-crystal-store-manager-extras, round 1.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Clock, ImageIcon, Shirt, Sparkles } from 'lucide-react'
import { vendorStoreApi, type StoreCredits as Credits } from '../../lib/vendor-store'

export default function StoreCredits({ slug, onDesign }: { slug: string; onDesign: () => void }) {
  const [c, setC] = useState<Credits | null>(null)
  useEffect(() => { vendorStoreApi.credits(slug).then(setC).catch(() => setC({ linked: false, balance: null, prices: [], recent: [] })) }, [slug])

  return (
    <div id="credits" className="grid sm:grid-cols-2 xl:grid-cols-[1.15fr_0.8fr_0.8fr_1fr] gap-3 sm:gap-5 scroll-mt-44 md:scroll-mt-28">
      {/* Balance + prices */}
      <div className="vs-card p-4 sm:p-5 flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <span className="w-12 h-12 rounded-full grid place-items-center text-white shrink-0" style={{ background: 'radial-gradient(circle at 35% 30%, #ffe08a, var(--vs-gold) 60%, #c9861a)' }}>
            <Sparkles className="w-6 h-6" />
          </span>
          <h2 className="vs-display text-2xl">Your credits</h2>
        </div>
        <p className="vs-display text-4xl">{c?.balance != null ? `${c.balance.toLocaleString()} ITC` : '—'}</p>
        {c && !c.linked && <p className="text-xs text-[var(--vs-muted)]">Her credits show here once she signs in with her store email.</p>}
        <Link to="/wallet" className="vs-btn-pink rounded-xl h-11 font-semibold grid place-items-center">Buy credits</Link>
        <ul className="text-sm flex flex-col gap-2 mt-1">
          {(c?.prices || []).map(p => (
            <li key={p.label} className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[var(--vs-gold)] shrink-0" />
              <span className="flex-1">{p.label}</span>
              <span className="font-semibold text-[var(--vs-primary)]">{p.itc} ITC</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Doors into the AI tools (they charge ITC themselves) */}
      <Door onClick={onDesign} icon={Shirt} title="Design a shirt" colours={['#8b3fd1', '#5b1d8f']} />
      <Door to="/imagination-station" icon={ImageIcon} title="Make an image" colours={['#1fb5c9', '#0b7f9c']} />

      {/* Recent use */}
      <div className="vs-card p-4 sm:p-5">
        <h3 className="font-semibold flex items-center gap-2 mb-3"><Clock className="w-5 h-5 text-[var(--vs-primary)]" /> Recent use</h3>
        {!c?.recent.length ? (
          <p className="text-sm text-[var(--vs-muted)]">Nothing yet. What she spends credits on shows up here.</p>
        ) : (
          <ul className="flex flex-col gap-3 text-sm">
            {c.recent.map((r, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="w-8 h-8 rounded-lg bg-[var(--vs-page)] grid place-items-center shrink-0"><Sparkles className="w-4 h-4 text-[var(--vs-primary)]" /></span>
                <span className="flex-1 min-w-0">
                  <span className="block font-medium capitalize truncate">{r.what}</span>
                  <span className="text-xs text-[var(--vs-muted)]">{new Date(r.at).toLocaleDateString()}</span>
                </span>
                <span className={`font-semibold ${r.amount < 0 ? 'text-[var(--vs-pink)]' : 'text-[var(--vs-green)]'}`}>{r.amount > 0 ? '+' : ''}{r.amount} ITC</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function Door({ to, onClick, icon: Icon, title, colours }: { to?: string; onClick?: () => void; icon: typeof Shirt; title: string; colours: [string, string] }) {
  // The design flow opens right on her page (StoreDesign); Make an image still goes to Imagination Station.
  const Tag: any = to ? Link : 'button'
  return (
    <Tag {...(to ? { to } : { type: 'button', onClick })} className="vs-card group relative overflow-hidden p-4 sm:p-5 flex flex-col items-center justify-center gap-4 text-white text-center min-h-48"
      style={{ background: `linear-gradient(160deg, ${colours[0]}, ${colours[1]})`, border: 'none' }}>
      {[[14, 18], [80, 14], [86, 70], [10, 76]].map(([l, t], i) => (
        <Sparkles key={i} className="vs-sparkle w-4 h-4" style={{ left: `${l}%`, top: `${t}%`, animationDelay: `${i * 0.6}s` }} />
      ))}
      <span className="w-20 h-20 rounded-2xl bg-white/15 grid place-items-center transition-transform group-hover:scale-110"><Icon className="w-10 h-10" /></span>
      <span className="vs-display text-xl">{title}</span>
      <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-4 h-9 text-sm font-semibold group-hover:bg-white/30">Open <ArrowRight className="w-4 h-4" /></span>
    </Tag>
  )
}
