import React, { useState, useEffect } from 'react'
import {
  TrendingUp,
  RefreshCw,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  Calendar,
  Layers,
  ArrowUpRight,
  Info,
  HelpCircle
} from 'lucide-react'
import { tryonApi } from '../lib/api'
import { useToast } from '../hooks/useToast'

interface CohortData {
  shoppers: number
  addToCarts: number
  addToCartRatePct: number
  purchases: number
}

interface TryOnAnalytics {
  windowDays: number
  since: string
  fashnCostPerCreditUsd: number
  cohorts: {
    usedTryOn: CohortData
    noTryOn: CohortData
  }
  liftPct: number
  runs: {
    total: number
    completed: number
    failed: number
    free: number
    paid: number
  }
  spend: {
    totalUsd: number
    itcRevenue: number
    itcRevenueUsd: number
    netUsd: number
    costPerCompletedRunUsd: number
    costPerIncrementalAddToCartUsd: number | null
  }
  incrementalAddToCarts: number
  breakevenUsdPerRun: number
  valuePerAddToCartUsd: number
  usingMeasuredValue: boolean
  breakevenIncrementalCartsPer100Runs: number
  actualIncrementalCartsPer100Runs: number
  verdict: 'keep' | 'kill' | 'insufficient-data'
  verdictReason: string
}

export default function AdminVirtualTryOnReport() {
  const toast = useToast()
  const [days, setDays] = useState<number>(30)
  const [data, setData] = useState<TryOnAnalytics | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAnalytics = async (windowDays: number) => {
    try {
      setLoading(true)
      setError(null)
      const res = await tryonApi.getAnalytics(windowDays)
      setData(res as TryOnAnalytics)
    } catch (err: any) {
      console.error('[tryon-analytics] failed:', err)
      setError(err?.message || 'Failed to load try-on analytics.')
      toast.error('Load Failed', 'Could not load virtual try-on conversion report.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAnalytics(days)
  }, [days])

  if (loading && !data) {
    return (
      <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-8 flex flex-col items-center justify-center min-h-[300px]">
        <RefreshCw className="w-8 h-8 text-purple-600 animate-spin mb-4" />
        <p className="text-slate-500 font-medium">Loading try-on analytics...</p>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-8 text-center">
        <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h4 className="text-lg font-bold text-slate-900 mb-2">Failed to Load Report</h4>
        <p className="text-slate-600 mb-4">{error}</p>
        <button
          onClick={() => fetchAnalytics(days)}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-medium shadow-lg shadow-purple-500/20 transition-all inline-flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" /> Retry
        </button>
      </div>
    )
  }

  if (!data) return null

  const { cohorts, spend, runs, liftPct, verdict, verdictReason, valuePerAddToCartUsd, usingMeasuredValue } = data

  const getVerdictStyle = (v: typeof verdict) => {
    switch (v) {
      case 'keep':
        return {
          bg: 'bg-emerald-50 border-emerald-200 text-emerald-900',
          badgeBg: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
          icon: <CheckCircle2 className="w-6 h-6 text-emerald-600 flex-shrink-0" />,
          label: 'KEEP FEATURE'
        }
      case 'kill':
        return {
          bg: 'bg-rose-50 border-rose-200 text-rose-900',
          badgeBg: 'bg-rose-100 text-rose-800 border border-rose-200',
          icon: <AlertTriangle className="w-6 h-6 text-rose-600 flex-shrink-0" />,
          label: 'KILL FEATURE'
        }
      case 'insufficient-data':
      default:
        return {
          bg: 'bg-amber-50 border-amber-200 text-amber-900',
          badgeBg: 'bg-amber-100 text-amber-800 border border-amber-200',
          icon: <Info className="w-6 h-6 text-amber-600 flex-shrink-0" />,
          label: 'INSUFFICIENT DATA'
        }
    }
  }

  const vStyle = getVerdictStyle(verdict)

  return (
    <div className="space-y-6">
      {/* Title Bar */}
      <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h3 className="text-xl font-display font-bold text-slate-900 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-600" /> Virtual Try-On Conversion Report
          </h3>
          <p className="text-sm text-slate-500 mt-1">
            Analyzing cohort add-to-cart lift vs FASHN usage costs since {new Date(data.since).toLocaleDateString()}
          </p>
        </div>

        <div className="flex items-center gap-3 self-end sm:self-auto">
          {/* Time Window Buttons */}
          <div className="bg-slate-100 p-1 rounded-xl flex gap-1 border border-slate-200">
            {[7, 14, 30, 90].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  days === d
                    ? 'bg-white text-slate-900 shadow-sm border border-slate-200/50'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {d}D
              </button>
            ))}
          </div>

          <button
            onClick={() => fetchAnalytics(days)}
            disabled={loading}
            className="p-2.5 text-slate-500 hover:text-slate-800 hover:bg-slate-50 border border-slate-200 rounded-xl transition-all disabled:opacity-50"
            title="Refresh Report"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Verdict Banner */}
      <div className={`border rounded-2xl p-5 ${vStyle.bg} flex items-start gap-4 shadow-sm`}>
        {vStyle.icon}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-extrabold px-2.5 py-0.5 rounded-full ${vStyle.badgeBg}`}>
              {vStyle.label}
            </span>
            <span className="text-xs text-slate-500 font-semibold">
              Economics Decision Gateway
            </span>
          </div>
          <p className="text-sm font-semibold leading-relaxed">
            {verdictReason}
          </p>
        </div>
      </div>

      {/* Primary Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* FASHN Spend */}
        <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-6 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-start mb-2">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">FASHN API Spend</span>
              <span className="p-1.5 bg-red-50 text-red-600 rounded-lg">
                <DollarSign className="w-4 h-4" />
              </span>
            </div>
            <h4 className="text-3xl font-extrabold text-slate-900">
              ${spend.totalUsd.toFixed(2)}
            </h4>
          </div>
          <div className="text-xs text-slate-500 mt-4 border-t border-slate-50 pt-2 flex justify-between">
            <span>Runs: {runs.total}</span>
            <span>Fails: {runs.failed} (free)</span>
          </div>
        </div>

        {/* ITC Recovered */}
        <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-6 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-start mb-2">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">ITC Recovered</span>
              <span className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg">
                <Layers className="w-4 h-4" />
              </span>
            </div>
            <h4 className="text-3xl font-extrabold text-slate-900">
              ${spend.itcRevenueUsd.toFixed(2)}
            </h4>
          </div>
          <div className="text-xs text-slate-500 mt-4 border-t border-slate-50 pt-2 flex justify-between">
            <span>{spend.itcRevenue} ITC</span>
          </div>
        </div>

        {/* Net Profit/Cost */}
        <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-6 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-start mb-2">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Net Cost</span>
              <span className={`p-1.5 rounded-lg ${spend.netUsd >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                <DollarSign className="w-4 h-4" />
              </span>
            </div>
            <h4 className={`text-3xl font-extrabold ${spend.netUsd >= 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
              {spend.netUsd >= 0 ? '+' : ''}${spend.netUsd.toFixed(2)}
            </h4>
          </div>
          <div className="text-xs text-slate-500 mt-4 border-t border-slate-50 pt-2">
            {spend.netUsd >= 0 ? 'Net profit generated' : 'Net expenditure spent'}
          </div>
        </div>

        {/* Incremental Carts */}
        <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-6 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-start mb-2">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Incremental Carts</span>
              <span className="p-1.5 bg-purple-50 text-purple-600 rounded-lg">
                <ArrowUpRight className="w-4 h-4" />
              </span>
            </div>
            <h4 className="text-3xl font-extrabold text-slate-900">
              +{data.incrementalAddToCarts.toFixed(1)}
            </h4>
          </div>
          <div className="text-xs text-slate-500 mt-4 border-t border-slate-50 pt-2">
            {spend.costPerIncrementalAddToCartUsd 
              ? `$${spend.costPerIncrementalAddToCartUsd.toFixed(2)} per extra cart` 
              : 'N/A cost per extra cart'}
          </div>
        </div>
      </div>

      {/* Cohort Comparison */}
      <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-6">
        <h4 className="text-lg font-display font-bold text-slate-900 mb-6">
          Matched Cohort Performance
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 relative">
          {/* Vertical Separator for Desktop */}
          <div className="hidden md:block absolute left-1/2 top-0 bottom-0 w-px bg-slate-100" />

          {/* Try-On Cohort */}
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h5 className="font-bold text-purple-700 flex items-center gap-1.5 text-sm">
                <span className="w-2.5 h-2.5 rounded-full bg-purple-600" /> Used Try-On Cohort
              </h5>
              <span className="text-xs text-slate-500 font-semibold">Saw & Used Try-on</span>
            </div>

            <div className="bg-purple-50/40 border border-purple-100/50 rounded-xl p-5 grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-2xl font-extrabold text-purple-900">{cohorts.usedTryOn.shoppers}</div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">Shoppers</div>
              </div>
              <div>
                <div className="text-2xl font-extrabold text-purple-900">{cohorts.usedTryOn.addToCarts}</div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">Carts</div>
              </div>
              <div>
                <div className="text-2xl font-extrabold text-purple-950">{cohorts.usedTryOn.purchases}</div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">Purchases</div>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 bg-purple-50/20 border border-dashed border-purple-200 rounded-xl">
              <span className="text-xs text-slate-600 font-semibold">Add-to-Cart Conversion Rate:</span>
              <span className="text-xl font-black text-purple-800">{cohorts.usedTryOn.addToCartRatePct}%</span>
            </div>
          </div>

          {/* Control Cohort */}
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h5 className="font-bold text-slate-600 flex items-center gap-1.5 text-sm">
                <span className="w-2.5 h-2.5 rounded-full bg-slate-400" /> Control Cohort (No Try-On)
              </h5>
              <span className="text-xs text-slate-500 font-semibold">Saw Card & Skipped</span>
            </div>

            <div className="bg-slate-50 border border-slate-100 rounded-xl p-5 grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-2xl font-extrabold text-slate-700">{cohorts.noTryOn.shoppers}</div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">Shoppers</div>
              </div>
              <div>
                <div className="text-2xl font-extrabold text-slate-700">{cohorts.noTryOn.addToCarts}</div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">Carts</div>
              </div>
              <div>
                <div className="text-2xl font-extrabold text-slate-800">{cohorts.noTryOn.purchases}</div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">Purchases</div>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 bg-slate-50/50 border border-dashed border-slate-200 rounded-xl">
              <span className="text-xs text-slate-600 font-semibold">Add-to-Cart Conversion Rate:</span>
              <span className="text-xl font-black text-slate-700">{cohorts.noTryOn.addToCartRatePct}%</span>
            </div>
          </div>
        </div>

        {/* Lift Callout */}
        <div className="mt-8 border-t border-slate-100 pt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-lg ${
              liftPct > 0 ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-600'
            }`}>
              {liftPct > 0 ? `+${liftPct}` : liftPct}%
            </div>
            <div>
              <div className="font-bold text-slate-900 text-sm">Measured Cart Lift Percentage Points</div>
              <div className="text-xs text-slate-500 mt-0.5">
                Difference in add-to-cart rate between the two cohorts
              </div>
            </div>
          </div>

          <div className="text-xs text-slate-400 font-semibold text-right">
            Cohorts matched via 40%+ card viewport visibility to exclude selection bias
          </div>
        </div>
      </div>

      {/* Break-even Economics Analysis */}
      <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-6">
        <h4 className="text-lg font-display font-bold text-slate-900 mb-4 flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-purple-600" /> Break-Even Economics Analysis
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="border border-slate-100 p-4 rounded-xl space-y-1 bg-slate-50/30">
            <div className="text-xs text-slate-500 font-semibold">Cost Bar per Run</div>
            <div className="text-lg font-bold text-slate-800">${data.breakevenUsdPerRun.toFixed(3)} USD</div>
            <p className="text-[11px] text-slate-400">
              Breakeven target cost per completed render run
            </p>
          </div>

          <div className="border border-slate-100 p-4 rounded-xl space-y-1 bg-slate-50/30">
            <div className="text-xs text-slate-500 font-semibold flex items-center gap-1.5">
              Value per Add-to-Cart
              {usingMeasuredValue ? (
                <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded text-[9px] font-bold">
                  MEASURED
                </span>
              ) : (
                <span className="px-1.5 py-0.5 bg-slate-200 text-slate-700 rounded text-[9px] font-bold">
                  ASSUMED
                </span>
              )}
            </div>
            <div className="text-lg font-bold text-slate-800">${valuePerAddToCartUsd.toFixed(2)} USD</div>
            <p className="text-[11px] text-slate-400 leading-normal">
              {usingMeasuredValue 
                ? `Dynamically computed from actual purchases (${cohorts.usedTryOn.purchases} sales) at $13 margin each.` 
                : 'Using the default assumption of $4.00. Requires ≥10 purchases in try-on cohort to use measured data.'}
            </p>
          </div>

          <div className="border border-slate-100 p-4 rounded-xl space-y-1 bg-slate-50/30">
            <div className="text-xs text-slate-500 font-semibold">Breakeven Carts Rate</div>
            <div className="text-lg font-bold text-slate-800">
              {data.breakevenIncrementalCartsPer100Runs}% <span className="text-xs font-normal text-slate-400">vs {data.actualIncrementalCartsPer100Runs}% actual</span>
            </div>
            <p className="text-[11px] text-slate-400">
              Requires {data.breakevenIncrementalCartsPer100Runs} incremental carts per 100 runs to cover expenditures
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
