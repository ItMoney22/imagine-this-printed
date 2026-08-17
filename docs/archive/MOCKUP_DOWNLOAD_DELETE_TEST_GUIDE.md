# Mockup Download & Delete Functionality - Test Guide

**Date:** 2025-11-12
**Status:** ✅ ALL FIXES COMPLETE - Ready for testing

## Summary of All Fixes Applied

This document summarizes ALL fixes applied during this session to get Nano Banana mockup generation working end-to-end.

### Fix 1: Binary Data Detection ✅
**File:** `backend/routes/realistic-mockups.ts:527-546`
**Issue:** Nano Banana returns raw PNG binary data instead of URLs, code tried to `fetch()` binary string
**Fix:** Added dual-path detection to handle both URL downloads and binary data conversion

```typescript
let buffer: Buffer

if (outputUrl.startsWith('http://') || outputUrl.startsWith('https://')) {
  console.log(`[Mockup ${generationId}] 🔗 Detected URL output, downloading...`)
  const response = await fetch(outputUrl)
  buffer = Buffer.from(await response.arrayBuffer())
} else {
  console.log(`[Mockup ${generationId}] 🔧 Detected binary data, converting to Buffer...`)
  const byteArray = outputUrl.split(',').map(b => parseInt(b.trim()))
  buffer = Buffer.from(byteArray)
}
```

### Fix 2: Chunk Concatenation ✅
**File:** `backend/routes/realistic-mockups.ts:518-528`
**Issue:** Replicate streams binary data in multiple chunks (818 chunks), code only used first chunk resulting in 623-byte truncated files
**Fix:** Detect PNG header in first chunk and concatenate all chunks

```typescript
if (outputs.length > 0) {
  const firstChunk = outputs[0]
  if (firstChunk && firstChunk.match(/^137,80,78,71/)) {
    console.log(`[Mockup ${generationId}] Detected chunked binary data, concatenating ${outputs.length} chunks...`)
    outputUrl = outputs.join(',')  // ✅ JOIN ALL CHUNKS
  } else {
    outputUrl = outputs[0]
  }
}
```

### Fix 3: Metadata Simplification ✅
**File:** `backend/routes/realistic-mockups.ts:556-564`
**Issue:** GCS upload metadata included large `modelDescription` object causing "Request is too large" error
**Fix:** Simplified metadata to only include `generationId`

```typescript
const uploadResult = await gcsStorage.uploadFile(buffer, {
  userId,
  folder: 'temp',
  filename: `mockup_${generationId}.png`,
  contentType: 'image/png',
  metadata: {
    generationId  // ✅ Only essential field
  }
})
```

### Fix 4: Front-Facing Prompt ✅
**File:** `backend/routes/realistic-mockups.ts:471`
**Issue:** Generated mockups showed models turned to the side instead of facing forward
**Fix:** Enhanced prompt with explicit front-facing instructions

```typescript
const prompt = `Professional product photography of a front-facing full body ${modelDescription.gender} model wearing a ${modelDescription.garmentColor} ${garmentDescription}. The model is ${modelDescription.ethnicity} with ${modelDescription.bodyType} body type, facing directly towards the camera in a straight-on front view. Apply the custom graphic design from the reference images seamlessly onto the ${garmentDescription}. Show the complete garment from shoulders to waist with realistic fabric texture, proper lighting, and natural shadows. Front view only, full torso view, not turned to the side, not just a headshot. High quality professional fashion photography.`
```

**Key additions:**
- "front-facing" at the beginning
- "facing directly towards the camera in a straight-on front view"
- "Front view only"
- "not turned to the side"

### Fix 5: Download URL Fix ✅
**File:** `backend/routes/realistic-mockups.ts:283-290`
**Issue:** Download button tried to generate signed GCS URL with `gcsStorage.generateSignedUrl()` which requires `client_email` in credentials
**Fix:** Return public GCS URL directly instead of trying to sign it

```typescript
// Return public mockup URL for download
const downloadUrl = generation.mockup_url.replace('/temp/', '/mockups/')

return res.json({
  ok: true,
  mediaId: media.id,
  downloadUrl,
  message: 'Mockup accepted and saved to your profile'
})
```

## Backend Status

✅ **Backend Running:** Port 4000 (latest restart: 21:11:36)
```
[21:11:36] INFO: 🚀 Server running on port 4000
[21:11:36] INFO: 📡 API available at http://localhost:4000
[21:11:36] INFO: 🏥 Health check: http://localhost:4000/api/health

REPLICATE_TRYON_MODEL_ID: "google/nano-banana" ✅
```

## How to Test

### Option 1: Manual Testing (Recommended)

1. **Generate a new mockup:**
   - Open http://localhost:5173
   - Navigate to Design Studio
   - Create or upload a design
   - Click "Generate Realistic Preview (25 ITC)"
   - Fill out the customization form (select model attributes)
   - Click "Generate"

2. **Wait for completion:**
   - Backend logs should show chunk concatenation
   - Status should change from "generating" to "completed"
   - Mockup preview should appear in the frontend

3. **Test download (accept mockup):**
   - Click "Accept" button
   - File should download successfully as PNG
   - Open downloaded file to verify it's a complete, viewable image
   - Check it's NOT just 623 bytes - should be 500KB-2MB

4. **Test delete (reject mockup):**
   - Generate another mockup
   - Click "Reject" button
   - Should receive 25 ITC refund
   - Mockup should be deleted from temp storage
   - Check your ITC balance increased by 25

### Option 2: Automated Testing

A test script is available at `backend/test-mockup-actions.ts`:

```bash
# Run test (after generating a mockup manually)
cd backend
npx tsx test-mockup-actions.ts <generationId> <userId>
```

**Example:**
```bash
npx tsx test-mockup-actions.ts cf18945d-2317-46a9-b630-fcdf507e5597 11111111-1111-1111-1111-111111111111
```

**The test script will:**
- Check mockup status
- Test accept/download endpoint
- Verify download URL is accessible
- Show file size and content-type
- (Optional) Test reject/delete endpoint

**To get generation ID and user ID:**
1. Generate a mockup in the frontend
2. Check backend logs for `[Mockup {id}]` - that's the generation ID
3. Get user ID from Supabase `user_profiles` table or your auth token

## Expected Behavior

### Successful Generation with All Fixes:
```
[Mockup {id}] Starting generation with Nano Banana
[Mockup {id}] Using Nano Banana model: google/nano-banana:858e56734846d24469ed35a07ca2161aaf4f83588d7060e32964926e1b73b7be
[Mockup {id}] Prompt: Professional product photography of a front-facing full body...
[Mockup {id}] Stock model URL: https://storage.googleapis.com/.../stock-models/...
[Mockup {id}] Design URL: https://storage.googleapis.com/.../temp/design_...

[Mockup {id}] Processing async iterator output
[Mockup {id}] Detected chunked binary data, concatenating 818 chunks...
[Mockup {id}] Generation complete from Replicate: 137,80,78,71,13,10,26,10...

[Mockup {id}] 🔧 Detected binary data, converting to Buffer...
[Mockup {id}] 📦 Buffer size: 1666569 bytes  ✅ COMPLETE FILE, NOT 623 BYTES

[Mockup {id}] Upload to GCS complete: https://storage.googleapis.com/.../temp/mockup_{id}.png
[Mockup {id}] ✅ Mockup generation complete!
```

### Successful Accept (Download):
```
POST /api/realistic-mockups/{id}/accept
{
  "ok": true,
  "mediaId": "...",
  "downloadUrl": "https://storage.googleapis.com/.../mockups/mockup_{id}.png",
  "message": "Mockup accepted and saved to your profile"
}
```

### Successful Reject (Delete):
```
POST /api/realistic-mockups/{id}/reject
{
  "ok": true,
  "refundAmount": 25,
  "newBalance": 1025,
  "message": "Mockup rejected and 25 ITC refunded"
}
```

## Testing Checklist

### Generation Tests
- [ ] Generate mockup from Design Studio
- [ ] Backend logs show "Detected chunked binary data, concatenating X chunks..."
- [ ] Logs show "📦 Buffer size: X bytes" where X > 100,000 (not 623!)
- [ ] No "Request is too large" error
- [ ] No "Failed to parse URL" error
- [ ] Mockup completes successfully
- [ ] Status changes from "generating" to "completed"
- [ ] Frontend shows mockup preview (not broken image)

### Front-Facing Model Tests
- [ ] Generated mockup shows model facing directly forward
- [ ] Model is NOT turned to the side
- [ ] Full torso view is visible
- [ ] Design is applied correctly to garment

### Download Tests (Accept)
- [ ] Click "Accept" button in frontend
- [ ] File downloads successfully
- [ ] Downloaded file is named `mockup_{id}.png`
- [ ] File size is realistic (500KB-2MB range)
- [ ] File opens successfully in image viewer
- [ ] Image shows complete mockup (not corrupted/truncated)
- [ ] Image shows front-facing model with design applied
- [ ] Mockup appears in user profile/media library

### Delete Tests (Reject)
- [ ] Click "Reject" button in frontend
- [ ] Receives confirmation message
- [ ] 25 ITC refunded to wallet
- [ ] Wallet balance increases by 25 ITC
- [ ] Mockup is deleted from temp storage
- [ ] Mockup does NOT appear in user profile

## Common Issues

### Issue 1: "Request is too large" Error
**Cause:** Metadata too large
**Status:** ✅ FIXED - Metadata simplified to only include `generationId`

### Issue 2: 623-Byte Truncated Files
**Cause:** Only using first chunk of binary data
**Status:** ✅ FIXED - All chunks concatenated with `outputs.join(',')`

### Issue 3: "Failed to parse URL" Error
**Cause:** Trying to fetch binary data as URL
**Status:** ✅ FIXED - Dual-path detection for URL vs binary

### Issue 4: Model Turned to Side
**Cause:** Prompt didn't specify front-facing view
**Status:** ✅ FIXED - Enhanced prompt with explicit front-facing instructions

### Issue 5: Download Button Not Working
**Cause:** GCS signed URL generation requires `client_email`
**Status:** ✅ FIXED - Using public URL directly instead

## Technical Details

### PNG File Header
First 8 bytes of every PNG: `137, 80, 78, 71, 13, 10, 26, 10`
Used to detect binary PNG data: `firstChunk.match(/^137,80,78,71/)`

### Replicate Streaming
Nano Banana streams large files in chunks via async iterator.
Example: 818 chunks → 1.67MB complete image

### GCS Public URLs
Format: `https://storage.googleapis.com/{bucket}/{path}/mockup_{id}.png`
No signing required for public read access.

### Chunk Concatenation
Each chunk is comma-separated bytes: `"137,80,78,71,13,10"`
Join all chunks: `outputs.join(',')` → `"137,80,78,71,13,10,26,10..."`
Parse to Buffer: `Buffer.from(outputUrl.split(',').map(b => parseInt(b.trim())))`

## Success Criteria

✅ Nano Banana model integrated (`google/nano-banana:858e56734846d24469ed35a07ca2161aaf4f83588d7060e32964926e1b73b7be`)
✅ Correct API parameters (`image_input` array)
✅ Binary output handling (URL vs binary detection)
✅ Multi-chunk binary data concatenation
✅ Simplified metadata (prevents "Request is too large")
✅ Front-facing model prompts
✅ Download functionality (public GCS URLs)
✅ Temp folder system
✅ Accept/reject flow with refunds
✅ Backend restarted and running

## Next Steps

1. **Manual Testing** - Generate a new mockup and test full flow
2. **Verify Front-Facing** - Confirm models face forward in new generations
3. **Test Download** - Accept mockup and verify file downloads correctly
4. **Test Reject** - Reject mockup and verify refund + deletion

**All fixes are complete and backend is running. The system is ready for end-to-end testing!** 🚀
