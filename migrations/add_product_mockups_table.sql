-- Migration: Add product_mockups table
-- Purpose: Store mockup templates with print area configuration for Product Designer
-- Created: 2025-11-10

-- Create product_mockups table
CREATE TABLE IF NOT EXISTS public.product_mockups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    view_type TEXT NOT NULL,
    mockup_image_url TEXT NOT NULL,
    thumbnail_url TEXT,
    print_area JSONB NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_product_mockups_category ON public.product_mockups(category);
CREATE INDEX IF NOT EXISTS idx_product_mockups_view_type ON public.product_mockups(view_type);
CREATE INDEX IF NOT EXISTS idx_product_mockups_is_active ON public.product_mockups(is_active);
CREATE INDEX IF NOT EXISTS idx_product_mockups_category_active ON public.product_mockups(category, is_active);

-- Add comment to table
COMMENT ON TABLE public.product_mockups IS 'Stores mockup templates with print area configurations for the Product Designer';
COMMENT ON COLUMN public.product_mockups.category IS 'Product category: shirts, hoodies, tumblers';
COMMENT ON COLUMN public.product_mockups.view_type IS 'Mockup view: front, back, side, flat-lay, lifestyle';
COMMENT ON COLUMN public.product_mockups.print_area IS 'JSON object with x, y, width, height, rotation (percentages 0-1)';
COMMENT ON COLUMN public.product_mockups.metadata IS 'Additional metadata for mockup configuration';

-- Create trigger for updated_at timestamp
CREATE OR REPLACE FUNCTION update_product_mockups_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_product_mockups_updated_at
    BEFORE UPDATE ON public.product_mockups
    FOR EACH ROW
    EXECUTE FUNCTION update_product_mockups_updated_at();

-- Enable Row Level Security
ALTER TABLE public.product_mockups ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Public read access for active mockups
CREATE POLICY "Public can view active mockups"
    ON public.product_mockups
    FOR SELECT
    USING (is_active = true);

-- RLS Policy: Admin-only write access (insert, update, delete)
-- Check if user has admin role in user_profiles table
CREATE POLICY "Admin can insert mockups"
    ON public.product_mockups
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.user_profiles
            WHERE user_profiles.id = auth.uid()
            AND user_profiles.role = 'admin'
        )
    );

CREATE POLICY "Admin can update mockups"
    ON public.product_mockups
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.user_profiles
            WHERE user_profiles.id = auth.uid()
            AND user_profiles.role = 'admin'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.user_profiles
            WHERE user_profiles.id = auth.uid()
            AND user_profiles.role = 'admin'
        )
    );

CREATE POLICY "Admin can delete mockups"
    ON public.product_mockups
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.user_profiles
            WHERE user_profiles.id = auth.uid()
            AND user_profiles.role = 'admin'
        )
    );

-- Grant permissions
GRANT SELECT ON public.product_mockups TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.product_mockups TO authenticated;
