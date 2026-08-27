# Claude Task Brief
## Request
- Fix Smart Fill collision detection and gang-sheet coverage for Watchtower task `f6c1b2a0-5252-4da6-ad99-43ff2840bdc2`.
- Send every occupied layer's real `position_x`, `position_y`, `width`, `height`, and `rotation` to the backend, place duplicates without overlap, and calculate coverage from occupied geometry rather than template-count multiplication.
- Add focused automated tests for collision, rotation, placement, and coverage regressions.

## Repo detection
- Git worktree on branch `earth/mason-blaze/fix-smart-fill-collision-f6c1b2a0-ms2cmbsc`.
- Vite + React + TypeScript frontend with an Express + TypeScript backend in `backend/`.
- Smart Fill is invoked by `src/pages/ImaginationStation.tsx`, typed in `src/lib/api.ts`, validated by `backend/routes/imagination-station.ts`, and implemented in `backend/services/imagination-layout.ts`.
- Root Vitest is available through `npm test`; frontend and backend have separate typecheck commands.
- No existing Smart Fill unit test was found.

## Relevant files (Claude MUST read these first)
- `AGENTS.md`
- `CLAUDE.md`
- `src/pages/ImaginationStation.tsx` (Smart Fill handler around lines 1046-1103)
- `src/lib/api.ts` (layout API types around lines 580-585)
- `backend/routes/imagination-station.ts` (Smart Fill route around lines 1156-1197)
- `backend/services/imagination-layout.ts` (layer contract and `smartFill`)
- `src/components/imagination/SheetCanvas.tsx` (read-only geometry reference: Konva uses `position_x`/`position_y` as the un-offset rotation origin)

## Files to edit (STRICT)
- `src/pages/ImaginationStation.tsx`
- `src/lib/api.ts`
- `backend/routes/imagination-station.ts`
- `backend/services/imagination-layout.ts`
- `backend/services/imagination-layout.test.ts` (new)
- Do not edit any other repo file. If another file is genuinely necessary, update `TASK_NOTES.md` with the path and rationale before touching it.

## Context from scouting
- `handleSmartFill` currently maps only the selected layers (or all layers when nothing is selected) to `{ id, width, height }`. This both omits geometry and makes unselected layers invisible to collision detection.
- Preserve selected-layer behavior by separating the complete occupied-layer list from duplicate-source selection. Recommended contract: send every layer in `layers` and the selected IDs in optional `sourceLayerIds`; when there is no selection, all layer IDs are eligible. The backend chooses the smallest eligible source as it does today.
- `src/lib/api.ts` currently types Smart Fill layers as only `{ id, width, height }`; its request type must match the new payload.
- Backend `LayerDimensions` has optional rotation but no position fields. The route validates only ID/width/height, so malformed or missing geometry can reach pricing/layout logic.
- The current collision check anchors every existing rectangle at `(0, 0)`, does not account for rotation, and checks only the original `layers` list.
- Canvas geometry uses a top-left Konva origin with no offset. Rotation-aware AABBs therefore need to rotate all four corners around `(position_x, position_y)` and take min/max X/Y; simply swapping width and height at 90 degrees is insufficient because positive rotation can extend left of the origin.
- The placement loop should test each candidate against both original occupied AABBs and already accepted duplicate AABBs, keep the complete candidate AABB inside the sheet, and treat edge-touching as non-overlap. Apply the configured padding consistently as inter-item clearance.
- Coverage at line 244 multiplies every original layer by the chosen template area. This is wrong for mixed layer dimensions and can exceed or misstate real sheet occupancy.
- Calculate coverage from the union of all original and accepted duplicate footprints clipped to the sheet, so overlaps are not double-counted, out-of-sheet area is excluded, and the result is clamped to `0..100`. Use the same rotation-aware AABB representation as collision detection for consistent Smart Fill geometry.
- If no duplicate grid cell fits, still return coverage for existing occupied layers; do not return hard-coded zero merely because `cols` or `rows` is zero.
- The route performs wallet deduction only after layout returns. Keep input validation before pricing/wallet work, and require finite positive sheet/layer dimensions plus finite positions/rotation so invalid geometry cannot cause a charge.

## Plan (step-by-step)
1. Expand the frontend Smart Fill request contract:
   - Send all occupied layers with `id`, `width`, `height`, `position_x`, `position_y`, and `rotation`.
   - Send `sourceLayerIds` for selected duplicate sources; default to all layer IDs when nothing is selected.
   - Update the `imaginationApi.smartFill` TypeScript signature to match.
2. Harden the Smart Fill route:
   - Validate finite positive sheet dimensions, finite non-negative padding, and each layer's complete finite geometry before reading wallet/pricing data.
   - Validate optional `sourceLayerIds` as IDs that exist in the occupied layer list.
   - Pass source selection into the layout service without dropping occupied layers.
3. Refactor Smart Fill geometry into small testable helpers in `backend/services/imagination-layout.ts`:
   - Build a rotation-aware AABB from the four rotated corners around the stored Konva origin.
   - Implement strict AABB overlap/clearance checks and sheet-boundary checks.
   - Keep original occupied AABBs and append each accepted duplicate AABB so every placement is checked against all prior occupancy.
4. Correct template selection and placement:
   - Choose the smallest eligible source from `sourceLayerIds`, falling back to all layers only when the field is omitted.
   - Generate candidates within sheet bounds and reject any that collide with an original or newly placed layer.
   - Keep returned `sourceId`, coordinates, and rotation consistent with the selected template.
5. Replace template-count coverage math:
   - Compute the clipped union area of all original and duplicate AABBs with a deterministic sweep/interval merge.
   - Divide by sheet area, round as the current API expects, and clamp to `0..100`.
   - Compute existing coverage even when no duplicate can fit.
6. Add focused Vitest coverage in `backend/services/imagination-layout.test.ts`:
   - A centered existing layer blocks the corresponding candidate instead of a phantom top-left rectangle.
   - Non-overlapping, edge-touching, and rotated layers produce correct AABB decisions.
   - Every returned duplicate is inside the sheet and pairwise non-overlapping with originals and other duplicates.
   - Selected source IDs affect the duplicated template while all layers remain collision obstacles.
   - Mixed-size layers use actual geometry; overlapping and partly out-of-sheet occupancy are unioned/clipped once; coverage stays within `0..100`.
   - Existing coverage is returned when no duplicate can fit.
7. Run the targeted test, both TypeScript checks, and the production build. Fix only failures caused by this change.

## Acceptance criteria (checkboxes)
- [ ] Smart Fill requests include `position_x`, `position_y`, and `rotation` for every occupied layer.
- [ ] Selected-layer duplication remains supported without hiding unselected occupied layers from collision detection.
- [ ] Backend validation rejects incomplete, non-finite, or invalid geometry before pricing/wallet work.
- [ ] Rotation-aware AABB checks use each layer's actual position and dimensions.
- [ ] New duplicates stay inside the sheet and never overlap original layers or one another.
- [ ] Coverage reflects the clipped union of actual occupied geometry, handles mixed sizes, does not double-count overlaps, and remains between 0% and 100%.
- [ ] A no-room result reports existing coverage rather than zero.
- [ ] Focused automated tests cover the phantom-origin regression, rotation, duplicate collisions, source selection, and coverage.
- [ ] Frontend typecheck, backend typecheck, targeted tests, and production build pass with no new failures.

## Commands to run
```powershell
npm test -- backend/services/imagination-layout.test.ts
npm run typecheck
npm --prefix backend run typecheck
npm run build
```
