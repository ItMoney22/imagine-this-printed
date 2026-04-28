#!/usr/bin/env node
/**
 * One-shot: create the ITP backend (web service) and AI worker on Render.
 * Reads env vars from backend/.env and pushes them into each service.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ─── Load credentials ──────────────────────────────────────────────────
const vault = JSON.parse(readFileSync("C:/Users/David/.secrets/keys.json", "utf8"));
const RENDER_KEY = vault.render.RENDER_API_KEY;
if (!RENDER_KEY) throw new Error("No RENDER_API_KEY in vault");

const OWNER_ID = "tea-d7jp7tt7vvec7392beeg";
const REPO_URL = "https://github.com/ItMoney22/imagine-this-printed";
const BRANCH = "main";

// ─── Parse backend/.env (handles multi-line GCS_CREDENTIALS JSON) ─────
function parseEnv(filePath) {
  const src = readFileSync(filePath, "utf8");
  const vars = {};
  const lines = src.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line || /^\s*#/.test(line)) { i++; continue; }
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m) { i++; continue; }
    const key = m[1];
    let val = m[2];

    // Handle single-quoted multi-line (e.g. GCS_CREDENTIALS='{...}')
    if (val.startsWith("'") && !val.endsWith("'")) {
      const buf = [val.slice(1)];
      i++;
      while (i < lines.length) {
        const l = lines[i];
        if (l.endsWith("'")) { buf.push(l.slice(0, -1)); i++; break; }
        buf.push(l);
        i++;
      }
      val = buf.join("\n");
    } else if (val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1);
    } else if (val.startsWith("'") && val.endsWith("'")) {
      val = val.slice(1, -1);
    }
    vars[key] = val;
    i++;
  }
  return vars;
}

const backendEnv = parseEnv(join(ROOT, "backend", ".env"));

// Override for production
backendEnv.NODE_ENV = "production";
backendEnv.PORT = "10000"; // Render default
backendEnv.ALLOWED_ORIGINS = "https://imaginethisprinted.com,https://www.imaginethisprinted.com";
backendEnv.APP_ORIGIN = "https://imaginethisprinted.com";
backendEnv.API_ORIGIN = "https://api.imaginethisprinted.com";
backendEnv.FRONTEND_URL = "https://imaginethisprinted.com";
backendEnv.PUBLIC_URL = "https://api.imaginethisprinted.com";

const envVars = Object.entries(backendEnv).map(([key, value]) => ({ key, value }));
console.log(`Loaded ${envVars.length} env vars from backend/.env`);

// ─── Render API helper ────────────────────────────────────────────────
async function render(method, path, body) {
  const r = await fetch(`https://api.render.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${RENDER_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!r.ok) {
    console.error(`API ${method} ${path} → ${r.status}`);
    console.error(JSON.stringify(data, null, 2));
    throw new Error(`Render API error: ${r.status}`);
  }
  return data;
}

// ─── Create services ──────────────────────────────────────────────────
async function createWebService() {
  console.log("Creating web service: imagine-this-printed-backend");
  const body = {
    type: "web_service",
    name: "imagine-this-printed-backend",
    ownerId: OWNER_ID,
    repo: REPO_URL,
    branch: BRANCH,
    autoDeploy: "yes",
    rootDir: "backend",
    envVars,
    serviceDetails: {
      env: "node",
      plan: "free",
      region: "oregon",
      healthCheckPath: "/api/health",
      numInstances: 1,
      envSpecificDetails: {
        buildCommand: "npm ci && npx prisma generate && npm run build",
        startCommand: "node dist/index.js",
      },
    },
  };
  const out = await render("POST", "/services", body);
  console.log(`  → ${out.service?.name} (${out.service?.id})`);
  console.log(`  → URL: ${out.service?.serviceDetails?.url || "n/a"}`);
  return out.service;
}

async function createWorker() {
  console.log("Creating background worker: imagine-this-printed-worker");
  const body = {
    type: "background_worker",
    name: "imagine-this-printed-worker",
    ownerId: OWNER_ID,
    repo: REPO_URL,
    branch: BRANCH,
    autoDeploy: "yes",
    rootDir: "backend",
    envVars,
    serviceDetails: {
      env: "node",
      plan: "free",
      region: "oregon",
      envSpecificDetails: {
        buildCommand: "npm ci && npx prisma generate && npm run build",
        startCommand: "npm run start:worker",
      },
    },
  };
  const out = await render("POST", "/services", body);
  console.log(`  → ${out.service?.name} (${out.service?.id})`);
  return out.service;
}

// ─── Go ────────────────────────────────────────────────────────────────
const webService = await createWebService();
const workerService = await createWorker();

console.log("\n✅ DONE");
console.log(`Web: https://dashboard.render.com/web/${webService.id}`);
console.log(`Worker: https://dashboard.render.com/worker/${workerService.id}`);
if (webService.serviceDetails?.url) {
  console.log(`Live URL: ${webService.serviceDetails.url}`);
}
