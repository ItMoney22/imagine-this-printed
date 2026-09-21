// Mrs. Imagine's daily clock — RETIRED. She scouts when David presses the
// button, and at no other time.
//
// History, because the default flipped three times and the reason matters each
// time:
//   2026-08-20  David: "she needs to do all the work e2e — im just gonna sign
//               into etsy and change drafts to active." Clock ran her full
//               autonomous batch, default ON.
//   2026-09-02  David: "i dont want her creating designs on her own anymore
//               but i do like this new stepflow." Batch default flipped OFF.
//   2026-09-09  David: "mrs imagine is a scout she finds great designs that
//               are selling ... she drops a list of her top 10 everyday and i
//               just have to click on it it goes to step flow." Clock re-armed
//               to run the SCOUT (read-only, no image spend), default ON.
//   2026-09-21  David: "stop mrs image from doing daily scouts i want that on
//               my push of the button only." Clock retired entirely.
//
// WHY THIS IS A DELETION AND NOT A FLAG. The obvious way to honour that last
// instruction is MRS_IMAGINE_SCOUT=false on Render. It was rejected for the
// same reason this file already gave for the batch: a flag is something someone
// can flip back by accident, and an env var on a dashboard is invisible from
// the code. Removing the timer — and the import of the scout service with it —
// is a structural guarantee that nothing in this process can start a sweep.
// There is no clock left to re-arm.
//
// The scout itself is untouched and fully alive. It runs from the button:
//   POST /api/admin/mrs-imagine/scout/run   (backend/routes/admin/mrs-imagine.ts)
//   pressed by src/components/AdminMrsImagine.tsx
//
// This module is kept, rather than deleted outright, so the worker logs a line
// every boot saying the clock is retired. Someone reading Render logs and
// wondering why no top-10 list appeared gets an answer in the place they are
// already looking, instead of silence.

/**
 * Greppable from the MRS_IMAGINE_SCOUT / MRS_IMAGINE_DAILY vars that may still
 * be set on Render — neither does anything now.
 */
export const SCOUT_CLOCK_RETIRED_MESSAGE =
  'Mrs. Imagine scout clock is RETIRED (David 2026-09-21) — she scouts only when the button is pressed. MRS_IMAGINE_SCOUT and MRS_IMAGINE_DAILY no longer do anything.'

/**
 * Formerly armed the daily sweep. Now a no-op that logs why.
 *
 * Deliberately still called from worker/index.ts: the boot log line is the
 * point. Dropping the call would make the retirement invisible to anyone
 * watching the worker start up.
 */
export function startMrsImagineDaily(): void {
  console.log(`[mrs-imagine-scout] ${SCOUT_CLOCK_RETIRED_MESSAGE}`)
}
