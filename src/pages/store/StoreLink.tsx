// Her own link in the store manager (David 2026-10-26: "if one of her referrals use her link and buy a shirt she
// gets a cut. She needs her own link to give her stuff."). It is the site's friend link with her store's code
// (imaginethisprinted.com/?ref=CRYSTAL); a paid order through it sends her cut to her payouts
// (backend/services/store-referral.ts). Data rides GET /manage/:slug as `referral`.
import { useEffect, useState } from 'react'
import { Check, Copy, Link2, Share2, Wallet } from 'lucide-react'
import { money, type ManageData, type ReferralStatus } from '../../lib/vendor-store'

const STATUS: Record<ReferralStatus, { label: string; tone: 'green' | 'gold' | 'muted' }> = {
  paid: { label: 'Paid to you', tone: 'green' },
  waiting_percent: { label: 'Waiting', tone: 'gold' },
  waiting_payouts: { label: 'Waiting for payouts', tone: 'gold' },
  failed: { label: 'Waiting', tone: 'gold' },
  nothing: { label: 'No share', tone: 'muted' },
  own_order: { label: 'Your own order', tone: 'muted' },
  reversed: { label: 'Refunded', tone: 'muted' },
  cancelled: { label: 'Refunded', tone: 'muted' },
}
const WAITING: ReferralStatus[] = ['waiting_percent', 'waiting_payouts', 'failed']

export default function StoreLink({ data }: { data: ManageData }) {
  const { referral, payouts } = data
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 2200)
    return () => clearTimeout(t)
  }, [copied])

  if (!referral.link) return null
  const link = referral.link
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
    } catch {
      // Older browsers: select the link so a long-press / Ctrl+C copies it.
      const box = document.getElementById('vs-my-link') as HTMLInputElement | null
      box?.select()
      document.execCommand?.('copy')
    }
    setCopied(true)
  }
  const share = () => navigator.share({ title: data.store.name, text: 'Shirts, gifts and custom prints from Imagine This Printed', url: link }).catch(() => {})

  const paid = referral.orders.filter(o => o.status === 'paid')
  const waiting = referral.orders.filter(o => WAITING.includes(o.status))
  const earned = paid.reduce((n, o) => n + o.cutCents, 0)
  const waitingCents = waiting.reduce((n, o) => n + o.cutCents, 0)

  return (
    <section id="link" className="rounded-3xl bg-white border border-[var(--vs-line)] p-4 sm:p-6 scroll-mt-44 md:scroll-mt-28">
      <h2 className="vs-display text-2xl sm:text-3xl flex items-center gap-3 mb-2">
        <span className="w-10 h-10 rounded-full grid place-items-center text-white" style={{ background: 'var(--vs-pink)' }}><Link2 className="w-5 h-5" /></span>
        Your link
      </h2>
      <p className="text-[var(--vs-muted)] mb-4 max-w-3xl">
        Share it with friends and followers. When someone opens it and buys from Imagine This Printed within 30 days,
        you get {referral.percent != null ? <strong className="text-[var(--vs-text)]">{referral.percent}% of what they spend on products</strong> : 'a share of what they spend on products'}.
        {referral.percent == null && ' Imagine This Printed is setting your share now; buys before then still count.'}
      </p>

      <div className="flex flex-col sm:flex-row gap-3">
        <label className="flex-1 min-w-0 flex items-center gap-2 rounded-xl border-2 border-[var(--vs-primary)]/30 bg-[var(--vs-page)] px-3 h-12 focus-within:border-[var(--vs-primary)]">
          <Link2 className="hidden sm:block w-5 h-5 text-[var(--vs-primary)] shrink-0" />
          {/* Shown without https:// so the whole link fits; Copy and Share send the full link. */}
          <input id="vs-my-link" readOnly value={link.replace(/^https?:\/\//, '')} onFocus={e => e.target.select()} aria-label="Your link" className="w-full min-w-0 bg-transparent outline-none font-semibold text-sm sm:text-base text-[var(--vs-text)]" />
        </label>
        <div className="flex gap-3">
          <button onClick={copy} className="vs-btn-pink flex-[2] sm:flex-none whitespace-nowrap rounded-xl px-4 sm:px-6 h-12 font-semibold inline-flex items-center justify-center gap-2">
            {copied ? <><Check className="w-5 h-5" /> Copied</> : <><Copy className="w-5 h-5" /> Copy my link</>}
          </button>
          {canShare && (
            <button onClick={share} className="vs-btn-solid flex-1 sm:flex-none whitespace-nowrap rounded-xl px-4 sm:px-5 h-12 font-semibold inline-flex items-center justify-center gap-2">
              <Share2 className="w-5 h-5" /> Share
            </button>
          )}
        </div>
      </div>

      {!payouts.ready && (
        <a href="#payouts" className="mt-3 flex items-center gap-2 rounded-xl bg-[var(--vs-gold)]/15 px-3 py-2 text-sm">
          <Wallet className="w-4 h-4 text-[var(--vs-primary)] shrink-0" />
          Set up payouts so your share can reach you. Anything you earn before then waits for you.
        </a>
      )}

      <div className="grid grid-cols-3 gap-3 mt-5">
        <Figure label="Bought through your link" value={String(referral.orders.length)} />
        <Figure label="Paid to you" value={money(earned)} tone="green" />
        <Figure label="Waiting" value={referral.percent == null && waiting.length ? `${waiting.length} order${waiting.length === 1 ? '' : 's'}` : money(waitingCents)} tone="gold" />
      </div>

      {referral.orders.length > 0 && (
        <ul className="mt-4 divide-y divide-[var(--vs-line)] text-sm">
          {referral.orders.slice(0, 6).map(o => {
            const s = STATUS[o.status] ?? STATUS.waiting_percent
            return (
              <li key={o.orderNumber} className="py-3 flex items-center gap-3">
                <span className="flex-1 min-w-0">
                  <span className="block font-medium truncate">{o.orderNumber}</span>
                  <span className="text-xs text-[var(--vs-muted)]">{new Date(o.createdAt).toLocaleDateString()} · {money(o.productsCents)} of products</span>
                </span>
                <span className={`text-xs font-semibold rounded-full px-2 py-1 ${s.tone === 'green' ? 'bg-[var(--vs-green)]/15 text-[var(--vs-green)]' : s.tone === 'gold' ? 'bg-[var(--vs-gold)]/20 text-[var(--vs-text)]' : 'bg-[var(--vs-page)] text-[var(--vs-muted)]'}`}>{s.label}</span>
                <span className="w-16 text-right font-semibold">{o.cutCents > 0 ? money(o.cutCents) : '—'}</span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'gold' }) {
  return (
    <div className="rounded-2xl bg-[var(--vs-page)] p-3 sm:p-4">
      <p className="text-xs sm:text-sm text-[var(--vs-muted)] leading-tight">{label}</p>
      <p className={`vs-display text-xl sm:text-3xl mt-1 ${tone === 'green' ? 'text-[var(--vs-green)]' : ''}`}>{value}</p>
    </div>
  )
}
