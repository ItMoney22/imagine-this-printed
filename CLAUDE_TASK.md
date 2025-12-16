# Claude Task Brief
## Request
- From `codex1.txt`: Imagination Sheet (Imagination Sheet editor) — implement 3 related UX/bug fixes (docs only from Scout; Claude will modify code).
- 1) Enhance + Upscale: ensure processing truly returns an improved/upscaled asset end-to-end, UI swaps to the new asset, and users can verify via BEFORE/AFTER compare (draggable slider) + output metadata (pixel dims and/or DPI) + clear loading states.
- 2) “Mystery Imagine” (Mr Imagine AI generation): fix cases where generation succeeds but nothing shows; redesign into a lightbox/modal tool panel with the waving Mr Imagine hero image, better prompt UX, clear queued/running/complete/error states, and retry.
- 3) Large sheet navigation: add intuitive pan/drag navigation (mouse + trackpad; mobile-friendly if applicable) so users can reach top/bottom without zooming out/in.

## Repo detection
- JavaScript/TypeScript project with Vite + React frontend and an Express/TypeScript backend in `backend/`.
- Canvas editor uses `react-konva`/Konva (`src/components/imagination/SheetCanvas.tsx`).
- AI image tools are served from backend routes under `/api/imagination-station/*` and call Replicate via `backend/services/imagination-ai.ts`.
- Root Node engine: `>=18.17` (from `package.json`); backend Node engine: `>=18.0.0` (from `backend/package.json`).
- Tests: Vitest (`npm test`), plus E2E config (`npm run test:e2e`).

## Relevant files (Claude MUST read these first)
- `AGENTS.md`
- `codex1.txt`
- `package.json`
- `backend/package.json`
- `README.md`
- `backend/README.md`
- `RUNBOOK.md`
- `TESTING_README.md`
- `src/pages/ImaginationStation.tsx`
- `src/components/imagination/SheetCanvas.tsx`
- `src/lib/api.ts`
- `backend/routes/imagination-station.ts`
- `backend/services/imagination-ai.ts`
- `public/mr-imagine/mr-imagine-waving.png`
- `TASK_NOTES.md`

## Files to edit (STRICT)
- Frontend (Imagination Sheet editor)
  - `src/pages/ImaginationStation.tsx`
  - `src/components/imagination/SheetCanvas.tsx`
  - `src/lib/api.ts`
  - Add: `src/components/imagination/ImageCompareModal.tsx`
  - Add: `src/components/imagination/MysteryImagineModal.tsx`
- Backend (Imagination Station AI endpoints)
  - `backend/routes/imagination-station.ts`
  - `backend/services/imagination-ai.ts`
- Static asset (for Mystery Imagine modal header)
  - Use existing: `public/mr-imagine/mr-imagine-waving.png`

## Plan (step-by-step)
1) Fix response/shape mismatches between frontend and backend for image tools.
2) Enhance/Upscale: return and apply new asset URLs; collect/display before+after metadata; add compare modal + loading/error states.
3) Mystery Imagine: move AI generation into a dedicated modal/lightbox; show the waving hero image; render results reliably with explicit state machine + retry.
4) Large sheet navigation: add pan/drag (and/or jump controls) in `SheetCanvas` without breaking zoom/mirror; ensure mouse + trackpad behavior.
5) Validate end-to-end with manual flows on small and large sheets; verify metadata changes are measurable.

## Acceptance criteria (checkboxes)
- [ ] Upscale 2x produces an output that reports larger pixel dimensions than the input (and the canvas swaps to the new asset URL).
- [ ] Enhance produces a new asset URL and the canvas swaps to it; users can see BEFORE/AFTER side-by-side with a draggable compare slider.
- [ ] The UI shows progress states (queued/running/completed/error) and exposes output metadata (at least pixel dimensions; DPI if available/derivable).
- [ ] Mystery Imagine modal always opens, always shows clear states, and reliably shows the generated image in the same modal when complete (with Retry).
- [ ] The Mystery Imagine modal header uses `public/mr-imagine/mr-imagine-waving.png` and includes CTA + prompt guidance/examples.
- [ ] Large sheet navigation: user can pan to top/bottom without changing zoom; works with mouse drag and trackpad gestures (and is mobile-friendly if applicable).
- [ ] No regressions: existing zoom controls still work; mirror-for-sublimation still renders correctly.

## Commands to run
- Frontend install/dev: `npm install` then `npm run dev`
- Frontend build/preview: `npm run build` then `npm run preview`
- Frontend lint/tests: `npm run lint`, `npm test`, `npm run test:e2e`
- Frontend verify scripts: `npm run verify` (or `npm run verify:home`, `npm run verify:products`, `npm run verify:auth`)
- Backend install/dev: `cd backend` then `npm install` then `npm run dev`
- Backend build/start: `cd backend` then `npm run build` then `npm start`

## Edge cases / warning
- Likely root cause for “success but no change”: `src/pages/ImaginationStation.tsx` checks `data.processedUrl` for remove-bg/upscale/enhance, but `backend/routes/imagination-station.ts` currently returns `imageUrl`/`url`/`output` (no `processedUrl`), so the layer never updates.
- DPI in the Konva editor is derived from `layer.metadata.originalWidth/originalHeight` (see `src/utils/dpi-calculator.ts` usage in `src/components/imagination/SheetCanvas.tsx`); after swapping in a new asset, update metadata so DPI/quality can change measurably.
- Likely root causes for “Mystery Imagine generated but nothing shows”: the generated layer is placed at a fixed position near the top (`position_x/position_y`), there is no panning (sheet is always centered), and the AI layer’s `width/height` units appear inconsistent with the upload path (AI uses `width / PIXELS_PER_INCH`, while uploads store pixel widths).
- Replicate SDK outputs can be `string`, array, or FileOutput objects; confirm whether `.url()` is sync/async to avoid “sometimes blank” URLs.
- `README.md` and `backend/README.md` contain some encoding/formatting artifacts; prefer `package.json` files for canonical scripts.
- The repo includes `node_modules/`; avoid broad searches that traverse it unless necessary.
- Network access is restricted in this environment; avoid adding new deps or running installs that require fetching unless explicitly approved.

## Notes for Claude (STRICT RULES)
- Scout first: search (`rg` preferred), then read the minimum files needed.
- Do not expand the edit surface beyond the “Files to edit (STRICT)” list without explicit confirmation.
- Keep changes focused on the 3 requested fixes; avoid opportunistic refactors.
- Avoid large inline dumps in PR/notes; link to files/symbols instead.
