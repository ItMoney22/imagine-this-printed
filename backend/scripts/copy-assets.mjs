/**
 * Postbuild: copy static assets `tsc` never touches into `dist/`.
 *
 * `backend/services/team-plate/fonts.ts` resolves its font directory relative
 * to the COMPILED file (dist/services/team-plate/ -> ../../assets/fonts ->
 * dist/assets/fonts). `tsc` only emits `.ts` -> `.js`; it does not copy
 * `.ttf`/`.txt` files, so without this step `dist/assets/fonts` never exists
 * and every bundled typeface fails with ENOENT the moment team-plate renders
 * in production (this shipped broken to Render for exactly that reason).
 *
 * Verifies the copy landed, loudly, so a broken build fails HERE instead of
 * shipping a working `npm run build` that produces a font-less `dist/`.
 */
import { existsSync, cpSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(backendRoot, 'assets')
const dest = join(backendRoot, 'dist', 'assets')

if (!existsSync(src)) {
  console.error(`[copy-assets] ❌ source directory missing: ${src}`)
  process.exit(1)
}

cpSync(src, dest, { recursive: true })

const fontDir = join(dest, 'fonts')
const ttfCount = existsSync(fontDir) ? readdirSync(fontDir).filter((f) => f.endsWith('.ttf')).length : 0
const expected = readdirSync(join(src, 'fonts')).filter((f) => f.endsWith('.ttf')).length

if (ttfCount < expected) {
  console.error(
    `[copy-assets] ❌ expected ${expected} bundled typefaces in dist/assets/fonts, found ${ttfCount}`,
  )
  process.exit(1)
}

console.log(`[copy-assets] ✅ copied assets/ -> dist/assets/ (${ttfCount} fonts)`)
