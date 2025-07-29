-- Row Level Security (RLS) Policies
-- Enable RLS on all tables

-- Enable RLS
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE points_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE itc_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variations ENABLE ROW LEVEL SECURITY;
ALTER TABLE variation_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE founder_earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE kiosks ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_variables ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_cost_breakdowns ENABLE ROW LEVEL SECURITY;

-- User Profiles Policies
CREATE POLICY "Users can view their own profile" ON user_profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON user_profiles
    FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile" ON user_profiles
    FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Public profiles are viewable by all" ON user_profiles
    FOR SELECT USING (role = 'vendor' OR role = 'founder');

-- Admin access to all profiles
CREATE POLICY "Admins can access all profiles" ON user_profiles
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM user_profiles 
            WHERE id = auth.uid() AND role IN ('admin', 'founder')
        )
    );

-- User Wallets Policies
CREATE POLICY "Users can access their own wallet" ON user_wallets
    FOR ALL USING (auth.uid() = user_id);

-- Points Transactions Policies
CREATE POLICY "Users can view their own points transactions" ON points_transactions
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "System can insert points transactions" ON points_transactions
    FOR INSERT WITH CHECK (true);

-- ITC Transactions Policies
CREATE POLICY "Users can view their own ITC transactions" ON itc_transactions
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "System can insert ITC transactions" ON itc_transactions
    FOR INSERT WITH CHECK (true);

-- Referral Codes Policies
CREATE POLICY "Users can manage their own referral codes" ON referral_codes
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "All users can view active referral codes" ON referral_codes
    FOR SELECT USING (is_active = true);

-- Referral Transactions Policies
CREATE POLICY "Users can view referrals they're involved in" ON referral_transactions
    FOR SELECT USING (
        auth.uid() = referrer_id OR 
        auth.uid() = referee_id
    );

CREATE POLICY "System can manage referral transactions" ON referral_transactions
    FOR ALL WITH CHECK (true);

-- Products Policies
CREATE POLICY "All users can view approved products" ON products
    FOR SELECT USING (approved = true AND status = 'active');

CREATE POLICY "Vendors can manage their own products" ON products
    FOR ALL USING (auth.uid() = vendor_id);

CREATE POLICY "Admins can manage all products" ON products
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM user_profiles 
            WHERE id = auth.uid() AND role IN ('admin', 'founder')
        )
    );

-- Product Variations Policies
CREATE POLICY "Product variations follow product access" ON product_variations
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM products 
            WHERE id = product_id AND (
                approved = true AND status = 'active' OR
                vendor_id = auth.uid()
            )
        )
    );

CREATE POLICY "Vendors can manage their product variations" ON product_variations
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM products 
            WHERE id = product_id AND vendor_id = auth.uid()
        )
    );

-- Variation Options Policies
CREATE POLICY "Variation options follow variation access" ON variation_options
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM product_variations pv
            JOIN products p ON p.id = pv.product_id
            WHERE pv.id = variation_id AND (
                p.approved = true AND p.status = 'active' OR
                p.vendor_id = auth.uid()
            )
        )
    );

CREATE POLICY "Vendors can manage their variation options" ON variation_options
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM product_variations pv
            JOIN products p ON p.id = pv.product_id
            WHERE pv.id = variation_id AND p.vendor_id = auth.uid()
        )
    );

-- Orders Policies
CREATE POLICY "Users can view their own orders" ON orders
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create orders" ON orders
    FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can update their pending orders" ON orders
    FOR UPDATE USING (
        auth.uid() = user_id AND 
        status IN ('pending', 'confirmed')
    );

CREATE POLICY "Vendors can view orders for their products" ON orders
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM order_items oi
            JOIN products p ON p.id = oi.product_id
            WHERE oi.order_id = id AND p.vendor_id = auth.uid()
        )
    );

CREATE POLICY "Admins can manage all orders" ON orders
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM user_profiles 
            WHERE id = auth.uid() AND role IN ('admin', 'founder')
        )
    );

-- Order Items Policies
CREATE POLICY "Order items follow order access" ON order_items
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM orders 
            WHERE id = order_id AND (
                user_id = auth.uid() OR
                EXISTS (
                    SELECT 1 FROM products 
                    WHERE id = product_id AND vendor_id = auth.uid()
                )
            )
        )
    );

CREATE POLICY "System can manage order items" ON order_items
    FOR ALL WITH CHECK (true);

-- Messages Policies
CREATE POLICY "Users can view messages they sent or received" ON messages
    FOR SELECT USING (
        auth.uid() = sender_id OR 
        auth.uid() = recipient_id
    );

CREATE POLICY "Users can send messages" ON messages
    FOR INSERT WITH CHECK (auth.uid() = sender_id);

CREATE POLICY "Users can update messages they sent" ON messages
    FOR UPDATE USING (auth.uid() = sender_id);

-- Vendor Payouts Policies
CREATE POLICY "Vendors can view their own payouts" ON vendor_payouts
    FOR SELECT USING (auth.uid() = vendor_id);

CREATE POLICY "System can manage vendor payouts" ON vendor_payouts
    FOR ALL WITH CHECK (true);

-- Founder Earnings Policies
CREATE POLICY "Founders can view their own earnings" ON founder_earnings
    FOR SELECT USING (auth.uid() = founder_id);

CREATE POLICY "System can manage founder earnings" ON founder_earnings
    FOR ALL WITH CHECK (true);

-- Kiosks Policies
CREATE POLICY "Vendors can manage their own kiosks" ON kiosks
    FOR ALL USING (auth.uid() = vendor_id);

CREATE POLICY "All users can view active kiosks" ON kiosks
    FOR SELECT USING (is_active = true);

-- Cost Variables Policies
CREATE POLICY "Managers can manage their cost variables" ON cost_variables
    FOR ALL USING (auth.uid() = manager_id);

CREATE POLICY "Admins can manage all cost variables" ON cost_variables
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM user_profiles 
            WHERE id = auth.uid() AND role IN ('admin', 'founder')
        )
    );

-- Product Cost Breakdowns Policies
CREATE POLICY "Managers can manage cost breakdowns they created" ON product_cost_breakdowns
    FOR ALL USING (auth.uid() = manager_id);

CREATE POLICY "Product owners can view cost breakdowns" ON product_cost_breakdowns
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM products 
            WHERE id = product_id AND vendor_id = auth.uid()
        )
    );

CREATE POLICY "Admins can manage all cost breakdowns" ON product_cost_breakdowns
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM user_profiles 
            WHERE id = auth.uid() AND role IN ('admin', 'founder')
        )
    );

-- Function to handle new user creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, username, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'username', SPLIT_PART(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'full_name', NEW.email)
  );
  
  INSERT INTO public.user_wallets (user_id)
  VALUES (NEW.id);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for new user creation
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;