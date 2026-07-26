# Claude Task Brief

## Request

- Watchtower task `a19d9784-31eb-44ab-8921-5413bf89610f`: retire the unauthenticated, uncapped AI concierge avatar generator and replace its one-off corporate headshot with a committed static PNG.
- The retired route is `GET /api/ai/concierge/avatar`. On a cold process it calls `generateProductImage`, which selects `black-forest-labs/flux-1.1-pro-ultra`; that must no longer be possible through the concierge path.

## Repo detection

- TypeScript monorepo: Vite/React frontend at the root and Express/TypeScript API in `backend/`.
- Root public files are served at root-relative URLs; existing mascot configuration follows this pattern (for example, `/mr-imagine/...`).
- The route has no auth, rate limit, durable cache, or in-flight request deduplication. It imports `generateProductImage`, whose active model list contains Flux 1.1 Pro Ultra.
- A full source search found no frontend/client reference to `/api/ai/concierge`, `/api/ai/concierge/avatar`, `conciergeAvatar`, or the route response field `avatarUrl`. The active chat UI is `MrImagineChatWidget`, which is a separate mascot feature.

## Relevant files (Claude MUST read these first)

- `AGENTS.md`
- `CLAUDE.md`
- `CLAUDE_TASK.md`
- `TASK_NOTES.md`
- `backend/routes/ai/concierge-avatar.ts`
- `backend/index.ts`
- `backend/services/replicate.ts` (read only; Flux remains used by unrelated product-generation paths)
- `src/components/MrImagineChatWidget.tsx`
- `src/components/mr-imagine/config.ts`
- `AI_CONCIERGE_ENHANCEMENTS.md`

## Files to edit (STRICT)

- `public/ai-concierge-avatar.png` (new, committed static asset)
- `backend/index.ts` (remove only the concierge-avatar import and mount)
- `backend/routes/ai/concierge-avatar.ts` (delete)
- `AI_CONCIERGE_ENHANCEMENTS.md` (replace obsolete endpoint instructions with the static URL or mark the generator retired)
- `TASK_NOTES.md` (append one concise milestone/work-log bullet after implementation)

Do not edit `backend/services/replicate.ts`: Flux is still deliberately used for other image-generation features. Do not alter the Mr. Imagine mascot assets or point its mascot UI at a human corporate headshot. Do not add an unused frontend config file or change unrelated client code: no client call site currently exists.

## Context from scouting

- `backend/index.ts` imports `./routes/ai/concierge-avatar.js` and mounts it at `/api/ai/concierge`.
- The route’s only handler is `/avatar`; it stores a generated external URL in a module variable, so every deploy/cold-start can trigger a new paid Flux generation and concurrent misses are not coalesced.
- The route’s product-image call has no model override, so the `MODELS` default in `backend/services/replicate.ts` selects `black-forest-labs/flux-1.1-pro-ultra`.
- Assumption — filename and path: use `public/ai-concierge-avatar.png`, available directly as `/ai-concierge-avatar.png` in both dev and production builds.
- Assumption — configuration: use the root-relative static URL at an actual future consumer (`'/ai-concierge-avatar.png'`), not an environment variable. There is no current consumer, so adding a standalone, unused config export would create dead code; Vite’s `public/` convention is the serving configuration for this asset.
- Assumption — artwork: generate a new 1024x1024 PNG of a fictional, friendly adult woman in modern business-casual clothing, warm studio lighting, neutral light background, head-and-shoulders crop, no text, logos, watermark, celebrity likeness, or identifiable real person. Optimize it to a crisp square avatar before committing.

## Plan (step-by-step)

1. Generate and visually inspect the square PNG against the artwork assumption, then save it as `public/ai-concierge-avatar.png`. Confirm it is a valid PNG and can be fetched at `/ai-concierge-avatar.png` after a frontend build/dev serve.
2. Delete `backend/routes/ai/concierge-avatar.ts`, then remove its import and `app.use('/api/ai/concierge', ...)` mount from `backend/index.ts`. Do not leave a redirect or compatibility route; the former URL must naturally return 404.
3. Update `AI_CONCIERGE_ENHANCEMENTS.md` so it no longer tells developers or operators to call the removed endpoint. State the direct static URL and that the dynamic avatar generator is retired.
4. Re-run a repository search for concierge route strings and Flux references. Confirm all concierge-specific Flux usage is gone while unrelated product/mockup usages remain untouched.
5. Run the scoped typechecks/build commands below. If local dependencies prevent execution, record the exact missing dependency/error and still run the static searches.
6. Append one concise `TASK_NOTES.md` work-log bullet with the exact checks run and results.

## Acceptance criteria (checkboxes)

- [ ] `public/ai-concierge-avatar.png` exists, is a valid square PNG, and is directly reachable at `/ai-concierge-avatar.png`.
- [ ] `backend/routes/ai/concierge-avatar.ts` is removed.
- [ ] `backend/index.ts` no longer imports or mounts `/api/ai/concierge`; `GET /api/ai/concierge/avatar` returns 404 when the backend is running.
- [ ] No client-side reference to `/api/ai/concierge` remains; none existed at scout time, and the Mr. Imagine mascot UI remains unchanged.
- [ ] Concierge documentation names the static image URL and no longer instructs anyone to call the retired generator.
- [ ] No concierge path can call `black-forest-labs/flux-1.1-pro-ultra`; unrelated image-generation uses are preserved.
- [ ] Backend typecheck and frontend typecheck/build pass, or any environment-only failure is documented precisely.

## Commands to run

```powershell
npm --prefix backend run typecheck
npm run typecheck
npm run build
rg -n -i -S "/api/ai/concierge|concierge-avatar|avatarUrl" backend src AI_CONCIERGE_ENHANCEMENTS.md
rg -n -i -S "flux-1\\.1-pro-ultra" backend
```

For an optional local runtime smoke after starting the backend with its documented command:

```powershell
curl.exe -i http://localhost:4000/api/ai/concierge/avatar
```

Expected result: HTTP 404. Do not run the old endpoint before removal because that can incur a paid image-generation call.
