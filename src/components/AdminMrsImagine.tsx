import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, ExternalLink, RefreshCw, ShieldAlert } from 'lucide-react'
import { mrsImagine, type ScoutPick, type ScoutRun } from '../lib/api'

// Mrs. Imagine's card — her daily SCOUT board (David 2026-09-09: "mrs imagine
// is a scout she finds great designs that are selling she needs to verify they
// are selling she drops a list of her top 10 everyday and i just have to click
// on it it goes to step flow").
//
// WHAT USED TO BE HERE: a "Run a batch" button that sent her off to design,
// mock up, QA and queue 15 products unattended. David killed that behaviour on
// 2026-09-02; the button outlived the decision and the last press drained the
// OpenAI wallet to a 429 without shipping a thing. It is gone, and so is the
// route behind it.
//
// The number on every row is VERIFIED SALES: Etsy only accepts a review from
// the buyer of that listing, so a review count inside the window is a count of
// real purchases. About one buyer in three leaves one, so it reads as a floor —
// "at least this many" — and the copy here never rounds that up into a claim
// the data can't carry.

const KIND_LABEL: Record<ScoutPick['kind'], string> = {
  tshirt: 'T-Shirt',
  hoodie: 'Hoodie',
  'youth-tshirt': 'Kids Tee',
  metal: 'Metal print',
}

const relativeTime = (iso: string): string => {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (!Number.isFinite(mins)) return ''
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/** One pitched theme. The receipts sit under a disclosure so the row stays
 *  scannable — David reads ten of these, he shouldn't have to read thirty
 *  listing titles to find the one he wants to build. */
function PickRow({ pick, onBuild }: { pick: ScoutPick; onBuild: (pick: ScoutPick) => void }) {
  const [showProof, setShowProof] = useState(false)
  return (
    <li className="border border-slate-100 rounded-xl p-3 hover:border-fuchsia-200 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-slate-900">{pick.theme}</span>
            <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">
              {KIND_LABEL[pick.kind]}
            </span>
            {!pick.gate.pass && (
              <span
                className="text-[11px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 inline-flex items-center gap-1"
                title={pick.gate.reasons.join(', ')}
              >
                <ShieldAlert className="w-3 h-3" /> copyright check
              </span>
            )}
          </div>
          <p className="text-sm text-slate-600 mt-1">{pick.idea}</p>
          <p className="text-xs text-slate-400 mt-1">{pick.angle}</p>
        </div>
        <button
          onClick={() => onBuild(pick)}
          className="shrink-0 px-3 py-1.5 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-700 text-white text-sm font-semibold inline-flex items-center gap-1.5 transition-colors"
        >
          Build it <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex items-center gap-3 mt-2 text-xs">
        <span className="font-semibold text-emerald-700">
          {pick.verifiedSales} verified sale{pick.verifiedSales === 1 ? '' : 's'}
        </span>
        {pick.medianPriceUsd > 0 && (
          <span className="text-slate-500">market price ${pick.medianPriceUsd.toFixed(2)}</span>
        )}
        <button
          onClick={() => setShowProof((v) => !v)}
          className="text-slate-400 hover:text-slate-700 underline"
        >
          {showProof ? 'hide proof' : `proof (${pick.evidence.length})`}
        </button>
      </div>

      {showProof && (
        <ul className="mt-2 space-y-1 border-t border-slate-100 pt-2">
          {pick.evidence.map((e) => (
            <li key={e.url} className="text-xs text-slate-500 flex items-start gap-2">
              <a
                href={e.url}
                target="_blank"
                rel="noreferrer"
                className="text-slate-600 hover:text-fuchsia-700 inline-flex items-center gap-1 min-w-0"
              >
                <span className="truncate max-w-[26rem]">{e.title}</span>
                <ExternalLink className="w-3 h-3 shrink-0" />
              </a>
              <span className="shrink-0">
                {e.verifiedSales} sold · ${e.priceUsd.toFixed(2)}
                {e.shopSoldCount ? ` · shop ${e.shopSoldCount.toLocaleString()} lifetime` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

export default function AdminMrsImagine() {
  const navigate = useNavigate()
  const [run, setRun] = useState<ScoutRun | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const { run } = await mrsImagine.scout()
      setRun(run)
    } catch {
      // Card stays quiet if the route isn't deployed yet — the frontend and
      // the API deploy independently (see memory: Vercel/Render deploy skew).
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const sweep = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const { run } = await mrsImagine.runScout()
      setRun(run)
      if (run.status === 'failed') setMessage(run.error || 'Scout failed')
    } catch (e: any) {
      setMessage(e.message)
    } finally {
      setBusy(false)
    }
  }

  /** Click-through: Step 1 of the flow, pre-filled with her idea. Nothing is
   *  generated by the navigation itself — David still approves every step. */
  const build = (pick: ScoutPick) => {
    const params = new URLSearchParams({ mode: 'steps', idea: pick.idea, kind: pick.kind })
    navigate(`/admin/ai/products/create?${params.toString()}`)
  }

  const picks = run?.output?.picks ?? []
  const output = run?.output

  return (
    <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <img
            src="/mrs-imagine/mrs-imagine-head.png"
            alt="Mrs. Imagine"
            className="w-16 h-16 object-contain"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
          <div>
            <h3 className="text-lg font-display font-bold text-slate-900">Mrs. Imagine — Scout</h3>
            <p className="text-sm text-slate-500">
              Every morning she sweeps Etsy, keeps only designs with{' '}
              <span className="font-semibold">proven buyers</span>, and pitches ten. Click one and it
              opens in the Step Flow. She never builds anything herself.
            </p>
          </div>
        </div>
        <button
          onClick={sweep}
          disabled={busy}
          className="shrink-0 px-4 py-2 rounded-xl bg-fuchsia-600 hover:bg-fuchsia-700 disabled:opacity-50 text-white font-semibold transition-colors inline-flex items-center gap-2"
          title="Sweep Etsy again now. Read-only — no designs, no spend."
        >
          <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />
          {busy ? 'Scouting…' : 'Scout now'}
        </button>
      </div>

      {message && <p className="mt-3 text-sm text-red-600">{message}</p>}

      {run && (
        <div className="flex items-center gap-2 text-xs mt-4">
          <span
            className={`px-2 py-0.5 rounded-full font-semibold ${
              run.status === 'running'
                ? 'bg-blue-100 text-blue-800'
                : run.status === 'succeeded'
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-red-100 text-red-700'
            }`}
          >
            {run.status}
          </span>
          <span className="text-slate-400">{relativeTime(run.created_at)}</span>
          {output && (
            <span className="text-slate-400">
              · {output.proven} of {output.verified} listings proved a sale in the last {output.windowDays} days
            </span>
          )}
          {run.error && <span className="text-red-600 truncate">{run.error}</span>}
        </div>
      )}

      {picks.length > 0 ? (
        <>
          <ul className="mt-3 space-y-2">
            {picks.map((p) => (
              <PickRow key={p.id} pick={p} onBuild={build} />
            ))}
          </ul>
          <p className="text-[11px] text-slate-400 mt-3">
            "Verified sales" counts buyer reviews on the source listings in the last{' '}
            {output?.windowDays ?? 90} days. Only a buyer can review on Etsy, and roughly one in three
            does — so the real number is higher, never lower.
          </p>
        </>
      ) : (
        <p className="mt-4 text-sm text-slate-400">
          {run?.status === 'failed'
            ? 'Her last sweep failed — hit Scout now to retry.'
            : 'No list yet. She sweeps every morning, or hit Scout now.'}
        </p>
      )}
    </div>
  )
}
