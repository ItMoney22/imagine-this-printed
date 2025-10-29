# Environment Setup Notes

## Backend Missing Environment Variables

The backend/.env file is missing two required environment variables:

### 1. SUPABASE_ANON_KEY

**Purpose**: Used for health checks and logging
**Current Value**: Not set (showing as 'none')
**Where to find it**: Supabase Dashboard → Project Settings → API → Project API keys → `anon` public key

**Add to `backend/.env`**:
```bash
SUPABASE_ANON_KEY="your-anon-key-from-supabase-dashboard"
```

### 2. FRONTEND_URL

**Purpose**: Used for CORS, OAuth callbacks, and email links
**Current Value**: Not set (showing as undefined)
**Local Development**: `http://localhost:5173`
**Production**: Your production frontend URL (e.g., `https://imaginethisprinted.com`)

**Add to `backend/.env`**:
```bash
FRONTEND_URL="http://localhost:5173"
```

## How to Fix

1. Open `backend/.env` in your editor
2. Add the two missing environment variables shown above
3. Get the SUPABASE_ANON_KEY from your Supabase dashboard
4. Restart the backend server

## Updated .env.example

The `backend/.env.example` file has been updated to include these variables as a reference for future deployments.
