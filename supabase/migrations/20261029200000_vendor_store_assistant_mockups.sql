-- Mockups from her store assistant (David 2026-10-29: "crystal gives him a image says mock this on a shirt he does it
-- he comes up in a lightbox"). One nullable column on the chat: the reply that offers a mockup carries its product,
-- colour, the picture and the price it stated, then its progress (offered -> rendering -> done | failed); the finished
-- mockup is its own reply row marked status 'result' (backend/routes/vendor-store.ts). Server-only like the rest of the
-- table: RLS stays on with no policies and no grants.
alter table public.vendor_store_assistant_messages add column if not exists mockup jsonb;
