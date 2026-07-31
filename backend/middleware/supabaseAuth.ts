import type { Request, Response, NextFunction } from "express";
import { jose } from "../lib/jose.js";
import { getCachedRole } from "../lib/role-cache.js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
// Supabase's JWT secret must never be aliased to the legacy Prisma-era
// JWT_SECRET (see backend/routes/account.ts) — sharing one secret between
// the two systems means anyone holding either one can mint a token the
// other accepts. Fail fast at boot instead of limping along with token
// verification silently broken (wrong secret) or cross-accepted (shared
// secret).
const rawSupabaseJwtSecret = process.env.SUPABASE_JWT_SECRET;
if (!rawSupabaseJwtSecret) {
  throw new Error("SUPABASE_JWT_SECRET is not set — refusing to boot without a way to verify auth tokens.");
}
const SUPABASE_JWT_SECRET: string = rawSupabaseJwtSecret;

export type AuthUser = { id: string; sub: string; email?: string; role?: string };

declare global {
  namespace Express {
    interface Request { user?: AuthUser }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const auth = req.header("authorization") || req.header("Authorization");
    if (!auth?.startsWith("Bearer ")) {
      console.log("[auth] Missing bearer token");
      res.status(401).json({ error: "Missing bearer token" });
      return;
    }
    const token = auth.substring(7);

    // Load jose dynamically
    const { jwtVerify, decodeJwt } = await jose();

    // Decode token to check algorithm and issuer (silent on success)
    const decoded = decodeJwt(token);

    // Create secret key for HS256 verification
    const secret = new TextEncoder().encode(SUPABASE_JWT_SECRET);

    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
      issuer: `https://${new URL(SUPABASE_URL).host}/auth/v1`,
    });
    void decoded; // referenced for tooling, not logged on the happy path

    // Role is intentionally NOT read from the token. `user_metadata` is
    // client-writable via supabase.auth.updateUser({ data: { role: ... } }),
    // so a forged role claim inside an otherwise legitimately-signed JWT
    // must never be trusted. Authorization always resolves through
    // requireRole() -> role-cache.ts, which reads the server-controlled
    // `user_profiles` table.
    const sub = String(payload.sub ?? "");

    req.user = {
      id: sub,
      sub,
      email: typeof payload.email === "string" ? payload.email : undefined,
    };
    next();
  } catch (err: any) {
    console.error("[auth] Token verification failed:", err.message);
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireRole(roles: string[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
    // Role always resolves from the server-trusted role cache (backed by
    // user_profiles), never from the JWT — see requireAuth() above for why.
    try {
      const role = await getCachedRole(req.user.id);
      if (role && roles.includes(role)) {
        req.user.role = role;
        next();
      } else {
        res.status(403).json({ error: "Insufficient permissions" });
      }
    } catch {
      res.status(403).json({ error: "Insufficient permissions" });
    }
  };
}

export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const auth = req.header("authorization") || req.header("Authorization");
    if (!auth?.startsWith("Bearer ")) { next(); return; }
    const token = auth.substring(7);
    const { jwtVerify } = await jose();
    const secret = new TextEncoder().encode(SUPABASE_JWT_SECRET);
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
      issuer: `https://${new URL(SUPABASE_URL).host}/auth/v1`,
    });
    const sub = String(payload.sub ?? "");
    req.user = {
      id: sub,
      sub,
      email: typeof payload.email === "string" ? payload.email : undefined,
    };
  } catch {
    // no-op — optional means unauthenticated is fine
  }
  next();
}
