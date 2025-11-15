# AI Product Builder - Next Steps & Frontend Integration

**Created:** 2025-11-07
**Status:** 🎉 Backend Complete - Ready for Frontend Integration

---

## ✅ What We've Accomplished

### Backend AI Product Builder (Admin Only)
1. **Source Image Generation** - Recraft V3 for realistic product images ($0.04/image)
2. **Background Removal** - Remove.bg integration (50 free calls/month, $0.02/call after)
3. **Mockup Generation** - Google Nano Banana for realistic product mockups
4. **Worker System** - Asynchronous job processing with 5-second polling
5. **Google Cloud Storage** - All images stored in GCS with signed URLs

### Key Features
- ✅ Manual step-by-step workflow (admin control at each step)
- ✅ Immediate background removal (no polling needed!)
- ✅ Mockups proceed even if background removal fails
- ✅ Updated Nano Banana prompts to preserve graphic design (no added backgrounds)
- ✅ Error handling and job status tracking

---

## 📊 Current GCS Structure

**Current Format:**
```
products/{product-uuid}/{asset-type}/{filename}
```

**Example:**
```
products/166623f3-d5ba-4e1b-9554-bfc31847dc6e/source/source-1762520923247.png
products/166623f3-d5ba-4e1b-9554-bfc31847dc6e/nobg/nobg-1762520965312.png
products/166623f3-d5ba-4e1b-9554-bfc31847dc6e/mockup/mockup-1762520983349.png
```

**Stats:**
- Total files: 62
- Total products: 19
- Organized by UUID only (makes manual search difficult)

### Recommendation: Add Product Name/Slug to Path

**Proposed Format:**
```
products/{product-slug}-{short-uuid}/{asset-type}/{filename}
```

**Example:**
```
products/coffee-mug-design-166623f3/source/source-1762520923247.png
products/coffee-mug-design-166623f3/nobg/nobg-1762520965312.png
products/coffee-mug-design-166623f3/mockup/mockup-1762520983349.png
```

**Benefits:**
- ✅ Human-readable folder names
- ✅ Easy to locate products in GCS console
- ✅ Still maintains UUID for uniqueness
- ✅ Searchable by product name

---

## 🎯 Next Big Steps

### 1. Frontend Customer AI Product Builder (ITP Credits)

**Goal:** Allow customers to create AI-generated products using ITP credits

**Pricing Model:**
- Source Image: 10 ITP credits ($0.04 cost + margin)
- Background Removal: 5 ITP credits ($0.02 cost + margin)
- Mockup Generation: 5 ITP credits per mockup ($0.02 cost + margin)
- **Total for complete product:** 20-30 ITP credits

**Required Features:**
- [ ] Frontend wizard similar to AdminCreateProductWizard
- [ ] ITP credit balance check before each step
- [ ] Deduct credits upon job creation
- [ ] Refund credits if job fails
- [ ] Show credit cost before each action
- [ ] Real-time progress updates
- [ ] Product preview at each step

**API Endpoints Needed:**
```typescript
// Check if user has enough credits
GET /api/ai/credits/check?cost=10

// Create product with credit deduction
POST /api/ai/customer/source-image
Body: { prompt, credits: 10, user_id }

POST /api/ai/customer/remove-background
Body: { product_id, credits: 5, user_id }

POST /api/ai/customer/create-mockups
Body: { product_id, templates, credits: 15, user_id }

// Get job status
GET /api/ai/customer/status/:jobId
```

---

### 2. Kiosk Integration

**Goal:** Vendors can offer AI product creation at kiosk terminals

**Pricing Model:**
- Kiosk adds markup on top of ITP credit cost
- Example: 30 ITP credits = $3 vendor price
- Vendor can set their own markup (e.g., $5-$10 per AI product)

**Required Features:**
- [ ] Kiosk-specific API endpoints
- [ ] Simplified UI for touchscreen use
- [ ] Quick preview/approval workflow
- [ ] Direct payment integration (bypass user accounts)
- [ ] Vendor commission tracking
- [ ] Print queue integration

**Kiosk API Endpoints:**
```typescript
// Kiosk creates guest product
POST /api/kiosk/ai/create-product
Body: {
  prompt,
  kiosk_id,
  vendor_id,
  payment_amount,
  customer_email (optional)
}

// Check kiosk AI product status
GET /api/kiosk/ai/status/:jobId

// Add to print queue
POST /api/kiosk/ai/finalize
Body: { product_id, kiosk_id, print_settings }
```

---

### 3. ITP Credits System Integration

**Database Schema Needed:**

```sql
-- Track AI job credits
CREATE TABLE ai_credits_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES user_profiles(id),
  job_id UUID REFERENCES ai_jobs(id),
  amount INTEGER NOT NULL, -- Credits deducted (negative) or refunded (positive)
  type TEXT NOT NULL, -- 'source_image', 'remove_background', 'mockup'
  status TEXT NOT NULL, -- 'pending', 'charged', 'refunded'
  created_at TIMESTAMP DEFAULT NOW()
);

-- Update user_wallets to track reserved credits
ALTER TABLE user_wallets
ADD COLUMN reserved_credits INTEGER DEFAULT 0;
```

**Credit Flow:**
1. User initiates AI job → Reserve credits from wallet
2. Job processing → Credits in "reserved" state
3. Job succeeds → Move credits from reserved to spent
4. Job fails → Refund reserved credits back to available

---

### 4. GCS Path Improvement

**Implementation:**

```typescript
// backend/services/google-cloud-storage.ts
export async function generateProductPath(
  productId: string,
  productName: string,
  assetType: 'source' | 'nobg' | 'mockup'
): Promise<string> {
  // Convert product name to slug
  const slug = productName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50); // Limit length

  // Use first 8 characters of UUID for uniqueness
  const shortId = productId.substring(0, 8);

  const timestamp = Date.now();
  const filename = `${assetType}-${timestamp}.png`;

  return `products/${slug}-${shortId}/${assetType}/${filename}`;
}
```

---

### 5. Admin Dashboard Enhancements

**Features to Add:**
- [ ] AI Product Analytics Dashboard
  - Total products created
  - Success/failure rates
  - Average generation time
  - Cost tracking (API calls)
- [ ] Bulk AI Product Generator
  - Upload CSV with prompts
  - Generate multiple products overnight
- [ ] AI Model Configuration
  - Switch between models (Recraft V3, FLUX, etc.)
  - Adjust parameters (style, size, etc.)
- [ ] Job Queue Management
  - Retry failed jobs
  - Cancel stuck jobs
  - View job logs

---

### 6. Customer Product Gallery

**Features:**
- [ ] "My AI Products" page
- [ ] Filter by date, status, type
- [ ] Re-generate variations
- [ ] Download source/mockup images
- [ ] Share products publicly
- [ ] Add to cart from AI products

---

## 🚀 Implementation Priority

### Phase 1 (Week 1-2): Frontend Foundation
1. ✅ Backend APIs (COMPLETE)
2. Create customer-facing wizard component
3. Integrate ITP credits check/deduction
4. Add real-time job status polling
5. Product preview and approval

### Phase 2 (Week 3): Kiosk Integration
1. Kiosk-specific API endpoints
2. Simplified touchscreen UI
3. Payment integration
4. Print queue connection
5. Vendor commission tracking

### Phase 3 (Week 4): Enhancements
1. Improve GCS folder structure
2. Admin analytics dashboard
3. Customer product gallery
4. Bulk generation tools

---

## 💰 Pricing Strategy

### Current Costs (Per Product)
- Recraft V3 (source image): $0.04
- Remove.bg (background removal): $0.02
- Nano Banana (mockup x3): $0.06 (estimated)
- **Total Cost:** ~$0.12

### Recommended ITP Credit Pricing
- Source Image: 10 ITP credits ($0.10) = 150% markup
- Background Removal: 5 ITP credits ($0.05) = 150% markup
- Mockup (x3): 15 ITP credits ($0.15) = 150% markup
- **Total Customer Price:** 30 ITP credits ($0.30)

### Kiosk Markup Example
- Base Cost: 30 ITP credits ($0.30)
- Vendor Markup: $4.70
- **Customer Kiosk Price:** $5.00

---

## 📝 Documentation Needed

1. **API Documentation**
   - Endpoint specifications
   - Request/response examples
   - Error codes
   - Rate limits

2. **Frontend Integration Guide**
   - Component usage
   - State management
   - Credit system integration
   - Real-time updates

3. **Kiosk Setup Guide**
   - Hardware requirements
   - Network configuration
   - Payment integration
   - Troubleshooting

4. **Cost Optimization Guide**
   - Model selection criteria
   - Batch processing strategies
   - Cache management

---

## 🔧 Technical Considerations

### Scaling
- Current worker handles 1 job at a time
- Need job queue system for high volume (Bull, BullMQ)
- Consider Redis for job state management
- Load balancing for multiple workers

### Error Handling
- Automatic retries for failed API calls
- Dead letter queue for persistent failures
- Email notifications for critical errors
- Slack/Discord webhooks for monitoring

### Monitoring
- Track API usage and costs
- Monitor job completion rates
- Alert on high failure rates
- Log AI model performance metrics

---

## 🎨 UI/UX Improvements

### Customer Wizard
- [ ] Step-by-step progress indicator
- [ ] Credit cost display at each step
- [ ] Real-time preview updates
- [ ] Image comparison (before/after)
- [ ] Download/share buttons
- [ ] Regenerate options

### Admin Interface
- [ ] Visual job queue dashboard
- [ ] One-click retry for failed jobs
- [ ] Bulk actions (delete, retry, cancel)
- [ ] Export job history to CSV
- [ ] Cost analysis charts

---

## 🔒 Security Considerations

1. **Rate Limiting**
   - Prevent abuse of AI endpoints
   - Limit jobs per user per day
   - Implement cooldown periods

2. **Credit Fraud Prevention**
   - Validate credit balance server-side
   - Atomic transactions for credit deduction
   - Audit trail for all credit changes

3. **Content Moderation**
   - Filter inappropriate prompts
   - Review flagged AI-generated images
   - NSFW detection on outputs

---

## 📞 Next Steps Summary

### Immediate (This Week)
1. ✅ Test updated Nano Banana prompts
2. Create frontend customer wizard
3. Implement ITP credit integration
4. Add job status polling to frontend

### Short Term (Next 2 Weeks)
1. Kiosk API endpoints
2. Kiosk touchscreen UI
3. Payment integration
4. GCS path improvements

### Long Term (Next Month)
1. Admin analytics dashboard
2. Bulk generation tools
3. Customer product gallery
4. Advanced features (variations, styles)

---

**Ready to proceed with Phase 1: Frontend Foundation?**

Let me know which component you'd like to tackle first!
