import { Router } from "express";
import { requireAuth } from "../middleware/supabaseAuth.js";
import { supabase } from "../lib/supabase.js";
import { uploadImageFromBase64 } from "../services/google-cloud-storage.js";
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
router.post("/update", requireAuth, async (req, res) => {
    try {
        const userId = req.user?.sub;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const { username, displayName, bio, location, website, socialLinks, avatarImage, isPublic, showOrderHistory, showDesigns, showModels } = req.body;
        console.log('[user/profile/update] Updating profile for user:', userId);
        let avatarUrl = null;
        if (avatarImage && avatarImage.startsWith('data:image/')) {
            console.log('[user/profile/update] Uploading avatar to GCS...');
            const timestamp = Date.now();
            const destinationPath = `user-avatars/${userId}/${timestamp}.png`;
            const uploadResult = await uploadImageFromBase64(avatarImage, destinationPath);
            avatarUrl = uploadResult.publicUrl;
            console.log('[user/profile/update] Avatar uploaded:', avatarUrl);
        }
        const updateData = {
            username,
            display_name: displayName,
            bio,
            location,
            website,
            is_public: isPublic,
            updated_at: new Date().toISOString()
        };
        if (avatarUrl) {
            updateData.avatar_url = avatarUrl;
        }
        if (socialLinks) {
            updateData.social_links = socialLinks;
        }
        const { error: profileError } = await supabase
            .from('user_profiles')
            .update(updateData)
            .eq('id', userId);
        if (profileError) {
            console.error('[user/profile/update] Profile update error:', profileError);
            return res.status(500).json({ error: profileError.message });
        }
        console.log('[user/profile/update] ✅ Profile updated successfully');
        return res.json({ ok: true, message: 'Profile updated successfully' });
    }
    catch (error) {
        console.error('[user/profile/update] Error:', error);
        return res.status(500).json({ error: error.message });
    }
});
export default router;
//# sourceMappingURL=user.js.map