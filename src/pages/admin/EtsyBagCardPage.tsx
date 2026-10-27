import { useEffect, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, CheckCircle2, Printer, Scissors } from 'lucide-react'
import EtsyBagCard from '../../components/etsy-bag/EtsyBagCard'
import { WorkingPanel } from '../../components/studio/shared'
import { apiFetch } from '../../lib/api'
import { ETSY_BAG, ETSY_BAG_CARD, checkEtsyShopCoupon, type EtsyBagWeek, type EtsyShopCoupon } from '../../../backend/shared/etsy-bag'

// Admin print page for the Etsy bag card (Watchtower tasks 8cde2a1d, d9a98efc):
// make the Etsy shop promo code, put it on the card, print a stack — plus the
// weekly count for the ETSYBAG website code (pickup, markets, social).
//
// The card carries an Etsy SHOP code only (Etsy's Off-Platform Transactions
// Policy, updated 2026-10-05, bans website discounts and QR codes in Etsy
// orders), so nothing prints until that code is saved here.
//
// Printing renders a separate sheet straight under <body> and hides
// everything else, so the site's header/footer never end up on the card.

type Paper = 'card' | 'letter'

const PRINT_SHEET_ID = 'etsy-bag-print-sheet'

function printCss(paper: Paper): string {
  const page = paper === 'card' ? '@page { size: 4in 6in; margin: 0; }' : '@page { size: letter portrait; margin: 0.25in; }'
  return `
    #${PRINT_SHEET_ID} { display: none; }
    @media print {
      ${page}
      body > *:not(#${PRINT_SHEET_ID}) { display: none !important; }
      #${PRINT_SHEET_ID} { display: block !important; }
    }
  `
}

const money = (n: number) => `$${n.toFixed(2)}`

/** apiFetch throws "HTTP 400: {json}"; show the server's own reason. */
function reasonFrom(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : ''
  const body = msg.replace(/^HTTP \d+:\s*/, '')
  try {
    const parsed = JSON.parse(body)
    if (typeof parsed?.error === 'string') return parsed.error
  } catch {
    /* not JSON */
  }
  return msg || fallback
}

const ETSY_STEPS = [
  'In Etsy, open Shop Manager.',
  'Go to Marketing, then Sales and Discounts, then Create a promo code.',
  `Pick Percentage off. We suggest ${ETSY_BAG_CARD.suggestedPercentOff}% and the code ${ETSY_BAG_CARD.suggestedCode}.`,
  'Choose Add all active listings, and limit it to one use per buyer.',
  'Leave the end date open (or set one far out), then Confirm and create code.'
]

export default function EtsyBagCardPage() {
  const [paper, setPaper] = useState<Paper>('card')
  const [weeks, setWeeks] = useState<EtsyBagWeek[] | null>(null)
  const [weeksError, setWeeksError] = useState<string | null>(null)

  // undefined = still loading; null = no Etsy code saved yet.
  const [saved, setSaved] = useState<EtsyShopCoupon | null | undefined>(undefined)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [codeInput, setCodeInput] = useState('')
  const [percentInput, setPercentInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    apiFetch('/api/admin/coupons/etsy-bag/weekly?weeks=8')
      .then(data => setWeeks(data.weeks))
      .catch(err => setWeeksError(err instanceof Error ? err.message : 'Could not load the weekly count'))
    apiFetch('/api/admin/coupons/etsy-bag/card')
      .then(data => {
        const coupon: EtsyShopCoupon | null = data.coupon ?? null
        setSaved(coupon)
        if (coupon) {
          setCodeInput(coupon.code)
          setPercentInput(String(coupon.percentOff))
        }
      })
      .catch(err => setLoadError(reasonFrom(err, 'Could not load the Etsy code')))
  }, [])

  // The preview shows what is typed as soon as it is a valid Etsy code;
  // printing only ever uses the saved one.
  const draft = checkEtsyShopCoupon({ code: codeInput, percentOff: percentInput })
  const previewCoupon = draft.ok ? draft : saved ?? null
  const unsaved = draft.ok && (!saved || saved.code !== draft.code || saved.percentOff !== draft.percentOff)
  const matchesSaved = draft.ok && Boolean(saved) && !unsaved
  const ready = Boolean(saved) && !unsaved

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setSaveError(null)
    if (!draft.ok) {
      setSaveError(draft.error)
      return
    }
    setSaving(true)
    try {
      const data = await apiFetch('/api/admin/coupons/etsy-bag/card', {
        method: 'PUT',
        body: JSON.stringify({ code: draft.code, percentOff: draft.percentOff })
      })
      setSaved(data.coupon)
      setCodeInput(data.coupon.code)
      setPercentInput(String(data.coupon.percentOff))
    } catch (err) {
      setSaveError(reasonFrom(err, 'Could not save the code'))
    } finally {
      setSaving(false)
    }
  }

  const print = (next: Paper) => {
    if (!ready) return
    setPaper(next)
    // Let the @page rule for this paper land before the print dialog reads it.
    setTimeout(() => window.print(), 60)
  }

  const totals = (weeks || []).reduce(
    (t, w) => ({ redemptions: t.redemptions + w.redemptions, sales: t.sales + w.sales, discount: t.discount + w.discountGiven }),
    { redemptions: 0, sales: 0, discount: 0 }
  )

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <style>{printCss(paper)}</style>

      <header className="mb-6">
        <p className="text-sm font-semibold uppercase tracking-widest text-primary">Etsy orders</p>
        <h1 className="mt-1 font-display text-3xl font-bold text-text">Etsy bag card</h1>
        <p className="mt-2 max-w-2xl text-text-secondary">
          A 4×6 thank-you card for every Etsy order, with a promo code for the buyer's next order in our Etsy shop. It follows
          Etsy's rules: no website discount, no QR code, nothing that sends Etsy buyers off Etsy.
        </p>
      </header>

      {saved === undefined && !loadError && (
        <div className="mb-8">
          <WorkingPanel note="Loading the card" />
        </div>
      )}
      {loadError && (
        <div role="alert" className="mb-8 flex gap-3 rounded-2xl border border-accent bg-bg-warm p-4 sm:p-5">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
          <p className="text-sm text-text-secondary">
            <span className="font-semibold text-text">Couldn't load the Etsy code, so printing is off.</span> {loadError}
          </p>
        </div>
      )}
      {saved === null && (
        <div role="note" className="mb-8 flex gap-3 rounded-2xl border border-accent bg-bg-warm p-4 sm:p-5">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
          <div className="text-sm text-text-secondary">
            <p className="font-semibold text-text">Not ready to print yet: the card needs your Etsy shop code.</p>
            <p className="mt-1">Make the promo code in Etsy (step 1), type it here (step 2), then print (step 3).</p>
          </div>
        </div>
      )}
      {saved && (
        <div role="status" className="mb-8 flex gap-3 rounded-2xl border border-primary bg-bg-warm p-4 sm:p-5">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
          <div className="text-sm text-text-secondary">
            <p className="font-semibold text-text">
              Ready for Etsy orders: the card carries your Etsy code {saved.code} ({saved.percentOff}% off).
            </p>
            <p className="mt-1">It's Etsy-safe: no website discount and no QR code. Drop one in every Etsy order.</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,4in)_minmax(0,1fr)]">
        {/* Preview */}
        <div>
          <div className="mx-auto w-full max-w-[4in] overflow-hidden rounded-2xl shadow-soft-xl ring-1 ring-border">
            <EtsyBagCard coupon={previewCoupon} />
          </div>
          <p className="mt-3 text-center text-xs text-muted">Actual size: 4 × 6 inches</p>
        </div>

        <div className="min-w-0 space-y-8">
          {/* Step 1: make the code in Etsy */}
          <section>
            <h2 className="font-display text-xl font-bold text-text">1. Make the promo code in Etsy</h2>
            <p className="mt-1 text-sm text-text-secondary">Once, about two minutes.</p>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-text-secondary marker:font-semibold marker:text-text">
              {ETSY_STEPS.map(step => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </section>

          {/* Step 2: put it on the card */}
          <section>
            <h2 className="font-display text-xl font-bold text-text">2. Put the code on the card</h2>
            <p className="mt-1 text-sm text-text-secondary">Type it exactly as you made it in Etsy. The card on the left updates as you type.</p>
            <form onSubmit={save} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="flex-1 text-sm font-medium text-text">
                Etsy promo code
                <input
                  value={codeInput}
                  onChange={e => setCodeInput(e.target.value)}
                  placeholder={`e.g. ${ETSY_BAG_CARD.suggestedCode}`}
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={20}
                  className="mt-1 block min-h-[44px] w-full rounded-xl border border-border bg-card px-3 font-semibold uppercase tracking-wide text-text placeholder:font-normal placeholder:normal-case placeholder:tracking-normal placeholder:text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </label>
              <label className="text-sm font-medium text-text sm:w-32">
                % off
                <input
                  value={percentInput}
                  onChange={e => setPercentInput(e.target.value)}
                  inputMode="numeric"
                  placeholder={`e.g. ${ETSY_BAG_CARD.suggestedPercentOff}`}
                  className="mt-1 block min-h-[44px] w-full rounded-xl border border-border bg-card px-3 text-text placeholder:text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </label>
              <button
                type="submit"
                disabled={saving || saved === undefined || matchesSaved}
                className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-gradient-to-r from-primary to-secondary px-5 py-3 font-semibold text-white shadow-glow transition-transform hover:scale-[1.02] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
              >
                {saving ? 'Saving…' : matchesSaved ? 'Saved' : 'Save code'}
              </button>
            </form>
            {saveError && (
              <p role="alert" className="mt-2 text-sm text-accent">
                {saveError}
              </p>
            )}
            {saved && matchesSaved && (
              <p className="mt-2 text-xs text-muted">
                Saved {saved.savedAt ? new Date(saved.savedAt).toLocaleString() : ''}
                {saved.savedBy ? ` by ${saved.savedBy}` : ''}. Change it any time; new prints use the new code.
              </p>
            )}
          </section>

          {/* Step 3: print */}
          <section>
            <h2 className="font-display text-xl font-bold text-text">3. Print a stack</h2>
            <ol className="mt-3 space-y-2 text-sm text-text-secondary">
              <li>Pick your paper below. In the print box, set how many copies you want and turn off headers and footers.</li>
              <li>On letter paper, cut along the dashed lines.</li>
              <li>Drop one card in every Etsy order as you pack it.</li>
            </ol>
            {!ready && saved !== undefined && (
              <p className="mt-3 text-sm font-medium text-accent">
                {unsaved ? 'Save the code first, so the cards print with it.' : 'Printing turns on once the Etsy code is saved.'}
              </p>
            )}
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => print('card')}
                disabled={!ready}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-secondary px-5 py-3 font-semibold text-white shadow-glow transition-transform hover:scale-[1.02] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
              >
                <Printer className="h-5 w-5" aria-hidden />
                Print on 4×6 cards
              </button>
              <button
                type="button"
                onClick={() => print('letter')}
                disabled={!ready}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-primary px-5 py-3 font-semibold text-primary transition-colors hover:bg-bg-warm disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Scissors className="h-5 w-5" aria-hidden />
                Print on letter paper (2 per sheet)
              </button>
            </div>
            <p className="mt-3 text-xs text-muted">Etsy counts uses of your shop code in Shop Manager, under Marketing, Sales and Discounts.</p>
          </section>

          {/* The website code */}
          <section>
            <h2 className="font-display text-xl font-bold text-text">Website code {ETSY_BAG.code}, week by week</h2>
            <p className="mt-1 text-sm text-text-secondary">
              {ETSY_BAG.code} ({ETSY_BAG.percentOff}% off a first order on our website, one per customer) still works. Hand it out at
              pickup, at markets and on social. Never put it in an Etsy order. Paid orders that used it are below; weeks start Monday.
            </p>

            {weeksError && <p className="mt-4 text-sm text-accent">{weeksError}</p>}
            {!weeks && !weeksError && (
              <div className="mt-4">
                <WorkingPanel note="Counting redemptions" />
              </div>
            )}
            {weeks && (
              <>
                <div className="mt-4 grid grid-cols-3 gap-3">
                  {[
                    { label: 'Redeemed', value: String(totals.redemptions) },
                    { label: 'Sales from the code', value: money(totals.sales) },
                    { label: 'Discount given', value: money(totals.discount) }
                  ].map(stat => (
                    <div key={stat.label} className="rounded-xl border border-border bg-card p-3">
                      <p className="text-xs text-muted">{stat.label}</p>
                      <p className="mt-1 text-xl font-bold text-text tabular-nums">{stat.value}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-card">
                  <table className="w-full min-w-[440px] text-sm">
                    <thead className="bg-bg-warm text-left text-xs uppercase tracking-wide text-muted">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Week of</th>
                        <th className="px-3 py-2 text-right font-semibold">Redeemed</th>
                        <th className="px-3 py-2 text-right font-semibold">Sales</th>
                        <th className="px-3 py-2 text-right font-semibold">Discount</th>
                        <th className="px-3 py-2 text-right font-semibold">Unpaid checkouts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {weeks.map(w => (
                        <tr key={w.weekStart} className="border-t border-border-subtle text-text-secondary">
                          <td className="px-3 py-2 font-medium text-text">
                            {new Date(`${w.weekStart}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{w.redemptions}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{money(w.sales)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{money(w.discountGiven)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{w.unpaidCheckouts}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        </div>
      </div>

      {ready &&
        saved &&
        createPortal(
          <div id={PRINT_SHEET_ID}>
            {paper === 'card' ? (
              <div className="w-[4in]">
                <EtsyBagCard coupon={saved} />
              </div>
            ) : (
              <div className="flex w-[8in]">
                {[0, 1].map(i => (
                  <div key={i} className="w-[4in] border border-dashed border-muted">
                    <EtsyBagCard coupon={saved} />
                  </div>
                ))}
              </div>
            )}
          </div>,
          document.body
        )}
    </div>
  )
}
