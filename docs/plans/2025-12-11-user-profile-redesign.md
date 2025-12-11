# User Profile Page Redesign - FB-Style Creator Portfolio

## Overview
Redesign the user profile page to be a Facebook-style creator portfolio with design showcase cover, slide-out edit panel, creator-focused tabs, and configurable privacy settings.

## User Requirements
1. FB-style layout with cover photo (auto-generated from designs or user upload)
2. Creator-focused tabs: Overview, Designs, Orders, Reviews
3. Slide-out panel for profile editing
4. Per-field privacy controls (designs, reviews, activity visibility)
5. Fix bug: designs from /create-design not showing on profile

## Bug Fix Required

### Issue: Designs Not Showing
The `/my-products` endpoint queries `metadata->>creator_id` but products are created with `created_by_user_id` column. The `/creator-analytics` endpoint queries non-existent `user_products` table.

### Fix:
1. Update `/api/user-products/my-products` to query `created_by_user_id` column
2. Update `/api/user-products/creator-analytics` to query `products` table with `created_by_user_id`
3. Update `UserDesignDashboard.tsx` to use fixed endpoints

## Database Changes

Add columns to `user_profiles` table:
```sql
ALTER TABLE user_profiles ADD COLUMN cover_image_url TEXT;
ALTER TABLE user_profiles ADD COLUMN show_activity BOOLEAN DEFAULT false;
ALTER TABLE user_profiles ADD COLUMN allow_messages BOOLEAN DEFAULT false;
ALTER TABLE user_profiles ADD COLUMN social_tiktok TEXT;
```

## Component Structure

### 1. ProfileHeader Component
```
src/components/profile/ProfileHeader.tsx
```
- Cover area (300px height, 16:9 ratio)
- Auto-generated collage from user's top designs OR custom upload
- Fallback: role-based gradient (purple=vendor, blue=customer, gold=founder)
- Avatar (120px) overlapping cover bottom edge
- Display name, username, role badge, join date
- Location, website links
- Stats row: Designs | Sales | Royalties | Points
- Edit Profile / Settings buttons (own profile only)

### 2. ProfileTabs Component
```
src/components/profile/ProfileTabs.tsx
```
Tabs:
- **Overview** (default): Activity feed, featured designs, badges, quick links
- **Designs**: Grid of user's creations with filters (All/Approved/Pending/Drafts)
- **Orders**: Private tab, order history (own profile only)
- **Reviews**: Reviews written and received

### 3. ProfileEditPanel Component
```
src/components/profile/ProfileEditPanel.tsx
```
Slide-out panel (right side, 400px width) containing:
- Avatar upload
- Cover image upload
- Display name, username, bio, location, website
- Social links (Twitter, Instagram, TikTok)
- Privacy toggles:
  - Show designs publicly
  - Show reviews publicly
  - Show activity on profile
  - Allow messages from others

### 4. DesignGrid Component
```
src/components/profile/DesignGrid.tsx
```
- Masonry or grid layout
- Filter pills
- Design cards with: thumbnail, name, status badge, views, sales
- Click action based on status

## File Changes

### Backend Changes

**`backend/routes/user-products.ts`**:
- Line ~706: Fix `/my-products` query to use `created_by_user_id`
- Line ~1053: Fix `/creator-analytics` to query `products` table

Before:
```typescript
.eq('metadata->>creator_id', userId)
```

After:
```typescript
.eq('created_by_user_id', userId)
```

**`backend/routes/profile.ts`** (new or update existing):
- Add endpoint for cover image upload
- Add endpoint for privacy settings update

### Frontend Changes

**`src/pages/UserProfile.tsx`** - Complete rewrite:
- Import new sub-components
- FB-style layout structure
- Real data fetching (no mock data)
- Slide-out edit panel state management

**New files to create:**
- `src/components/profile/ProfileHeader.tsx`
- `src/components/profile/ProfileTabs.tsx`
- `src/components/profile/ProfileEditPanel.tsx`
- `src/components/profile/DesignGrid.tsx`
- `src/components/profile/ActivityFeed.tsx`

**Delete:**
- `src/pages/ProfileEdit.tsx` (replaced by slide-out panel)

### Routes
- Keep `/profile/:username` for public profiles
- Keep `/account/profile` for own profile
- Remove `/account/profile/edit` (now slide-out)

## UI Specifications

### Cover Image
- Height: 300px (desktop), 200px (mobile)
- Auto-collage: 3-5 top designs by view_count, horizontal strip
- Edit button: camera icon, top-right corner
- Gradient overlay: bottom 50% for text readability

### Profile Info Section
- Avatar: 120px circle, -60px margin-top to overlap cover
- Name: text-2xl font-bold
- Username: text-muted @handle
- Role badge: colored pill (Vendor/Customer/Founder)
- Stats: 4-column grid with large numbers

### Tab Bar
- Sticky below header on scroll
- Active state: purple underline
- Tab content: max-w-6xl centered

### Edit Panel
- Width: 400px (desktop), full-width (mobile)
- Slide from right with backdrop blur
- Form sections with clear labels
- Save/Cancel sticky at bottom

## Privacy System

| Setting | Default | Controls |
|---------|---------|----------|
| `is_public` | true | Entire profile visibility |
| `show_designs` | true | Designs tab visible to others |
| `show_reviews` | true | Reviews tab visible to others |
| `show_activity` | false | Activity feed on overview |
| `allow_messages` | false | DM button shown to others |

Visitors see:
- If `is_public=false`: "This profile is private" message
- If `show_designs=false`: Designs tab hidden
- If `show_reviews=false`: Reviews tab hidden
- Orders tab: Always hidden for non-owners

## Implementation Order

1. **Database migration** - Add new columns to user_profiles
2. **Backend bug fix** - Fix `/my-products` and `/creator-analytics` queries
3. **ProfileHeader component** - Cover + avatar + stats
4. **ProfileEditPanel component** - Slide-out form
5. **DesignGrid component** - Reusable design grid with filters
6. **ProfileTabs component** - Tab navigation and content
7. **UserProfile.tsx rewrite** - Assemble all components
8. **Test** - Verify designs show, edit works, privacy controls work

## Styling Notes

Use existing theme system:
- `bg-bg`, `bg-card`, `text-text`, `text-muted`
- Gradients: `from-purple-900/50 to-pink-900/30`
- Borders: `border-white/10`
- Backdrop blur for overlays
- Studio Noir aesthetic consistent with /create-design
