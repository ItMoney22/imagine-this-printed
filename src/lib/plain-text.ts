/**
 * A product description as plain sentences (task 63520e95): listings written
 * in markdown showed raw "**The Design:**" on the page. Bold/italic marks,
 * heading hashes and list bullets go; line breaks between paragraphs stay.
 */
export function plainDescription(text: string | null | undefined): string {
  if (!text) return ''
  return text
    .replace(/\r\n/g, '\n')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,!?:;]|$)/g, '$1$2')
    .replace(/^\s*["“]|["”]\s*$/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
