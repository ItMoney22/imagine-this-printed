import { jose } from "../lib/jose";
const SUPABASE_URL = process.env.SUPABASE_URL;
let JWKS = null;
export async function requireAuth(req, res, next) {
    try {
        const auth = req.header("authorization") || req.header("Authorization");
        if (!auth?.startsWith("Bearer "))
            return res.status(401).json({ error: "Missing bearer token" });
        const token = auth.substring(7);
        const { createRemoteJWKSet, jwtVerify } = await jose();
        if (!JWKS) {
            JWKS = createRemoteJWKSet(new URL(`https://${new URL(SUPABASE_URL).host}/auth/v1/.well-known/jwks.json`));
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
    }
    catch (err) {
        return res.status(401).json({ error: "Invalid token", detail: err?.message });
    }
}
//# sourceMappingURL=supabaseAuth.js.map