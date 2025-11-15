# Customer-Facing AI Product Builder

## Overview

This document outlines the differences between the admin AI Product Builder and the customer-facing version that will be released in the future.

## Current Admin Version Features

The admin version (`/admin/ai-product-builder`) includes:

### Step 1: Describe
- Full product description textarea
- Product category selection (DTF Transfers, T-Shirts, Hoodies, Tumblers)
- Target price input
- Target audience input
- Primary colors input
- Design style/aesthetic input
- Number of images selection (1-4)
- Mockup style selection (Casual, Lifestyle, Product)
- Background style selection (Studio, Lifestyle, Urban)
- Brand tone selection (Professional, Playful, Minimal)

### Step 2: Review
- AI-interpreted product details
- Product title
- Full description
- Category
- Suggested price
- Tags
- Product variants with pricing
- Option to start over or proceed to generation

### Step 3: Generate
- Real-time job status monitoring
- Visual progress indicators for:
  - Product image generation
  - Try-on mockup generation
- Status updates (queued, running, succeeded, failed)
- Error handling and display

### Step 4: Success
- Confetti animation celebration
- Product details card with:
  - Product name
  - Draft status indicator
  - Price
  - Product ID
- Generated images gallery with:
  - Source images
  - Mockup images
  - Download buttons for each image
  - Image dimensions display
- Action buttons:
  - Create Another Product
  - Edit Details
  - **Approve & Publish** (admin only)

## Customer Version Differences

The customer version will be simplified and focused on a consumer-friendly experience:

### Removed Features (Admin Only)
1. **Approve & Publish Button** - Customers cannot directly publish products
2. **Multiple Image Generation** - Limited to 1-2 images max
3. **Advanced Style Controls** - Simplified options
4. **Price Setting** - Prices will be auto-calculated or admin-set
5. **Variant Creation** - Admin reviews and approves variants
6. **Direct Product Editing** - Limited editing capabilities

### Modified Features

#### Step 1: Simplified Design Form
- Simpler product description (fewer fields)
- Pre-selected categories based on popular choices
- Removed: Target price, brand tone, mockup style controls
- Keep: Basic design description, primary colors, target audience
- Add: Pre-made style templates (e.g., "Minimalist", "Bold & Colorful", "Vintage")

#### Step 2: Quick Review
- Simplified review showing only:
  - Product concept
  - Basic details
  - Estimated price range (not exact)
- "Looks Good" or "Start Over" buttons

#### Step 3: Generation
- Same real-time progress
- More customer-friendly language
- Estimated completion time display
- Progress percentage

#### Step 4: Success
- Confetti celebration (keep)
- Product preview card
- **Submit for Approval** button instead of "Approve & Publish"
- Message: "Your design will be reviewed by our team within 24-48 hours"
- Download images for personal use
- Share design preview link

### Customer Workflow

```
Customer Flow:
1. Describe → 2. Review → 3. Generate → 4. Submit for Approval
                                                    ↓
                                          Admin Reviews in Dashboard
                                                    ↓
                                        Approved → Customer Notified
                                                    ↓
                                          Product Goes Live
```

### Additional Customer Features

1. **My Designs Page**
   - View submitted designs
   - Status tracking (Pending, Approved, Rejected, Live)
   - Edit and resubmit rejected designs
   - Share approved designs

2. **Design History**
   - Save draft designs
   - View generation history
   - Reuse previous prompts

3. **Pricing**
   - Transparent pricing model
   - Optional: Premium AI generation (more images, faster processing)
   - Credits system for AI generations

4. **Approval Notifications**
   - Email notifications when design is approved/rejected
   - In-app notifications
   - Feedback from admin team on rejected designs

## Technical Implementation Notes

### Files to Create
- `src/pages/CustomerAIProductBuilder.tsx` - Main customer page
- `src/components/CustomerCreateProductWizard.tsx` - Customer wizard component
- `src/pages/MyDesigns.tsx` - Customer design management page

### Database Changes
- Add `designer_id` field to products table
- Add `approval_status` field: 'pending', 'approved', 'rejected'
- Add `rejection_reason` field for admin feedback
- Add `submission_date` and `approval_date` timestamps

### API Endpoints to Add
```
POST /api/customer/products/ai/create
GET /api/customer/products/my-designs
PUT /api/customer/products/:id/resubmit
GET /api/customer/products/:id/status

Admin endpoints:
GET /api/admin/products/pending-approval
PUT /api/admin/products/:id/approve
PUT /api/admin/products/:id/reject
```

### Permissions
- Customers can only view/edit their own designs
- Admins can view all pending designs
- Only admins can approve/reject designs
- Approved designs become publicly visible

## Rollout Plan

### Phase 1: Beta Testing (Internal)
- Release to select customers
- Gather feedback on workflow
- Test approval process
- Monitor AI generation costs

### Phase 2: Limited Release
- Release to all customers with limits:
  - 3 free designs per month
  - 5 minutes queue time
- Collect usage data
- Adjust pricing model

### Phase 3: Full Release
- Open to all customers
- Implement premium tiers if needed
- Marketing campaign
- Help center articles and tutorials

## Notes for Future Development

1. **Design Templates** - Pre-made prompts for popular styles
2. **Collaborative Designs** - Allow customers to collaborate
3. **Design Marketplace** - Customers can sell their designs
4. **AI Suggestions** - Suggest improvements based on successful designs
5. **Style Transfer** - Upload reference images for style matching
6. **Bulk Generation** - Create variations of a design
7. **A/B Testing** - Generate multiple versions, customer picks best

## Customer Support Considerations

- Clear instructions and tooltips throughout the wizard
- Video tutorial on how to use the AI Product Builder
- FAQ section addressing common questions
- Live chat support during design creation
- Email support for design feedback and appeals

## Success Metrics

Track the following for customer version:
- Design submission rate
- Approval rate (target: >80%)
- Time from submission to approval
- Customer satisfaction scores
- Repeat usage rate
- Conversion rate (designs that lead to purchases)
