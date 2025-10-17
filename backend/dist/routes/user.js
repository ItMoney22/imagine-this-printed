import { Router } from "express";
import { requireAuth } from "../middleware/supabaseAuth";
const router = Router();
router.get("/me", requireAuth, async (req, res) => {
    const user = req.user || null;
    return res.json({ ok: true, user, profile: null });
});
export default router;
//# sourceMappingURL=user.js.map