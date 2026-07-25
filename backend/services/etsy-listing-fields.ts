// Pure field mapping for Etsy listings: ITP product copy -> Etsy title + tags.
//
// Kept free of imports (and therefore of Supabase/env side effects) so the rules
// can be exercised directly against real catalogue rows before a batch goes out.
// Etsy gives a listing 140 title characters and exactly 13 tag slots; both are
// primary search surfaces, so wasting either is the difference between a listing
// that gets impressions and one that never surfaces.

export const MAX_TITLE_LEN = 140
export const MAX_TAGS = 13
export const MAX_TAG_LEN = 20

// Words that must never be left dangling on the end of a trimmed tag.
const TRAILING_STOPWORDS = new Set(['a', 'an', 'and', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with', 'your'])

// One ITP keyword phrase -> one legal Etsy tag, or null if nothing usable survives.
//
// ITP's search_keywords are long website-SEO phrases ("patriotic tees for sale"),
// and a naive slice to 20 chars cut them mid-word into "patriotic tees for s" - a
// tag that matches no shopper query and burns one of only 13 slots. Trim on whole
// words instead, then drop a dangling stopword.
export function toEtsyTag(phrase: string): string | null {
  const clean = phrase.trim().replace(/[^A-Za-z0-9 -]/g, '').replace(/\s+/g, ' ').trim()
  if (!clean) return null

  let out = clean
  if (out.length > MAX_TAG_LEN) {
    out = ''
    for (const word of clean.split(' ')) {
      const next = out ? `${out} ${word}` : word
      if (next.length > MAX_TAG_LEN) break
      out = next
    }
    // A single word longer than the limit leaves nothing usable.
    if (!out) return null
  }

  const words = out.split(' ')
  while (words.length > 1 && TRAILING_STOPWORDS.has(words[words.length - 1].toLowerCase())) words.pop()
  out = words.join(' ').trim()
  return out.length >= 3 ? out : null
}

// Etsy tag rules: <=13 tags, <=20 chars, letters/numbers/spaces/hyphens, no dupes.
export function toEtsyTags(searchKeywords: string | null | undefined): string[] {
  if (!searchKeywords) return []
  const seen = new Set<string>()
  const tags: string[] = []
  for (const phrase of searchKeywords.split(/[,;]+/)) {
    const tag = toEtsyTag(phrase)
    if (!tag) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    tags.push(tag)
    if (tags.length >= MAX_TAGS) break
  }
  return tags
}

// ITP product names average ~30 characters, so a bare name throws away three
// quarters of the title field. Append whole keyword phrases (comma separated -
// the category convention) until the budget runs out, skipping anything the
// title already covers.
export function toEtsyTitle(base: string, searchKeywords: string | null | undefined): string {
  let title = base.trim().replace(/\s+/g, ' ').slice(0, MAX_TITLE_LEN)
  if (!searchKeywords) return title
  for (const raw of searchKeywords.split(/[,;]+/)) {
    const phrase = raw.trim().replace(/\s+/g, ' ')
    if (phrase.length < 3) continue
    if (title.toLowerCase().includes(phrase.toLowerCase())) continue
    const next = `${title}, ${phrase}`
    if (next.length > MAX_TITLE_LEN) continue
    title = next
  }
  return title
}
