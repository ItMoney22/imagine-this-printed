// Her discount codes in the store manager (David 2026-10-26: "she should be able to give a discount to her peeps but
// whatever she does cuts at her own cost"). Percent or dollars off, an optional last day, on/off, edit. Buyers type a
// code in her cart; whatever it takes off comes out of her share only, and checkout refuses a code that would reach
// into ITP's (backend/lib/vendor-store-split.ts). The API is backend/routes/vendor-store-discounts.ts.
import { useCallback, useEffect, useState } from 'react'
import { Pencil, TicketPercent } from 'lucide-react'
import { vendorStoreApi, type DiscountCode, type DiscountCodeInput, type DiscountKind } from '../../lib/vendor-store'

const cleanError = (e: any) => String(e?.message || e).replace(/^HTTP \d+: /, '').replace(/^\{"error":"(.*)"\}$/, '$1')
const cents = (v: string) => Math.round(Number(v.replace(/[^0-9.]/g, '')) * 100)
/** 2026-11-30 -> Nov 30 (the date as she picked it, whatever this browser's time zone). */
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const label = (c: Pick<DiscountCode, 'kind' | 'amount'>) => (c.kind === 'percent' ? `${c.amount}% off` : `$${(c.amount / 100).toFixed(2)} off`)

type Draft = { code: string; kind: DiscountKind; amount: string; endsOn: string }
const blank: Draft = { code: '', kind: 'percent', amount: '', endsOn: '' }
const draftOf = (c: DiscountCode): Draft => ({ code: c.code, kind: c.kind, amount: c.kind === 'percent' ? String(c.amount) : (c.amount / 100).toFixed(2), endsOn: c.endsOn || '' })
const inputOf = (d: Draft): DiscountCodeInput => ({
  code: d.code.trim(),
  kind: d.kind,
  amount: d.kind === 'percent' ? Math.round(Number(d.amount)) : cents(d.amount),
  endsOn: d.endsOn || null,
})

export default function StoreDiscounts({ slug, onToast }: { slug: string; onToast: (m: string) => void }) {
  const [codes, setCodes] = useState<DiscountCode[] | null>(null)
  const [today, setToday] = useState('')
  const [error, setError] = useState('')
  const [draft, setDraft] = useState<Draft>(blank)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)

  const load = useCallback(() => {
    vendorStoreApi.discounts(slug)
      .then(r => { setCodes(r.codes); setToday(r.today); setError('') })
      .catch(() => setError('Your codes didn’t load.'))
  }, [slug])
  useEffect(load, [load])

  const create = async () => {
    setBusy(true)
    try {
      const { code } = await vendorStoreApi.addDiscount(slug, inputOf(draft))
      onToast(`${code.code} is ready to share`)
      setDraft(blank)
      load()
    } catch (e) {
      onToast(cleanError(e))
    } finally {
      setBusy(false)
    }
  }
  const save = async (id: string, patch: Partial<DiscountCodeInput>, done: string) => {
    try {
      await vendorStoreApi.saveDiscount(slug, id, patch)
      onToast(done)
      setEditing(null)
      load()
    } catch (e) {
      onToast(cleanError(e))
    }
  }

  return (
    <section id="discounts" className="rounded-3xl bg-white border border-[var(--vs-line)] p-4 sm:p-6 scroll-mt-44 md:scroll-mt-28">
      <div className="flex items-center gap-3 mb-2">
        <span className="w-10 h-10 rounded-full grid place-items-center text-white shrink-0" style={{ background: 'var(--vs-primary)' }}><TicketPercent className="w-5 h-5" /></span>
        <h2 className="vs-display text-2xl sm:text-3xl leading-tight">Discount codes</h2>
      </div>
      <p className="text-[var(--vs-muted)] mb-5">Give your people a deal. Whatever a code takes off comes out of your share. Our price to you and shipping stay the same.</p>

      <div className="rounded-2xl bg-[var(--vs-page)] border border-[var(--vs-line)] p-3 sm:p-4">
        <p className="font-semibold mb-3">Make a code</p>
        <CodeFields draft={draft} onChange={setDraft} today={today} />
        <button disabled={busy || !draft.code.trim() || !draft.amount.trim()} onClick={create} className="vs-btn-pink rounded-xl h-11 px-6 font-semibold mt-3 w-full sm:w-auto">
          {busy ? 'Saving…' : 'Make code'}
        </button>
      </div>

      <div className="mt-5 flex flex-col gap-3">
        {error && <p className="text-sm text-[var(--vs-pink)]">{error}</p>}
        {codes?.length === 0 && <p className="text-[var(--vs-muted)]">No codes yet. Make your first one above, then share it with your people.</p>}
        {codes?.map(c => {
          const ended = !!c.endsOn && !!today && c.endsOn < today
          if (editing === c.id) return <EditRow key={c.id} code={c} today={today} onCancel={() => setEditing(null)} onSave={d => save(c.id, inputOf(d), 'Code saved')} />
          return (
            <div key={c.id} className="rounded-2xl border border-[var(--vs-line)] p-3 sm:p-4 flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="font-mono font-bold tracking-wider text-[var(--vs-primary)] bg-[var(--vs-page)] rounded-lg px-3 py-1.5">{c.code}</span>
              <span className="font-semibold">{label(c)}</span>
              <span className={`text-sm ${ended ? 'text-[var(--vs-pink)] font-medium' : 'text-[var(--vs-muted)]'}`}>
                {c.endsOn ? `${ended ? 'Ended' : 'Last day'} ${day(c.endsOn)}` : 'No end date'}
              </span>
              <span className="ml-auto flex items-center gap-3">
                <button className="flex items-center gap-1 text-sm font-medium text-[var(--vs-primary)]" onClick={() => setEditing(c.id)} aria-label={`Edit ${c.code}`}>
                  <Pencil className="w-4 h-4" /> Edit
                </button>
                <span className="flex items-center gap-2 text-sm">
                  <button role="switch" aria-checked={c.active} aria-label={`${c.code} on`} onClick={() => save(c.id, { active: !c.active }, c.active ? `${c.code} is off` : `${c.code} is on`)}
                    className={`w-12 h-7 rounded-full p-1 transition-colors ${c.active ? 'bg-[var(--vs-green)]' : 'bg-gray-300'}`}>
                    <span className={`block w-5 h-5 rounded-full bg-white shadow transition-transform ${c.active ? 'translate-x-5' : ''}`} />
                  </button>
                  <span className="w-7">{c.active ? 'On' : 'Off'}</span>
                </span>
              </span>
            </div>
          )
        })}
      </div>
      <p className="text-xs text-[var(--vs-muted)] mt-4">A code can’t take an order below what Imagine This Printed keeps on it. If it would, checkout asks the buyer to pay without it.</p>
    </section>
  )
}

function EditRow({ code, today, onCancel, onSave }: { code: DiscountCode; today: string; onCancel: () => void; onSave: (d: Draft) => void }) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(code))
  return (
    <div className="rounded-2xl border-2 border-[var(--vs-primary)]/40 p-3 sm:p-4">
      <CodeFields draft={draft} onChange={setDraft} today={today} />
      <div className="flex gap-2 mt-3">
        <button className="vs-btn-solid rounded-xl h-10 px-5 text-sm font-semibold" onClick={() => onSave(draft)}>Save</button>
        <button className="rounded-xl h-10 px-5 text-sm font-medium border border-[var(--vs-line)]" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

function CodeFields({ draft, onChange, today }: { draft: Draft; onChange: (d: Draft) => void; today: string }) {
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch })
  const box = 'mt-1 w-full rounded-xl border border-[var(--vs-line)] bg-white px-3 h-11 outline-none focus:border-[var(--vs-primary)]'
  return (
    <div className="grid sm:grid-cols-2 xl:grid-cols-[1.2fr_1.3fr_1fr] gap-3 text-sm">
      <label className="font-medium">Code
        <input className={`${box} font-mono uppercase tracking-wider`} placeholder="CRYSTAL20" maxLength={24} value={draft.code}
          onChange={e => set({ code: e.target.value.toUpperCase().replace(/\s+/g, '') })} />
      </label>
      <div className="font-medium">Takes off
        <div className="mt-1 flex gap-2">
          <span className="flex-1 flex items-center rounded-xl border border-[var(--vs-line)] bg-white px-3 h-11 focus-within:border-[var(--vs-primary)]">
            {draft.kind === 'amount' && <span className="text-[var(--vs-muted)]">$</span>}
            <input inputMode="decimal" className="w-full outline-none px-1 bg-transparent" placeholder={draft.kind === 'percent' ? '20' : '5.00'} aria-label="How much off"
              value={draft.amount} onChange={e => set({ amount: e.target.value })} />
            {draft.kind === 'percent' && <span className="text-[var(--vs-muted)]">%</span>}
          </span>
          <span className="flex rounded-xl border border-[var(--vs-line)] overflow-hidden shrink-0" role="group" aria-label="Percent or dollars off">
            <button type="button" aria-pressed={draft.kind === 'percent'} onClick={() => set({ kind: 'percent' })} className="vs-size px-3 h-11 font-semibold">% off</button>
            <button type="button" aria-pressed={draft.kind === 'amount'} onClick={() => set({ kind: 'amount' })} className="vs-size px-3 h-11 font-semibold border-l border-[var(--vs-line)]">$ off</button>
          </span>
        </div>
      </div>
      <label className="font-medium">Last day <span className="font-normal text-[var(--vs-muted)]">(optional)</span>
        <span className="mt-1 flex gap-2 items-center">
          <input type="date" className={box.replace('mt-1 ', '')} min={today || undefined} value={draft.endsOn} onChange={e => set({ endsOn: e.target.value })} />
          {draft.endsOn && <button type="button" className="text-xs text-[var(--vs-muted)] underline shrink-0" onClick={() => set({ endsOn: '' })}>No end</button>}
        </span>
      </label>
    </div>
  )
}
