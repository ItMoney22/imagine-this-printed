# Profile Edit Page - Test Plan

## Test Date: 2025-11-09
## Tester: Claude Code

---

## Test Environment
- **Frontend**: http://localhost:5173
- **Backend**: http://localhost:4000
- **Database**: Supabase (czzyrmizvjqlifcivrhn.supabase.co)
- **Test User**: davidltrinidad@gmail.com (admin role)

---

## Features Implemented

### 1. Profile Loading
- ✅ Loads profile data from Supabase `user_profiles` table
- ✅ Maps database fields to form fields correctly
- ✅ Shows loading spinner while fetching data
- ✅ Displays error message if loading fails

### 2. Form Inputs
- ✅ Username input (required)
- ✅ Display Name input (required)
- ✅ Bio textarea
- ✅ Location input
- ✅ Website input (URL validation)
- ✅ Twitter social link
- ✅ Instagram social link
- ✅ LinkedIn social link
- ✅ Privacy checkbox (Make profile public)

### 3. Profile Picture Upload
- ✅ File input with validation
- ✅ Image preview (shows existing avatar or placeholder)
- ✅ File size validation (5MB max)
- ✅ File type validation (images only)
- ✅ Converts image to base64 for upload
- ✅ Uploads to Google Cloud Storage via backend API
- ✅ Success feedback when image is selected

### 4. Save Functionality
- ✅ Validates required fields (username, displayName)
- ✅ Sends data to `/api/profile/update` endpoint
- ✅ Backend uploads image to GCS if provided
- ✅ Updates `user_profiles` table in Supabase
- ✅ Shows loading state during save
- ✅ Success message on completion
- ✅ Error handling with user-friendly messages
- ✅ Redirects to `/account/profile` after save

### 5. UI/UX Features
- ✅ Cancel button (navigates back)
- ✅ Preview Public Profile link (opens in new tab)
- ✅ Save button disabled when required fields empty
- ✅ Save button disabled during save operation
- ✅ Responsive design with theme-aware colors
- ✅ Error banner at top of form
- ✅ Success feedback for image selection

---

## Manual Test Steps

### Test 1: Load Profile Page
1. Navigate to http://localhost:5173
2. Sign in as admin (davidltrinidad@gmail.com)
3. Click on Account dropdown → My Profile
4. Click "Edit Profile" button
5. **Expected**: Profile form loads with current data

**Result**: ⏳ PENDING - Ready to test

---

### Test 2: Edit Text Fields
1. On Edit Profile page
2. Change Display Name to "Test User"
3. Add bio text: "This is a test bio"
4. Add location: "Test City, TC"
5. Add website: "https://test.com"
6. **Expected**: All fields update as you type

**Result**: ⏳ PENDING - Ready to test

---

### Test 3: Edit Social Links
1. On Edit Profile page
2. Add Twitter: "https://twitter.com/testuser"
3. Add Instagram: "https://instagram.com/testuser"
4. Add LinkedIn: "https://linkedin.com/in/testuser"
5. **Expected**: Social link fields update correctly

**Result**: ⏳ PENDING - Ready to test

---

### Test 4: Upload Profile Picture
1. On Edit Profile page
2. Click "Upload Photo" button
3. Select a small test image (<5MB)
4. **Expected**:
   - Image preview updates immediately
   - Green checkmark shows with filename
   - No errors displayed

**Result**: ⏳ PENDING - Ready to test

---

### Test 5: Upload Picture - Size Validation
1. On Edit Profile page
2. Click "Upload Photo" button
3. Select a large image (>5MB)
4. **Expected**: Error message "Image must be less than 5MB"

**Result**: ⏳ PENDING - Ready to test

---

### Test 6: Upload Picture - Type Validation
1. On Edit Profile page
2. Click "Upload Photo" button
3. Try to select a PDF or text file
4. **Expected**: File browser only shows image files

**Result**: ⏳ PENDING - Ready to test

---

### Test 7: Save Profile Without Changes
1. On Edit Profile page (with existing data loaded)
2. Click "Save Profile" button without making changes
3. **Expected**:
   - Loading spinner shows in button
   - Success message appears
   - Redirects to /account/profile
   - Backend logs show successful update

**Result**: ⏳ PENDING - Ready to test

---

### Test 8: Save Profile With Changes
1. On Edit Profile page
2. Change Display Name, bio, and add social links
3. Click "Save Profile" button
4. **Expected**:
   - Loading spinner shows in button
   - Success message appears
   - Redirects to /account/profile
   - Backend logs show successful update
   - Database updated with new values

**Result**: ⏳ PENDING - Ready to test

---

### Test 9: Save Profile With New Picture
1. On Edit Profile page
2. Upload a new profile picture
3. Change some text fields
4. Click "Save Profile" button
5. Check browser console and backend logs
6. **Expected**:
   - Console shows: "[ProfileEdit] Converting image to base64..."
   - Console shows: "[ProfileEdit] Sending update request..."
   - Backend logs show: "[user/profile/update] Uploading avatar to GCS..."
   - Backend logs show: "[gcs] ✅ Image uploaded successfully"
   - Backend logs show: "[user/profile/update] ✅ Profile updated successfully"
   - Success message appears
   - Redirects to /account/profile
   - New avatar shows on profile page

**Result**: ⏳ PENDING - Ready to test

---

### Test 10: Validation - Empty Required Fields
1. On Edit Profile page
2. Clear the username field
3. Try to click "Save Profile"
4. **Expected**: Button is disabled, cannot click

**Result**: ⏳ PENDING - Ready to test

---

### Test 11: Cancel Button
1. On Edit Profile page
2. Make some changes to fields
3. Click "Cancel" button
4. **Expected**: Navigate back to /account/profile without saving

**Result**: ⏳ PENDING - Ready to test

---

### Test 12: Preview Public Profile
1. On Edit Profile page
2. Click "Preview Public Profile →" link
3. **Expected**: Opens public profile in new tab at /profile/{username}

**Result**: ⏳ PENDING - Ready to test

---

### Test 13: Privacy Toggle
1. On Edit Profile page
2. Uncheck "Make my profile public" checkbox
3. Click "Save Profile"
4. **Expected**:
   - Profile saves successfully
   - Database `is_public` field set to false

**Result**: ⏳ PENDING - Ready to test

---

## Database Schema Verification

### user_profiles Table Columns Used:
- ✅ `id` (UUID, primary key)
- ✅ `username` (text)
- ✅ `display_name` (text)
- ✅ `bio` (text)
- ✅ `location` (text)
- ✅ `website` (text)
- ✅ `avatar_url` (text) - stores GCS signed URL
- ✅ `social_twitter` (text)
- ✅ `social_instagram` (text)
- ✅ `social_linkedin` (text)
- ✅ `is_public` (boolean)
- ✅ `updated_at` (timestamp)

---

## Backend API Endpoints

### POST /api/profile/update
**Request Body:**
```json
{
  "username": "testuser",
  "displayName": "Test User",
  "bio": "This is a test bio",
  "location": "Test City, TC",
  "website": "https://test.com",
  "socialLinks": {
    "twitter": "https://twitter.com/testuser",
    "instagram": "https://instagram.com/testuser",
    "linkedin": "https://linkedin.com/in/testuser"
  },
  "avatarImage": "data:image/png;base64,iVBORw0KG...",
  "isPublic": true,
  "showOrderHistory": false,
  "showDesigns": true,
  "showModels": true
}
```

**Response:**
```json
{
  "ok": true,
  "message": "Profile updated successfully"
}
```

---

## Google Cloud Storage

### Upload Path Format:
```
user-avatars/{userId}/{timestamp}.png
```

### Example:
```
user-avatars/3e409705-2d5f-4ef8-a819-c7579f226961/1762638271234.png
```

### Signed URL:
- Valid for 7 days
- Format: `https://storage.googleapis.com/.../signed-url`

---

## Known Issues & Fixes

### ✅ FIXED: Profile Service API Calls
- **Issue**: Using old profileService that calls non-existent backend routes
- **Fix**: Replaced with direct Supabase queries for loading, backend API for saving

### ✅ FIXED: Image Upload Not Working
- **Issue**: No GCS upload implementation
- **Fix**: Added base64 conversion, backend API endpoint, GCS upload service integration

### ✅ FIXED: Social Links Not Saving
- **Issue**: Social links stored as JSON but needed separate columns
- **Fix**: Backend maps socialLinks object to separate columns (social_twitter, etc.)

### ✅ FIXED: Avatar URL Not Showing
- **Issue**: avatar_url field not being read
- **Fix**: Added avatar_url mapping in loadUserProfile function

---

## Test Checklist

- [ ] All form inputs work and save correctly
- [ ] Profile picture upload works
- [ ] Image validation works (size and type)
- [ ] Save button shows loading state
- [ ] Success message appears after save
- [ ] Error messages show when needed
- [ ] Cancel button works
- [ ] Preview public profile link works
- [ ] Privacy toggle works
- [ ] Database updates correctly
- [ ] Backend logs show successful operations
- [ ] GCS image upload works
- [ ] Redirects to profile page after save

---

## Next Steps After Testing

1. Test public profile preview page
2. Verify avatar shows on UserProfile page
3. Test profile visibility (public vs private)
4. Verify social links display correctly
5. Test username change (ensure unique)
6. Test profile completeness indicators

---

## Status: ✅ READY FOR TESTING

All features have been implemented and backend server is running with corrected routes.

### Recent Fixes Applied:
- ✅ Fixed route paths in backend/routes/user.ts (changed from `/profile/update` to `/update`)
- ✅ Restarted backend server to apply route changes
- ✅ Backend responding correctly on port 4000
- ✅ Health endpoint verified: http://localhost:4000/api/health
- ✅ Profile update endpoint should now work at: POST /api/profile/update

**Backend Server Status:** Running (PID: 59964)
**Frontend Dev Server:** http://localhost:5173
**Backend API Server:** http://localhost:4000

All features have been implemented and are ready for manual testing by the user.
