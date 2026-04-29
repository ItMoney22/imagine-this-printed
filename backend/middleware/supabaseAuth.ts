import type { Request, Response, NextFunction } from "express";
import { jose } from "../lib/jose.js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_JWT_SECRET = process.env.JWT_SECRET || process.env.SUPABASE_JWT_SECRET!;

export type AuthUser = { sub: string; email?: string; role?: string };

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

    // Extract app role from user_metadata if available
    // NOTE: payload.role is the Supabase auth role ("authenticated"/"anon"), NOT the app role.
    // Only use user_metadata.role; otherwise leave undefined so requireRole() does a DB lookup.
    const userMetadata = payload.user_metadata as any;
    const role = userMetadata?.role || undefined;

    req.user = {
      sub: String(payload.sub ?? ""),
      email: typeof payload.email === "string" ? payload.email : undefined,
      role,
    };
    next();
  } catch (err: any) {
    console.error("[auth] ❌ JWT verification failed:", err.message);
    console.error("[auth] Error code:", err.code);
    res.status(401).json({ error: "Invalid token", detail: err?.message });
    return;
  }
}

/**
 * Optional auth middleware - tries to authenticate but continues even if no token
 * Sets req.user if valid token present, otherwise continues without user
 */
export async function optionalAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const auth = req.header("authorization") || req.header("Authorization");
    if (!auth?.startsWith("Bearer ")) {
      // No token provided, continue without user
      next();
      return;
    }
    const token = auth.substring(7);

    // Load jose dynamically
    const { jwtVerify, decodeJwt } = await jose();

    // Create secret key for HS256 verification
    const secret = new TextEncoder().encode(SUPABASE_JWT_SECRET);

    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
      issuer: `https://${new URL(SUPABASE_URL).host}/auth/v1`,
    });

    // Extract app role from user_metadata if available
    // NOTE: payload.role is the Supabase auth role ("authenticated"/"anon"), NOT the app role.
    // Only use user_metadata.role; otherwise leave undefined so requireRole() does a DB lookup.
    const userMetadata = payload.user_metadata as any;
    const role = userMetadata?.role || undefined;

    req.user = {
      sub: String(payload.sub ?? ""),
      email: typeof payload.email === "string" ? payload.email : undefined,
      role,
    };
  } catch (err: any) {
    // Token invalid or expired, continue without user
    console.log("[auth] Optional auth failed, continuing without user:", err.message);
  }
  next();
}

/**
 * Middleware to require specific roles
 * Usage: requireRole(['admin', 'manager'])
 */
export function requireRole(allowedRoles: string[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // Resolve the app role. JWT user_metadata.role is preferred (no DB
    // call); fall through to the shared role cache otherwise. The cache
    // has a 5-minute TTL and absorbs the cost across consecutive requests
    // from the same user.
    if (!req.user.role) {
      const { getCachedRole } = await import('../lib/role-cache.js');
      const role = await getCachedRole(req.user.sub);
      if (role) {
        req.user.role = role;
      }
    }

    if (!req.user.role || !allowedRoles.includes(req.user.role)) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }

    next();
  };
}
