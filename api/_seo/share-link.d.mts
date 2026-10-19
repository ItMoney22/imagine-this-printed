// Types for share-link.mjs, so the SPA (src/) can import the one copy of the
// short-link rules the bot renderer and the card function also use.

export declare const SHARE_ORIGIN: string

export interface ShareProduct {
  id?: string | null
  name?: string | null
  price?: number | string | null
  category?: string | null
  images?: string[] | null
  metadata?: Record<string, unknown> | null
}

export type LookupStep =
  | { kind: 'idRange'; lo: string; hi: string }
  | { kind: 'id'; id: string }
  | { kind: 'slug'; slug: string }
  | { kind: 'replaces'; value: string }

export declare function isUuid(s: unknown): boolean
export declare function shareName(name: unknown): string
export declare function shortCodeFor(product?: { id?: string | null; name?: string | null }): string | null
export declare function shareUrlFor(product: { id?: string | null; name?: string | null }, origin?: string): string | null
export declare function shareLinkFor(
  product?: { id?: string | null; name?: string | null; published?: boolean },
  origin?: string
): string
export declare function shortIdOf(code: unknown): string | null
export declare function shortIdRange(prefix: string): { lo: string; hi: string }
export declare function isPublishedProduct(row: unknown): boolean
export declare function lookupPlan(key: unknown, opts?: { short?: boolean }): LookupStep[]
export declare function replacesEntriesFor(oldRow: { id?: string | null; slug?: string | null } | null | undefined): string[]
export declare function shareImageFor(product: ShareProduct | null | undefined): string | null
export declare function sharePriceLabel(product: ShareProduct | null | undefined): string | null
export declare function shareTitleFor(product: ShareProduct | null | undefined): string
export declare function shareImageVersion(url: unknown): string
export declare function shareCardUrl(product: ShareProduct, siteUrl: string): string | null
