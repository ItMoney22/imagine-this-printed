# Imagination Station API Testing Resources

## Overview

This directory contains comprehensive testing resources for the Imagination Station backend API.

## Quick Start

**To test the API endpoints, follow these 3 steps**:

### 1. Start the Backend
```bash
cd backend
npm run dev
```
Backend will run on `http://localhost:4000`

### 2. Get a User Token
```bash
# Method A: Using the helper script
node get-user-token.mjs your-email@example.com yourpassword

# Method B: Extract from browser
# Login at http://localhost:5173 and copy token from DevTools > Local Storage
```

### 3. Run Tests
```bash
# Set the token
export USER_TOKEN="your-token-here"

# Run automated tests
node test-imagination-api.mjs
```

## Documentation Files

| File | Description | When to Use |
|------|-------------|-------------|
| **API_TESTING_GUIDE.md** | Quick start guide | Start here for step-by-step instructions |
| **IMAGINATION_STATION_API_TEST_REPORT.md** | Complete API reference | Detailed endpoint documentation, schemas, examples |
| **test-imagination-curl.md** | cURL command reference | Manual testing with cURL |
| **test-imagination-api.mjs** | Automated test script | Run all tests at once |
| **get-user-token.mjs** | Token helper script | Get a valid JWT token |

## What Gets Tested

The Imagination Station API has these core endpoints:

### Public Endpoints (No Auth)
- ✅ GET `/api/imagination-station/presets` - Sheet type configurations

### Protected Endpoints (Require Auth)
- ✅ GET `/api/imagination-station/pricing` - Pricing & free trials
- ✅ POST `/api/imagination-station/sheets` - Create design sheet
- ✅ GET `/api/imagination-station/sheets` - List user sheets
- ✅ GET `/api/imagination-station/sheets/:id` - Get sheet details
- ✅ PUT `/api/imagination-station/sheets/:id` - Update sheet
- ✅ DELETE `/api/imagination-station/sheets/:id` - Delete sheet
- ✅ POST `/api/imagination-station/sheets/:id/upload` - Upload image
- ✅ POST `/api/imagination-station/sheets/:id/generate` - AI generate
- ✅ POST `/api/imagination-station/sheets/:id/remove-bg` - Remove background
- ✅ POST `/api/imagination-station/sheets/:id/upscale` - Upscale image
- ✅ POST `/api/imagination-station/sheets/:id/enhance` - Enhance image

## Testing Methods

### 1. Automated (Recommended)
Run the Node.js test script:
```bash
export USER_TOKEN="your-token"
node test-imagination-api.mjs
```

### 2. Manual cURL
Use cURL commands from `test-imagination-curl.md`:
```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:4000/api/imagination-station/pricing
```

### 3. API Client (Postman/Insomnia)
Import endpoints manually with:
- Base URL: `http://localhost:4000`
- Header: `Authorization: Bearer YOUR_TOKEN`

## Expected Test Output

### Successful Test
```
============================================================
Testing: Get Pricing Data
GET /api/imagination-station/pricing
============================================================

Status: 200 OK
Content-Type: application/json

Response Body:
{
  "pricing": [...],
  "freeTrials": [...]
}
```

### Failed Test (Missing Token)
```
Status: 401 Unauthorized
Response Body:
{
  "error": "Unauthorized"
}
```

## Database Setup

The API requires these Supabase tables:
- `imagination_sheets` - Design sheets
- `imagination_layers` - Sheet layers
- `imagination_pricing` - Feature pricing
- `imagination_free_trials` - User trial tracking

See `IMAGINATION_STATION_API_TEST_REPORT.md` for SQL schemas.

## Common Issues

| Problem | Solution |
|---------|----------|
| Connection refused | Start backend: `cd backend && npm run dev` |
| 401 Unauthorized | Get fresh token with `get-user-token.mjs` |
| Empty pricing array | Seed database (see Test Report) |
| Token expired | Tokens last ~1 hour, get new one |

## Backend Implementation

The backend code is located at:
```
backend/
├── routes/
│   └── imagination-station.ts      # API route handlers
├── services/
│   ├── imagination-pricing.ts       # Pricing service
│   └── imagination-ai.ts            # AI operations
└── config/
    └── imagination-presets.ts       # Sheet configurations
```

## Test Request Examples

### Create DTF Sheet
```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My DTF Design",
    "print_type": "dtf",
    "sheet_height": 48
  }' \
  http://localhost:4000/api/imagination-station/sheets
```

### Create UV DTF Sheet
```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Sticker Sheet",
    "print_type": "uv_dtf",
    "sheet_height": 24
  }' \
  http://localhost:4000/api/imagination-station/sheets
```

## Support

- **Full API Docs**: See `IMAGINATION_STATION_API_TEST_REPORT.md`
- **Quick Guide**: See `API_TESTING_GUIDE.md`
- **Backend Logs**: Check terminal where `npm run dev` runs
- **Database**: Supabase dashboard at https://supabase.com/dashboard

## Workflow

1. **Read**: Start with `API_TESTING_GUIDE.md`
2. **Setup**: Get backend running and obtain token
3. **Test**: Run `test-imagination-api.mjs`
4. **Debug**: Check backend logs and database
5. **Reference**: Use `IMAGINATION_STATION_API_TEST_REPORT.md` for details
6. **Manual**: Use cURL commands from `test-imagination-curl.md`

---

**Quick Links**:
- [API Testing Guide](./API_TESTING_GUIDE.md) - Start here
- [Full API Report](./IMAGINATION_STATION_API_TEST_REPORT.md) - Complete reference
- [cURL Reference](./test-imagination-curl.md) - Manual testing
- Backend: `backend/routes/imagination-station.ts`
- Frontend: `src/pages/ImaginationStation.tsx` (when implemented)
