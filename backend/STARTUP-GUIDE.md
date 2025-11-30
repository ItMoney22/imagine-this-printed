# Backend Startup Guide

This guide explains how to start the Imagine This Printed backend with the AI Product Builder fully functional.

## Important: AI Product Builder Requires Both Services

The **AI Product Builder** requires TWO separate processes to function:

1. **API Server** - Handles HTTP requests from the frontend
2. **AI Jobs Worker** - Processes image generation jobs in the background

**If only the API is running, the AI Product Builder will NOT generate images!**

## Quick Start (Development)

### Option 1: One Command (Recommended) ✨

```bash
cd backend
npm run dev:full
```

This starts both the API and worker in a single terminal with color-coded output.

### Option 2: Script (Windows)

```bash
cd backend
dev-with-worker.bat
```

Opens two terminal windows - one for API, one for worker.

### Option 3: Script (Linux/Mac)

```bash
cd backend
chmod +x dev-with-worker.sh
./dev-with-worker.sh
```

Runs both services with graceful shutdown on Ctrl+C.

### Option 4: Manual (Two Terminals)

**Terminal 1 - API:**
```bash
cd backend
npm run watch
```

**Terminal 2 - Worker:**
```bash
cd backend
npm run worker:dev
```

## Production (PM2)

For production deployment, use PM2 which will run both the API and worker:

```bash
cd backend

# Build TypeScript
npm run build

# Start both API and worker with PM2
npm run pm2:start

# View logs
npm run pm2:logs

# Restart both
npm run pm2:restart

# Stop both
npm run pm2:stop
```

The PM2 configuration ([ecosystem.config.js](ecosystem.config.js)) automatically runs:
- `imagine-this-printed-api` - Main API server
- `imagine-this-printed-worker` - AI jobs worker

## Verifying the Worker is Running

After starting the worker, you should see:

```
=================================
AI Jobs Worker Starting...
=================================
Environment check:
- SUPABASE_URL: Set
- SUPABASE_SERVICE_ROLE_KEY: Set
- REPLICATE_API_TOKEN: Set
- OPENAI_API_KEY: Set
=================================
[worker] 🚀 Starting AI jobs worker
Worker is running. Press Ctrl+C to stop.
```

## Troubleshooting

### Images not generating in AI Product Builder?

**Check if the worker is running:**
```bash
# Look for the worker process
ps aux | grep "worker/index"

# Or on Windows
tasklist | findstr "node"
```

**Check worker logs:**
- Development: The worker outputs to console
- Production: Check `backend/logs/worker-out.log`

### How the AI Product Builder Works

1. User submits product idea in frontend
2. Frontend calls `/api/admin/products/ai/create`
3. API creates product and queues `replicate_image` job
4. **Worker picks up job** (every 5 seconds)
5. Worker calls Replicate API to generate image
6. Worker uploads image to Google Cloud Storage
7. Worker updates product with image URL
8. Frontend polls `/api/admin/products/ai/:id/status` and shows image

**If the worker is not running, jobs stay in "queued" status forever!**

## Environment Variables Required

Ensure your `.env` file has:

```env
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Replicate (for AI image generation)
REPLICATE_API_TOKEN=your_replicate_token

# OpenAI (for product metadata generation)
OPENAI_API_KEY=your_openai_key

# Google Cloud Storage (for image hosting)
GCS_BUCKET_NAME=your-bucket
GCS_PROJECT_ID=your-project
# Plus GCS credentials JSON
```

## Monitoring

### Check job queue status:
```bash
cd backend
node check-ai-workflow.mjs
```

This shows recent AI jobs, product assets, and AI-generated products.

### Watch logs in real-time:
```bash
# Development
tail -f backend/logs/*.log

# Production (PM2)
npm run pm2:logs
```

## Need Help?

- Backend API not starting? Check `.env` file and port 4000 availability
- Worker not processing jobs? Verify REPLICATE_API_TOKEN and OPENAI_API_KEY
- Images not uploading? Check Google Cloud Storage credentials
