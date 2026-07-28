-- Social Content Management tables
-- Created: 2025-12-22

-- Create social_submissions table (pending user submissions)
CREATE TABLE IF NOT EXISTS social_submissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  platform VARCHAR(50) NOT NULL CHECK (platform IN ('tiktok', 'instagram', 'youtube', 'twitter')),
  url TEXT NOT NULL,
  submitter_handle VARCHAR(255),
  submitted_by UUID REFERENCES auth.users(id),
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  description TEXT,
  notes TEXT,
  featured_products TEXT[] DEFAULT '{}',
  admin_notes TEXT,
  processed_by UUID REFERENCES auth.users(id),
  processed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for social_submissions
CREATE INDEX IF NOT EXISTS idx_social_submissions_status ON social_submissions(status);
CREATE INDEX IF NOT EXISTS idx_social_submissions_platform ON social_submissions(platform);
CREATE INDEX IF NOT EXISTS idx_social_submissions_submitted_by ON social_submissions(submitted_by);
CREATE INDEX IF NOT EXISTS idx_social_submissions_submitted_at ON social_submissions(submitted_at DESC);

-- Create social_posts table (approved/featured posts)
CREATE TABLE IF NOT EXISTS social_posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  submission_id UUID REFERENCES social_submissions(id) ON DELETE SET NULL,
  platform VARCHAR(50) NOT NULL CHECK (platform IN ('tiktok', 'instagram', 'youtube', 'twitter')),
  url TEXT NOT NULL,
  embed_code TEXT,
  thumbnail_url TEXT,
  title VARCHAR(500),
  description TEXT,
  author_username VARCHAR(255),
  author_display_name VARCHAR(255),
  author_profile_image TEXT,
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ DEFAULT NOW(),
  status VARCHAR(50) NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'featured', 'hidden')),
  tags TEXT[] DEFAULT '{}',
  product_ids TEXT[] DEFAULT '{}',
  votes INTEGER DEFAULT 0,
  is_featured BOOLEAN DEFAULT FALSE,
  featured_at TIMESTAMPTZ,
  view_count INTEGER DEFAULT 0,
  engagement JSONB DEFAULT '{"likes": 0, "shares": 0, "comments": 0}',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for social_posts
CREATE INDEX IF NOT EXISTS idx_social_posts_status ON social_posts(status);
CREATE INDEX IF NOT EXISTS idx_social_posts_is_featured ON social_posts(is_featured);
CREATE INDEX IF NOT EXISTS idx_social_posts_platform ON social_posts(platform);
CREATE INDEX IF NOT EXISTS idx_social_posts_approved_at ON social_posts(approved_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_posts_votes ON social_posts(votes DESC);

-- Create social_votes table (user votes on posts)
CREATE TABLE IF NOT EXISTS social_votes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id UUID REFERENCES social_posts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  vote_type VARCHAR(10) CHECK (vote_type IN ('up', 'down')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(post_id, user_id)
);

-- Create indexes for social_votes
CREATE INDEX IF NOT EXISTS idx_social_votes_post_id ON social_votes(post_id);
CREATE INDEX IF NOT EXISTS idx_social_votes_user_id ON social_votes(user_id);

-- Enable Row Level Security
ALTER TABLE social_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_votes ENABLE ROW LEVEL SECURITY;

-- RLS Policies for social_submissions
-- Users can create their own submissions
CREATE POLICY "Users can create submissions" ON social_submissions
  FOR INSERT WITH CHECK (auth.uid() = submitted_by);

-- Users can view their own submissions, admins can view all
CREATE POLICY "Users can view own submissions" ON social_submissions
  FOR SELECT USING (
    submitted_by = auth.uid() OR EXISTS (
      SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'manager', 'founder')
    )
  );

-- Admins can update/delete submissions
CREATE POLICY "Admins can update submissions" ON social_submissions
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'manager', 'founder'))
  );

CREATE POLICY "Admins can delete submissions" ON social_submissions
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'manager', 'founder'))
  );

-- RLS Policies for social_posts
-- Anyone can view approved/featured posts
CREATE POLICY "Anyone can view approved posts" ON social_posts
  FOR SELECT USING (status IN ('approved', 'featured'));

-- Admins can manage all posts
CREATE POLICY "Admins can insert posts" ON social_posts
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'manager', 'founder'))
  );

CREATE POLICY "Admins can update posts" ON social_posts
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'manager', 'founder'))
  );

CREATE POLICY "Admins can delete posts" ON social_posts
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'manager', 'founder'))
  );

-- RLS Policies for social_votes
-- Users can manage their own votes
CREATE POLICY "Users can vote" ON social_votes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can change own vote" ON social_votes
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can remove own vote" ON social_votes
  FOR DELETE USING (auth.uid() = user_id);

-- Anyone can view vote counts (for aggregation)
CREATE POLICY "Anyone can view votes" ON social_votes
  FOR SELECT USING (true);

-- Create updated_at trigger functions
CREATE OR REPLACE FUNCTION update_social_submissions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_social_posts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers
DROP TRIGGER IF EXISTS trigger_social_submissions_updated_at ON social_submissions;
CREATE TRIGGER trigger_social_submissions_updated_at
  BEFORE UPDATE ON social_submissions
  FOR EACH ROW
  EXECUTE FUNCTION update_social_submissions_updated_at();

DROP TRIGGER IF EXISTS trigger_social_posts_updated_at ON social_posts;
CREATE TRIGGER trigger_social_posts_updated_at
  BEFORE UPDATE ON social_posts
  FOR EACH ROW
  EXECUTE FUNCTION update_social_posts_updated_at();

-- Add comments for documentation
COMMENT ON TABLE social_submissions IS 'User-submitted social media content pending admin review';
COMMENT ON TABLE social_posts IS 'Approved social media posts for display on the platform';
COMMENT ON TABLE social_votes IS 'User votes (up/down) on social posts';
