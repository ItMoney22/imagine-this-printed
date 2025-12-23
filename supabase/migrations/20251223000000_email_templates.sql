-- Email Templates Table
-- Stores customizable email templates with AI personalization support

CREATE TABLE IF NOT EXISTS email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Template identification
  template_key TEXT NOT NULL UNIQUE, -- e.g., 'order_confirmation', 'welcome', 'order_shipped'
  name TEXT NOT NULL, -- Human-readable name
  description TEXT, -- What this template is for

  -- Template content
  subject_template TEXT NOT NULL, -- Subject line with {{variables}}
  html_template TEXT NOT NULL, -- HTML content with {{variables}}

  -- AI personalization settings
  ai_enabled BOOLEAN DEFAULT true, -- Whether to use AI for personalization
  ai_prompt_context TEXT, -- Additional context for AI when generating personalized content
  ai_tone TEXT DEFAULT 'friendly_humorous', -- Tone: friendly_humorous, professional, casual, etc.

  -- Template variables (JSON array of available variables)
  available_variables JSONB DEFAULT '[]'::jsonb,

  -- Mr. Imagine character settings
  mr_imagine_enabled BOOLEAN DEFAULT true, -- Show Mr. Imagine in email
  mr_imagine_greeting TEXT, -- Custom greeting from Mr. Imagine

  -- Metadata
  category TEXT DEFAULT 'transactional', -- transactional, marketing, notification
  is_active BOOLEAN DEFAULT true,
  version INTEGER DEFAULT 1,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id)
);

-- Email send logs for analytics
CREATE TABLE IF NOT EXISTS email_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Reference
  template_key TEXT NOT NULL,
  recipient_email TEXT NOT NULL,

  -- Order/context reference
  order_id UUID,
  user_id UUID REFERENCES auth.users(id),

  -- Content sent (for debugging/audit)
  subject_sent TEXT,
  ai_personalization_used BOOLEAN DEFAULT false,

  -- Status
  status TEXT DEFAULT 'sent', -- sent, failed, bounced, opened
  error_message TEXT,

  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,

  -- Timestamps
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_email_templates_key ON email_templates(template_key);
CREATE INDEX IF NOT EXISTS idx_email_templates_category ON email_templates(category);
CREATE INDEX IF NOT EXISTS idx_email_templates_active ON email_templates(is_active);
CREATE INDEX IF NOT EXISTS idx_email_logs_template ON email_logs(template_key);
CREATE INDEX IF NOT EXISTS idx_email_logs_recipient ON email_logs(recipient_email);
CREATE INDEX IF NOT EXISTS idx_email_logs_sent_at ON email_logs(sent_at);

-- RLS Policies
ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_logs ENABLE ROW LEVEL SECURITY;

-- Admin/Manager can manage templates
CREATE POLICY "Admin can manage email templates" ON email_templates
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_id = auth.uid()
      AND role IN ('admin', 'manager')
    )
  );

-- Admin can view email logs
CREATE POLICY "Admin can view email logs" ON email_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_id = auth.uid()
      AND role IN ('admin', 'manager')
    )
  );

-- Insert can happen from service role (backend)
CREATE POLICY "Service can insert email logs" ON email_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Seed default templates with Mr. Imagine personality
INSERT INTO email_templates (template_key, name, description, subject_template, html_template, ai_prompt_context, available_variables, mr_imagine_greeting, category)
VALUES
-- Order Confirmation
('order_confirmation', 'Order Confirmation', 'Sent when a customer places an order',
'{{ai_subject}}',
'{{ai_content}}',
'Generate a friendly, slightly humorous order confirmation email. The email should feel personal and exciting. Reference their specific items in a creative way. Include a fun fact or pun related to their purchase if possible. Sign off as Mr. Imagine.',
'["customer_name", "order_number", "items", "total", "shipping_address"]'::jsonb,
'Hey there, creative soul!',
'transactional'),

-- Welcome Email
('welcome', 'Welcome Email', 'Sent to new users after signup',
'{{ai_subject}}',
'{{ai_content}}',
'Generate a warm, enthusiastic welcome email from Mr. Imagine. Make the customer feel special for joining. Mention the creative possibilities (design, print, earn royalties). Include the WELCOME10 discount code. Be playful but not overwhelming.',
'["username", "email"]'::jsonb,
'Welcome to the family!',
'transactional'),

-- Order Shipped
('order_shipped', 'Order Shipped', 'Sent when order ships',
'{{ai_subject}}',
'{{ai_content}}',
'Generate an excited shipping notification. Make it feel like their creation is on an adventure to them. Include tracking info naturally. Build anticipation. Mr. Imagine is excited to see their creation arrive.',
'["customer_name", "order_number", "tracking_number", "carrier", "estimated_delivery"]'::jsonb,
'Woohoo! Your creation is on its way!',
'transactional'),

-- Order Delivered
('order_delivered', 'Order Delivered', 'Sent when order is delivered',
'{{ai_subject}}',
'{{ai_content}}',
'Generate a celebratory delivery confirmation. Ask them to share photos on social media. Express Mr. Imagines excitement about seeing their creation in the real world. Encourage them to create more.',
'["customer_name", "order_number"]'::jsonb,
'Your creation has landed!',
'transactional'),

-- Design Approved
('design_approved', 'Design Approved', 'Sent when a user design is approved',
'{{ai_subject}}',
'{{ai_content}}',
'Generate an enthusiastic approval email. Celebrate their creativity. Explain the 10% royalty in an exciting way. Encourage them to share and create more. Mr. Imagine is proud of them.',
'["creator_name", "product_name", "product_id"]'::jsonb,
'Congratulations, creative genius!',
'transactional'),

-- Support Ticket Confirmation
('ticket_confirmation', 'Support Ticket Confirmation', 'Sent when a support ticket is created',
'{{ai_subject}}',
'{{ai_content}}',
'Generate a reassuring support ticket confirmation. Let them know Mr. Imagine and the team are on it. Set expectations for response time. Keep it warm but efficient.',
'["customer_name", "ticket_id", "subject"]'::jsonb,
'We got your message!',
'transactional'),

-- ITC Purchase Confirmation
('itc_purchase', 'ITC Purchase Confirmation', 'Sent when ITC tokens are purchased',
'{{ai_subject}}',
'{{ai_content}}',
'Generate an exciting ITC purchase confirmation. Make them feel like they just leveled up their creative powers. Explain what they can do with ITC. Mr. Imagine is excited for their creative journey.',
'["customer_name", "itc_amount", "usd_amount", "new_balance"]'::jsonb,
'Your creative powers just leveled up!',
'transactional')

ON CONFLICT (template_key) DO NOTHING;

-- Update trigger
CREATE OR REPLACE FUNCTION update_email_template_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER email_templates_updated_at
  BEFORE UPDATE ON email_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_email_template_timestamp();
