import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/supabaseAuth.js";
import { supabase } from "../lib/supabase.js";

const router = Router();

// Returns authenticated user and (optionally) a minimal profile object.
// You can later extend to look up a "profiles" table.
router.get("/me", requireAuth, async (req: Request, res: Response) => {
  const user = req.user || null;
  return res.json({ ok: true, user, profile: null });
});

// GET /api/profile/get?userId=xxx
router.get("/get", async (req: Request, res: Response): Promise<any> => {
  try {
    const { userId } = req.query;

    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: 'userId is required' });
    }

    const { data: profile, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error || !profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    return res.json({ ok: true, profile });
  } catch (error: any) {
    console.error('[user/profile/get] Error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/profile/upload-image
// Upload avatar or cover image to Supabase Storage
router.post("/upload-image", requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { image, type } = req.body;

    if (!image || !image.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Invalid image data' });
    }

    if (!type || !['avatar', 'cover'].includes(type)) {
      return res.status(400).json({ error: 'Type must be avatar or cover' });
    }

    console.log(`[user/profile/upload-image] Uploading ${type} image for user:`, userId);

    // Extract the base64 string and content type from data URL
    const matches = image.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) {
      return res.status(400).json({ error: 'Invalid base64 data URL format' });
    }

    const contentType = matches[1];
    const base64String = matches[2];
    const buffer = Buffer.from(base64String, 'base64');

    // Determine file extension from content type
    const extMap: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp'
    };
    const ext = extMap[contentType] || 'png';

    const timestamp = Date.now();
    const bucket = type === 'avatar' ? 'avatars' : 'covers';
    const filePath = `${userId}/${timestamp}.${ext}`;

    console.log(`[user/profile/upload-image] Uploading to bucket: ${bucket}, path: ${filePath}`);

    // Upload to Supabase Storage
    const { data, error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(filePath, buffer, {
        contentType,
        upsert: true,
      });

    if (uploadError) {
      console.error('[user/profile/upload-image] Upload error:', uploadError);
      return res.status(500).json({ error: uploadError.message });
    }

    // Get the public URL
    const { data: urlData } = supabase.storage
      .from(bucket)
      .getPublicUrl(data.path);

    const publicUrl = urlData.publicUrl;

    console.log(`[user/profile/upload-image] ✅ ${type} uploaded:`, publicUrl);

    return res.json({ ok: true, url: publicUrl });
  } catch (error: any) {
    console.error('[user/profile/upload-image] Error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/profile/update
router.post("/update", requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Accept both snake_case and camelCase field names for flexibility
    const {
      username,
      display_name, displayName,
      bio,
      location,
      website,
      avatar_url, avatarUrl,
      cover_image_url, coverImageUrl,
      social_twitter, socialTwitter,
      social_instagram, socialInstagram,
      social_tiktok, socialTiktok,
      show_designs, showDesigns,
      show_reviews, showReviews,
      show_activity, showActivity,
      allow_messages, allowMessages,
      is_public, isPublic
    } = req.body;

    console.log('[user/profile/update] Updating profile for user:', userId);
    console.log('[user/profile/update] Received fields:', Object.keys(req.body));

    // Prepare update object - use snake_case for DB, prefer snake_case input but fallback to camelCase
    const updateData: any = {
      updated_at: new Date().toISOString()
    };

    // Basic fields
    if (username !== undefined) updateData.username = username;
    if (display_name !== undefined || displayName !== undefined) {
      updateData.display_name = display_name ?? displayName;
    }
    if (bio !== undefined) updateData.bio = bio;
    if (location !== undefined) updateData.location = location;
    if (website !== undefined) updateData.website = website;

    // Image URLs
    if (avatar_url !== undefined || avatarUrl !== undefined) {
      updateData.avatar_url = avatar_url ?? avatarUrl;
    }
    if (cover_image_url !== undefined || coverImageUrl !== undefined) {
      updateData.cover_image_url = cover_image_url ?? coverImageUrl;
    }

    // Social links
    if (social_twitter !== undefined || socialTwitter !== undefined) {
      updateData.social_twitter = social_twitter ?? socialTwitter;
    }
    if (social_instagram !== undefined || socialInstagram !== undefined) {
      updateData.social_instagram = social_instagram ?? socialInstagram;
    }
    if (social_tiktok !== undefined || socialTiktok !== undefined) {
      updateData.social_tiktok = social_tiktok ?? socialTiktok;
    }

    // Privacy settings
    if (show_designs !== undefined || showDesigns !== undefined) {
      updateData.show_designs = show_designs ?? showDesigns;
    }
    if (show_reviews !== undefined || showReviews !== undefined) {
      updateData.show_reviews = show_reviews ?? showReviews;
    }
    if (show_activity !== undefined || showActivity !== undefined) {
      updateData.show_activity = show_activity ?? showActivity;
    }
    if (allow_messages !== undefined || allowMessages !== undefined) {
      updateData.allow_messages = allow_messages ?? allowMessages;
    }
    if (is_public !== undefined || isPublic !== undefined) {
      updateData.is_public = is_public ?? isPublic;
    }

    console.log('[user/profile/update] Update data:', updateData);

    // Update user_profiles table
    const { data: updatedProfile, error: profileError } = await supabase
      .from('user_profiles')
      .update(updateData)
      .eq('id', userId)
      .select()
      .single();

    if (profileError) {
      console.error('[user/profile/update] Profile update error:', profileError);
      return res.status(500).json({ error: profileError.message });
    }

    console.log('[user/profile/update] ✅ Profile updated successfully');
    return res.json({ ok: true, message: 'Profile updated successfully', profile: updatedProfile });
  } catch (error: any) {
    console.error('[user/profile/update] Error:', error);
    return res.status(500).json({ error: error.message });
  }
});

export default router;
