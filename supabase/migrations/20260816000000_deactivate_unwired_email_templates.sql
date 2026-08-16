-- Deactivate any email_templates rows that have no corresponding code-level
-- sender wired through generateAIEmail(). Editing those rows in the admin
-- panel would have no effect on real customer mail, so they should not
-- appear there as editable options (backend/routes/admin/email-templates.ts
-- GET / now filters on is_active = true).
--
-- As of this migration, every row seeded by 20251223000000_email_templates.sql
-- has a sender:
--   order_confirmation  -> backend/utils/email.ts sendOrderConfirmationEmail
--   welcome              -> backend/utils/email.ts sendWelcomeEmail
--   order_shipped        -> backend/utils/email.ts sendOrderShippedEmail
--   order_delivered      -> backend/utils/email.ts sendOrderDeliveredEmail
--   design_approved      -> backend/utils/email.ts sendProductApprovalEmail
--   ticket_confirmation  -> backend/utils/email.ts sendTicketConfirmationEmail
--   itc_purchase         -> backend/utils/email.ts sendItcPurchaseEmail
--
-- So this WHERE clause matches zero rows today. It exists to guard against
-- template rows added later (by hand, or by a future migration) that never
-- get a sender wired up.
UPDATE email_templates
SET is_active = false, updated_at = NOW()
WHERE template_key NOT IN (
  'order_confirmation',
  'welcome',
  'order_shipped',
  'order_delivered',
  'design_approved',
  'ticket_confirmation',
  'itc_purchase'
)
AND is_active = true;
