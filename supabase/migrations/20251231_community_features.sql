-- Community Features Migration
-- Creates tables for community showcase with boost system

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- Table: community_posts
-- Unified feed of user designs and vendor products
-- ============================================
CREATE TABLE IF NOT EXISTS community_posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Post type discriminator
  post_type VARCHAR(20) NOT NULL CHECK (post_type IN ('design', 'vendor_product')),

  -- Reference to source content (one of these will be set based on post_type)
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  vendor_product_id UUID,

  -- Creator info (denormalized for performance)
  creator_id UUID NOT NULL,
  creator_username VARCHAR(255) NOT NULL,
  creator_display_name VARCHAR(255),
  creator_avatar_url TEXT,
  creator_role VARCHAR(50) DEFAULT 'customer',

  -- Post content
  title VARCHAR(255),
  description TEXT,
  primary_image_url TEXT NOT NULL,
  additional_images TEXT[] DEFAULT '{}',

  -- Engagement metrics
  free_vote_count INTEGER DEFAULT 0,
  paid_boost_count INTEGER DEFAULT 0,
  total_boost_score INTEGER DEFAULT 0,
  view_count INTEGER DEFAULT 0,

  -- Status and visibility
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'hidden', 'featured')),
  is_featured BOOLEAN DEFAULT FALSE,
  featured_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints: ensure proper reference based on post_type
  CONSTRAINT content_reference_check CHECK (
    (post_type = 'design' AND product_id IS NOT NULL) OR
    (post_type = 'vendor_product' AND vendor_product_id IS NOT NULL) OR
    (product_id IS NULL AND vendor_product_id IS NULL)
  )
);

-- Indexes for efficient feed queries
CREATE INDEX IF NOT EXISTS idx_community_posts_total_boost ON community_posts(total_boost_score DESC);
CREATE INDEX IF NOT EXISTS idx_community_posts_created ON community_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_posts_creator ON community_posts(creator_id);
CREATE INDEX IF NOT EXISTS idx_community_posts_type ON community_posts(post_type);
CREATE INDEX IF NOT EXISTS idx_community_posts_status ON community_posts(status);
CREATE INDEX IF NOT EXISTS idx_community_posts_featured ON community_posts(is_featured, featured_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_posts_product ON community_posts(product_id) WHERE product_id IS NOT NULL;

-- ============================================
-- Table: community_boosts
-- Tracks both free votes and paid ITC boosts
-- ============================================
CREATE TABLE IF NOT EXISTS community_boosts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Post and user reference
  post_id UUID REFERENCES community_posts(id) ON DELETE CASCADE NOT NULL,
  user_id UUID NOT NULL,

  -- Boost type
  boost_type VARCHAR(20) NOT NULL CHECK (boost_type IN ('free_vote', 'paid_boost')),

  -- For paid boosts: track ITC spent and points added
  itc_amount INTEGER DEFAULT 0,
  boost_points INTEGER DEFAULT 1,

  -- Status
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'removed')),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unique constraint: only one free vote per user per post
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_free_vote
  ON community_boosts(post_id, user_id)
  WHERE boost_type = 'free_vote' AND status = 'active';

-- Regular indexes
CREATE INDEX IF NOT EXISTS idx_community_boosts_post ON community_boosts(post_id);
CREATE INDEX IF NOT EXISTS idx_community_boosts_user ON community_boosts(user_id);
CREATE INDEX IF NOT EXISTS idx_community_boosts_created ON community_boosts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_boosts_type ON community_boosts(boost_type);

-- ============================================
-- Table: community_boost_earnings
-- Tracks ITC earnings for creators when posts receive boosts
-- ============================================
CREATE TABLE IF NOT EXISTS community_boost_earnings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- References
  post_id UUID REFERENCES community_posts(id) ON DELETE SET NULL,
  creator_id UUID NOT NULL,
  boost_id UUID REFERENCES community_boosts(id) ON DELETE SET NULL,
  booster_id UUID,

  -- Earnings details
  itc_earned INTEGER NOT NULL DEFAULT 1,
  boost_type VARCHAR(20) NOT NULL CHECK (boost_type IN ('free_vote', 'paid_boost')),

  -- Processing status
  status VARCHAR(20) DEFAULT 'credited' CHECK (status IN ('pending', 'credited', 'failed')),
  credited_at TIMESTAMPTZ DEFAULT NOW(),

  -- Link to ITC transaction for audit
  itc_transaction_id UUID,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_boost_earnings_creator ON community_boost_earnings(creator_id);
CREATE INDEX IF NOT EXISTS idx_boost_earnings_post ON community_boost_earnings(post_id);
CREATE INDEX IF NOT EXISTS idx_boost_earnings_status ON community_boost_earnings(status);

-- ============================================
-- Function: Update boost counts on community_posts
-- ============================================
CREATE OR REPLACE FUNCTION update_community_post_boost_counts()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'active' THEN
    UPDATE community_posts
    SET
      free_vote_count = CASE WHEN NEW.boost_type = 'free_vote' THEN free_vote_count + 1 ELSE free_vote_count END,
      paid_boost_count = CASE WHEN NEW.boost_type = 'paid_boost' THEN paid_boost_count + 1 ELSE paid_boost_count END,
      total_boost_score = total_boost_score + NEW.boost_points,
      updated_at = NOW()
    WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' AND OLD.status = 'active' THEN
    UPDATE community_posts
    SET
      free_vote_count = CASE WHEN OLD.boost_type = 'free_vote' THEN GREATEST(0, free_vote_count - 1) ELSE free_vote_count END,
      paid_boost_count = CASE WHEN OLD.boost_type = 'paid_boost' THEN GREATEST(0, paid_boost_count - 1) ELSE paid_boost_count END,
      total_boost_score = GREATEST(0, total_boost_score - OLD.boost_points),
      updated_at = NOW()
    WHERE id = OLD.post_id;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'active' AND NEW.status = 'removed' THEN
    -- Handle soft delete (status change to removed)
    UPDATE community_posts
    SET
      free_vote_count = CASE WHEN OLD.boost_type = 'free_vote' THEN GREATEST(0, free_vote_count - 1) ELSE free_vote_count END,
      paid_boost_count = CASE WHEN OLD.boost_type = 'paid_boost' THEN GREATEST(0, paid_boost_count - 1) ELSE paid_boost_count END,
      total_boost_score = GREATEST(0, total_boost_score - OLD.boost_points),
      updated_at = NOW()
    WHERE id = OLD.post_id;
    RETURN NEW;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create trigger for boost count updates
DROP TRIGGER IF EXISTS trigger_update_boost_counts ON community_boosts;
CREATE TRIGGER trigger_update_boost_counts
  AFTER INSERT OR DELETE OR UPDATE ON community_boosts
  FOR EACH ROW
  EXECUTE FUNCTION update_community_post_boost_counts();

-- ============================================
-- Function: Update updated_at timestamp
-- ============================================
CREATE OR REPLACE FUNCTION update_community_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_community_posts_updated ON community_posts;
CREATE TRIGGER trigger_community_posts_updated
  BEFORE UPDATE ON community_posts
  FOR EACH ROW
  EXECUTE FUNCTION update_community_updated_at();

-- ============================================
-- Row Level Security Policies
-- ============================================

-- Enable RLS
ALTER TABLE community_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_boosts ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_boost_earnings ENABLE ROW LEVEL SECURITY;

-- community_posts policies
DROP POLICY IF EXISTS "Anyone can view active community posts" ON community_posts;
CREATE POLICY "Anyone can view active community posts" ON community_posts
  FOR SELECT USING (status IN ('active', 'featured'));

DROP POLICY IF EXISTS "Users can create their own posts" ON community_posts;
CREATE POLICY "Users can create their own posts" ON community_posts
  FOR INSERT WITH CHECK (auth.uid()::text = creator_id::text);

DROP POLICY IF EXISTS "Users can update their own posts" ON community_posts;
CREATE POLICY "Users can update their own posts" ON community_posts
  FOR UPDATE USING (auth.uid()::text = creator_id::text);

DROP POLICY IF EXISTS "Admins can manage all community posts" ON community_posts;
CREATE POLICY "Admins can manage all community posts" ON community_posts
  FOR ALL USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'manager'))
  );

-- community_boosts policies
DROP POLICY IF EXISTS "Users can create boosts" ON community_boosts;
CREATE POLICY "Users can create boosts" ON community_boosts
  FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);

DROP POLICY IF EXISTS "Anyone can view boosts" ON community_boosts;
CREATE POLICY "Anyone can view boosts" ON community_boosts
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can remove their own free votes" ON community_boosts;
CREATE POLICY "Users can remove their own free votes" ON community_boosts
  FOR DELETE USING (auth.uid()::text = user_id::text AND boost_type = 'free_vote');

DROP POLICY IF EXISTS "Users can update their own boosts" ON community_boosts;
CREATE POLICY "Users can update their own boosts" ON community_boosts
  FOR UPDATE USING (auth.uid()::text = user_id::text);

-- community_boost_earnings policies
DROP POLICY IF EXISTS "Users can view their own earnings" ON community_boost_earnings;
CREATE POLICY "Users can view their own earnings" ON community_boost_earnings
  FOR SELECT USING (auth.uid()::text = creator_id::text);

DROP POLICY IF EXISTS "System can insert earnings" ON community_boost_earnings;
CREATE POLICY "System can insert earnings" ON community_boost_earnings
  FOR INSERT WITH CHECK (true);

-- ============================================
-- Helper View: Leaderboard
-- ============================================
CREATE OR REPLACE VIEW community_leaderboard AS
SELECT
  cp.creator_id,
  cp.creator_username,
  cp.creator_display_name,
  cp.creator_avatar_url,
  COUNT(DISTINCT cp.id) as post_count,
  SUM(cp.total_boost_score) as total_boosts_received,
  COALESCE(SUM(cbe.itc_earned), 0) as total_itc_earned,
  ROW_NUMBER() OVER (ORDER BY SUM(cp.total_boost_score) DESC) as rank
FROM community_posts cp
LEFT JOIN community_boost_earnings cbe ON cbe.creator_id = cp.creator_id
WHERE cp.status IN ('active', 'featured')
GROUP BY cp.creator_id, cp.creator_username, cp.creator_display_name, cp.creator_avatar_url
ORDER BY total_boosts_received DESC;

-- Grant access to the view
GRANT SELECT ON community_leaderboard TO authenticated;
GRANT SELECT ON community_leaderboard TO anon;
