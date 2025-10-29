import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/supabaseAuth.js";

const router = Router();

// Returns authenticated user and (optionally) a minimal profile object.
// You can later extend to look up a "profiles" table.
router.get("/me", requireAuth, async (req: Request, res: Response) => {
  const user = req.user || null;
  return res.json({ ok: true, user, profile: null });
});

export default router;
