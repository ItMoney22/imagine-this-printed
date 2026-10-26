// Her reminders in the store manager (David 2026-10-26: "setup reminders for her through email with her assistant
// reminding her to post etc."). Each one is written fresh by her store assistant when it's due and emailed to her store
// inbox; the switch stops it. API: backend/routes/vendor-store-reminders.ts; the clock: worker/store-reminders-sweep.ts.
// Approved mock: itp-crystal-store-manager-inbox round 1 (Reminders card).
import { useCallback, useEffect, useState } from 'react'
import { Bell, CalendarClock, Instagram, Plus, ShoppingCart, Trash2, X } from 'lucide-react'
import { apiFetch } from '../../lib/api'

type Reminder = {
  id: string
  kind: 'instagram' | 'orders' | 'product' | 'custom'
  title: string
  note: string | null
  days: number[]
  time: string
  schedule: string
  enabled: boolean
  lastSentAt: string | null
}

const path = (slug: string, rest = '') => `/api/vendor-store/manage/${encodeURIComponent(slug)}/reminders${rest}`
const ICONS = { instagram: Instagram, orders: ShoppingCart, product: Plus, custom: Bell }
const COLOURS = { instagram: 'var(--vs-pink)', orders: 'var(--vs-primary)', product: 'var(--vs-green)', custom: 'var(--vs-gold)' }
const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
// Every half hour from 6 AM to 10 PM, Eastern.
const TIMES = Array.from({ length: 33 }, (_, i) => {
  const mins = 6 * 60 + i * 30
  const hh = Math.floor(mins / 60)
  const mm = mins % 60
  return { value: `${String(hh).padStart(2, '0')}:${mm ? '30' : '00'}`, label: `${hh % 12 || 12}${mm ? ':30' : ''} ${hh < 12 ? 'AM' : 'PM'}` }
})

const ago = (iso: string) => {
  const d = new Date(iso)
  const today = new Date()
  return d.toDateString() === today.toDateString() ? `today at ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function StoreReminders({ slug, onToast }: { slug: string; onToast: (m: string) => void }) {
  const [list, setList] = useState<Reminder[] | null>(null)
  const [to, setTo] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(() => {
    apiFetch(path(slug))
      .then((r: { to: string | null; reminders: Reminder[] }) => { setList(r.reminders); setTo(r.to) })
      .catch(() => setList([]))
  }, [slug])
  useEffect(load, [load])

  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn()
      onToast(done)
      load()
    } catch (e: any) {
      onToast(String(e.message).replace(/^HTTP \d+: /, '').replace(/^\{"error":"(.*)"\}$/, '$1'))
    }
  }
  const toggle = (r: Reminder, on: boolean) => {
    setList(l => l && l.map(x => (x.id === r.id ? { ...x, enabled: on } : x)))
    act(() => apiFetch(path(slug, `/${r.id}`), { method: 'PATCH', body: JSON.stringify({ enabled: on }) }), on ? `${r.title}: on` : `${r.title}: off`)
  }

  return (
    <section id="reminders" className="rounded-3xl bg-white border border-[var(--vs-line)] p-4 sm:p-6 scroll-mt-28">
      <h2 className="vs-display text-2xl sm:text-3xl flex items-center gap-3">
        <span className="w-10 h-10 rounded-full grid place-items-center text-white" style={{ background: 'var(--vs-primary)' }}><Bell className="w-5 h-5" /></span>
        Reminders
      </h2>
      <p className="text-sm text-[var(--vs-muted)] mt-2 mb-4">
        Your assistant emails you these at {to ? <span className="font-medium text-[var(--vs-text)]">{to}</span> : 'your store inbox'}, written fresh each time. Times are Eastern.
      </p>

      {!list ? (
        <div className="h-24 grid place-items-center"><div className="w-8 h-8 rounded-full border-2 border-[var(--vs-primary)] border-t-transparent animate-spin" /></div>
      ) : (
        <ul className="divide-y divide-[var(--vs-line)]">
          {list.length === 0 && <li className="py-3 text-[var(--vs-muted)]">No reminders yet. Add one below.</li>}
          {list.map(r => {
            const Icon = ICONS[r.kind]
            return (
              <li key={r.id} className="py-3 flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl grid place-items-center shrink-0 bg-[var(--vs-page)]" style={{ color: COLOURS[r.kind] }}><Icon className="w-5 h-5" /></span>
                <span className="flex-1 min-w-0">
                  <span className={`block font-medium leading-snug ${r.enabled ? '' : 'text-[var(--vs-muted)]'}`}>{r.title}</span>
                  <span className="block text-xs text-[var(--vs-muted)]">
                    {r.schedule}{r.note ? ` · ${r.note}` : ''}{r.lastSentAt ? ` · last sent ${ago(r.lastSentAt)}` : ''}
                  </span>
                </span>
                {r.kind === 'custom' && (
                  <button className="w-9 h-9 grid place-items-center rounded-lg text-[var(--vs-muted)] hover:text-[var(--vs-pink)] hover:bg-[var(--vs-page)]" aria-label={`Delete ${r.title}`}
                    onClick={() => window.confirm(`Delete the “${r.title}” reminder?`) && act(() => apiFetch(path(slug, `/${r.id}`), { method: 'DELETE' }), 'Reminder deleted')}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                <button role="switch" aria-checked={r.enabled} aria-label={`${r.title} reminder`} onClick={() => toggle(r, !r.enabled)}
                  className={`w-12 h-7 rounded-full p-1 shrink-0 transition-colors ${r.enabled ? 'bg-[var(--vs-green)]' : 'bg-gray-300'}`}>
                  <span className={`block w-5 h-5 rounded-full bg-white shadow transition-transform ${r.enabled ? 'translate-x-5' : ''}`} />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {adding ? (
        <AddReminder onCancel={() => setAdding(false)} onSave={body => act(async () => {
          await apiFetch(path(slug), { method: 'POST', body: JSON.stringify(body) })
          setAdding(false)
        }, 'Reminder added')} />
      ) : (
        <button className="vs-btn-pink w-full rounded-xl h-12 font-semibold mt-4 flex items-center justify-center gap-2" onClick={() => setAdding(true)}>
          <Plus className="w-5 h-5" /> Add a reminder
        </button>
      )}
    </section>
  )
}

function AddReminder({ onSave, onCancel }: { onSave: (body: { title: string; days: number[]; time: string; note: string }) => void; onCancel: () => void }) {
  const [title, setTitle] = useState('')
  const [days, setDays] = useState<number[]>([1])
  const [time, setTime] = useState('10:00')
  const [note, setNote] = useState('')
  const [tried, setTried] = useState(false)
  const flip = (d: number) => setDays(ds => (ds.includes(d) ? ds.filter(x => x !== d) : [...ds, d].sort()))
  const ready = !!title.trim() && days.length > 0

  return (
    <div className="mt-4 rounded-2xl border border-[var(--vs-line)] bg-[var(--vs-page)] p-4 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <CalendarClock className="w-5 h-5 text-[var(--vs-primary)]" />
        <p className="font-semibold flex-1">New reminder</p>
        <button className="w-8 h-8 grid place-items-center rounded-lg hover:bg-white" aria-label="Cancel" onClick={onCancel}><X className="w-4 h-4" /></button>
      </div>
      <label className="text-sm font-medium">Remind me to
        <input autoFocus maxLength={80} className="mt-1 w-full rounded-xl border border-[var(--vs-line)] bg-white px-3 h-11 outline-none focus:border-[var(--vs-primary)]"
          placeholder="Eg. Restock the candle holders" value={title} onChange={e => setTitle(e.target.value)} />
      </label>
      <div>
        <p className="text-sm font-medium mb-2 flex items-center justify-between">On
          <button type="button" className="text-sm font-normal text-[var(--vs-primary)] underline" onClick={() => setDays(days.length === 7 ? [1] : [0, 1, 2, 3, 4, 5, 6])}>
            {days.length === 7 ? 'Just Monday' : 'Every day'}
          </button>
        </p>
        {/* Seven across fits a 390px phone: 7 x 36px + 6 gaps. */}
        <div className="flex gap-1.5 sm:gap-2">
          {DAYS.map((d, i) => (
            <button key={i} type="button" aria-pressed={days.includes(i)} aria-label={DAY_NAMES[i]} title={DAY_NAMES[i]} onClick={() => flip(i)}
              className="vs-size w-9 h-9 sm:w-10 sm:h-10 rounded-full border border-[var(--vs-line)] bg-white text-sm font-semibold shrink-0">{d}</button>
          ))}
        </div>
        {tried && !days.length && <p className="text-xs text-[var(--vs-pink)] mt-1">Pick at least one day.</p>}
      </div>
      <div className="grid sm:grid-cols-[160px_1fr] gap-4">
        <label className="text-sm font-medium">At (Eastern)
          <select className="mt-1 w-full rounded-xl border border-[var(--vs-line)] bg-white px-3 h-11" value={time} onChange={e => setTime(e.target.value)}>
            {TIMES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">Anything your assistant should know <span className="font-normal text-[var(--vs-muted)]">(optional)</span>
          <input maxLength={300} className="mt-1 w-full rounded-xl border border-[var(--vs-line)] bg-white px-3 h-11 outline-none focus:border-[var(--vs-primary)]"
            placeholder="Eg. the craft fair is Saturday" value={note} onChange={e => setNote(e.target.value)} />
        </label>
      </div>
      {tried && !title.trim() && <p className="text-xs text-[var(--vs-pink)] -mt-2">Say what to remind you about.</p>}
      <button className="vs-btn-pink rounded-xl h-12 font-semibold" onClick={() => { setTried(true); if (ready) onSave({ title: title.trim(), days, time, note: note.trim() }) }}>
        Save reminder
      </button>
    </div>
  )
}
