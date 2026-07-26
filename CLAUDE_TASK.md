# Claude Task Brief
## Request
- Watchtower task `555b557b-c83b-4d9a-b02d-cea80a469c8c`: fix or retire the dead Replicate webhook callback path.
- Decision for this pass: retire Replicate webhooks and rely on the existing worker polling mechanism. The async Replicate calls already return prediction IDs, and the dispatch notes jobs currently complete because polling works. Keeping webhooks would require a production `API_PUBLIC_URL` decision, raw-body middleware, Svix verification, and tests; that is not needed unless real-time callbacks become a product requirement.

## Repo detection
- JavaScript/TypeScript project with a Vite + React frontend and an Express/TypeScript backend in `backend/`.
- Replicate integration lives in `backend/services/replicate.ts`.
- The dead callback route is imported and mounted in `backend/index.ts` at `/api/ai/replicate`.
- The current callback file is `backend/routes/ai/replicate-callback.ts`.
- Root commands from `package.json`: `npm run typecheck`, `npm run test`, `npm run build`, `npm run lint`.
- Backend commands from `backend/package.json`: `npm run typecheck`, `npm run build`, `npm run dev`, `npm run worker`.

## Relevant files (Claude MUST read these first)
- `AGENTS.md`
- `CLAUDE.md`
- `TASK_NOTES.md`
- `backend/services/replicate.ts`
- `backend/index.ts`
- `backend/routes/ai/replicate-callback.ts`
- `backend/.env.example`
- `docs/AI_PRODUCT_BUILDER.md`
- `docs/ENV_VARIABLES.md`
- `backend/package.json`
- `package.json`

## Files to edit (STRICT)
- `backend/services/replicate.ts`
- `backend/index.ts`
- `backend/routes/ai/replicate-callback.ts` (delete)
- `backend/.env.example`
- `docs/AI_PRODUCT_BUILDER.md`
- `docs/ENV_VARIABLES.md`
- `TASK_NOTES.md` (append exactly one milestone/work-log bullet after implementation)

Do not edit unrelated Replicate, Stripe, Resend, Etsy, worker, or frontend files unless typecheck exposes a direct compile break from deleting the route import/mount.

## Context from scouting
- `backend/services/replicate.ts` registers webhooks in four `replicate.predictions.create()` calls:
  - around line 175 in async product/image generation fallback
  - around line 263 in `removeBackground`
  - around line 387 in Mr. Imagine mockup generation
  - around line 629 in `upscaleImage`
- Each call uses `webhook: ${process.env.PUBLIC_URL}/api/ai/replicate/callback` plus `webhook_events_filter: ['completed']`.
- `backend/.env.example` defines `PUBLIC_URL` as a public GCS bucket base (`https://storage.googleapis.com/your-bucket-name`), so the current webhook URL points at Cloud Storage, not the API.
- `backend/index.ts` imports `replicateCallbackRouter`, mounts it at `/api/ai/replicate`, and currently only applies raw body middleware to Stripe and Resend before `express.json()`.
- `backend/routes/ai/replicate-callback.ts` verifies a nonexistent `x-replicate-signature` header and HMACs `JSON.stringify(req.body)`, so real Replicate Svix-style callbacks will fail verification.
- Existing working pattern for Svix raw-body verification is `verifyResendWebhook` in `backend/services/email-resend.ts`, but this pass should not duplicate it because webhooks are being retired.
- Docs still describe Replicate webhooks as HMAC over JSON and mention `PUBLIC_URL` as the webhook public URL; those docs must be revised to say Replicate jobs are completed by polling.

## Plan (step-by-step)
1. Remove webhook registration from all four Replicate prediction creation call sites in `backend/services/replicate.ts`.
   - Delete only the `webhook` and `webhook_events_filter` fields.
   - Preserve the prediction creation inputs, model/version handling, logging, and returned `prediction.id`.
2. Delete `backend/routes/ai/replicate-callback.ts`.
3. Remove the `replicateCallbackRouter` import and `app.use('/api/ai/replicate', replicateCallbackRouter)` mount from `backend/index.ts`.
4. Update docs and env examples:
   - In `backend/.env.example`, keep `PUBLIC_URL` documented as the GCS/public-asset URL only.
   - Remove or revise `AI_WEBHOOK_SECRET` references that are specific to Replicate callback verification.
   - In `docs/AI_PRODUCT_BUILDER.md`, replace callback/security flow claims with polling-based job completion.
   - In `docs/ENV_VARIABLES.md`, remove or revise the Replicate `AI_WEBHOOK_SECRET` requirement and any callback troubleshooting steps.
5. Do not add `API_PUBLIC_URL` or webhook signature tests in the retire path.
6. Run verification commands below and fix any compile/search failures caused by the deletion.

## Acceptance criteria (checkboxes)
- [ ] `backend/routes/ai/replicate-callback.ts` is deleted.
- [ ] `backend/index.ts` no longer imports or mounts the Replicate callback router.
- [ ] `backend/services/replicate.ts` no longer sends `webhook` or `webhook_events_filter` fields to Replicate.
- [ ] No code attempts to register `/api/ai/replicate/callback` with Replicate.
- [ ] Documentation states that Replicate async jobs are completed by polling, not callbacks.
- [ ] `PUBLIC_URL` is not described as an API callback base for Replicate.
- [ ] No new `API_PUBLIC_URL` or webhook tests are added because webhooks are retired.
- [ ] Backend typecheck passes, or any failures are clearly documented as unrelated pre-existing dependency/type issues.

## Commands to run
```bash
rg -n "replicate/callback|replicate-callback|webhook_events_filter|AI_WEBHOOK_SECRET|Public URL \\(for webhooks\\)|PUBLIC_URL=https://api.imaginethisprinted.com" backend docs
```

```bash
cd backend
npm run typecheck
```

Optional broader check if backend typecheck is clean and dependencies are installed:
```bash
npm run build
```
