// Pet ornament — where things sit on the disc, in mm (task 81358f3a).
//
// The disc and cap are the 3D name ornament's (name-print/geometry.ts,
// 67 mm disc + 12 mm cap with the hanging hole). On it:
//
//   ink rim      a 1.6 mm ring just inside the disc edge
//   portrait     a 60 x 47.6 mm box from the name band to the rim, clipped to the rim and kept
//                clear of the name band
//   name         a 36 x 8.5 mm box near the bottom
//
// The portrait is a raster of PX mm squares. Every pixel edge becomes a wall
// in the print, so PX is the print's resolution: 0.2 mm is half a nozzle
// width, fine enough that the staircase does not show, coarse enough that
// cleanup sizes (a 3-pixel sliver = 0.6 mm) mean something to a 0.4 nozzle.

export const PX = 0.2

export const DISC_R = 33.5
export const RIM_W = 1.6
/** The portrait never comes closer than this to the centre than the rim's inner edge allows. */
export const PORTRAIT_CLIP_R = DISC_R - RIM_W - 0.5

export const PORTRAIT_BOX = { cx: 0, cy: 7.8, w: 60, h: 47.6 }
/** Lowest y the portrait may reach: the top of the name band, plus a gap. */
export const PORTRAIT_MIN_Y = -16

export const NAME_BOX = { cx: 0, cy: -21.5, w: 36, h: 8.5 }

/**
 * Layer tops, mm: each is a real layer top at 0.16 mm (the process the print
 * check passed with) and at 0.2 mm, first layer 0.2. The two coats share a
 * height — they are separate parts, so they need no step to tell them apart,
 * and the ornament stays 4.2 mm thick instead of 5.
 */
export const Z = { plate: 2.6, fur1: 3.4, fur2: 3.4, ink: 4.2 } as const

/** Portrait raster size in pixels. */
export const GRID_W = Math.round(PORTRAIT_BOX.w / PX)
export const GRID_H = Math.round(PORTRAIT_BOX.h / PX)
/** mm of the raster's top-left corner. */
export const GRID_ORIGIN = { x: PORTRAIT_BOX.cx - PORTRAIT_BOX.w / 2, y: PORTRAIT_BOX.cy + PORTRAIT_BOX.h / 2 }

/** True when the pixel's centre is somewhere the portrait may print. */
export function pixelAllowed(gx: number, gy: number): boolean {
  const x = GRID_ORIGIN.x + (gx + 0.5) * PX
  const y = GRID_ORIGIN.y - (gy + 0.5) * PX
  return y >= PORTRAIT_MIN_Y && Math.hypot(x, y) <= PORTRAIT_CLIP_R
}
