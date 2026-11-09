/**
 * `url` plus `params` as a query string, leaving out any param that is undefined or null.
 *
 * `String(undefined)` is "undefined": imaginationApi.getSheets() with no status sent `?status=undefined`, the backend
 * filtered on a status nobody has, the list came back empty, and Imagination Station made a new empty sheet on every
 * visit (81 on David's account by 2026-11-09, and an empty Projects list). Kept free of imports so it tests anywhere.
 */
export function withQuery(url: string, params?: Record<string, unknown>): string {
  if (!params) return url
  const q = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    q.append(key, String(value))
  }
  const s = q.toString()
  return s ? `${url}${url.includes('?') ? '&' : '?'}${s}` : url
}
