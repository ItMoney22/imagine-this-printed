import { jose } from "../lib/jose.js";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_JWT_SECRET = process.env.JWT_SECRET || process.env.SUPABASE_JWT_SECRET;
export async function requireAuth(req, res, next) {
    try {
        const auth = req.header("authorization") || req.header("Authorization");
        if (!auth?.startsWith("Bearer ")) {
            console.log("[auth] Missing bearer token");
            res.status(401).json({ error: "Missing bearer token" });
            return;
        }
        const token = auth.substring(7);
        const { jwtVerify, decodeJwt } = await jose();
        const decoded = decodeJwt(token);
        console.log("[auth] Token algorithm:", decoded.alg);
        console.log("[auth] Token issuer:", decoded.iss);
        console.log("[auth] Expected issuer:", `https://${new URL(SUPABASE_URL).host}/auth/v1`);
        console.log("[auth] JWT_SECRET length:", SUPABASE_JWT_SECRET?.length);
        const secret = new TextEncoder().encode(SUPABASE_JWT_SECRET);
        const { payload } = await jwtVerify(token, secret, {
            algorithms: ["HS256"],
            issuer: `https://${new URL(SUPABASE_URL).host}/auth/v1`,
        });
        console.log("[auth] ✅ JWT verified successfully");
        const userMetadata = payload.user_metadata;
        const role = userMetadata?.role || undefined;
        req.user = {
            sub: String(payload.sub ?? ""),
            email: typeof payload.email === "string" ? payload.email : undefined,
            role,
        };
        next();
    }
    catch (err) {
        console.error("[auth] ❌ JWT verification failed:", err.message);
        console.error("[auth] Error code:", err.code);
        res.status(401).json({ error: "Invalid token", detail: err?.message });
        return;
    }
}
export async function optionalAuth(req, res, next) {
    try {
        const auth = req.header("authorization") || req.header("Authorization");
        if (!auth?.startsWith("Bearer ")) {
            next();
            return;
        }
        const token = auth.substring(7);
        const { jwtVerify, decodeJwt } = await jose();
        const secret = new TextEncoder().encode(SUPABASE_JWT_SECRET);
        const { payload } = await jwtVerify(token, secret, {
            algorithms: ["HS256"],
            issuer: `https://${new URL(SUPABASE_URL).host}/auth/v1`,
        });
        const userMetadata = payload.user_metadata;
        const role = userMetadata?.role || undefined;
        req.user = {
            sub: String(payload.sub ?? ""),
            email: typeof payload.email === "string" ? payload.email : undefined,
            role,
        };
    }
    catch (err) {
        console.log("[auth] Optional auth failed, continuing without user:", err.message);
    }
    next();
}
export function requireRole(allowedRoles) {
    return async (req, res, next) => {
        if (!req.user) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }
        if (!req.user.role) {
            const { supabase } = await import('../lib/supabase.js');
            const { data: profile } = await supabase
                .from('user_profiles')
                .select('role')
                .eq('id', req.user.sub)
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
//# sourceMappingURL=supabaseAuth.js.map