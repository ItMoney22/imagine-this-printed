# Imagine This Printed - Backend API

Express TypeScript backend server for Imagine This Printed application.

## Features

- **Authentication**: JWT-based auth with login/register/profile management
- **Wallet System**: Points and ITC token management
- **Stripe Integration**: Payment processing and webhooks
- **Health Checks**: Database and server health monitoring
- **TypeScript**: Full TypeScript support with proper types
- **PM2 Ready**: Production deployment with PM2 process manager

## Routes

### Authentication & Account (`/api/auth`, `/api/account`)
- `POST /api/auth/login` - User login
- `POST /api/auth/register` - User registration
- `GET /api/auth/me` - Get current user
- `GET /api/account/profile` - Get user profile
- `POST /api/account/profile` - Update user profile
- `GET /api/account/wallet` - Get wallet information

### Health (`/api/health`)
- `GET /api/health` - General health check
- `GET /api/health/database` - Database connection check

### Webhooks (`/api/webhooks`)
- `POST /api/webhooks/stripe` - Stripe payment webhooks

## Setup

1. **Install dependencies:**
   ```bash
   cd backend
   npm install
   ```

2. **Environment setup:**
   ```bash
   cp .env.example .env
   # Edit .env with your actual values
   ```

3. **Database setup:**
   - Ensure PostgreSQL is running
   - Update DATABASE_URL in .env
   - Run Prisma migrations from the main project

## Development

```bash
# Development mode with auto-reload
npm run dev

# Watch mode
npm run watch
```

## Production Deployment

### Option 1: Direct with ts-node
```bash
npm run dev
```

### Option 2: Build and run
```bash
npm run build
npm start
```

### Option 3: PM2 (Recommended for VPS)
```bash
# Build the project
npm run build

# Create logs directory
mkdir -p logs

# Start with PM2
npm run pm2:start

# Other PM2 commands
npm run pm2:stop
npm run pm2:restart
npm run pm2:logs
```

## Environment Variables

Copy `.env.example` to `.env` and configure:

- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - Secret key for JWT tokens
- `STRIPE_SECRET_KEY` - Stripe secret key
- `STRIPE_WEBHOOK_SECRET` - Stripe webhook secret
- `FRONTEND_URL` - Frontend URL for CORS
- `PORT` - Server port (default: 4000)

## API Usage from Frontend

Update your frontend to call:
```
http://<VPS-IP>:4000/api/auth/login
http://<VPS-IP>:4000/api/account/profile
http://<VPS-IP>:4000/api/health
```

## File Structure

```
backend/
├── routes/
│   ├── account.ts      # Auth, profile, wallet routes
│   ├── health.ts       # Health check routes
│   └── webhooks.ts     # Stripe webhook handlers
├── index.ts            # Main Express server
├── package.json        # Dependencies and scripts
├── tsconfig.json       # TypeScript configuration
├── ecosystem.config.js # PM2 configuration
└── .env.example        # Environment variables template
```

## Production Notes

- Server runs on port 4000 by default
- CORS configured to allow frontend requests
- Error logging and graceful shutdown implemented
- Ready for reverse proxy (nginx) setup
- PM2 process management included

## Deploys (Render)

- The API (`srv-d7jpgut7vvec739bsid0`) and the worker (`srv-d7jppnn7f7vs73bb4p80`) auto-deploy from `main` with
  Root Directory `backend`. A push redeploys them only when it changes a file under `backend/`. A frontend-only
  push that starts no Render deploy is correct; Vercel ships it.
- What is live: `GET https://api.render.com/v1/services/<id>/deploys?limit=3`, the `live` row's `commit.id`.
  `trigger` is `new_commit` when a push started it and `api` when someone deployed by hand.
- A backend push with no Render deploy after ~3 minutes: GitHub may not have sent the push event. On 2026-11-09
  GitHub recorded main f257d25a -> 84c4b8c1 during its own incident and sent no push event to anyone, so Render and
  Vercel both missed it. Deploy that commit by hand on both services:
  `POST /v1/services/<id>/deploys {"commitId":"<sha>"}`.
