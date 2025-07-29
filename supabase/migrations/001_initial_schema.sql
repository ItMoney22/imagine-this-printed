-- Initial schema migration from Prisma to Supabase
-- This creates all the tables with proper Supabase auth integration

-- Create user_profiles table (extends Supabase auth.users)
CREATE TABLE user_profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  role TEXT DEFAULT 'customer',
  username TEXT UNIQUE NOT NULL,
  first_name TEXT,
  last_name TEXT,
  display_name TEXT,
  bio TEXT,
  avatar_url TEXT,
  phone TEXT,
  company_name TEXT,
  business_type TEXT,
  tax_id TEXT,
  wholesale_status TEXT,
  wholesale_tier TEXT,
  credit_limit DECIMAL DEFAULT 0,
  payment_terms INTEGER DEFAULT 30,
  stripe_account_id TEXT,
  stripe_customer_id TEXT,
  email_verified BOOLEAN DEFAULT false,
  email_verification_token TEXT,
  password_reset_token TEXT,
  password_reset_expiry TIMESTAMPTZ,
  profile_completed BOOLEAN DEFAULT false,
  last_active TIMESTAMPTZ,
  preferences JSONB DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create user_wallets table
CREATE TABLE user_wallets (
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE PRIMARY KEY,
  points_balance INTEGER DEFAULT 0,
  itc_balance DECIMAL DEFAULT 0.00,
  lifetime_points_earned INTEGER DEFAULT 0,
  lifetime_itc_earned DECIMAL DEFAULT 0.00,
  last_points_activity TIMESTAMPTZ,
  last_itc_activity TIMESTAMPTZ,
  wallet_status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create points_transactions table
CREATE TABLE points_transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  reason TEXT NOT NULL,
  source TEXT,
  reference_id TEXT,
  metadata JSONB DEFAULT '{}',
  expires_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create itc_transactions table
CREATE TABLE itc_transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL,
  amount DECIMAL NOT NULL,
  balance_after DECIMAL NOT NULL,
  usd_value DECIMAL,
  exchange_rate DECIMAL DEFAULT 0.10,
  reason TEXT NOT NULL,
  payment_intent_id TEXT,
  transaction_hash TEXT,
  reference_id TEXT,
  metadata JSONB DEFAULT '{}',
  status TEXT DEFAULT 'completed',
  processed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create referral_codes table
CREATE TABLE referral_codes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE NOT NULL,
  code TEXT UNIQUE NOT NULL,
  is_active BOOLEAN DEFAULT true,
  total_uses INTEGER DEFAULT 0,
  max_uses INTEGER,
  total_earnings DECIMAL DEFAULT 0,
  referrer_reward_amount DECIMAL DEFAULT 10.00,
  referee_reward_amount DECIMAL DEFAULT 5.00,
  description TEXT,
  campaign_id TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create referral_transactions table
CREATE TABLE referral_transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  referral_code_id UUID REFERENCES referral_codes(id) NOT NULL,
  referrer_id UUID REFERENCES user_profiles(id) NOT NULL,
  referee_id UUID REFERENCES user_profiles(id) NOT NULL,
  referee_email TEXT NOT NULL,
  type TEXT NOT NULL,
  referrer_reward DECIMAL DEFAULT 0,
  referee_reward DECIMAL DEFAULT 0,
  order_id TEXT,
  status TEXT DEFAULT 'completed',
  metadata JSONB DEFAULT '{}',
  processed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Create products table
CREATE TABLE products (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  short_description TEXT,
  price DECIMAL NOT NULL,
  compare_at_price DECIMAL,
  cost_price DECIMAL,
  images TEXT[] DEFAULT '{}',
  thumbnail_url TEXT,
  category TEXT NOT NULL,
  subcategory TEXT,
  tags TEXT[] DEFAULT '{}',
  sku TEXT UNIQUE,
  barcode TEXT,
  in_stock BOOLEAN DEFAULT true,
  stock_quantity INTEGER DEFAULT 0,
  track_inventory BOOLEAN DEFAULT false,
  allow_backorder BOOLEAN DEFAULT false,
  vendor_id UUID REFERENCES user_profiles(id),
  approved BOOLEAN DEFAULT false,
  featured BOOLEAN DEFAULT false,
  is_digital BOOLEAN DEFAULT false,
  weight DECIMAL,
  dimensions JSONB,
  shipping_class TEXT,
  tax_class TEXT,
  status TEXT DEFAULT 'draft',
  visibility TEXT DEFAULT 'public',
  search_keywords TEXT,
  meta_title TEXT,
  meta_description TEXT,
  requires_personalization BOOLEAN DEFAULT false,
  print_time_hours DECIMAL,
  material_usage_grams DECIMAL,
  difficulty_level TEXT,
  print_settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create product_variations table
CREATE TABLE product_variations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  display_name TEXT,
  is_required BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create variation_options table
CREATE TABLE variation_options (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  variation_id UUID REFERENCES product_variations(id) ON DELETE CASCADE NOT NULL,
  value TEXT NOT NULL,
  display_value TEXT,
  price_adjustment DECIMAL DEFAULT 0,
  weight_adjustment DECIMAL DEFAULT 0,
  stock_quantity INTEGER DEFAULT 0,
  sku_suffix TEXT,
  color_hex TEXT,
  image_url TEXT,
  is_default BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create orders table
CREATE TABLE orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_number TEXT UNIQUE NOT NULL,
  user_id UUID REFERENCES user_profiles(id),
  customer_email TEXT,
  customer_name TEXT,
  subtotal DECIMAL NOT NULL,
  tax_amount DECIMAL DEFAULT 0,
  shipping_amount DECIMAL DEFAULT 0,
  discount_amount DECIMAL DEFAULT 0,
  total DECIMAL NOT NULL,
  currency TEXT DEFAULT 'USD',
  status TEXT DEFAULT 'pending',
  payment_status TEXT DEFAULT 'pending',
  fulfillment_status TEXT DEFAULT 'unfulfilled',
  payment_method TEXT,
  payment_intent_id TEXT,
  charge_id TEXT,
  billing_address JSONB,
  shipping_address JSONB,
  tracking_number TEXT,
  tracking_company TEXT,
  estimated_delivery TIMESTAMPTZ,
  notes TEXT,
  internal_notes TEXT,
  source TEXT DEFAULT 'web',
  discount_codes TEXT[] DEFAULT '{}',
  referral_code TEXT,
  tags TEXT[] DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  cancelled_at TIMESTAMPTZ,
  shipped_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create order_items table
CREATE TABLE order_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE NOT NULL,
  product_id UUID REFERENCES products(id),
  product_name TEXT NOT NULL,
  product_sku TEXT,
  quantity INTEGER NOT NULL,
  price DECIMAL NOT NULL,
  total DECIMAL NOT NULL,
  cost_price DECIMAL,
  variations JSONB DEFAULT '{}',
  personalization JSONB DEFAULT '{}',
  print_files TEXT[] DEFAULT '{}',
  fulfillment_status TEXT DEFAULT 'unfulfilled',
  vendor_id UUID REFERENCES user_profiles(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create messages table
CREATE TABLE messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  sender_id UUID REFERENCES user_profiles(id),
  recipient_id UUID REFERENCES user_profiles(id),
  subject TEXT,
  content TEXT NOT NULL,
  message_type TEXT DEFAULT 'text',
  attachments JSONB DEFAULT '[]',
  metadata JSONB DEFAULT '{}',
  is_read BOOLEAN DEFAULT false,
  is_archived BOOLEAN DEFAULT false,
  is_pinned BOOLEAN DEFAULT false,
  priority TEXT DEFAULT 'normal',
  reply_to TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create vendor_payouts table
CREATE TABLE vendor_payouts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_id UUID REFERENCES user_profiles(id) NOT NULL,
  order_id UUID REFERENCES orders(id) NOT NULL,
  order_item_id TEXT NOT NULL,
  sale_amount DECIMAL NOT NULL,
  platform_fee_rate DECIMAL NOT NULL,
  platform_fee DECIMAL NOT NULL,
  stripe_fee_rate DECIMAL NOT NULL,
  stripe_fee DECIMAL NOT NULL,
  payout_amount DECIMAL NOT NULL,
  currency TEXT DEFAULT 'USD',
  status TEXT DEFAULT 'pending',
  payout_method TEXT DEFAULT 'stripe_express',
  stripe_transfer_id TEXT,
  stripe_payout_id TEXT,
  failure_reason TEXT,
  processing_fee DECIMAL DEFAULT 0,
  net_amount DECIMAL,
  scheduled_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create founder_earnings table
CREATE TABLE founder_earnings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID REFERENCES orders(id) NOT NULL,
  founder_id UUID REFERENCES user_profiles(id) NOT NULL,
  sale_amount DECIMAL NOT NULL,
  cost_of_goods DECIMAL NOT NULL,
  platform_fees DECIMAL NOT NULL,
  stripe_fees DECIMAL NOT NULL,
  gross_profit DECIMAL NOT NULL,
  founder_percentage DECIMAL DEFAULT 0.35,
  founder_earnings DECIMAL NOT NULL,
  currency TEXT DEFAULT 'USD',
  status TEXT DEFAULT 'pending',
  payout_batch_id TEXT,
  notes TEXT,
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create kiosks table
CREATE TABLE kiosks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  display_name TEXT,
  vendor_id UUID REFERENCES user_profiles(id) NOT NULL,
  kiosk_user_id TEXT,
  location TEXT NOT NULL,
  address JSONB,
  is_active BOOLEAN DEFAULT true,
  commission_rate DECIMAL DEFAULT 0.15,
  partner_commission_rate DECIMAL DEFAULT 0.05,
  access_url TEXT UNIQUE NOT NULL,
  qr_code_url TEXT,
  total_sales DECIMAL DEFAULT 0,
  total_orders INTEGER DEFAULT 0,
  settings JSONB DEFAULT '{}',
  payment_methods TEXT[] DEFAULT '{"card","cash","itc_wallet"}',
  operating_hours JSONB,
  timezone TEXT DEFAULT 'UTC',
  last_activity TIMESTAMPTZ,
  last_heartbeat TIMESTAMPTZ,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create cost_variables table
CREATE TABLE cost_variables (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  manager_id UUID REFERENCES user_profiles(id) NOT NULL,
  location_id TEXT,
  location_name TEXT,
  filament_price_per_gram DECIMAL NOT NULL,
  electricity_cost_per_hour DECIMAL NOT NULL,
  average_packaging_cost DECIMAL NOT NULL,
  monthly_rent DECIMAL NOT NULL,
  overhead_percentage DECIMAL NOT NULL,
  default_margin_percentage DECIMAL NOT NULL,
  labor_rate_per_hour DECIMAL NOT NULL,
  currency TEXT DEFAULT 'USD',
  is_active BOOLEAN DEFAULT true,
  effective_date TIMESTAMPTZ DEFAULT NOW(),
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create product_cost_breakdowns table
CREATE TABLE product_cost_breakdowns (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID REFERENCES products(id) NOT NULL,
  manager_id UUID REFERENCES user_profiles(id) NOT NULL,
  cost_variables_id TEXT NOT NULL,
  print_time_hours DECIMAL NOT NULL,
  material_usage_grams DECIMAL NOT NULL,
  material_cost DECIMAL NOT NULL,
  electricity_cost DECIMAL NOT NULL,
  labor_cost DECIMAL NOT NULL,
  packaging_cost DECIMAL NOT NULL,
  overhead_cost DECIMAL NOT NULL,
  total_cost DECIMAL NOT NULL,
  suggested_margin DECIMAL NOT NULL,
  suggested_price DECIMAL NOT NULL,
  final_price DECIMAL,
  price_difference DECIMAL,
  approval_status TEXT DEFAULT 'pending',
  approved_by TEXT,
  notes TEXT,
  calculation_method TEXT DEFAULT 'manual',
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Add updated_at triggers
CREATE TRIGGER update_user_profiles_updated_at BEFORE UPDATE ON user_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_user_wallets_updated_at BEFORE UPDATE ON user_wallets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_referral_codes_updated_at BEFORE UPDATE ON referral_codes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_messages_updated_at BEFORE UPDATE ON messages FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_kiosks_updated_at BEFORE UPDATE ON kiosks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create indexes for better performance
CREATE INDEX idx_user_profiles_email ON user_profiles(email);
CREATE INDEX idx_user_profiles_username ON user_profiles(username);
CREATE INDEX idx_user_profiles_role ON user_profiles(role);
CREATE INDEX idx_points_transactions_user_id ON points_transactions(user_id);
CREATE INDEX idx_itc_transactions_user_id ON itc_transactions(user_id);
CREATE INDEX idx_products_vendor_id ON products(vendor_id);
CREATE INDEX idx_products_category ON products(category);
CREATE INDEX idx_products_status ON products(status);
CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_order_items_order_id ON order_items(order_id);
CREATE INDEX idx_messages_sender_id ON messages(sender_id);
CREATE INDEX idx_messages_recipient_id ON messages(recipient_id);