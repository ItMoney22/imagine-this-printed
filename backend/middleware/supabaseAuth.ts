import type { Request, Response, NextFunction } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const JWKS = createRemoteJWKSet(new URL(`https://${new URL(SUPABASE_URL).host}/auth/v1/.well-known/jwks.json`));

export type AuthUser = { sub: string; email?: string; role?: string };

declare global {
  namespace Express {
    interface Request { user?: AuthUser }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const auth = req.header("authorization") || req.header("Authorization");
    if (!auth?.startsWith("Bearer ")) return res.status(401).json({ error: "Missing bearer token" });
    const token = auth.substring(7);

    const { payload } = await jwtVerify(token, JWKS, {
      algorithms: ["RS256"],
      // issuer should be your supabase auth url
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
