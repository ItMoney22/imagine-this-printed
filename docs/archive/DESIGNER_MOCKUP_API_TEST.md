# Designer Mockup API Testing Guide

## Overview

This document provides testing instructions for the new Designer Mockup Generation API endpoint.

**Endpoint:** `POST /api/designer/generate-mockup`

**Purpose:** Generate realistic product mockups using Replicate's AI image generation, deducting 25 ITC tokens from the user's wallet.

---

## API Endpoints

### 1. Generate Mockup (Authenticated)

**Endpoint:** `POST /api/designer/generate-mockup`

**Authentication:** Required (Bearer token)

**Request Body:**
```json
{
  "designImageUrl": "https://storage.googleapis.com/...",
  "productTemplate": "shirts",
  "mockupType": "flat"
}
```

**Parameters:**
- `designImageUrl` (string, required): URL to the design canvas export image
- `productTemplate` (string, required): One of: `"shirts"`, `"hoodies"`, `"tumblers"`
- `mockupType` (string, optional): One of: `"flat"`, `"lifestyle"` (default: `"flat"`)

**Response Success (200):**
```json
{
  "ok": true,
  "mockupUrl": "https://storage.googleapis.com/...",
  "cost": 25,
  "newBalance": 475
}
```

**Response Errors:**
- `401 Unauthorized`: Missing or invalid authentication token
- `400 Bad Request`: Missing required fields, invalid parameters, or insufficient ITC balance
- `500 Internal Server Error`: Replicate API error, GCS upload error, or database error

### 2. Get Mockup Cost (Public)

**Endpoint:** `GET /api/designer/mockup-cost`

**Authentication:** None required

**Response:**
```json
{
  "ok": true,
  "cost": 25,
  "currency": "ITC"
}
```

---

## Testing Instructions

### Prerequisites

1. **Environment Variables** (in backend `.env`):
   ```env
   REPLICATE_API_TOKEN=r8_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   # OR
   REPLICATE_API_KEY=r8_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx

   GCS_PROJECT_ID=your-project-id
   GCS_BUCKET_NAME=imagine-this-printed-products
   GCS_CREDENTIALS={"type":"service_account",...}

   SUPABASE_URL=https://czzyrmizvjqlifcivrhn.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   ```

2. **User Account Setup**:
   - Create a test user account
   - Ensure user has an entry in `user_wallets` table with sufficient ITC balance (>= 25)

3. **Database Setup**:
   - Ensure `product_mockups` table exists with sample mockup templates
   - Run migration: `migrations/add_product_mockups_table.sql` if not already done

---

### Test Case 1: Successful Mockup Generation

**Request:**
```bash
curl -X POST https://api.imaginethisprinted.com/api/designer/generate-mockup \
  -H "Authorization: Bearer YOUR_SUPABASE_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "designImageUrl": "https://storage.googleapis.com/imagine-this-printed-products/test-design.png",
    "productTemplate": "shirts",
    "mockupType": "flat"
  }'
```

**Expected Response:**
```json
{
  "ok": true,
  "mockupUrl": "https://storage.googleapis.com/imagine-this-printed-products/designer-mockups/user-id/1699999999999.png?GoogleAccessId=...",
  "cost": 25,
  "newBalance": 475
}
```

**Verification Steps:**
1. Check response contains `mockupUrl` with GCS signed URL
2. Check `cost` is 25
3. Check `newBalance` = previous balance - 25
4. Verify image exists at returned `mockupUrl`
5. Query `user_wallets` table to confirm ITC balance was deducted

---

### Test Case 2: Insufficient ITC Balance

**Setup:**
- Set user's ITC balance to less than 25 (e.g., 10)

**Request:**
```bash
curl -X POST https://api.imaginethisprinted.com/api/designer/generate-mockup \
  -H "Authorization: Bearer YOUR_SUPABASE_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "designImageUrl": "https://storage.googleapis.com/...",
    "productTemplate": "hoodies",
    "mockupType": "lifestyle"
  }'
```

**Expected Response (400):**
```json
{
  "error": "Insufficient ITC balance. Need 25, have 10"
}
```

---

### Test Case 3: Invalid Product Template

**Request:**
```bash
curl -X POST https://api.imaginethisprinted.com/api/designer/generate-mockup \
  -H "Authorization: Bearer YOUR_SUPABASE_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "designImageUrl": "https://storage.googleapis.com/...",
    "productTemplate": "mugs",
    "mockupType": "flat"
  }'
```

**Expected Response (400):**
```json
{
  "error": "Invalid productTemplate. Must be one of: shirts, hoodies, tumblers"
}
```

---

### Test Case 4: Missing Required Fields

**Request:**
```bash
curl -X POST https://api.imaginethisprinted.com/api/designer/generate-mockup \
  -H "Authorization: Bearer YOUR_SUPABASE_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "productTemplate": "shirts"
  }'
```

**Expected Response (400):**
```json
{
  "error": "designImageUrl and productTemplate are required"
}
```

---

### Test Case 5: Unauthorized Access

**Request:**
```bash
curl -X POST https://api.imaginethisprinted.com/api/designer/generate-mockup \
  -H "Content-Type: application/json" \
  -d '{
    "designImageUrl": "https://storage.googleapis.com/...",
    "productTemplate": "shirts"
  }'
```

**Expected Response (401):**
```json
{
  "error": "Unauthorized"
}
```

---

### Test Case 6: Get Mockup Cost (Public)

**Request:**
```bash
curl -X GET https://api.imaginethisprinted.com/api/designer/mockup-cost
```

**Expected Response (200):**
```json
{
  "ok": true,
  "cost": 25,
  "currency": "ITC"
}
```

---

## Integration Testing

### Frontend Integration

**Usage in React/TypeScript:**

```typescript
import { api } from '@/lib/api'

async function generateMockup(
  designImageUrl: string,
  productTemplate: 'shirts' | 'hoodies' | 'tumblers',
  mockupType: 'flat' | 'lifestyle' = 'flat'
) {
  try {
    const response = await api.post('/designer/generate-mockup', {
      designImageUrl,
      productTemplate,
      mockupType
    })

    if (response.data.ok) {
      console.log('Mockup generated:', response.data.mockupUrl)
      console.log('New ITC balance:', response.data.newBalance)
      return response.data
    }
  } catch (error: any) {
    if (error.response?.status === 400) {
      console.error('Insufficient balance:', error.response.data.error)
    } else {
      console.error('Failed to generate mockup:', error.message)
    }
    throw error
  }
}

// Usage in component
const result = await generateMockup(
  canvasRef.current.toDataURL(),
  'shirts',
  'flat'
)
```

---

## Monitoring & Debugging

### Server Logs

Look for log entries with the prefix `[designer/generate-mockup]`:

**Successful Flow:**
```
[designer/generate-mockup] 🚀 Request received: { userId: '...', productTemplate: 'shirts', mockupType: 'flat' }
[designer/generate-mockup] ✅ Wallet check passed. Balance: 500
[designer/generate-mockup] 📸 Using template mockup: https://...
[designer/generate-mockup] 🎨 Calling Replicate API...
[designer/generate-mockup] ✅ Replicate API response received
[designer/generate-mockup] 🖼️ Generated image URL: https://...
[designer/generate-mockup] 📤 Uploading to GCS: designer-mockups/user-id/1699999999999.png
[gcs] 📥 Downloading image from: https://...
[gcs] 📤 Uploading to GCS: designer-mockups/user-id/1699999999999.png
[gcs] ✅ Image uploaded successfully: https://...
[designer/generate-mockup] ✅ Uploaded to GCS: https://...
[designer/generate-mockup] 💰 Deducted 25 ITC tokens
[designer/generate-mockup] ✅ Mockup generated successfully
```

**Error Scenarios:**
- `❌ Unauthorized`: Missing/invalid JWT token
- `❌ Missing required fields`: Validation error
- `❌ Invalid product template`: Invalid parameter
- `❌ Insufficient balance`: User doesn't have 25 ITC
- `❌ Failed to fetch wallet`: Database error
- `❌ Replicate API error`: AI service unavailable or quota exceeded
- `❌ GCS upload error`: Storage service issue
- `❌ Failed to update wallet`: Database update failed

---

## Database Queries

### Check User Balance
```sql
SELECT itc_balance
FROM user_wallets
WHERE user_id = 'your-user-id';
```

### Check Mockup Templates
```sql
SELECT *
FROM product_mockups
WHERE category = 'shirts'
  AND view_type = 'flat-lay'
  AND is_active = true;
```

### View Recent Mockup Generations
```sql
-- Note: This requires adding a tracking table (optional)
-- For now, check GCS bucket: designer-mockups/{user-id}/
```

---

## Troubleshooting

### Issue: "Failed to generate mockup with AI"

**Possible Causes:**
1. Replicate API token is invalid or expired
2. Replicate API quota exceeded
3. Model ID is incorrect
4. Network connectivity issue

**Solution:**
- Verify `REPLICATE_API_TOKEN` or `REPLICATE_API_KEY` in environment
- Check Replicate dashboard for quota/usage
- Ensure model `stability-ai/stable-diffusion` is accessible

### Issue: "Failed to upload mockup to storage"

**Possible Causes:**
1. GCS credentials are invalid
2. Bucket doesn't exist
3. Insufficient permissions
4. Network issue

**Solution:**
- Verify `GCS_CREDENTIALS`, `GCS_PROJECT_ID`, `GCS_BUCKET_NAME`
- Check GCS bucket permissions
- Test with `uploadImageFromUrl()` function directly

### Issue: "Failed to fetch wallet"

**Possible Causes:**
1. User doesn't have wallet entry
2. Database connection issue
3. RLS policy blocking access

**Solution:**
- Verify user has entry in `user_wallets` table
- Check Supabase connection
- Review RLS policies on `user_wallets` table

---

## Performance Considerations

### Expected Timings

- **Wallet check:** ~100ms
- **Mockup template fetch:** ~100ms
- **Replicate API call:** ~5-15 seconds (depends on model)
- **GCS upload:** ~500ms-2s (depends on image size)
- **Wallet update:** ~100ms
- **Total:** ~6-18 seconds

### Optimization Tips

1. **Caching**: Cache mockup templates in memory to avoid repeated DB queries
2. **Async Processing**: Consider moving Replicate call to background worker for large batches
3. **Monitoring**: Track Replicate API response times and quota usage
4. **Error Recovery**: Implement retry logic for transient failures

---

## Security Considerations

1. ✅ **Authentication Required**: All endpoints use `requireAuth` middleware
2. ✅ **Input Validation**: Validates `productTemplate` and `mockupType`
3. ✅ **Balance Check**: Prevents negative balance exploits
4. ✅ **Atomic Operations**: Wallet deduction happens after successful generation
5. ⚠️ **Rate Limiting**: Consider adding rate limits per user (e.g., max 10/hour)
6. ⚠️ **Image URL Validation**: Consider validating `designImageUrl` is from trusted domain

---

## Next Steps

1. ✅ API endpoint implemented
2. ✅ TypeScript compilation verified
3. ⏳ Manual testing with Postman/curl
4. ⏳ Frontend integration in ProductDesigner page
5. ⏳ Add usage analytics tracking
6. ⏳ Implement rate limiting
7. ⏳ Add admin dashboard for monitoring mockup generation stats

---

## API Reference Summary

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/designer/generate-mockup` | POST | Yes | Generate AI mockup, deduct 25 ITC |
| `/api/designer/mockup-cost` | GET | No | Get current ITC cost |

**ITC Token Economy:**
- Mockup generation: 25 ITC tokens
- Balance stored in: `user_wallets.itc_balance`
- Deduction: Atomic update after successful generation
