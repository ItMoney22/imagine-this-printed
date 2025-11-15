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

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const auth = req.header("authorization") || req.header("Authorization");
    if (!auth?.startsWith("Bearer ")) {
      console.log("[auth] Missing bearer token");
      return res.status(401).json({ error: "Missing bearer token" });
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

    // Extract role from user_metadata if available
    const userMetadata = payload.user_metadata as any;
    const role = userMetadata?.role || (typeof payload.role === "string" ? payload.role : undefined);

    req.user = {
      sub: String(payload.sub ?? ""),
      email: typeof payload.email === "string" ? payload.email : undefined,
      role,
    };
    return next();
  } catch (err: any) {
    console.error("[auth] ❌ JWT verification failed:", err.message);
    console.error("[auth] Error code:", err.code);
    return res.status(401).json({ error: "Invalid token", detail: err?.message });
  }
}

/**
 * Middleware to require specific roles
 * Usage: requireRole(['admin', 'manager'])
 */
export function requireRole(allowedRoles: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Fetch user role from database if not in token
    if (!req.user.role) {
      const { supabase } = await import('../lib/supabase.js');
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('role')
        .eq('user_id', req.user.sub)
        .single();

      if (profile?.role) {
        req.user.role = profile.role;
      }
    }

    if (!req.user.role || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    next();
  };
}
