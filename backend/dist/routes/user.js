import { Router } from "express";
import { requireAuth } from "../middleware/supabaseAuth.js";
import { supabase } from "../lib/supabase.js";
import { uploadFile } from "../services/gcs-storage.js";
const router = Router();
router.get("/me", requireAuth, async (req, res) => {
    const user = req.user || null;
    return res.json({ ok: true, user, profile: null });
});
router.get("/get", async (req, res) => {
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
    }
    catch (error) {
        console.error('[user/profile/get] Error:', error);
        return res.status(500).json({ error: error.message });
    }
});
router.post("/upload-image", requireAuth, async (req, res) => {
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
        const matches = image.match(/^data:([^;]+);base64,(.+)$/);
        if (!matches) {
            return res.status(400).json({ error: 'Invalid base64 data URL format' });
        }
        const contentType = matches[1];
        const base64String = matches[2];
        const buffer = Buffer.from(base64String, 'base64');
        const extMap = {
            'image/png': 'png',
            'image/jpeg': 'jpg',
            'image/jpg': 'jpg',
            'image/gif': 'gif',
            'image/webp': 'webp'
        };
        const ext = extMap[contentType] || 'png';
        const timestamp = Date.now();
        const folder = type === 'avatar' ? 'avatars' : 'covers';
        const filename = `${timestamp}.${ext}`;
        console.log(`[user/profile/upload-image] Uploading to GCS folder: ${folder}, filename: ${filename}`);
        const result = await uploadFile(buffer, {
            userId,
            folder: folder,
            filename,
            contentType
        });
        console.log(`[user/profile/upload-image] ✅ ${type} uploaded to GCS:`, result.gcsPath);
        return res.json({ ok: true, url: result.publicUrl, gcsPath: result.gcsPath });
    }
    catch (error) {
        console.error('[user/profile/upload-image] Error:', error);
        return res.status(500).json({ error: error.message });
    }
});
router.post("/update", requireAuth, async (req, res) => {
    try {
        const userId = req.user?.sub;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const { username, display_name, displayName, bio, location, website, avatar_url, avatarUrl, cover_image_url, coverImageUrl, social_twitter, socialTwitter, social_instagram, socialInstagram, social_tiktok, socialTiktok, show_designs, showDesigns, show_reviews, showReviews, show_activity, showActivity, allow_messages, allowMessages, is_public, isPublic, shipping_address_line1, shippingAddressLine1, shipping_address_line2, shippingAddressLine2, shipping_city, shippingCity, shipping_state, shippingState, shipping_zip, shippingZip, shipping_country, shippingCountry, shipping_phone, shippingPhone } = req.body;
        console.log('[user/profile/update] Updating profile for user:', userId);
        console.log('[user/profile/update] Received fields:', Object.keys(req.body));
        const updateData = {
            updated_at: new Date().toISOString()
        };
        if (username !== undefined)
            updateData.username = username;
        if (display_name !== undefined || displayName !== undefined) {
            updateData.display_name = display_name ?? displayName;
        }
        if (bio !== undefined)
            updateData.bio = bio;
        if (location !== undefined)
            updateData.location = location;
        if (website !== undefined)
            updateData.website = website;
        if (avatar_url !== undefined || avatarUrl !== undefined) {
            updateData.avatar_url = avatar_url ?? avatarUrl;
        }
        if (cover_image_url !== undefined || coverImageUrl !== undefined) {
            updateData.cover_image_url = cover_image_url ?? coverImageUrl;
        }
        if (social_twitter !== undefined || socialTwitter !== undefined) {
            updateData.social_twitter = social_twitter ?? socialTwitter;
        }
        if (social_instagram !== undefined || socialInstagram !== undefined) {
            updateData.social_instagram = social_instagram ?? socialInstagram;
        }
        if (social_tiktok !== undefined || socialTiktok !== undefined) {
            updateData.social_tiktok = social_tiktok ?? socialTiktok;
        }
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
        if (shipping_address_line1 !== undefined || shippingAddressLine1 !== undefined) {
            updateData.shipping_address_line1 = shipping_address_line1 ?? shippingAddressLine1;
        }
        if (shipping_address_line2 !== undefined || shippingAddressLine2 !== undefined) {
            updateData.shipping_address_line2 = shipping_address_line2 ?? shippingAddressLine2;
        }
        if (shipping_city !== undefined || shippingCity !== undefined) {
            updateData.shipping_city = shipping_city ?? shippingCity;
        }
        if (shipping_state !== undefined || shippingState !== undefined) {
            updateData.shipping_state = shipping_state ?? shippingState;
        }
        if (shipping_zip !== undefined || shippingZip !== undefined) {
            updateData.shipping_zip = shipping_zip ?? shippingZip;
        }
        if (shipping_country !== undefined || shippingCountry !== undefined) {
            updateData.shipping_country = shipping_country ?? shippingCountry;
        }
        if (shipping_phone !== undefined || shippingPhone !== undefined) {
            updateData.shipping_phone = shipping_phone ?? shippingPhone;
        }
        console.log('[user/profile/update] Update data:', updateData);
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
    }
    catch (error) {
        console.error('[user/profile/update] Error:', error);
        return res.status(500).json({ error: error.message });
    }
});
export default router;
//# sourceMappingURL=user.js.map