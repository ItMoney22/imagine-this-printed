import path from "path";
import fs from "fs";
import express from "express";
import compression from "compression";
import { fileURLToPath } from "url";
import { SITE_URL, injectHead } from "./api/_seo/structured-data.mjs";
import { isBotUserAgent, resolveHeadForPath } from "./api/_seo/bot-meta.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;
const dist = path.join(__dirname, "dist");

// Build timestamp for cache busting
const BUILD_TIME = new Date().toISOString();

// Security headers. Vercel serves the SPA from vercel.json's `headers` block;
// this server is the Railway/VPS path to the same bundle, so the policy is
// mirrored here. Keep the two in sync — see docs/SECURITY_HARDENING.md.
//
// connect-src ships TWO policies right now: the enforcing one stays broad
// (`https: wss:`) so nothing in production breaks, while
// Content-Security-Policy-Report-Only carries the tightened, explicit host
// allowlist. Once a monitoring window confirms the allowlist is complete,
// fold it into the enforcing CSP and delete the Report-Only header — see
// docs/SECURITY_HARDENING.md section 4 for the exact host list and why each
// entry is there.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://js.stripe.com https://unpkg.com https://ajax.googleapis.com https://www.googletagmanager.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "connect-src 'self' https: wss:",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://m.stripe.network https://www.tiktok.com https://www.youtube.com https://www.instagram.com",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests"
].join("; ");

const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' https://js.stripe.com https://unpkg.com https://ajax.googleapis.com https://www.googletagmanager.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "connect-src 'self' https://czzyrmizvjqlifcivrhn.supabase.co wss://czzyrmizvjqlifcivrhn.supabase.co https://api.imaginethisprinted.com https://api.stripe.com https://m.stripe.network https://storage.googleapis.com https://api.goshippo.com https://www.googletagmanager.com https://www.google-analytics.com https://region1.google-analytics.com",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://m.stripe.network https://www.tiktok.com https://www.youtube.com https://www.instagram.com",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests"
].join("; ");

app.disable("x-powered-by");

app.use((_req, res, next) => {
  res.set({
    "Content-Security-Policy": CSP,
    "Content-Security-Policy-Report-Only": CSP_REPORT_ONLY,
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "0",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": 'geolocation=(), usb=(), interest-cohort=(), payment=(self "https://js.stripe.com")'
  });
  next();
});

app.use(compression());

// No-cache headers for HTML to ensure fresh content
app.use((req, res, next) => {
  // For HTML requests, prevent caching
  if (req.path === '/' || req.path.endsWith('.html') || !req.path.includes('.')) {
    res.set({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'X-Build-Time': BUILD_TIME
    });
  }
  next();
});

// Static files with long cache (they have hashed names from Vite)
app.use(express.static(dist, {
  index: false,
  maxAge: '1y', // Cache hashed assets for 1 year
  setHeaders: (res, filePath) => {
    // Don't cache index.html
    if (filePath.endsWith('index.html')) {
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

// Bot / social-unfurler pre-render. This is a Vite SPA, so a crawler that does
// not run JS sees the same empty shell for every URL and every shared link
// unfurls as one generic site card. For bot user-agents only we inject the real
// per-page <head> (meta + JSON-LD) built in api/_seo/bot-meta.mjs — the exact
// module the Vercel deploy uses (api/product-meta.mjs), so both hosts emit
// identical markup. Humans fall straight through to the untouched shell.
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://czzyrmizvjqlifcivrhn.supabase.co";
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || "";

app.get("*", async (req, res, next) => {
  if (!isBotUserAgent(req.headers["user-agent"])) return next();
  try {
    const head = await resolveHeadForPath(req.path, {
      supabaseUrl: SUPABASE_URL,
      anonKey: SUPABASE_ANON_KEY,
      siteUrl: SITE_URL
    });
    if (!head) return next();
    const shell = await fs.promises.readFile(path.join(dist, "index.html"), "utf8");
    res.set({ "Content-Type": "text/html; charset=utf-8", "X-Build-Time": BUILD_TIME });
    return res.send(injectHead(shell, head));
  } catch (err) {
    console.error("[bot-meta] static-server render failed:", err?.message || err);
    return next();
  }
});

app.get("*", (_req, res) => {
  res.set({
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'X-Build-Time': BUILD_TIME
  });
  res.sendFile(path.join(dist, "index.html"));
});

app.listen(port, () => console.log(`[frontend] Serving dist on ${port} (built: ${BUILD_TIME})`));
