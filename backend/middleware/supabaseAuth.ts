import type { Request, Response, NextFunction } from "express";
import { jose } from "../lib/jose.js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_JWT_SECRET = process.env.JWT_SECRET || process.env.SUPABASE_JWT_SECRET!;

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

    // Extract app role from user_metadata if available
    // NOTE: payload.role is the Supabase auth role ("authenticated"/"anon"), NOT the app role.
    // Only use user_metadata.role; otherwise leave undefined so requireRole() does a DB lookup.
    const userMetadata = payload.user_metadata as any;
    const role = userMetadata?.role || undefined;
    const sub = String(payload.sub ?? "");

    req.user = {
      id: sub,
      sub,
      email: typeof payload.email === "string" ? payload.email : undefined,
      role,
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
    // If role is set in token, check it directly
    if (req.user.role && roles.includes(req.user.role)) { next(); return; }
    // Otherwise fall back to a DB lookup
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const sb = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      const { data } = await sb.from("user_profiles").select("role").eq("id", req.user.id).single();
      if (data?.role && roles.includes(data.role)) {
        req.user.role = data.role;
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
    const userMetadata = payload.user_metadata as any;
    const sub = String(payload.sub ?? "");
    req.user = {
      id: sub,
      sub,
      email: typeof payload.email === "string" ? payload.email : undefined,
      role: userMetadata?.role || undefined,
    };
  } catch {
    // no-op — optional means unauthenticated is fine
  }
  next();
}
