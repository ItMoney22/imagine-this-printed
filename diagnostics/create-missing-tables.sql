-- Create missing tables for Imagine This Printed
-- Run this BEFORE fix-rls-policies.sql if tables don't exist

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create user_profiles table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(50) UNIQUE,
    display_name VARCHAR(100),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    bio TEXT,
    profile_image TEXT,
    avatar_url TEXT,
    location VARCHAR(255),
    website VARCHAR(255),
    social_links JSONB DEFAULT '{}',
    is_public BOOLEAN DEFAULT true,
    show_order_history BOOLEAN DEFAULT true,
    show_designs BOOLEAN DEFAULT true,
    show_models BOOLEAN DEFAULT true,
    role VARCHAR(50) DEFAULT 'customer',
    points INTEGER DEFAULT 0,
    itc_balance DECIMAL(10,2) DEFAULT 0,
    stripe_account_id VARCHAR(255),
    company_name VARCHAR(255),
    business_type VARCHAR(100),
    tax_id VARCHAR(100),
    wholesale_status VARCHAR(50) DEFAULT 'pending',
    wholesale_tier VARCHAR(50),
    credit_limit DECIMAL(10,2),
    payment_terms VARCHAR(100),
    joined_date TIMESTAMP DEFAULT NOW(),
    email_verified BOOLEAN DEFAULT false,
    profile_completed BOOLEAN DEFAULT false,
    metadata JSONB DEFAULT '{}',
    preferences JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create user_wallets table
CREATE TABLE IF NOT EXISTS public.user_wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    points_balance INTEGER DEFAULT 0,
    itc_balance DECIMAL(10,2) DEFAULT 0,
    stripe_customer_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create referral_codes table
CREATE TABLE IF NOT EXISTS public.referral_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) UNIQUE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    is_active BOOLEAN DEFAULT true,
    max_uses INTEGER,
    total_uses INTEGER DEFAULT 0,
    discount_type VARCHAR(20) DEFAULT 'percentage',
    discount_value DECIMAL(10,2),
    points_reward INTEGER DEFAULT 0,
    expires_at TIMESTAMP,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create products table (if needed)
CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100),
    subcategory VARCHAR(100),
    price DECIMAL(10,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    sku VARCHAR(100) UNIQUE,
    inventory_count INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    images JSONB DEFAULT '[]',
    variants JSONB DEFAULT '[]',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON user_profiles(email);
CREATE INDEX IF NOT EXISTS idx_user_profiles_username ON user_profiles(username);
CREATE INDEX IF NOT EXISTS idx_user_profiles_role ON user_profiles(role);
CREATE INDEX IF NOT EXISTS idx_user_wallets_user_id ON user_wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON referral_codes(code);

-- Grant permissions
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Success message
SELECT 'Tables created successfully!' as message;