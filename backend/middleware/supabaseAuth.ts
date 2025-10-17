import type { Request, Response, NextFunction } from "express";
import { jose } from "../lib/jose";

const SUPABASE_URL = process.env.SUPABASE_URL!;

export type AuthUser = { sub: string; email?: string; role?: string };

declare global {
  namespace Express {
    interface Request { user?: AuthUser }
  }
}

// Lazy-loaded JWKS (created on first auth request)
let JWKS: any = null;

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const auth = req.header("authorization") || req.header("Authorization");
    if (!auth?.startsWith("Bearer ")) return res.status(401).json({ error: "Missing bearer token" });
    const token = auth.substring(7);

    // Load jose dynamically and create JWKS if not yet created
    const { createRemoteJWKSet, jwtVerify } = await jose();

    if (!JWKS) {
      JWKS = createRemoteJWKSet(
        new URL(`https://${new URL(SUPABASE_URL).host}/auth/v1/.well-known/jwks.json`)
      );
    }

    const { payload } = await jwtVerify(token, JWKS, {
      algorithms: ["RS256"],
      issuer: `https://${new URL(SUPABASE_URL).host}/auth/v1`,
    });

    req.user = {
      sub: String(payload.sub ?? ""),
      email: typeof payload.email === "string" ? payload.email : undefined,
      role: typeof payload.role === "string" ? payload.role : undefined,
    };
    return next();
  } catch (err: any) {
    return res.status(401).json({ error: "Invalid token", detail: err?.message });
  }
}
