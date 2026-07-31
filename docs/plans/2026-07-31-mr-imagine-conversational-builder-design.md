# Mr. Imagine Conversational Product Builder — Design

**Date:** 2026-07-31 · **Requested by:** David (direct) · **Status:** approved in-session

David's ask, verbatim spirit: redo the AI Product Builder as a conversational piece
with Mr. Imagine using Grok realtime "like Zero in Watchtower" — a high-end design
machine that asks "is this a shirt, metal art, or a 3D print?", walks the steps,
knows when things are done, has a NEXT-LEVEL hexagon UI, can file Watchtower tasks
when something needs changing, and gives admin employees a way to file Watchtower
tasks too.

Decisions David confirmed in-session (2026-07-31):
1. Conversational experience is the **default face** of the page; the classic
   wizard stays reachable behind a toggle (zero regression risk).
2. **All three product lanes fully wired now** — shirts, metal art, 3D prints.
3. Employee task filing = **floating button on all admin pages** (admin/manager).

## Voice lane (mirrors Watchtower's proven browser-direct pattern)

Reference implementation: `david-trinidad-com/src/app/api/agents/realtime-token/route.ts`
+ `src/app/dashboard/zero/use-agent-live.ts`.

- New `POST /api/ai/realtime/token` (admin+manager gated) on the ITP backend mints
  an ephemeral xAI client secret via `https://api.x.ai/v1/realtime/client_secrets`
  (env `XAI_API_KEY`), and returns `{ token, expires_at, model, voice, instructions }`.
- Instructions = **Mr. Imagine, builder edition**: creative-director persona layered
  over the step protocol (below), tool-usage rules, and voice etiquette. Distinct
  from the customer-facing chat persona in `backend/routes/ai/mr-imagine-chat.ts` —
  this one is allowed to run the admin pipeline.
- Browser connects straight to `wss://api.x.ai/v1/realtime?model=grok-voice-latest`
  with subprotocols `["realtime", "xai-client-secret.<token>"]`. Mic → AudioWorklet
  (`public/audio-worklets/pcm-capture.js`, copied from Watchtower) → 24kHz PCM16
  base64 frames. Playback = queued AudioContext buffers with interrupt-on-speech.
  Known xAI realtime quirks handled (all verified in Watchtower): explicit
  `response.create` after `input_audio_buffer.committed`; tool-call dedup across
  `response.function_call_arguments.done` / `response.output_item.done`;
  `response.cancel` + local queue flush when the user starts talking.

## Step machine ("he knows when things are done")

The page owns a reducer-backed state machine; Mr. Imagine drives it through tools,
and the page feeds job completions back into the live conversation as system items
followed by `response.create` — so Mr. Imagine *announces* progress instead of the
admin polling by eye.

Steps (hex nodes): `type → brief → generate → pick → polish → publish`.

Lane mapping:
- **Shirt / metal art** → existing admin pipeline `/api/admin/products/ai/*`:
  `create` (GPT normalization decides `category_slug`; `metal_size` 4x6|8x10 rides
  the body for metal art) → poll `/:id/status` → `select-image` →
  `remove-background` / `create-mockups` → product row already exists (draft);
  publish = set storefront status via the existing admin product update lane.
- **3D print** → existing `/api/3d-models/*` customer pipeline: `create` (concept)
  → `approve` → `generate-3d` at a size tier (Tripo3D). NOTE: this lane charges
  the signed-in admin's ITC wallet (concept + tier). v1 keeps that honest — Mr.
  Imagine says the cost out loud before firing. No admin bypass in a customer route.

## Tools (handled in-browser, same dispatch pattern as Watchtower)

`set_product_type{type, metal_size?}` · `set_design_brief{prompt, style?, tone?,
shirt_color?, print_locations?}` · `generate_designs{}` · `select_design{index}` ·
`remove_background{}` · `create_mockups{}` · `finalize_product{status}` ·
`approve_concept{}` / `convert_3d{size_tier}` (3D lane) ·
`get_build_state{}` (re-ground after reconnect) ·
`create_watchtower_task{title, description, priority?}`.

## Watchtower task filing

- New backend route `backend/routes/watchtower.ts`: `POST /api/watchtower/tasks`
  (admin+manager gated) → `https://davidtrinidad.com/api/tasks/internal` with
  header `x-internal-secret: WATCHTOWER_INTERNAL_SECRET` (already present in
  backend/.env from the trend-scout bridge). Body forced to
  `project: "imagine-this-printed"`; `source: "itp-mr-imagine"` for Mr. Imagine's
  tool, `"itp-admin"` for the widget. Contract per
  `david-trinidad-com/src/app/api/tasks/internal/route.ts`.
- `src/components/WatchtowerTaskButton.tsx`: floating hex button, rendered for
  admin/manager roles across admin pages (mounted in App.tsx), opens a modal
  (title, details, priority) → the proxy. Success shows the board task id.

## UI direction (NEXT LEVEL, hexagons)

Rebuilt `src/pages/AdminAIProductBuilder.tsx`: honeycomb-pattern backdrop (CSS,
theme-token colors only), six clip-path hexagon step nodes with glow states
(idle / active-pulse / complete-fill), Mr. Imagine center-stage using the existing
head art (`/mr-imagine/mr-imagine-head*.png`) swapped by live status (idle /
thinking / speaking) inside a pulsing hex ring, live dual transcript, and a
results rail where generated designs/mockups land as they finish. Classic mode
toggle renders `<AdminCreateProductWizard />` untouched. All colors via semantic
tokens (bg/card/text/primary/secondary/accent) per project rules.

## Env additions (Render + local backend/.env)

- `XAI_API_KEY` — shared key from the vault (NOT the Darrell-dedicated one).
- `WATCHTOWER_INTERNAL_SECRET` — already local; must be set on Render prod.
- Optional: `XAI_REALTIME_MODEL` (default `grok-voice-latest`),
  `MR_IMAGINE_VOICE` (default set in route).

## Out of scope (v1)

Customer-facing voice builder; admin ITC bypass for the 3D lane; Watchtower task
status readback inside ITP; changing the classic wizard.
