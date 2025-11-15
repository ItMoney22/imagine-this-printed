# Designer Mockup API - Quick Reference

## Overview

New API endpoint for generating realistic product mockups using AI. Costs 25 ITC tokens per generation.

---

## Endpoints

### 1. Generate Mockup

**POST** `/api/designer/generate-mockup`

**Authentication:** Required (Bearer token)

**Request:**
```json
{
  "designImageUrl": "https://storage.googleapis.com/...",
  "productTemplate": "shirts",
  "mockupType": "flat"
}
```

**Parameters:**
- `designImageUrl` (string, required): URL to design canvas export
- `productTemplate` (string, required): `"shirts"` | `"hoodies"` | `"tumblers"`
- `mockupType` (string, optional): `"flat"` | `"lifestyle"` (default: `"flat"`)

**Success Response (200):**
```json
{
  "ok": true,
  "mockupUrl": "https://storage.googleapis.com/...",
  "cost": 25,
  "newBalance": 475
}
```

**Error Responses:**
- `400`: Missing fields, invalid parameters, or insufficient ITC balance
- `401`: Missing/invalid authentication
- `500`: Server error (Replicate API, GCS, or database)

---

### 2. Get Cost

**GET** `/api/designer/mockup-cost`

**Authentication:** Not required

**Response:**
```json
{
  "ok": true,
  "cost": 25,
  "currency": "ITC"
}
```

---

## Frontend Usage

```typescript
import { api } from '@/lib/api'

async function generateMockup(
  designImageUrl: string,
  productTemplate: 'shirts' | 'hoodies' | 'tumblers',
  mockupType: 'flat' | 'lifestyle' = 'flat'
) {
  const response = await api.post('/designer/generate-mockup', {
    designImageUrl,
    productTemplate,
    mockupType
  })

  return response.data
}

// Usage
const result = await generateMockup(
  canvasRef.current.toDataURL(),
  'shirts',
  'flat'
)
console.log('Mockup URL:', result.mockupUrl)
console.log('New balance:', result.newBalance)
```

---

## Error Handling

```typescript
try {
  const result = await generateMockup(url, 'shirts', 'flat')
  // Success
} catch (error: any) {
  if (error.response?.status === 400) {
    // Show: "Insufficient balance" or "Invalid input"
    alert(error.response.data.error)
  } else if (error.response?.status === 500) {
    // Show: "Service temporarily unavailable"
    alert('Failed to generate mockup. Try again later.')
  }
}
```

---

## Expected Performance

- **Response time:** 6-18 seconds (AI generation is slow)
- **Show loading spinner:** Yes, with message "Generating realistic mockup..."
- **Cost:** 25 ITC tokens (deducted after successful generation)

---

## UI Recommendations

1. **Before generation:**
   - Check user ITC balance (GET `/api/wallet`)
   - Show cost: "Generate Mockup (25 ITC)"
   - Disable button if balance < 25

2. **During generation:**
   - Show loading spinner
   - Display message: "Generating realistic mockup... (this may take 10-20 seconds)"
   - Disable other actions

3. **After success:**
   - Display mockup preview
   - Show new balance
   - Enable download button

4. **After error:**
   - Show error message
   - Allow retry
   - Don't deduct ITC (already handled by backend)

---

## Storage

- **Generated mockups:** `designer-mockups/{userId}/{timestamp}.png`
- **URL type:** GCS signed URL (7-day expiry)
- **Note:** Frontend should save mockup URL to database if needed for later access

---

## Testing

See `DESIGNER_MOCKUP_API_TEST.md` for comprehensive testing guide.

**Quick test with cURL:**
```bash
curl -X POST https://api.imaginethisprinted.com/api/designer/generate-mockup \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "designImageUrl": "https://example.com/design.png",
    "productTemplate": "shirts",
    "mockupType": "flat"
  }'
```

---

## Questions?

- **Full testing guide:** `backend/DESIGNER_MOCKUP_API_TEST.md`
- **Implementation details:** `backend/TASK_9_COMPLETION_REPORT.md`
- **Source code:** `backend/routes/designer.ts`
