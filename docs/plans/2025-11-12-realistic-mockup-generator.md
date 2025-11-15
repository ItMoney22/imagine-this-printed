# Realistic Mockup Generator with Virtual Try-On

**Date:** 2025-11-12
**Status:** Approved
**Author:** Claude Code + David Trinidad

## Overview

Implement an AI-powered realistic mockup generation system that allows users to visualize their designs on professional model photos wearing the actual garments. Uses Replicate's Nano Banana virtual try-on model with customizable model attributes and a stateful multi-generation flow with ITC refunds for rejected mockups.

## Goals

1. Generate photorealistic mockups of custom designs on models
2. Allow users to customize model appearance (ethnicity, hair, eyes, body type, etc.)
3. Store all generated mockups in user's media gallery
4. Implement ITC refund system for discarded mockups
5. Enable download only for selected/approved mockups

## User Flow

### Step 1: Design Creation
User creates design in Design Studio using existing Konva canvas editor.

### Step 2: Generate Realistic Preview
1. User clicks "Generate Realistic Preview" button
2. Modal appears with model configuration form:
   - **Garment Details**
     - Color selector (white, black, navy, gray, red, custom hex)
     - Shirt type (if applicable): crew neck, v-neck, tank
   - **Model Attributes** (Hybrid approach)
     - Gender: dropdown (male, female, non-binary)
     - Ethnicity: dropdown (diverse options)
     - Hair color: dropdown (blonde, brunette, black, red, gray, bald)
     - Eye color: dropdown (blue, brown, green, hazel, gray)
     - Body type: dropdown (slim, athletic, average, plus-size)
     - Additional details: textarea (free text for specific requests)
   - **Cost Indicator**: Shows "25 ITC" cost
3. User submits form
4. Confirmation modal: "Generate mockup for 25 ITC?"

### Step 3: Generation Process
1. Frontend uploads design canvas as PNG to backend
2. Backend:
   - Validates ITC balance (requires 25 ITC)
   - Deducts 25 ITC from user wallet
   - Uploads design to GCS temp storage
   - Constructs prompt for Nano Banana from form data
   - Calls Replicate API (Nano Banana virtual try-on)
   - Creates `mockup_generations` record (status: 'generating')
   - Polls for completion (30-60 seconds)
   - Downloads result, uploads to GCS user folder
   - Updates record (status: 'completed', adds mockup_url)
3. Frontend shows loading state with progress indicator
4. On completion, displays mockup in review panel

### Step 4: Mockup Review & Actions
User sees generated mockup with three action buttons:

**✅ Keep & Download**
- Marks mockup as 'selected' in database
- Enables download button (generates signed GCS URL)
- Adds to permanent user media gallery
- Cannot be refunded once selected

**🔄 Generate Another**
- Keeps current mockup in session gallery
- Returns to Step 2 (model configuration form)
- Allows generating more variations
- Each costs 25 ITC

**❌ Discard & Refund**
- Marks mockup as 'discarded'
- Immediately refunds 25 ITC to user wallet
- Logs refund transaction
- Removes from active gallery (archived for 30 days)
- Shows confirmation: "Refunded 25 ITC. New balance: X ITC"

### Step 5: Mockup Gallery (Session)
- Bottom panel shows thumbnail carousel of all generated mockups from current session
- Each thumbnail shows:
  - Status badge (selected, pending, discarded)
  - Timestamp
- Click to view full size
- Filter by status

### Step 6: User Media Gallery (Permanent)
New page: `/profile/media`
- Grid view of all user's selected mockups and saved designs
- Filter by type: mockups, designs, uploads
- Download button per item (signed URL, 24hr expiry)
- Delete option (doesn't refund if already selected)
- Pagination (20 items per page)

## Technical Architecture

### Database Schema

#### New Table: `mockup_generations`
```sql
CREATE TABLE mockup_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  design_snapshot JSONB NOT NULL, -- Konva elements at generation time
  model_description JSONB NOT NULL, -- Form data: garment color, model attributes
  product_template TEXT NOT NULL CHECK (product_template IN ('shirts', 'hoodies', 'tumblers')),
  status TEXT NOT NULL DEFAULT 'generating' CHECK (status IN ('generating', 'completed', 'failed', 'selected', 'discarded')),
  mockup_url TEXT, -- GCS URL
  gcs_path TEXT, -- GCS storage path
  generation_cost INTEGER NOT NULL DEFAULT 25,
  refunded BOOLEAN NOT NULL DEFAULT false,
  error_message TEXT,
  replicate_prediction_id TEXT, -- For tracking
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mockup_generations_user_id ON mockup_generations(user_id);
CREATE INDEX idx_mockup_generations_status ON mockup_generations(status);
CREATE INDEX idx_mockup_generations_created_at ON mockup_generations(created_at DESC);
```

#### New Table: `user_media`
```sql
CREATE TABLE user_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL CHECK (media_type IN ('mockup', 'design', 'upload')),
  file_url TEXT NOT NULL, -- GCS URL
  gcs_path TEXT NOT NULL,
  metadata JSONB, -- dimensions, file size, mime type, etc.
  source_generation_id UUID REFERENCES mockup_generations(id), -- If from mockup
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_media_user_id ON user_media(user_id);
CREATE INDEX idx_user_media_type ON user_media(media_type);
```

#### New Table: `wallet_transactions`
```sql
CREATE TABLE wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN (
    'mockup_generation', 'mockup_refund', 'background_removal',
    'image_upscale', 'purchase', 'reward', 'admin_adjustment'
  )),
  amount INTEGER NOT NULL, -- Positive for credits, negative for debits
  balance_before INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  reference_id UUID, -- Links to mockup_generations, orders, etc.
  reference_type TEXT, -- 'mockup', 'order', etc.
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wallet_transactions_user_id ON wallet_transactions(user_id);
CREATE INDEX idx_wallet_transactions_created_at ON wallet_transactions(created_at DESC);
```

#### Update Trigger for `user_wallets`
```sql
-- Function to log wallet transactions
CREATE OR REPLACE FUNCTION log_wallet_transaction()
RETURNS TRIGGER AS $$
BEGIN
  -- Only log if itc_balance changed
  IF NEW.itc_balance != OLD.itc_balance THEN
    INSERT INTO wallet_transactions (
      user_id,
      transaction_type,
      amount,
      balance_before,
      balance_after,
      description
    ) VALUES (
      NEW.user_id,
      'admin_adjustment', -- Default, should be overridden by application
      NEW.itc_balance - OLD.itc_balance,
      OLD.itc_balance,
      NEW.itc_balance,
      'Balance change'
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_log_wallet_transaction
  AFTER UPDATE ON user_wallets
  FOR EACH ROW
  EXECUTE FUNCTION log_wallet_transaction();
```

### Backend API Endpoints

#### POST `/api/mockups/generate-realistic`
**Request:**
```json
{
  "designImageUrl": "data:image/png;base64,...",
  "designElements": [...], // Konva elements
  "productTemplate": "shirts",
  "modelDescription": {
    "garmentColor": "#FFFFFF",
    "shirtType": "crew-neck",
    "gender": "female",
    "ethnicity": "caucasian",
    "hairColor": "blonde",
    "eyeColor": "blue",
    "bodyType": "athletic",
    "additionalDetails": "smiling, outdoor setting"
  }
}
```

**Response:**
```json
{
  "success": true,
  "generationId": "uuid",
  "status": "generating",
  "cost": 25,
  "newBalance": 475,
  "estimatedTime": 45
}
```

**Process:**
1. Validate user authentication
2. Check ITC balance >= 25
3. Create mockup_generations record (status: 'generating')
4. Deduct 25 ITC, log transaction
5. Upload design to GCS temp: `temp/designs/{uuid}.png`
6. Construct Nano Banana prompt from modelDescription
7. Call Replicate API with virtual try-on model
8. Return generation ID for polling

#### GET `/api/mockups/{generation_id}/status`
**Response:**
```json
{
  "generationId": "uuid",
  "status": "completed",
  "mockupUrl": "https://storage.googleapis.com/...",
  "createdAt": "2025-11-12T10:30:00Z"
}
```

#### POST `/api/mockups/{generation_id}/select`
**Request:** None (authenticated user)

**Response:**
```json
{
  "success": true,
  "downloadUrl": "https://storage.googleapis.com/...?signed=...",
  "mediaId": "uuid"
}
```

**Process:**
1. Verify generation belongs to user
2. Update status to 'selected'
3. Create user_media record
4. Generate signed download URL (24hr expiry)
5. Return download URL

#### POST `/api/mockups/{generation_id}/discard`
**Request:** None (authenticated user)

**Response:**
```json
{
  "success": true,
  "refunded": true,
  "refundAmount": 25,
  "newBalance": 500
}
```

**Process:**
1. Verify generation belongs to user
2. Check not already refunded or selected
3. Update status to 'discarded', set refunded=true
4. Add 25 ITC to user wallet
5. Log refund transaction
6. Return new balance

#### GET `/api/mockups/user-gallery`
**Query Params:**
- `page` (default: 1)
- `limit` (default: 20)
- `type` (filter: 'mockup', 'design', 'upload', 'all')
- `status` (filter for mockups: 'selected', 'all')

**Response:**
```json
{
  "items": [
    {
      "id": "uuid",
      "type": "mockup",
      "fileUrl": "https://...",
      "thumbnail": "https://...",
      "metadata": {...},
      "createdAt": "2025-11-12T10:30:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "pages": 3
  }
}
```

#### POST `/api/media/upload`
**Request:** FormData with file + metadata

**Response:**
```json
{
  "success": true,
  "mediaId": "uuid",
  "fileUrl": "https://..."
}
```

### Google Cloud Storage Setup

**Bucket Name:** `imagine-this-printed-media`

**Folder Structure:**
```
users/{user_id}/
  ├── mockups/
  │   └── {generation_id}.png
  ├── designs/
  │   └── {design_id}.png
  └── uploads/
      └── {upload_id}.{ext}

temp/
  └── designs/
      └── {uuid}.png (auto-delete after 1 day)
```

**IAM Permissions:**
- Backend service account: Storage Object Creator, Viewer
- Signed URL generation for downloads

**Lifecycle Policy:**
- Temp files: delete after 1 day
- Discarded mockups (not selected): delete after 30 days
- Selected mockups: keep indefinitely

**Environment Variables:**
```env
GCS_PROJECT_ID=imaginethisprinted
GCS_BUCKET_NAME=imagine-this-printed-media
GCS_CREDENTIALS_PATH=/path/to/service-account-key.json
```

### Frontend Components

#### Component: `RealisticMockupGenerator.tsx`
**Location:** `src/components/RealisticMockupGenerator.tsx`

**Props:**
```typescript
interface RealisticMockupGeneratorProps {
  designElements: DesignElement[]
  productTemplate: 'shirts' | 'hoodies' | 'tumblers'
  onMockupGenerated: (mockupUrl: string, generationId: string) => void
  itcBalance: number
}
```

**Features:**
- Multi-step form (model configuration)
- Real-time ITC balance display
- Loading state with progress
- Mockup review panel with action buttons
- Session gallery (thumbnails of all attempts)
- Error handling with auto-refund

#### Component: `UserMediaGallery.tsx`
**Location:** `src/pages/UserMediaGallery.tsx`

**Features:**
- Grid layout with masonry style
- Filter sidebar (type, date range)
- Pagination
- Download modal with signed URLs
- Delete confirmation
- Empty state for new users

#### Updates: `DesignStudioModal.tsx`
- Replace simple "Generate Realistic Preview" button with `RealisticMockupGenerator` component
- Add session gallery panel at bottom
- Integrate mockup state management

#### Updates: `MockupPreview.tsx`
- Keep existing canvas composite preview
- Add toggle between "Quick Preview" (canvas) and "Realistic Preview" (AI-generated)

### State Management

**Frontend State:**
```typescript
interface MockupGenerationState {
  sessionMockups: Array<{
    generationId: string
    status: 'generating' | 'completed' | 'failed' | 'selected' | 'discarded'
    mockupUrl?: string
    timestamp: string
  }>
  currentMockup: {
    generationId: string
    mockupUrl: string
  } | null
  isGenerating: boolean
  error: string | null
}
```

**Backend State Tracking:**
- All state persisted in `mockup_generations` table
- Wallet transactions immutable audit trail
- No temporary state except during API calls

### Error Handling & Edge Cases

#### Insufficient ITC Balance
- Pre-check before showing form
- Show "Add ITC" button linking to payment modal
- Prevent generation if balance < 25

#### Generation Failure
- Replicate API error → Auto-refund 25 ITC
- Network timeout → Retry 3x, then refund
- Log error in mockup_generations.error_message
- Show user-friendly error: "Generation failed. You've been refunded 25 ITC."

#### Duplicate Requests
- Debounce generate button (prevent double-click)
- Check for in-progress generations for same design

#### Storage Failures
- GCS upload fails → Refund ITC, mark failed
- Missing file on download → Show error, offer re-generation

#### Session Management
- Session mockups cleared on modal close
- All mockups preserved in database
- User can resume from media gallery

### Testing Plan

#### Unit Tests
- Wallet transaction logging
- ITC refund logic
- GCS upload/download
- Nano Banana API integration

#### Integration Tests
- Complete generation flow (generate → select → download)
- Refund flow (generate → discard → verify refund)
- Multi-generation flow (generate multiple → select one → refund others)

#### E2E Tests
- User journey from design creation to mockup download
- Error scenarios (insufficient balance, API failures)
- Media gallery access and downloads

## Implementation Phases

### Phase 1: Database & Backend Foundation (Priority 1)
- [ ] Create database migrations
- [ ] Set up GCS bucket and credentials
- [ ] Create wallet_transactions table and trigger
- [ ] Build backend API endpoints
- [ ] Integrate Nano Banana API via Replicate

### Phase 2: Frontend Components (Priority 2)
- [ ] Build RealisticMockupGenerator component
- [ ] Create model configuration form
- [ ] Build mockup review panel
- [ ] Add session gallery

### Phase 3: Media Gallery (Priority 3)
- [ ] Create UserMediaGallery page
- [ ] Add navigation link
- [ ] Implement download flow with signed URLs
- [ ] Add delete functionality

### Phase 4: Integration & Polish (Priority 4)
- [ ] Integrate with DesignStudioModal
- [ ] Add loading states and animations
- [ ] Error handling and user feedback
- [ ] Mobile responsive design

### Phase 5: Testing & Launch (Priority 5)
- [ ] Unit tests
- [ ] Integration tests
- [ ] User acceptance testing
- [ ] Performance optimization
- [ ] Production deployment

## Success Metrics

- **User Engagement:** 70%+ of designs generate at least one realistic mockup
- **Selection Rate:** 80%+ of mockups are selected (not discarded)
- **Refund Rate:** <20% of generations result in refunds
- **Generation Success:** 95%+ successful generations (no errors)
- **User Satisfaction:** Positive feedback on mockup quality

## Future Enhancements

1. **Background Scene Selection:** Let users choose setting (studio, outdoor, cafe, etc.)
2. **Multiple Models per Generation:** Generate 2-3 variations at once
3. **Video Mockups:** Short clips of model turning/moving
4. **Social Sharing:** Direct share to Instagram/Facebook from gallery
5. **Mockup Templates:** Pre-configured popular model/setting combos
6. **Bulk Generation:** Generate mockups for entire product catalog

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Nano Banana API reliability | High | Implement retry logic, fallback to alternative models |
| GCS costs | Medium | Lifecycle policies, compression, user quotas |
| Long generation times | Medium | Set expectations (30-60s), progress indicators, async processing |
| Poor mockup quality | High | Prompt engineering, user feedback loop, manual review option |
| ITC abuse (generate + refund loop) | Medium | Rate limiting, max refunds per day, fraud detection |

## Conclusion

This system provides a professional mockup generation experience with full user control, transparent costs, and fair refund policy. By storing all media in the user's gallery and enabling easy downloads, we create value beyond just the checkout flow.
