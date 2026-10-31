// Product link key -> product row, for /product/:id and the /p/:code short
// link Share hands out. Walks the same lookup plan as the bot renderer
// (api/_seo/share-link.mjs lookupPlan), so a link that unfurls also opens.
//
// id and slug steps carry no status filter: row-level security already limits
// the public to published products, and owners/staff may open their drafts.
// A replacement must itself be live, or the old link would land on a draft.

import { supabase } from './supabase'
import { lookupPlan, type LookupStep } from '../../api/_seo/share-link.mjs'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ProductRow = { id: string; slug?: string | null } & Record<string, any>

export interface ProductLookup {
  row: ProductRow
  /** Found through metadata.replaces: the link was for a product this one took over. */
  replaced: boolean
}

function queryFor(step: LookupStep) {
  const q = supabase.from('products').select('*')
  if (step.kind === 'idRange') return q.gte('id', step.lo).lte('id', step.hi)
  if (step.kind === 'id') return q.eq('id', step.id)
  if (step.kind === 'slug') return q.eq('slug', step.slug)
  return q.contains('metadata', { replaces: [step.value] }).eq('status', 'active')
}

/** The product a link key points at, or null when nothing (live) answers to it. Throws on a failed read. */
export async function findProductByKey(key: string, opts: { short: boolean }): Promise<ProductLookup | null> {
  for (const step of lookupPlan(key, opts)) {
    const { data, error } = await queryFor(step).order('created_at', { ascending: false }).limit(1)
    if (error) throw error
    const row = (data as ProductRow[] | null)?.[0]
    if (row) return { row, replaced: step.kind === 'replaces' }
  }
  return null
}
