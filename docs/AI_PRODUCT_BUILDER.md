# AI Product Builder

**Status:** CURRENT
**Last Updated:** 2025-12-09

---

The AI Product Builder is a powerful feature that allows administrators and managers to create complete product listings using natural language descriptions. The system leverages OpenAI GPT-4 for product normalization and Replicate's AI models for high-quality image generation.

## Overview

### What It Does

1. **Natural Language Input**: Admin describes a product idea in plain English
2. **AI Normalization**: GPT-4 interprets the description and generates structured product metadata
3. **Image Generation**: Replicate SDXL generates high-quality product images
4. **Mockup Creation**: Virtual try-on models create realistic product mockups
5. **Automated Publishing**: Complete product listing ready for review and publication

### Key Features

- 4-step wizard interface (Describe → Review → Generate → Finalize)
- Real-time job status monitoring
- Asynchronous processing via background worker
- Webhook integration for completion notifications
- Full type safety with TypeScript
- Supports multiple variants, tags, and SEO metadata

## Architecture

### Frontend Components

#### AdminAIProductBuilder Page (`src/pages/AdminAIProductBuilder.tsx`)
- Page wrapper with admin/manager access control
- Renders the wizard component

#### AdminCreateProductWizard Component (`src/components/AdminCreateProductWizard.tsx`)
- **Step 1: Describe** - User inputs product description and preferences
- **Step 2: Review** - Shows AI's interpretation for approval
- **Step 3: Generate** - Real-time progress of image generation
- **Step 4: Finalize** - Display completed product with assets

#### API Client (`src/lib/api.ts`)
```typescript
aiProducts.create(request: AIProductCreationRequest): Promise<AIProductCreationResponse>
aiProducts.getStatus(productId: string): Promise<{ product, jobs }>
```

### Backend Services

#### AI Product Service (`backend/services/ai-product.ts`)
- Uses OpenAI GPT-4 Turbo for product normalization
- Structured JSON output with all product metadata
- Customizable prompts for different tones and styles

#### Replicate Service (`backend/services/replicate.ts`)
- Product image generation using SDXL
- Virtual try-on mockup generation
- Webhook configuration for async callbacks
- Prediction status polling

#### Storage Utils (`backend/utils/storage.ts`)
- Supabase Storage integration
- Image upload from URLs
- Public URL generation

### Backend Routes

#### POST `/api/admin/products/ai/create`
Creates a new AI-generated product.

**Request Body:**
```json
{
  "prompt": "A t-shirt with a futuristic cyberpunk cityscape...",
  "priceTarget": 29.99,
  "mockupStyle": "casual",
  "background": "studio",
  "tone": "professional"
}
```

**Response:**
```json
{
  "product": {
    "id": "uuid",
    "name": "Cyberpunk Cityscape T-Shirt",
    "slug": "cyberpunk-cityscape-t-shirt",
    "status": "draft"
  },
  "normalized": {
    "title": "Cyberpunk Cityscape T-Shirt",
    "description": "...",
    "category": "apparel",
    "tags": ["cyberpunk", "futuristic", "neon"],
    "variants": [...]
  },
  "jobs": [
    { "id": "uuid", "type": "replicate_image", "status": "queued" },
    { "id": "uuid", "type": "replicate_mockup", "status": "queued" }
  ]
}
```

#### GET `/api/admin/products/ai/:id/status`
Gets the current status of product generation.

**Response:**
```json
{
  "product": { ... },
  "jobs": [
    { "id": "uuid", "type": "replicate_image", "status": "succeeded", "output": {...} },
    { "id": "uuid", "type": "replicate_mockup", "status": "running" }
  ],
  "assets": [
    { "id": "uuid", "kind": "source", "url": "https://..." },
    { "id": "uuid", "kind": "mockup", "url": "https://..." }
  ]
}
```

#### POST `/api/ai/replicate/callback`
Webhook endpoint for Replicate completion events.

**Headers:**
- `Replicate-Signature`: HMAC SHA256 signature for verification

**Processing:**
1. Verifies webhook signature
2. Downloads generated image
3. Uploads to Supabase Storage
4. Updates ai_jobs status
5. Creates product_assets record

### Background Worker

#### Worker Process (`backend/worker/index.ts`)
- Runs independently via `npm run worker`
- Polls `ai_jobs` table every 5 seconds
- Processes queued jobs in order
- Calls Replicate API to start generation
- Updates jobs with prediction IDs

#### Job Types
- `replicate_image`: Generate product image from text prompt
- `replicate_mockup`: Generate try-on mockup from product image

## Database Schema

### Tables

#### `product_categories`
```sql
id UUID PRIMARY KEY
name TEXT NOT NULL
slug TEXT UNIQUE
description TEXT
created_at TIMESTAMPTZ
```

#### `product_assets`
```sql
id UUID PRIMARY KEY
product_id UUID REFERENCES products(id)
kind TEXT NOT NULL (source, mockup, variant)
url TEXT NOT NULL
metadata JSONB
created_at TIMESTAMPTZ
```

#### `ai_jobs`
```sql
id UUID PRIMARY KEY
product_id UUID REFERENCES products(id)
type TEXT NOT NULL
status TEXT NOT NULL (queued, running, succeeded, failed)
input JSONB
output JSONB
error TEXT
prediction_id TEXT
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

#### `product_tags`
```sql
id UUID PRIMARY KEY
product_id UUID REFERENCES products(id)
tag TEXT NOT NULL
created_at TIMESTAMPTZ
```

#### `product_variants`
```sql
id UUID PRIMARY KEY
product_id UUID REFERENCES products(id)
size TEXT
color TEXT
price NUMERIC
sku TEXT
stock_quantity INTEGER
created_at TIMESTAMPTZ
```

### Row Level Security (RLS)

All tables have RLS policies restricting access to admin/manager roles:
```sql
CREATE POLICY "admin_full_access" ON table_name
FOR ALL USING (
  auth.jwt()->>'role' IN ('admin', 'manager')
);
```

## Environment Variables

### Backend (Required)

```bash
# OpenAI API (GPT-4)
OPENAI_API_KEY=sk-...

# Replicate API (Image Generation)
REPLICATE_API_TOKEN=r8_...
REPLICATE_PRODUCT_MODEL_ID=stability-ai/sdxl:...
REPLICATE_TRYON_MODEL_ID=cuuupid/idm-vton:...

# Webhook Security
AI_WEBHOOK_SECRET=your-random-secret-string

# Supabase Storage
ASSET_BUCKET=products

# Public URL (for webhooks)
PUBLIC_URL=https://api.imaginethisprinted.com
```

### Frontend (Required)

```bash
# API Base URL
VITE_API_BASE=https://api.imaginethisprinted.com
```

## Deployment

### Backend Deployment (Railway)

1. **Install Dependencies**
   ```bash
   cd backend
   npm install
   ```

2. **Run Database Migration**
   ```bash
   # Use Supabase MCP or psql
   psql $DATABASE_URL < migrations/2025-11-04-ai-product-builder.sql
   ```

3. **Set Environment Variables** in Railway dashboard

4. **Deploy API Server**
   ```bash
   npm run build
   npm start
   ```

5. **Deploy Worker Process** (separate Railway service)
   ```bash
   npm run worker
   ```

### Frontend Deployment (Vercel)

1. **Set Environment Variables** in Vercel dashboard

2. **Deploy**
   ```bash
   vercel --prod
   ```

## Usage Guide

### For Administrators/Managers

1. **Navigate to AI Product Builder**
   - Click Account → AI Product Builder in navbar
   - Or visit `/admin/ai/products/create`

2. **Step 1: Describe Your Product**
   - Enter detailed product description
   - Set target price (optional)
   - Choose mockup style: Casual, Lifestyle, or Product Focus
   - Select background: Studio, Lifestyle, or Urban
   - Pick brand tone: Professional, Playful, or Minimal

3. **Step 2: Review AI Interpretation**
   - Check product title and description
   - Review category and tags
   - Verify suggested price and variants
   - Inspect image generation prompt
   - Either proceed or start over to refine

4. **Step 3: Wait for Generation**
   - Monitor real-time job status
   - Two jobs: Product Image + Try-On Mockup
   - Status updates every 2 seconds
   - Takes 2-5 minutes total

5. **Step 4: View Final Product**
   - See generated assets
   - Product saved as "draft" status
   - Click "View Product Details" to edit/publish
   - Or create another product

## Technical Details

### GPT-4 System Prompt

The AI normalizes products using a structured system prompt:
- Interprets natural language descriptions
- Generates SEO-optimized titles and descriptions
- Suggests appropriate category and tags
- Creates multiple variants with pricing
- Outputs enhanced image generation prompts

### Replicate Models

**Product Images** (SDXL):
- High-quality 1024x1024 resolution
- Optimized prompts with negative prompts
- Consistent "Nano Banana" artistic style

**Try-On Mockups** (IDM-VTON):
- Virtual garment try-on
- Realistic clothing placement
- Multiple template options

### Webhook Security

Replicate webhooks are verified using HMAC SHA256:
```typescript
const signature = createHmac('sha256', AI_WEBHOOK_SECRET)
  .update(JSON.stringify(body))
  .digest('base64')

if (signature !== req.headers['replicate-signature']) {
  return res.status(401).json({ error: 'Invalid signature' })
}
```

### Job Processing Flow

```
1. User submits prompt
2. GPT normalizes → structured metadata
3. Create product record (draft status)
4. Create product_tags records
5. Create product_variants records
6. Create 2 ai_jobs (queued)
7. Return response with job IDs

Background Worker:
8. Poll ai_jobs every 5s
9. Find queued jobs
10. Call Replicate API
11. Store prediction_id
12. Update status → running

Replicate Webhook:
13. Generation completes
14. Webhook POST to /api/ai/replicate/callback
15. Verify signature
16. Download image
17. Upload to Supabase Storage
18. Create product_assets record
19. Update ai_jobs → succeeded
20. Frontend polls status → finalize step
```

## Troubleshooting

### Common Issues

**Problem**: Worker not processing jobs
- **Solution**: Check worker process is running (`npm run worker`)
- **Solution**: Verify DATABASE_URL and REPLICATE_API_TOKEN

**Problem**: Webhook not received
- **Solution**: Ensure PUBLIC_URL is correct and accessible
- **Solution**: Check AI_WEBHOOK_SECRET matches

**Problem**: Images not uploading
- **Solution**: Verify Supabase Storage bucket exists
- **Solution**: Check SUPABASE_SERVICE_ROLE_KEY has storage access

**Problem**: GPT normalization fails
- **Solution**: Verify OPENAI_API_KEY is valid
- **Solution**: Check OpenAI API rate limits

### Logs

Backend logs are structured using Pino:
```bash
# View API logs
pm2 logs imagine-this-printed-api

# View worker logs
pm2 logs imagine-this-printed-worker
```

## Future Enhancements

- [ ] Support for multiple product types (mugs, hoodies, etc.)
- [ ] Batch product creation from CSV
- [ ] A/B testing for different image prompts
- [ ] Video mockup generation
- [ ] Style transfer from uploaded reference images
- [ ] Automatic SEO keyword optimization
- [ ] Integration with inventory management
- [ ] Multi-language product descriptions
- [ ] Analytics on AI-generated product performance

## API Reference

See [ENV_VARIABLES.md](./ENV_VARIABLES.md) for full environment configuration.

## Support

For issues or questions:
1. Check the troubleshooting section
2. Review backend logs for errors
3. Verify all environment variables are set
4. Contact the development team

---

**Last Updated**: November 4, 2025
**Version**: 1.0.0
