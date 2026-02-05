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

    // Decode token to check algorithm and issuer
    const decoded = decodeJwt(token);
    console.log("[auth] Token algorithm:", decoded.alg);
    console.log("[auth] Token issuer:", decoded.iss);
    console.log("[auth] Expected issuer:", `https://${new URL(SUPABASE_URL).host}/auth/v1`);
    console.log("[auth] JWT_SECRET length:", SUPABASE_JWT_SECRET?.length);

    // Create secret key for HS256 verification
    const secret = new TextEncoder().encode(SUPABASE_JWT_SECRET);

    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
      issuer: `https://${new URL(SUPABASE_URL).host}/auth/v1`,
    });

    console.log("[auth] ✅ JWT verified successfully");

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

    // Fetch user role from database if not in token
    if (!req.user.role) {
      const { supabase } = await import('../lib/supabase.js');
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('role')
        .eq('id', req.user.sub)  // user_profiles.id matches Supabase auth user id
        .single();

      if (profile?.role) {
        req.user.role = profile.role;
      }
    }

    if (!req.user.role || !allowedRoles.includes(req.user.role)) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }

    next();
  };
}
