// ---------------------------------------------------------------------------
// Daily design-performance verdicts (task 47174caa).
//
// Re-maps every live product to its artwork + prompt variant, scores the last
// 30 days of store events and paid orders, and writes each variant's
// prune / refresh / learning / healthy verdict onto
// design_prompt_variants.flag (+ flag_reason, flagged_at) so anything that
// re-prompts or retires designs can read it without opening the dashboard.
// It only marks; it never unpublishes a product.
// ---------------------------------------------------------------------------

import { loadDesignPerformance, persistFlags } from '../services/design-performance.js'

export const DESIGN_PERFORMANCE_SWEEP_HOURS = Math.max(1, Number(process.env.DESIGN_PERFORMANCE_SWEEP_HOURS) || 24)
const WINDOW_DAYS = 30
const FIRST_RUN_DELAY_MS = 5 * 60 * 1000

export async function runDesignPerformanceSweep(
  deps = { load: loadDesignPerformance, persist: persistFlags },
): Promise<{ variants: number; changed: number; flagged: number } | null> {
  try {
    const report = await deps.load(WINDOW_DAYS)
    const changed = await deps.persist(report)
    const flagged = report.variants.filter(v => v.flag === 'prune' || v.flag === 'refresh').length
    console.log(`[design-performance] ${report.variants.length} variants scored, ${flagged} flagged, ${changed} verdicts changed`)
    return { variants: report.variants.length, changed, flagged }
  } catch (error: any) {
    console.error('[design-performance] sweep failed:', error?.message || error)
    return null
  }
}

export function startDesignPerformanceSweep(): void {
  if (process.env.DESIGN_PERFORMANCE_SWEEP_ENABLED === 'false') {
    console.log('[design-performance] disabled (DESIGN_PERFORMANCE_SWEEP_ENABLED=false)')
    return
  }
  console.log(`[design-performance] 🧵 scoring prompt variants every ${DESIGN_PERFORMANCE_SWEEP_HOURS}h over the last ${WINDOW_DAYS} days`)
  setInterval(() => { void runDesignPerformanceSweep() }, DESIGN_PERFORMANCE_SWEEP_HOURS * 60 * 60 * 1000)
  setTimeout(() => { void runDesignPerformanceSweep() }, FIRST_RUN_DELAY_MS)
}
