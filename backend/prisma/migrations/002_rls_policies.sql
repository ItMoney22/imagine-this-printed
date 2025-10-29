-- Enable RLS on all tables
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- User Profiles Policies
-- Users can read their own profile
CREATE POLICY "Users can read own profile" ON public.user_profiles
  FOR SELECT USING (auth.uid() = id);

-- Users can create their own profile
CREATE POLICY "Users can create own profile" ON public.user_profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "Users can update own profile" ON public.user_profiles
  FOR UPDATE USING (auth.uid() = id);

-- Public can read vendor profiles
CREATE POLICY "Public can read vendor profiles" ON public.user_profiles
  FOR SELECT USING (role = 'vendor');

-- Admin and Founder can read all profiles
CREATE POLICY "Admin/Founder can read all profiles" ON public.user_profiles
  FOR SELECT USING (
    (SELECT role FROM public.user_profiles WHERE id = auth.uid()) IN ('admin', 'founder')
  );

-- Admin and Founder can manage all profiles
CREATE POLICY "Admin/Founder can update all profiles" ON public.user_profiles
  FOR UPDATE USING (
    (SELECT role FROM public.user_profiles WHERE id = auth.uid()) IN ('admin', 'founder')
  );

-- User Wallets Policies
-- Users can read their own wallet
CREATE POLICY "Users can read own wallet" ON public.user_wallets
  FOR SELECT USING (auth.uid() = user_id);

-- Users can update their own wallet
CREATE POLICY "Users can update own wallet" ON public.user_wallets
  FOR UPDATE USING (auth.uid() = user_id);

-- Users can insert their own wallet
CREATE POLICY "Users can insert own wallet" ON public.user_wallets
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Admin and Founder can manage all wallets
CREATE POLICY "Admin/Founder can manage all wallets" ON public.user_wallets
  FOR ALL USING (
    (SELECT role FROM public.user_profiles WHERE id = auth.uid()) IN ('admin', 'founder')
  );

-- Products Policies
-- Anyone can read active products
CREATE POLICY "Public can read active products" ON public.products
  FOR SELECT USING (status = 'active');

-- Vendors can read their own products
CREATE POLICY "Vendors can read own products" ON public.products
  FOR SELECT USING (auth.uid() = vendor_id);

-- Vendors can create products
CREATE POLICY "Vendors can create products" ON public.products
  FOR INSERT WITH CHECK (auth.uid() = vendor_id);

-- Vendors can update their own products
CREATE POLICY "Vendors can update own products" ON public.products
  FOR UPDATE USING (auth.uid() = vendor_id);

-- Vendors can delete their own products
CREATE POLICY "Vendors can delete own products" ON public.products
  FOR DELETE USING (auth.uid() = vendor_id);

-- Admin and Founder can manage all products
CREATE POLICY "Admin/Founder can manage all products" ON public.products
  FOR ALL USING (
    (SELECT role FROM public.user_profiles WHERE id = auth.uid()) IN ('admin', 'founder')
  );

-- Orders Policies
-- Users can read their own orders
CREATE POLICY "Users can read own orders" ON public.orders
  FOR SELECT USING (auth.uid() = user_id);

-- Users can create their own orders
CREATE POLICY "Users can create orders" ON public.orders
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own orders
CREATE POLICY "Users can update own orders" ON public.orders
  FOR UPDATE USING (auth.uid() = user_id);

-- Admin and Founder can read all orders
CREATE POLICY "Admin/Founder can read all orders" ON public.orders
  FOR SELECT USING (
    (SELECT role FROM public.user_profiles WHERE id = auth.uid()) IN ('admin', 'founder')
  );

-- Admin and Founder can manage all orders
CREATE POLICY "Admin/Founder can manage all orders" ON public.orders
  FOR ALL USING (
    (SELECT role FROM public.user_profiles WHERE id = auth.uid()) IN ('admin', 'founder')
  );
