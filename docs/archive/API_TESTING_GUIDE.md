# Imagination Station API Testing Guide

## Quick Start

This guide helps you test the Imagination Station backend API endpoints at `http://localhost:4000`.

## Prerequisites

1. **Backend must be running**:
   ```bash
   cd backend
   npm install  # if not done already
   npm run dev  # starts on port 4000
   ```

2. **Get a valid user token** (required for most endpoints):
   ```bash
   # Option A: Use the helper script
   node get-user-token.mjs your-email@example.com yourpassword

   # Option B: From browser
   # 1. Login at http://localhost:5173
   # 2. DevTools > Application > Local Storage
   # 3. Copy access_token from: sb-czzyrmizvjqlifcivrhn.supabase.co-auth-token
   ```

## Three Ways to Test

### 1. Automated Node.js Script (Recommended)
```bash
# Set your user token
export USER_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# Run all tests
node test-imagination-api.mjs
```

**What it tests**:
- Health check
- Get pricing data
- Create DTF sheet
- Create UV DTF sheet
- Get sheet presets

### 2. Manual cURL Commands
```bash
# Set your token
export AUTH_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# Test 1: Get presets (no auth required)
curl http://localhost:4000/api/imagination-station/presets

# Test 2: Get pricing (requires auth)
curl -H "Authorization: Bearer $AUTH_TOKEN" \
  http://localhost:4000/api/imagination-station/pricing

# Test 3: Create sheet
curl -X POST \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test DTF Sheet","print_type":"dtf","sheet_height":48}' \
  http://localhost:4000/api/imagination-station/sheets
```

See `test-imagination-curl.md` for more examples.

### 3. API Client (Postman/Insomnia)

**Base URL**: `http://localhost:4000`

**Headers**:
```
Authorization: Bearer YOUR_USER_TOKEN
Content-Type: application/json
```

**Endpoints to test**:
- GET `/api/imagination-station/presets`
- GET `/api/imagination-station/pricing` (auth required)
- POST `/api/imagination-station/sheets` (auth required)

## Expected Results

### ✅ Success Indicators

**Test 1: GET /presets**
- Status: 200
- Response contains: dtf, uv_dtf, sublimation objects
- Each has: width, heights array, rules, displayName

**Test 2: GET /pricing**
- Status: 200
- Response has: pricing array, freeTrials array
- pricing contains feature_key, display_name, costs
- freeTrials shows remaining uses per feature

**Test 3: POST /sheets (DTF)**
- Status: 201
- Response contains: id, user_id, name, print_type, sheet_width=22.5, sheet_height=48

**Test 4: POST /sheets (UV DTF)**
- Status: 201
- Response contains: id, user_id, name, print_type, sheet_width=16, sheet_height=24

### ❌ Common Errors

**401 Unauthorized**
```json
{ "error": "Unauthorized" }
```
**Solution**: Get a fresh user token (see Prerequisites)

**400 Bad Request**
```json
{ "error": "Invalid print type" }
```
**Solution**: Use dtf, uv_dtf, or sublimation

**500 Internal Server Error**
```json
{ "error": "..." }
```
**Solutions**:
- Check backend logs for details
- Verify database tables exist
- Ensure Supabase connection is working

**Connection Refused**
```
ECONNREFUSED 127.0.0.1:4000
```
**Solution**: Start the backend server

## Files Reference

| File | Purpose |
|------|---------|
| `test-imagination-api.mjs` | Automated test script (Node.js) |
| `test-imagination-curl.md` | Manual cURL command reference |
| `get-user-token.mjs` | Helper to get JWT token |
| `IMAGINATION_STATION_API_TEST_REPORT.md` | Comprehensive API documentation |
| `API_TESTING_GUIDE.md` | This quick start guide |

## Backend Implementation Files

| File | Description |
|------|-------------|
| `backend/routes/imagination-station.ts` | API route handlers |
| `backend/services/imagination-pricing.ts` | Pricing & free trial logic |
| `backend/services/imagination-ai.ts` | AI operations (generate, upscale, etc) |
| `backend/config/imagination-presets.ts` | Sheet presets & AI styles |

## Database Check

Verify these tables exist in Supabase:

```sql
-- Check if tables exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name LIKE 'imagination%';
```

Required tables:
- `imagination_sheets`
- `imagination_layers`
- `imagination_pricing`
- `imagination_free_trials`

If missing, run the migration SQL in `IMAGINATION_STATION_API_TEST_REPORT.md`.

## Test Checklist

- [ ] Backend running on port 4000
- [ ] Database tables created
- [ ] User account created
- [ ] User token obtained
- [ ] GET /presets returns data
- [ ] GET /pricing returns data (with auth)
- [ ] POST /sheets creates DTF sheet
- [ ] POST /sheets creates UV DTF sheet
- [ ] No console errors in backend logs

## Troubleshooting

### Backend won't start
```bash
cd backend
npm install
npm run dev
```

### Can't get user token
1. Create account at http://localhost:5173
2. Use `get-user-token.mjs` script
3. Or extract from browser localStorage

### Pricing endpoint returns empty array
Seed the database:
```sql
INSERT INTO imagination_pricing (feature_key, display_name, base_cost, current_cost, is_free_trial, free_trial_uses) VALUES
  ('generate', 'AI Image Generation', 10, 10, true, 3),
  ('bg_remove', 'Background Removal', 5, 5, true, 5),
  ('upscale_2x', 'Upscale 2x', 3, 3, true, 5),
  ('upscale_4x', 'Upscale 4x', 8, 8, true, 2),
  ('enhance', 'Image Enhancement', 5, 5, true, 3);
```

### Token expired
Tokens expire after ~1 hour. Get a fresh token:
```bash
node get-user-token.mjs your-email@example.com yourpassword
```

## Next Steps

After successful API testing:
1. Test file upload endpoint: POST `/api/imagination-station/sheets/:id/upload`
2. Test AI generation: POST `/api/imagination-station/sheets/:id/generate`
3. Test image processing endpoints (bg removal, upscale, enhance)
4. Build frontend integration
5. Test end-to-end workflow

## Support

For detailed API documentation, see:
- `IMAGINATION_STATION_API_TEST_REPORT.md` - Full API reference
- `backend/routes/imagination-station.ts` - Source code
- Backend logs: Check terminal where `npm run dev` is running

---

**Last Updated**: 2025-12-11
