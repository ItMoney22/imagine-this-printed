import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Printer, Scissors } from 'lucide-react'
import EtsyBagCard from '../../components/etsy-bag/EtsyBagCard'
import { WorkingPanel } from '../../components/studio/shared'
import { apiFetch } from '../../lib/api'
import { ETSY_BAG, type EtsyBagWeek } from '../../../backend/shared/etsy-bag'

// Admin print page for the Etsy bag card (Watchtower task 8cde2a1d):
// preview, print a stack, and the weekly redemption count.
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

export default function EtsyBagCardPage() {
  const [paper, setPaper] = useState<Paper>('card')
  const [weeks, setWeeks] = useState<EtsyBagWeek[] | null>(null)
  const [weeksError, setWeeksError] = useState<string | null>(null)

  useEffect(() => {
    apiFetch('/api/admin/coupons/etsy-bag/weekly?weeks=8')
      .then(data => setWeeks(data.weeks))
      .catch(err => setWeeksError(err instanceof Error ? err.message : 'Could not load the weekly count'))
  }, [])

  const print = (next: Paper) => {
    setPaper(next)
    // Let the @page rule for this paper land before the print dialog reads it.
    setTimeout(() => window.print(), 60)
  }

  const totals = (weeks || []).reduce(
    (t, w) => ({ redemptions: t.redemptions + w.redemptions, sales: t.sales + w.sales, qrOrders: t.qrOrders + w.qrOrders }),
    { redemptions: 0, sales: 0, qrOrders: 0 }
  )

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <style>{printCss(paper)}</style>

      <header className="mb-6">
        <p className="text-sm font-semibold uppercase tracking-widest text-primary">Etsy orders</p>
        <h1 className="mt-1 font-display text-3xl font-bold text-text">Etsy bag card</h1>
        <p className="mt-2 max-w-2xl text-text-secondary">
          A 4×6 thank-you card with the code <strong className="text-text">{ETSY_BAG.code}</strong> ({ETSY_BAG.percentOff}% off a
          first order on our site, one per customer) and a QR code to the site. Print a stack and drop one in every Etsy order.
        </p>
      </header>

      {ETSY_BAG.onHoldForEtsyPolicy && (
        <div role="note" className="mb-8 flex gap-3 rounded-2xl border border-accent bg-bg-warm p-4 sm:p-5">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
          <div className="text-sm text-text-secondary">
            <p className="font-semibold text-text">On hold: don't put these in Etsy bags yet.</p>
            <p className="mt-1">
              Etsy's rules (updated October 5, 2026) say sellers may not offer discounts for buying off Etsy or use a QR code
              that sends Etsy buyers off Etsy. This card does both, and breaking that rule can put the Etsy shop at risk.
              David decides whether these go out as they are, change to an Etsy-safe card, or wait.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,4in)_minmax(0,1fr)]">
        {/* Preview */}
        <div>
          <div className="mx-auto w-full max-w-[4in] overflow-hidden rounded-2xl shadow-soft-xl ring-1 ring-border">
            <EtsyBagCard />
          </div>
          <p className="mt-3 text-center text-xs text-muted">Actual size: 4 × 6 inches</p>
        </div>

        <div className="min-w-0 space-y-8">
          {/* Print */}
          <section>
            <h2 className="font-display text-xl font-bold text-text">Print a stack</h2>
            <ol className="mt-3 space-y-2 text-sm text-text-secondary">
              <li>
                <span className="font-semibold text-text">1.</span> Pick your paper below. In the print box, set how many copies you want
                and turn off headers and footers.
              </li>
              <li>
                <span className="font-semibold text-text">2.</span> On letter paper, cut along the dashed lines.
              </li>
              <li>
                <span className="font-semibold text-text">3.</span> Drop one card in every Etsy order as you pack it.
              </li>
            </ol>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => print('card')}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-secondary px-5 py-3 font-semibold text-white shadow-glow transition-transform hover:scale-[1.02] active:scale-[0.99]"
              >
                <Printer className="h-5 w-5" aria-hidden />
                Print on 4×6 cards
              </button>
              <button
                type="button"
                onClick={() => print('letter')}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-primary px-5 py-3 font-semibold text-primary transition-colors hover:bg-bg-warm"
              >
                <Scissors className="h-5 w-5" aria-hidden />
                Print on letter paper (2 per sheet)
              </button>
            </div>
          </section>

          {/* Weekly count */}
          <section>
            <h2 className="font-display text-xl font-bold text-text">Redemptions, week by week</h2>
            <p className="mt-1 text-sm text-text-secondary">
              Paid orders that used {ETSY_BAG.code}, and paid orders that came in through the card's QR code. Weeks start Monday.
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
                    { label: 'Orders from the QR', value: String(totals.qrOrders) }
                  ].map(stat => (
                    <div key={stat.label} className="rounded-xl border border-border bg-card p-3">
                      <p className="text-xs text-muted">{stat.label}</p>
                      <p className="mt-1 text-xl font-bold text-text tabular-nums">{stat.value}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-card">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead className="bg-bg-warm text-left text-xs uppercase tracking-wide text-muted">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Week of</th>
                        <th className="px-3 py-2 text-right font-semibold">Redeemed</th>
                        <th className="px-3 py-2 text-right font-semibold">Sales</th>
                        <th className="px-3 py-2 text-right font-semibold">Discount</th>
                        <th className="px-3 py-2 text-right font-semibold">From QR</th>
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
                          <td className="px-3 py-2 text-right tabular-nums">{w.qrOrders}</td>
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

      {createPortal(
        <div id={PRINT_SHEET_ID}>
          {paper === 'card' ? (
            <div className="w-[4in]">
              <EtsyBagCard />
            </div>
          ) : (
            <div className="flex w-[8in]">
              {[0, 1].map(i => (
                <div key={i} className="w-[4in] border border-dashed border-muted">
                  <EtsyBagCard />
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
