// ---------------------------------------------------------------------------
// Recursive scan + import-key derivation for scripts/import-designs.mjs.
//
// Why this is its own dependency-free module: the rule that makes a second
// import run a no-op is the single most expensive thing in the script to get
// wrong (every miss is a duplicate product row plus a paid gpt-4o-mini vision
// call), and it could not be tested while it lived inline next to Supabase,
// GCS and OpenAI clients that are constructed at import time. See
// design-scan.test.mjs — it runs the whole plan twice against a fixture folder.
//
// THE BUG THIS FIXES: the bundle is not one level deep. 22 of 56 collection
// folders nest their designs one more level, e.g.
//   "8. Fishing/Fishing (50 Designs)/Fishing (50 Designs)/whatever.png"
// and readdirSync(DESIGN_ROOT/<collection>) alone silently skipped 1,392 PNGs.
//
// THE KEY: import_key is the design's path under DESIGN_ROOT, minus the ".png",
// with forward slashes. At depth 1 that string is byte-identical to the old
// "<dir>/<design-id>" format, so the rows already imported under the old
// importer still match and are still skipped — no re-import, no duplicates.
// Deeper paths keep their folders, so a file named the same as one in a
// sibling folder can no longer collide onto the same key.
// ---------------------------------------------------------------------------
import fs from 'node:fs'
import path from 'node:path'

const PNG = /\.png$/i

const toPosix = (p) => String(p).replace(/\\/g, '/')

/** Every PNG under `root`, at any depth, as sorted root-relative POSIX paths. */
export function walkPngs(root) {
  const found = []
  const visit = (absDir, relDir) => {
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name
      if (entry.isDirectory()) visit(path.join(absDir, entry.name), rel)
      else if (entry.isFile() && PNG.test(entry.name)) found.push(rel)
    }
  }
  visit(root, '')
  return found.sort()
}

/** "8. Fishing/Fishing (50 Designs)/bass.png" → "8. Fishing/Fishing (50 Designs)/bass" */
export const importKeyFor = (relPath) => toPosix(relPath).replace(PNG, '')

/** Split a root-relative PNG path into collection folder / subfolders / design id. */
export function describePng(relPath) {
  const parts = toPosix(relPath).split('/')
  const fileName = parts.pop()
  return {
    relPath: [...parts, fileName].join('/'),
    collectionDir: parts[0] || '',
    subDirs: parts.slice(1),
    designId: fileName.replace(PNG, ''),
    importKey: importKeyFor([...parts, fileName].join('/'))
  }
}

/**
 * Everything the importer should insert on this run: every PNG at any depth,
 * minus anything whose import_key is already in the catalogue.
 *
 * `limit` counts discovered designs per collection (not per run and not after
 * the skip), matching the old `pngs.slice(0, limit)` — so `--limit 2` still
 * means "the same first two designs of each collection" on a re-run rather
 * than creeping to the next two every time.
 *
 * PNGs sitting loose in DESIGN_ROOT with no collection folder are skipped, as
 * they always were: there is no collection to name or file them under.
 */
export function planImports(root, existingKeys = new Set(), { dirFilter = null, limit = 0 } = {}) {
  const planned = new Set(existingKeys)
  const perCollection = new Map()
  const filter = dirFilter ? String(dirFilter).toLowerCase() : null
  const plan = []

  for (const relPath of walkPngs(root)) {
    const design = describePng(relPath)
    if (!design.collectionDir) continue
    if (filter && !design.collectionDir.toLowerCase().includes(filter)) continue

    const seenInCollection = (perCollection.get(design.collectionDir) || 0) + 1
    perCollection.set(design.collectionDir, seenInCollection)
    if (limit && seenInCollection > limit) continue
    if (planned.has(design.importKey)) continue

    planned.add(design.importKey)
    const segments = design.relPath.split('/')
    plan.push({
      ...design,
      dirPath: path.join(root, ...segments.slice(0, -1)),
      fullPath: path.join(root, ...segments)
    })
  }

  return plan
}

/** Group a plan by its top-level collection folder, preserving scan order. */
export function groupByCollection(plan) {
  const groups = new Map()
  for (const design of plan) {
    if (!groups.has(design.collectionDir)) groups.set(design.collectionDir, [])
    groups.get(design.collectionDir).push(design)
  }
  return groups
}
