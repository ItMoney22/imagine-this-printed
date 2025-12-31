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
