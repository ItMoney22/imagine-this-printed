// Which vendor store a hostname is (David 2026-10-26). Dependency-free so App.tsx can branch
// on it before anything else loads, and so its test needs no Supabase env.

/** Subdomains that are ITP itself, never a store. */
const NOT_STORES = new Set(['www', 'api', 'admin', 'app', 'staging', 'preview', 'manage', 'store', 'mail'])

/** "crystal" for crystal.imaginethisprinted.com, else null. */
export function storeSlugFromHost(hostname: string): string | null {
  const m = /^([a-z0-9-]+)\.imaginethisprinted\.com$/i.exec(hostname || '')
  if (!m) return null
  const slug = m[1].toLowerCase()
  return NOT_STORES.has(slug) ? null : slug
}
