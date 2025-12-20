-- Performance indexes for faster queries
-- Created: 2025-12-20

-- Products table indexes
CREATE INDEX IF NOT EXISTS idx_products_is_active ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_products_is_featured ON products(is_featured);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_active_featured ON products(is_active, is_featured);

-- User profiles index for fast lookup
CREATE INDEX IF NOT EXISTS idx_user_profiles_id ON user_profiles(id);

-- Orders indexes
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);

-- Composite index for common product queries
CREATE INDEX IF NOT EXISTS idx_products_active_category ON products(is_active, category);

-- Analyze tables to update statistics for query planner
ANALYZE products;
ANALYZE user_profiles;
ANALYZE orders;
