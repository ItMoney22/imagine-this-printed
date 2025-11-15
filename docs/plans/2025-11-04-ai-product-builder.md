# AI Product Builder Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an admin-only AI-powered product creation system that uses GPT for metadata normalization and Replicate for image generation and mockup rendering.

**Architecture:**
- Admin wizard (4 steps): Describe → Review → Generate → Publish
- GPT normalizes natural language → structured product data
- Replicate generates: (1) high-quality product image, (2) try-on mockup
- Async job processing with webhook callbacks
- All assets stored in Supabase Storage

**Tech Stack:** React, TypeScript, Express.js, Supabase, OpenAI GPT, Replicate

---

## Task 1: Database Migrations

**Files:**
- Create: `migrations/2025-11-04-ai-product-builder.sql`
- Create: `scripts/apply-migration.ts`

**Step 1: Create migration file**

Create: `migrations/2025-11-04-ai-product-builder.sql`

```sql
-- ============================================
-- AI Product Builder Database Schema
-- ============================================

-- Product categories (if not exists)
CREATE TABLE IF NOT EXISTS product_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Add category_id to products table if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='products' AND column_name='category_id'
  ) THEN
    ALTER TABLE products ADD COLUMN category_id UUID REFERENCES product_categories(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Add slug to products if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='products' AND column_name='slug'
  ) THEN
    ALTER TABLE products ADD COLUMN slug TEXT UNIQUE;
  END IF;
END $$;

-- Add status to products if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='products' AND column_name='status'
  ) THEN
    ALTER TABLE products ADD COLUMN status TEXT NOT NULL DEFAULT 'draft';
  END IF;
END $$;

-- Product assets (images, mockups, thumbnails)
CREATE TABLE IF NOT EXISTS product_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                -- 'source' | 'mockup' | 'variant' | 'thumb'
  path TEXT NOT NULL,                -- storage path
  url TEXT,                          -- public URL
  width INT,
  height INT,
  meta JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- AI jobs tracking
CREATE TABLE IF NOT EXISTS ai_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                -- 'gpt_product', 'replicate_image', 'replicate_mockup'
  status TEXT NOT NULL DEFAULT 'queued', -- queued|running|succeeded|failed
  input JSONB,
  output JSONB,
  error TEXT,
  prediction_id TEXT,                -- Replicate prediction ID
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Product tags
CREATE TABLE IF NOT EXISTS product_tags (
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (product_id, tag)
);

-- Product variants (sizes, colors)
CREATE TABLE IF NOT EXISTS product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                 -- e.g., "Black / L"
  price_cents INT,
  sku TEXT,
  stock INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_product_assets_product_id ON product_assets(product_id);
CREATE INDEX IF NOT EXISTS idx_product_assets_kind ON product_assets(kind);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_product_id ON ai_jobs(product_id);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_status ON ai_jobs(status);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_prediction_id ON ai_jobs(prediction_id);
CREATE INDEX IF NOT EXISTS idx_product_tags_product_id ON product_tags(product_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_product_id ON product_variants(product_id);

-- RLS Policies
ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;

-- Allow admins/managers to manage everything
CREATE POLICY "Admins can manage categories" ON product_categories
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'manager')
    )
  );

CREATE POLICY "Admins can manage assets" ON product_assets
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'manager')
    )
  );

CREATE POLICY "Admins can manage ai_jobs" ON ai_jobs
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'manager')
    )
  );

CREATE POLICY "Admins can manage tags" ON product_tags
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'manager')
    )
  );

CREATE POLICY "Admins can manage variants" ON product_variants
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'manager')
    )
  );

-- Public read access for published products
CREATE POLICY "Public can read published assets" ON product_assets
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM products
      WHERE products.id = product_assets.product_id
      AND products.status = 'active'
    )
  );

-- Insert seed categories
INSERT INTO product_categories (slug, name, description) VALUES
  ('dtf-transfers', 'DTF Transfers', 'Direct to Film heat transfers'),
  ('shirts', 'T-Shirts', 'Custom printed t-shirts'),
  ('hoodies', 'Hoodies', 'Custom printed hoodies'),
  ('tumblers', 'Tumblers', 'Custom printed tumblers')
ON CONFLICT (slug) DO NOTHING;
```

Expected: Migration file created

**Step 2: Apply migration to Supabase**

Use the Supabase MCP tool to apply the migration:

```typescript
// This will be done via MCP tool call in the actual implementation
```

Expected: All tables created, indexes added, RLS policies enabled

---

## Task 2: Environment Variables

**Files:**
- Update: `docs/ENV_VARIABLES.md`
- Create: `.env.local.example`

**Step 1: Add new environment variables to documentation**

Update: `docs/ENV_VARIABLES.md`

Add section:

```markdown
### AI Product Builder

**Backend Service:**
```env
# OpenAI GPT for product normalization
OPENAI_API_KEY=sk-...

# Replicate for image generation
REPLICATE_API_TOKEN=r8_...
REPLICATE_PRODUCT_MODEL_ID=stability-ai/sdxl:latest
REPLICATE_TRYON_MODEL_ID=nano-banana/virtual-tryon:latest

# Webhook security
AI_WEBHOOK_SECRET=<random-long-string>

# Asset storage (Supabase Storage bucket)
ASSET_BUCKET=products
```

**Frontend Service:**
```env
# No additional frontend vars needed (uses existing VITE_API_BASE)
```
```

Expected: Documentation updated

**Step 2: Create example env file**

Create: `.env.local.example`

```env
# Add these to your existing .env.local
OPENAI_API_KEY=sk-your-openai-api-key
REPLICATE_API_TOKEN=r8_your-replicate-token
REPLICATE_PRODUCT_MODEL_ID=stability-ai/sdxl:latest
REPLICATE_TRYON_MODEL_ID=nano-banana/virtual-tryon:latest
AI_WEBHOOK_SECRET=your-random-secret-min-32-chars
ASSET_BUCKET=products
```

Expected: Example file created

---

## Task 3: Backend - Utility Services

**Files:**
- Create: `server/services/replicate.ts`
- Create: `server/services/ai-product.ts`
- Create: `server/utils/slugify.ts`
- Create: `server/utils/storage.ts`

**Step 1: Create Replicate service**

Create: `server/services/replicate.ts`

```typescript
import Replicate from 'replicate';

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN!,
});

export interface ReplicateImageInput {
  prompt: string;
  num_outputs?: number;
  width?: number;
  height?: number;
  background?: 'transparent' | 'studio';
}

export interface ReplicateTryOnInput {
  garment_image: string; // URL or base64
  template?: 'tshirt_front_flat' | 'tshirt_human_front';
}

export async function generateProductImage(input: ReplicateImageInput) {
  const modelId = process.env.REPLICATE_PRODUCT_MODEL_ID!;

  console.log('[replicate] 🎨 Generating product image:', { modelId, prompt: input.prompt });

  const prediction = await replicate.predictions.create({
    version: modelId,
    input: {
      prompt: input.prompt,
      num_outputs: input.num_outputs || 1,
      width: input.width || 1024,
      height: input.height || 1024,
      // Add model-specific params here
    },
    webhook: `${process.env.PUBLIC_URL}/api/ai/replicate/callback`,
    webhook_events_filter: ['completed'],
  });

  console.log('[replicate] ✅ Prediction created:', prediction.id);

  return prediction;
}

export async function generateMockup(input: ReplicateTryOnInput) {
  const modelId = process.env.REPLICATE_TRYON_MODEL_ID!;

  console.log('[replicate] 👕 Generating mockup:', { modelId });

  const prediction = await replicate.predictions.create({
    version: modelId,
    input: {
      garment_image: input.garment_image,
      template: input.template || 'tshirt_front_flat',
    },
    webhook: `${process.env.PUBLIC_URL}/api/ai/replicate/callback`,
    webhook_events_filter: ['completed'],
  });

  console.log('[replicate] ✅ Mockup prediction created:', prediction.id);

  return prediction;
}

export async function getPrediction(predictionId: string) {
  return await replicate.predictions.get(predictionId);
}
```

Expected: Replicate service created

**Step 2: Create AI product service**

Create: `server/services/ai-product.ts`

```typescript
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export interface ProductNormalizationInput {
  prompt: string;
  priceTarget?: number;
  mockupStyle?: 'flat' | 'human';
  background?: 'transparent' | 'studio';
  tone?: string;
}

export interface NormalizedProduct {
  category_slug: string;
  category_name: string;
  title: string;
  summary: string;
  description: string;
  tags: string[];
  seo_title: string;
  seo_description: string;
  suggested_price_cents: number;
  variants: Array<{
    name: string;
    priceDeltaCents?: number;
  }>;
  mockup_style: 'flat' | 'human';
  background: 'transparent' | 'studio';
}

const SYSTEM_PROMPT = `You are a product operations expert for a custom-print shop. Given a free-form idea, output normalized product metadata strictly as compact JSON with these fields:

- category_slug: one of ['dtf-transfers', 'shirts', 'hoodies', 'tumblers']
- category_name: human-readable category name
- title: concise product title (max 80 chars)
- summary: one-line summary (max 160 chars)
- description: detailed product description (2-3 paragraphs, markdown supported)
- tags: array of relevant tags for search/SEO (5-10 tags)
- seo_title: SEO-optimized title (max 60 chars)
- seo_description: SEO meta description (max 160 chars)
- suggested_price_cents: suggested retail price in cents (USD)
- variants: array of variant objects with name and optional priceDeltaCents
- mockup_style: "flat" or "human"
- background: "transparent" or "studio"

Output ONLY valid JSON, no markdown code blocks or explanations.`;

export async function normalizeProduct(
  input: ProductNormalizationInput
): Promise<NormalizedProduct> {
  console.log('[ai-product] 🤖 Normalizing product:', input.prompt);

  const userPrompt = `${input.prompt}

Additional preferences:
- Price target: ${input.priceTarget ? `$${input.priceTarget / 100}` : 'suggest based on product'}
- Mockup style: ${input.mockupStyle || 'auto-detect'}
- Background: ${input.background || 'transparent'}
- Tone: ${input.tone || 'professional and appealing'}`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4-turbo-preview',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.7,
  });

  const result = completion.choices[0].message.content!;
  const normalized = JSON.parse(result) as NormalizedProduct;

  console.log('[ai-product] ✅ Product normalized:', {
    title: normalized.title,
    category: normalized.category_slug,
    price: normalized.suggested_price_cents,
  });

  return normalized;
}
```

Expected: AI product service created

**Step 3: Create slugify utility**

Create: `server/utils/slugify.ts`

```typescript
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove non-word chars
    .replace(/[\s_-]+/g, '-')  // Replace spaces/underscores with hyphens
    .replace(/^-+|-+$/g, '');  // Remove leading/trailing hyphens
}

export function generateUniqueSlug(baseSlug: string, existingSlugs: string[]): string {
  let slug = baseSlug;
  let counter = 1;

  while (existingSlugs.includes(slug)) {
    slug = `${baseSlug}-${counter}`;
    counter++;
  }

  return slug;
}
```

Expected: Slugify utility created

**Step 4: Create storage utility**

Create: `server/utils/storage.ts`

```typescript
import { supabase } from '../lib/supabase';

export interface UploadOptions {
  bucket: string;
  path: string;
  buffer: Buffer;
  contentType: string;
  isPublic?: boolean;
}

export async function uploadFromBuffer(options: UploadOptions): Promise<string> {
  const { bucket, path, buffer, contentType, isPublic = true } = options;

  console.log('[storage] 📤 Uploading to:', { bucket, path, size: buffer.length });

  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(path, buffer, {
      contentType,
      upsert: true,
    });

  if (error) {
    console.error('[storage] ❌ Upload failed:', error);
    throw error;
  }

  console.log('[storage] ✅ Upload successful:', data.path);

  // Get public URL
  const { data: urlData } = supabase.storage
    .from(bucket)
    .getPublicUrl(data.path);

  return urlData.publicUrl;
}

export async function downloadImage(url: string): Promise<Buffer> {
  console.log('[storage] 📥 Downloading image:', url);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
```

Expected: Storage utility created

---

## Task 4: Backend - API Routes

**Files:**
- Create: `server/routes/admin/ai-products.ts`
- Create: `server/routes/ai/replicate-callback.ts`
- Update: `server/index.ts`

**Step 1: Create admin AI products route**

Create: `server/routes/admin/ai-products.ts`

```typescript
import { Router } from 'express';
import { supabase } from '../../lib/supabase';
import { normalizeProduct } from '../../services/ai-product';
import { slugify, generateUniqueSlug } from '../../utils/slugify';

const router = Router();

// Middleware to verify admin/manager role
async function requireAdmin(req: any, res: any, next: any) {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    return res.status(403).json({ error: 'Forbidden: Admin access required' });
  }

  req.user = user;
  req.profile = profile;
  next();
}

// POST /api/admin/products/ai/create
router.post('/create', requireAdmin, async (req, res) => {
  try {
    const { prompt, priceTarget, mockupStyle, background, tone } = req.body;

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    console.log('[ai-products] 🚀 Creating product from prompt:', prompt);

    // Step 1: Normalize with GPT
    const normalized = await normalizeProduct({
      prompt,
      priceTarget,
      mockupStyle,
      background,
      tone,
    });

    // Step 2: Upsert category
    const { data: category, error: catError } = await supabase
      .from('product_categories')
      .upsert({
        slug: normalized.category_slug,
        name: normalized.category_name,
      }, {
        onConflict: 'slug',
      })
      .select()
      .single();

    if (catError) {
      console.error('[ai-products] ❌ Category error:', catError);
      return res.status(500).json({ error: 'Failed to create category' });
    }

    // Step 3: Generate unique slug
    const baseSlug = slugify(normalized.title);
    const { data: existingProducts } = await supabase
      .from('products')
      .select('slug')
      .like('slug', `${baseSlug}%`);

    const existingSlugs = existingProducts?.map(p => p.slug) || [];
    const uniqueSlug = generateUniqueSlug(baseSlug, existingSlugs);

    // Step 4: Create product (draft)
    const { data: product, error: productError } = await supabase
      .from('products')
      .insert({
        category_id: category.id,
        name: normalized.title,
        slug: uniqueSlug,
        description: normalized.description,
        price: normalized.suggested_price_cents / 100,
        status: 'draft',
        in_stock: true,
        created_by: req.user.id,
      })
      .select()
      .single();

    if (productError) {
      console.error('[ai-products] ❌ Product error:', productError);
      return res.status(500).json({ error: 'Failed to create product' });
    }

    console.log('[ai-products] ✅ Product created:', product.id);

    // Step 5: Create tags
    if (normalized.tags.length > 0) {
      await supabase
        .from('product_tags')
        .insert(normalized.tags.map(tag => ({
          product_id: product.id,
          tag,
        })));
    }

    // Step 6: Create variants
    if (normalized.variants.length > 0) {
      await supabase
        .from('product_variants')
        .insert(normalized.variants.map(variant => ({
          product_id: product.id,
          name: variant.name,
          price_cents: normalized.suggested_price_cents + (variant.priceDeltaCents || 0),
          stock: 0,
        })));
    }

    // Step 7: Create AI jobs
    const jobs = [
      {
        product_id: product.id,
        type: 'replicate_image',
        status: 'queued',
        input: {
          prompt: `${normalized.title}, ${normalized.tags.join(', ')}, studio product shot, high detail, centered`,
          width: 1024,
          height: 1024,
          background: normalized.background,
        },
      },
      {
        product_id: product.id,
        type: 'replicate_mockup',
        status: 'queued',
        input: {
          template: normalized.mockup_style === 'flat' ? 'tshirt_front_flat' : 'tshirt_human_front',
        },
      },
    ];

    const { data: createdJobs, error: jobsError } = await supabase
      .from('ai_jobs')
      .insert(jobs)
      .select();

    if (jobsError) {
      console.error('[ai-products] ❌ Jobs error:', jobsError);
    }

    console.log('[ai-products] ✅ Jobs created:', createdJobs?.length);

    res.json({
      productId: product.id,
      product: {
        ...product,
        normalized,
      },
      jobs: createdJobs,
    });
  } catch (error: any) {
    console.error('[ai-products] ❌ Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/products/:id/status
router.get('/:id/status', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Get product
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('*, product_assets(*), ai_jobs(*)')
      .eq('id', id)
      .single();

    if (productError || !product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json(product);
  } catch (error: any) {
    console.error('[ai-products] ❌ Error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
```

Expected: Admin AI products route created

**Step 2: Create Replicate callback route**

Create: `server/routes/ai/replicate-callback.ts`

```typescript
import { Router } from 'express';
import crypto from 'crypto';
import { supabase } from '../../lib/supabase';
import { uploadFromBuffer, downloadImage } from '../../utils/storage';

const router = Router();

// Verify Replicate webhook signature
function verifySignature(req: any): boolean {
  const secret = process.env.AI_WEBHOOK_SECRET!;
  const signature = req.headers['x-replicate-signature'];

  if (!signature) {
    return false;
  }

  const payload = JSON.stringify(req.body);
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  const expectedSignature = hmac.digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

// POST /api/ai/replicate/callback
router.post('/callback', async (req, res) => {
  try {
    // Verify signature
    if (!verifySignature(req)) {
      console.error('[replicate-callback] ❌ Invalid signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { id: predictionId, status, output, error: replicateError } = req.body;

    console.log('[replicate-callback] 📥 Received:', {
      predictionId,
      status,
      hasOutput: !!output,
    });

    // Find the job
    const { data: job, error: jobError } = await supabase
      .from('ai_jobs')
      .select('*')
      .eq('prediction_id', predictionId)
      .single();

    if (jobError || !job) {
      console.error('[replicate-callback] ❌ Job not found:', predictionId);
      return res.status(404).json({ error: 'Job not found' });
    }

    if (status === 'succeeded' && output) {
      // Download image from Replicate output
      const imageUrl = Array.isArray(output) ? output[0] : output;

      if (!imageUrl) {
        console.error('[replicate-callback] ❌ No image URL in output');
        await supabase
          .from('ai_jobs')
          .update({
            status: 'failed',
            error: 'No image URL in output',
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id);

        return res.status(400).json({ error: 'No image URL' });
      }

      console.log('[replicate-callback] 📥 Downloading image:', imageUrl);
      const imageBuffer = await downloadImage(imageUrl);

      // Upload to Supabase Storage
      const timestamp = Date.now();
      const kind = job.type === 'replicate_image' ? 'source' : 'mockup';
      const path = `products/${job.product_id}/${kind}-${timestamp}.png`;

      const publicUrl = await uploadFromBuffer({
        bucket: process.env.ASSET_BUCKET || 'products',
        path,
        buffer: imageBuffer,
        contentType: 'image/png',
        isPublic: true,
      });

      console.log('[replicate-callback] ✅ Uploaded to:', publicUrl);

      // Create product_asset record
      const { error: assetError } = await supabase
        .from('product_assets')
        .insert({
          product_id: job.product_id,
          kind,
          path,
          url: publicUrl,
          width: 1024, // TODO: Get actual dimensions
          height: 1024,
          meta: { replicate_prediction_id: predictionId },
        });

      if (assetError) {
        console.error('[replicate-callback] ❌ Asset error:', assetError);
      }

      // Update job status
      await supabase
        .from('ai_jobs')
        .update({
          status: 'succeeded',
          output: { imageUrl: publicUrl },
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id);

      // If this was the mockup job, update product images array
      if (kind === 'mockup') {
        const { data: product } = await supabase
          .from('products')
          .select('images')
          .eq('id', job.product_id)
          .single();

        const images = product?.images || [];
        images.push(publicUrl);

        await supabase
          .from('products')
          .update({ images })
          .eq('id', job.product_id);
      }

      console.log('[replicate-callback] ✅ Job completed:', job.id);
    } else if (status === 'failed') {
      // Update job with error
      await supabase
        .from('ai_jobs')
        .update({
          status: 'failed',
          error: replicateError || 'Replicate generation failed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id);

      console.error('[replicate-callback] ❌ Job failed:', job.id, replicateError);
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('[replicate-callback] ❌ Error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
```

Expected: Replicate callback route created

**Step 3: Update server index to include new routes**

Update: `server/index.ts`

Add imports and route mounting:

```typescript
import aiProductsRouter from './routes/admin/ai-products';
import replicateCallbackRouter from './routes/ai/replicate-callback';

// Mount routes
app.use('/api/admin/products/ai', aiProductsRouter);
app.use('/api/ai/replicate', replicateCallbackRouter);
```

Expected: Routes registered in server

---

## Task 5: Backend - Worker Process

**Files:**
- Create: `server/worker/ai-jobs-worker.ts`
- Create: `server/worker/index.ts`
- Update: `package.json`

**Step 1: Create AI jobs worker**

Create: `server/worker/ai-jobs-worker.ts`

```typescript
import { supabase } from '../lib/supabase';
import { generateProductImage, generateMockup } from '../services/replicate';

const POLL_INTERVAL = 5000; // 5 seconds
const MAX_RETRIES = 3;

export async function processQueuedJobs() {
  try {
    // Fetch queued jobs
    const { data: jobs, error } = await supabase
      .from('ai_jobs')
      .select('*')
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(10);

    if (error) {
      console.error('[worker] ❌ Error fetching jobs:', error);
      return;
    }

    if (!jobs || jobs.length === 0) {
      return;
    }

    console.log('[worker] 📋 Processing', jobs.length, 'queued jobs');

    for (const job of jobs) {
      try {
        await processJob(job);
      } catch (error: any) {
        console.error('[worker] ❌ Error processing job:', job.id, error);

        // Update job with error
        await supabase
          .from('ai_jobs')
          .update({
            status: 'failed',
            error: error.message,
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id);
      }
    }
  } catch (error) {
    console.error('[worker] ❌ Worker error:', error);
  }
}

async function processJob(job: any) {
  console.log('[worker] 🔄 Processing job:', job.id, job.type);

  // Mark as running
  await supabase
    .from('ai_jobs')
    .update({
      status: 'running',
      updated_at: new Date().toISOString(),
    })
    .eq('id', job.id);

  if (job.type === 'replicate_image') {
    // Generate product image
    const prediction = await generateProductImage(job.input);

    // Update job with prediction ID
    await supabase
      .from('ai_jobs')
      .update({
        prediction_id: prediction.id,
        output: { prediction_id: prediction.id },
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id);

    console.log('[worker] ✅ Image generation started:', prediction.id);
  } else if (job.type === 'replicate_mockup') {
    // Wait for the source image to be ready
    const { data: sourceAsset } = await supabase
      .from('product_assets')
      .select('url')
      .eq('product_id', job.product_id)
      .eq('kind', 'source')
      .single();

    if (!sourceAsset) {
      throw new Error('Source image not ready yet');
    }

    // Generate mockup
    const prediction = await generateMockup({
      garment_image: sourceAsset.url,
      template: job.input.template,
    });

    // Update job with prediction ID
    await supabase
      .from('ai_jobs')
      .update({
        prediction_id: prediction.id,
        output: { prediction_id: prediction.id },
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id);

    console.log('[worker] ✅ Mockup generation started:', prediction.id);
  }
}

export function startWorker() {
  console.log('[worker] 🚀 Starting AI jobs worker');

  setInterval(async () => {
    await processQueuedJobs();
  }, POLL_INTERVAL);

  // Process immediately on start
  processQueuedJobs();
}
```

Expected: Worker created

**Step 2: Create worker entry point**

Create: `server/worker/index.ts`

```typescript
import dotenv from 'dotenv';
dotenv.config();

import { startWorker } from './ai-jobs-worker';

console.log('=================================');
console.log('AI Jobs Worker Starting...');
console.log('=================================');

startWorker();

console.log('Worker is running. Press Ctrl+C to stop.');
```

Expected: Worker entry point created

**Step 3: Add worker script to package.json**

Update: `package.json`

```json
{
  "scripts": {
    "worker": "tsx server/worker/index.ts",
    "worker:dev": "tsx watch server/worker/index.ts"
  }
}
```

Expected: Worker scripts added

---

## Task 6: Frontend - Type Definitions

**Files:**
- Update: `src/types/index.ts`

**Step 1: Add AI product types**

Update: `src/types/index.ts`

Add at the end:

```typescript
// AI Product Builder Types
export interface ProductCategory {
  id: string
  slug: string
  name: string
  description?: string
  created_at: string
}

export interface ProductAsset {
  id: string
  product_id: string
  kind: 'source' | 'mockup' | 'variant' | 'thumb'
  path: string
  url: string
  width?: number
  height?: number
  meta: Record<string, any>
  created_at: string
}

export interface AIJob {
  id: string
  product_id: string
  type: 'gpt_product' | 'replicate_image' | 'replicate_mockup'
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  input: Record<string, any>
  output?: Record<string, any>
  error?: string
  prediction_id?: string
  created_at: string
  updated_at: string
}

export interface ProductTag {
  product_id: string
  tag: string
}

export interface ProductVariant {
  id: string
  product_id: string
  name: string
  price_cents?: number
  sku?: string
  stock: number
  created_at: string
}

export interface NormalizedProduct {
  category_slug: string
  category_name: string
  title: string
  summary: string
  description: string
  tags: string[]
  seo_title: string
  seo_description: string
  suggested_price_cents: number
  variants: Array<{
    name: string
    priceDeltaCents?: number
  }>
  mockup_style: 'flat' | 'human'
  background: 'transparent' | 'studio'
}

export interface AIProductCreationRequest {
  prompt: string
  priceTarget?: number
  mockupStyle?: 'flat' | 'human'
  background?: 'transparent' | 'studio'
  tone?: string
}

export interface AIProductCreationResponse {
  productId: string
  product: Product & { normalized: NormalizedProduct }
  jobs: AIJob[]
}
```

Expected: Types added

---

## Task 7: Frontend - API Client

**Files:**
- Update: `src/lib/api.ts`

**Step 1: Add AI product API methods**

Update: `src/lib/api.ts`

Add methods:

```typescript
import type { AIProductCreationRequest, AIProductCreationResponse } from '@/types'

// AI Product Builder endpoints
export const aiProducts = {
  create: async (request: AIProductCreationRequest): Promise<AIProductCreationResponse> => {
    const response = await api.post('/admin/products/ai/create', request)
    return response.data
  },

  getStatus: async (productId: string) => {
    const response = await api.get(`/admin/products/ai/${productId}/status`)
    return response.data
  },
}
```

Expected: API methods added

---

## Task 8: Frontend - Admin Wizard Component

**Files:**
- Create: `src/components/AdminCreateProductWizard.tsx`
- Create: `src/pages/AdminAIProductBuilder.tsx`
- Update: `src/App.tsx`

**Step 1: Create wizard component**

Create: `src/components/AdminCreateProductWizard.tsx`

```typescript
import React, { useState } from 'react'
import type { AIProductCreationRequest, AIJob, NormalizedProduct } from '@/types'
import { aiProducts } from '@/lib/api'

type WizardStep = 'describe' | 'review' | 'generate' | 'finalize'

interface WizardState {
  step: WizardStep
  prompt: string
  priceTarget?: number
  mockupStyle?: 'flat' | 'human'
  background?: 'transparent' | 'studio'
  tone?: string
  normalized?: NormalizedProduct
  productId?: string
  jobs?: AIJob[]
}

export default function AdminCreateProductWizard() {
  const [state, setState] = useState<WizardState>({
    step: 'describe',
    prompt: '',
  })

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Step 1: Describe
  const handleDescribe = () => {
    if (!state.prompt.trim()) {
      setError('Please describe the product')
      return
    }
    setState({ ...state, step: 'review' })
  }

  // Step 2: Review & Generate
  const handleGenerate = async () => {
    setLoading(true)
    setError(null)

    try {
      const request: AIProductCreationRequest = {
        prompt: state.prompt,
        priceTarget: state.priceTarget,
        mockupStyle: state.mockupStyle,
        background: state.background,
        tone: state.tone,
      }

      const response = await aiProducts.create(request)

      setState({
        ...state,
        step: 'generate',
        normalized: response.product.normalized,
        productId: response.productId,
        jobs: response.jobs,
      })

      // Start polling for job status
      pollJobStatus(response.productId)
    } catch (err: any) {
      setError(err.message || 'Failed to create product')
    } finally {
      setLoading(false)
    }
  }

  // Poll job status
  const pollJobStatus = async (productId: string) => {
    const interval = setInterval(async () => {
      try {
        const status = await aiProducts.getStatus(productId)
        setState(prev => ({
          ...prev,
          jobs: status.ai_jobs,
        }))

        // Check if all jobs are complete
        const allComplete = status.ai_jobs.every(
          (job: AIJob) => job.status === 'succeeded' || job.status === 'failed'
        )

        if (allComplete) {
          clearInterval(interval)
        }
      } catch (err) {
        console.error('Poll error:', err)
      }
    }, 2000)
  }

  // Render steps
  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Progress Steps */}
      <div className="flex items-center justify-between mb-8">
        {['describe', 'review', 'generate', 'finalize'].map((step, index) => (
          <div
            key={step}
            className={`flex items-center ${
              index < ['describe', 'review', 'generate', 'finalize'].indexOf(state.step)
                ? 'text-primary'
                : index === ['describe', 'review', 'generate', 'finalize'].indexOf(state.step)
                ? 'text-accent'
                : 'text-muted'
            }`}
          >
            <div className="w-8 h-8 rounded-full border-2 flex items-center justify-center">
              {index + 1}
            </div>
            <span className="ml-2 capitalize">{step}</span>
            {index < 3 && <div className="w-12 h-0.5 bg-muted mx-4" />}
          </div>
        ))}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500 rounded-lg p-4 mb-6">
          {error}
        </div>
      )}

      {/* Step Content */}
      <div className="bg-card rounded-lg p-6 shadow-glow">
        {state.step === 'describe' && (
          <DescribeStep
            state={state}
            setState={setState}
            onNext={handleDescribe}
          />
        )}

        {state.step === 'review' && (
          <ReviewStep
            state={state}
            setState={setState}
            onBack={() => setState({ ...state, step: 'describe' })}
            onGenerate={handleGenerate}
            loading={loading}
          />
        )}

        {state.step === 'generate' && (
          <GenerateStep
            state={state}
            onNext={() => setState({ ...state, step: 'finalize' })}
          />
        )}

        {state.step === 'finalize' && (
          <FinalizeStep
            state={state}
          />
        )}
      </div>
    </div>
  )
}

// Step components (simplified for brevity)
function DescribeStep({ state, setState, onNext }: any) {
  return (
    <div>
      <h2 className="text-2xl font-display mb-4">Describe Your Product</h2>
      <p className="text-muted mb-6">
        Tell our AI what you want to create. Be as detailed as possible.
      </p>

      <textarea
        value={state.prompt}
        onChange={(e) => setState({ ...state, prompt: e.target.value })}
        className="w-full h-40 bg-bg border border-primary/30 rounded-lg p-4 text-text"
        placeholder="Example: Men's heavyweight tee with neon 'Imagine This Printed' logo, front chest, black shirt. Make it feel futuristic and premium."
      />

      <div className="mt-6 flex justify-end">
        <button
          onClick={onNext}
          className="px-6 py-2 bg-primary text-bg rounded-lg hover:bg-accent transition-colors"
        >
          Continue
        </button>
      </div>
    </div>
  )
}

function ReviewStep({ state, onBack, onGenerate, loading }: any) {
  return (
    <div>
      <h2 className="text-2xl font-display mb-4">Review & Customize</h2>
      <p className="text-muted mb-6">
        Review your input and adjust advanced options if needed.
      </p>

      <div className="space-y-4">
        <div>
          <label className="block text-sm text-muted mb-2">Your Description</label>
          <p className="text-text">{state.prompt}</p>
        </div>

        {/* Advanced options would go here */}
      </div>

      <div className="mt-6 flex justify-between">
        <button
          onClick={onBack}
          className="px-6 py-2 border border-primary/30 rounded-lg hover:bg-primary/10 transition-colors"
        >
          Back
        </button>
        <button
          onClick={onGenerate}
          disabled={loading}
          className="px-6 py-2 bg-primary text-bg rounded-lg hover:bg-accent transition-colors disabled:opacity-50"
        >
          {loading ? 'Generating...' : 'Generate Product'}
        </button>
      </div>
    </div>
  )
}

function GenerateStep({ state, onNext }: any) {
  const allComplete = state.jobs?.every(
    (job: AIJob) => job.status === 'succeeded' || job.status === 'failed'
  )

  return (
    <div>
      <h2 className="text-2xl font-display mb-4">Generating Assets</h2>
      <p className="text-muted mb-6">
        Our AI is creating your product images and mockups. This may take a few minutes.
      </p>

      <div className="space-y-4">
        {state.jobs?.map((job: AIJob) => (
          <div key={job.id} className="flex items-center justify-between p-4 bg-bg rounded-lg">
            <div>
              <h3 className="font-display">
                {job.type === 'replicate_image' ? 'Product Image' : 'Mockup'}
              </h3>
              <p className="text-sm text-muted">{job.status}</p>
            </div>
            <div>
              {job.status === 'succeeded' && <span className="text-green-400">✓</span>}
              {job.status === 'failed' && <span className="text-red-400">✗</span>}
              {job.status === 'running' && <span className="animate-spin">⟳</span>}
            </div>
          </div>
        ))}
      </div>

      {allComplete && (
        <div className="mt-6 flex justify-end">
          <button
            onClick={onNext}
            className="px-6 py-2 bg-primary text-bg rounded-lg hover:bg-accent transition-colors"
          >
            Continue to Finalize
          </button>
        </div>
      )}
    </div>
  )
}

function FinalizeStep({ state }: any) {
  return (
    <div>
      <h2 className="text-2xl font-display mb-4">Finalize & Publish</h2>
      <p className="text-muted mb-6">
        Review your product and publish when ready.
      </p>

      <div className="text-center py-12">
        <p className="text-muted">Product created successfully!</p>
        <p className="text-sm text-muted mt-2">Product ID: {state.productId}</p>

        <div className="mt-6">
          <a
            href={`/admin/products/${state.productId}`}
            className="px-6 py-2 bg-primary text-bg rounded-lg hover:bg-accent transition-colors inline-block"
          >
            View Product
          </a>
        </div>
      </div>
    </div>
  )
}
```

Expected: Wizard component created

**Step 2: Create page wrapper**

Create: `src/pages/AdminAIProductBuilder.tsx`

```typescript
import React from 'react'
import { useAuth } from '@/context/SupabaseAuthContext'
import AdminCreateProductWizard from '@/components/AdminCreateProductWizard'

export default function AdminAIProductBuilder() {
  const { user } = useAuth()

  if (!user || !['admin', 'manager'].includes(user.role)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-display mb-4">Access Denied</h1>
          <p className="text-muted">Admin access required</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg py-12">
      <div className="max-w-6xl mx-auto px-6">
        <h1 className="text-4xl font-display mb-2">AI Product Builder</h1>
        <p className="text-muted mb-8">Create products with AI-powered automation</p>

        <AdminCreateProductWizard />
      </div>
    </div>
  )
}
```

Expected: Page created

**Step 3: Add route to App.tsx**

Update: `src/App.tsx`

Add import:
```typescript
import AdminAIProductBuilder from './pages/AdminAIProductBuilder'
```

Add route:
```typescript
<Route path="/admin/ai/products/create" element={<ProtectedRoute><AdminAIProductBuilder /></ProtectedRoute>} />
```

Expected: Route added

---

## Task 9: Frontend - Navigation Integration

**Files:**
- Update: `src/components/Navbar.tsx`

**Step 1: Add AI Product Builder link to admin nav**

Update: `src/components/Navbar.tsx`

In the admin/manager navigation section, add:

```typescript
{(user.role === 'admin' || user.role === 'manager') && (
  <>
    {/* Existing admin links */}
    <Link to="/admin/ai/products/create" className="nav-link">
      🤖 AI Product Builder
    </Link>
  </>
)}
```

Expected: Navigation link added

---

## Task 10: Testing & Documentation

**Files:**
- Create: `docs/AI_PRODUCT_BUILDER.md`
- Update: `README.md`

**Step 1: Create feature documentation**

Create: `docs/AI_PRODUCT_BUILDER.md`

```markdown
# AI Product Builder

Automated product creation using GPT and Replicate.

## Overview

The AI Product Builder allows admins to create products by describing them in natural language. The system:

1. Uses GPT to normalize the description into structured metadata
2. Generates a high-quality product image using Replicate
3. Creates a mockup (try-on) using a Nano Banana-style model
4. Saves all assets to Supabase Storage
5. Creates the product with variants, tags, and SEO

## Setup

### Environment Variables

```env
OPENAI_API_KEY=sk-...
REPLICATE_API_TOKEN=r8_...
REPLICATE_PRODUCT_MODEL_ID=stability-ai/sdxl:latest
REPLICATE_TRYON_MODEL_ID=nano-banana/virtual-tryon:latest
AI_WEBHOOK_SECRET=<random-32-char-string>
ASSET_BUCKET=products
```

### Database

Run migration: `migrations/2025-11-04-ai-product-builder.sql`

### Worker

Start the worker process:
```bash
npm run worker
```

### Replicate Webhooks

Configure webhook URL in Replicate dashboard:
```
https://yourdomain.com/api/ai/replicate/callback
```

## Usage

1. Navigate to `/admin/ai/products/create`
2. Describe your product in detail
3. Review and customize options
4. Wait for AI generation
5. Finalize and publish

## API Endpoints

- `POST /api/admin/products/ai/create` - Create product from prompt
- `GET /api/admin/products/ai/:id/status` - Get generation status
- `POST /api/ai/replicate/callback` - Replicate webhook

## Architecture

- **GPT**: Normalizes product descriptions
- **Replicate**: Generates images and mockups
- **Worker**: Processes queued jobs asynchronously
- **Webhooks**: Receives completion notifications
- **Storage**: Supabase Storage for assets
```

Expected: Documentation created

**Step 2: Update README**

Update: `README.md`

Add to Features section:

```markdown
✅ **Phase 11 - AI Product Builder (NEW):**
- 🤖 GPT-powered product metadata normalization
- 🎨 Automated product image generation via Replicate
- 👕 Try-on mockup rendering (Nano Banana style)
- 📦 Async job processing with webhook callbacks
- 🔄 4-step wizard: Describe → Review → Generate → Publish
```

Expected: README updated

---

## Verification Steps

After completing all tasks:

1. **Database**: Verify all tables exist with `\dt` in Supabase SQL editor
2. **Backend**: Start server and worker, check logs
3. **Frontend**: Navigate to `/admin/ai/products/create`
4. **End-to-End**: Create a test product and verify:
   - GPT normalization works
   - Jobs are queued
   - Worker processes jobs
   - Replicate generates images
   - Webhooks update jobs
   - Assets are stored
   - Product is created

## Success Criteria

- ✅ Admin can describe product in natural language
- ✅ GPT normalizes to structured metadata
- ✅ Replicate generates product image
- ✅ Replicate generates mockup
- ✅ Assets stored in Supabase Storage
- ✅ Product created with all metadata
- ✅ Wizard shows live progress
- ✅ All jobs complete successfully

---

**Total Tasks:** 10
**Estimated Time:** 6-8 hours
**Complexity:** High (integrates multiple AI services)
