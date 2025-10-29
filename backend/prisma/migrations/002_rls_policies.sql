-- Enable RLS on all tables
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- User Profiles Policies
-- Users can read their own profile
CREATE POLICY "Users can read own profile" ON public.user_profiles
  FOR SELECT USING (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "Users can update own profile" ON public.user_profiles
  FOR UPDATE USING (auth.uid() = id);

-- Public can read vendor profiles
CREATE POLICY "Public can read vendor profiles" ON public.user_profiles
  FOR SELECT USING (role = 'vendor');

-- User Wallets Policies
-- Users can read their own wallet
CREATE POLICY "Users can read own wallet" ON public.user_wallets
  FOR SELECT USING (auth.uid() = user_id);

-- Service role can update wallets
CREATE POLICY "Service role can manage wallets" ON public.user_wallets
  FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- Products Policies
-- Anyone can read active products
CREATE POLICY "Public can read active products" ON public.products
  FOR SELECT USING (status = 'active');

-- Vendors can manage their own products
CREATE POLICY "Vendors can manage own products" ON public.products
  FOR ALL USING (auth.uid() = vendor_id);

-- Orders Policies
-- Users can read their own orders
CREATE POLICY "Users can read own orders" ON public.orders
  FOR SELECT USING (auth.uid() = user_id);

-- Users can create their own orders
CREATE POLICY "Users can create orders" ON public.orders
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Service role can update orders
CREATE POLICY "Service role can update orders" ON public.orders
  FOR UPDATE USING (auth.jwt()->>'role' = 'service_role');
