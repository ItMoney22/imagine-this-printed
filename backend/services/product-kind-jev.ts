// ---------------------------------------------------------------------------
// Jev's read of WHAT a product is (task 28ab467c). The rules that turn its
// answer into a decision live in shared/product-kind.ts; this file only asks.
//
// Jev reads the product's WORDS — name, the idea it was made from, the
// description, the keywords — and never the category column, product_type or
// garment. Those are the floor it is being measured against; handing them to
// Jev would only teach it to echo the field that might be the misroute.
//
// Rollout is PRODUCT_KIND_JEV: 'shadow' (default — Jev is asked, its verdict
// is logged and stamped, the old heuristics still decide), 'on' (Jev decides
// where it is sure and agrees with the category; disagreements go to a human),
// 'off' (never asked). Bar: PRODUCT_KIND_JEV_MIN_CONFIDENCE, default 0.85.
// Fails open: no key, a timeout or an off-menu answer is "no answer", and the
// floor decides exactly as before.
// ---------------------------------------------------------------------------
import { askJev, readChoice, type JevChoiceQuestion, type JevResult } from './jev.js'
import {
  PRODUCT_KINDS,
  PRODUCT_KIND_CRITERIA,
  PRODUCT_KIND_INSTRUCTIONS,
  PRODUCT_KIND_MIN_CONFIDENCE,
  adminKindOf,
  decideProductKind,
  type JevKindRead,
  type ProductKind,
  type ProductKindDecision,
  type ProductKindInput,
  type ProductKindMode,
} from '../shared/product-kind.js'

export const productKindMode = (): ProductKindMode => {
  const raw = String(process.env.PRODUCT_KIND_JEV ?? '').trim().toLowerCase()
  return raw === 'on' || raw === 'off' ? raw : 'shadow'
}

export const productKindMinConfidence = (): number => {
  const n = Number(process.env.PRODUCT_KIND_JEV_MIN_CONFIDENCE)
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : PRODUCT_KIND_MIN_CONFIDENCE
}

const clean = (v: unknown, max: number): string =>
  String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/** Everything a product row can carry that Jev reads. Loose on purpose: the
 *  callers hand over whatever columns they already selected. */
export interface ProductKindSubject extends ProductKindInput {
  id?: string
  description?: unknown
  search_keywords?: unknown
}

/** The words Jev reads. Undefined fields drop out of the JSON. */
export function buildProductKindState(product: ProductKindSubject): Record<string, unknown> {
  const md = product.metadata ?? {}
  const idea = md.step_flow?.idea || md.original_prompt || md.image_prompt
  return {
    product_name: clean(product.name, 200) || undefined,
    design_idea: clean(idea, 400) || undefined,
    description: clean(product.description, 600) || undefined,
    keywords: clean(product.search_keywords, 300) || undefined,
  }
}

export const hasKindWords = (product: ProductKindSubject): boolean =>
  Object.values(buildProductKindState(product)).some(Boolean)

export function buildProductKindQuestions(): Record<string, JevChoiceQuestion> {
  return {
    product_kind: {
      type: 'choice',
      instructions: PRODUCT_KIND_INSTRUCTIONS,
      criteria: { ...PRODUCT_KIND_CRITERIA },
    },
  }
}

/** Jev's answer read strictly (right type, on the menu, numeric confidence), or null. */
export function readProductKind(result: JevResult | null | undefined): JevKindRead | null {
  const read = readChoice(result, 'product_kind', PRODUCT_KINDS)
  return read ? { choice: read.choice as ProductKind, confidence: read.confidence } : null
}

export type AskProductKind = (product: ProductKindSubject) => Promise<JevResult | null>

const defaultAsk: AskProductKind = (product) =>
  askJev(buildProductKindState(product), buildProductKindQuestions(), { timeoutMs: 5000 })

/**
 * Decide what this product is. Never throws. The admin's pick short-circuits
 * (Jev is not asked); 'off' and a wordless product skip Jev; otherwise Jev is
 * asked and its answer goes through decideProductKind's rules.
 */
export async function resolveProductKind(
  product: ProductKindSubject,
  opts: { mode?: ProductKindMode; ask?: AskProductKind; minConfidence?: number } = {}
): Promise<ProductKindDecision> {
  const mode = opts.mode ?? productKindMode()
  const minConfidence = opts.minConfidence ?? productKindMinConfidence()
  if (adminKindOf(product) || mode === 'off' || !hasKindWords(product)) {
    return decideProductKind(product, undefined, mode, minConfidence)
  }
  let read: JevKindRead | null = null
  try {
    read = readProductKind(await (opts.ask ?? defaultAsk)(product))
  } catch {
    read = null
  }
  const decision = decideProductKind(product, read, mode, minConfidence)
  if (mode === 'shadow' || decision.needsReview) {
    console.log(
      `[product-kind] ${mode} "${clean(product.name, 80)}"${product.id ? ` ${String(product.id).slice(0, 8)}` : ''}: ` +
        `floor=${decision.floor.kind ?? '-'}(${decision.floor.basis}) jev=${read?.choice ?? '-'}@${read?.confidence?.toFixed(2) ?? '-'} ` +
        `status=${decision.jev.status} kind=${decision.kind ?? '-'} review=${decision.needsReview}`
    )
  }
  return decision
}
