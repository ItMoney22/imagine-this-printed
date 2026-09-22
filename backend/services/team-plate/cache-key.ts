// Cache key for a rendered team plate.
//
// Lives here rather than in backend/shared/team-template.ts because it is the
// one piece of that contract that needs node:crypto, and the rest of the
// contract is imported into the BROWSER so the input box a customer types into
// sanitizes exactly the way the press file does.
import { createHash } from 'node:crypto'
import type { TeamTemplate } from '../../shared/team-template.js'

/**
 * Cache key for a rendered plate.
 *
 * Covers the TEMPLATE as well as the values, so editing a template (moving a
 * zone, changing a colour) invalidates every file derived from it without a
 * purge step — the next request simply misses and re-renders.
 */
export function templateCacheKey(template: TeamTemplate, values: Record<string, string>): string {
  const shape = {
    v: template.version,
    plate: template.plateAssetId,
    distress: template.distressAssetId,
    canvas: template.canvas,
    halftone: template.halftone,
    fields: template.fields.map((f) => ({
      k: f.key,
      zone: f.zone,
      arch: f.arch,
      font: f.font,
      fill: f.fill,
      strokes: f.strokes,
      offset: f.offset,
      value: values[f.key] ?? '',
    })),
  }
  return createHash('sha256').update(JSON.stringify(shape)).digest('hex').slice(0, 32)
}
