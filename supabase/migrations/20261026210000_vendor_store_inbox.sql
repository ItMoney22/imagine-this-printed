-- A store's own inbox (David 2026-10-26, Crystal's store first: "she needs a spot to read her email that
-- goes to crystal@imaginethisprinted.com, also put jev in it so we make sure keeps junk away").
--
-- Mail for an address on our domain is stored only when an ACTIVE email_mailboxes row exists for it
-- (the Resend webhook in backend/routes/email.ts); Jev's spam is stored archived + read on the way in
-- (backend/lib/inbound-spam.ts), which is the store inbox's Junk tab. The store manager reads the mailbox
-- through backend/routes/vendor-store-inbox.ts: the store's owner, or an ITP admin, nobody else.
--
-- vendor_storefronts.inbox_mailbox_id says which mailbox is the store's. One mailbox per store.
-- email_mailboxes.user_id follows the store's owner once she has claimed it (the API keeps it in step;
-- the last statement here catches a claim that happened before this ran).
-- Idempotent: safe to re-run.

alter table public.vendor_storefronts
  add column if not exists inbox_mailbox_id uuid references public.email_mailboxes(id) on delete set null;

create unique index if not exists idx_vendor_storefronts_inbox
  on public.vendor_storefronts (inbox_mailbox_id) where inbox_mailbox_id is not null;

insert into public.email_mailboxes (address, display_name)
values ('crystal@imaginethisprinted.com', 'Crystal’s Shirts and More')
on conflict (address) do nothing;

update public.vendor_storefronts s
   set inbox_mailbox_id = m.id,
       updated_at = now()
  from public.email_mailboxes m
 where s.slug = 'crystal'
   and m.address = 'crystal@imaginethisprinted.com'
   and s.inbox_mailbox_id is null;

update public.email_mailboxes m
   set user_id = s.owner_user_id,
       updated_at = now()
  from public.vendor_storefronts s
 where s.inbox_mailbox_id = m.id
   and s.owner_user_id is not null
   and m.user_id is distinct from s.owner_user_id;

notify pgrst, 'reload schema';
