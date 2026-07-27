import path from "path";
import express from "express";
import compression from "compression";
import { fileURLToPath } from "url";

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

app.disable("x-powered-by");

app.use((_req, res, next) => {
  res.set({
    "Content-Security-Policy": CSP,
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
