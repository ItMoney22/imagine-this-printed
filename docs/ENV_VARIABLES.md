# Environment Variables Documentation

This document provides comprehensive information about all environment variables used in the Imagine This Printed application.

## Overview

The application uses environment variables for configuration across two main areas:

1. **Frontend** (`.env` file) - Vite variables with `VITE_` prefix
2. **Backend** (`backend/.env` file) - Node.js and sensitive configuration

## Table of Contents

- [Frontend Variables](#frontend-variables)
- [Backend Variables](#backend-variables)
- [Getting Started Guide](#getting-started-guide)
- [Environment-Specific Configuration](#environment-specific-configuration)
- [Security Best Practices](#security-best-practices)
- [Troubleshooting](#troubleshooting)

---

## Frontend Variables

Frontend environment variables are defined in `.env` file at the root of the project. All variables **must be prefixed with `VITE_`** to be accessible in the Vite application.

### Important Security Notice

**Frontend environment variables are publicly visible in the browser!** Never store secret keys, API credentials, or sensitive information in frontend variables. Only use:
- Public API keys (Stripe `pk_test_` or `pk_live_`)
- Public authentication tokens
- Non-sensitive configuration values

### Required Frontend Variables

#### Supabase Configuration

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `VITE_SUPABASE_URL` | Supabase project URL | `https://xxx.supabase.co` | Yes |
| `VITE_SUPABASE_ANON_KEY` | Supabase anonymous/public key | `eyJhbGciOiJIUzI1NiI...` | Yes |

**Where to find:**
1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Select your project
3. Navigate to Settings > API
4. Copy "Project URL" and "anon public" key

**Security:** These keys are safe to expose. The anonymous key only allows operations permitted by Row Level Security (RLS) policies.

#### API Configuration

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `VITE_API_BASE` | Backend API server URL | `http://localhost:4000` | Yes |
| `VITE_SITE_URL` | Frontend application URL | `http://localhost:5173` | Yes |

**Environment-specific values:**

Development:
```
VITE_API_BASE="http://localhost:4000"
VITE_SITE_URL="http://localhost:5173"
```

Production:
```
VITE_API_BASE="https://api.imaginethisprinted.com"
VITE_SITE_URL="https://imaginethisprinted.com"
```

### Optional Frontend Variables

#### Payment Processing

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `VITE_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key | `pk_test_...` or `pk_live_...` | No |

**Where to find:**
1. Go to [Stripe Dashboard](https://dashboard.stripe.com/apikeys)
2. Copy the "Publishable key"
3. Use `pk_test_` keys for development, `pk_live_` for production

**Important:** Only the publishable key goes here. The secret key must NEVER be in frontend code.

#### Cryptocurrency/Wallet Configuration

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `VITE_ITC_WALLET_ADDRESS` | Crypto wallet address for payments | `43XyoLPb3aek3poicnYXjr...` | No |
| `VITE_ITC_USD_RATE` | ITC to USD conversion rate | `0.10` | No |

---

## Backend Variables

Backend environment variables are defined in `backend/.env`. These are sensitive and should NEVER be committed to version control.

### Supabase Configuration (Required)

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `SUPABASE_URL` | Supabase project URL | `https://xxx.supabase.co` | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (admin access) | `eyJhbGciOiJIUzI1NiI...` | Yes |
| `SUPABASE_ANON_KEY` | Anonymous key (public) | `eyJhbGciOiJIUzI1NiI...` | Yes |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host/db` | Yes |

**Where to find Supabase credentials:**

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Select your project
3. Navigate to Settings > API
4. Copy:
   - Project URL
   - Service role secret key (⚠️ KEEP SECRET)
   - Anon public key

**For DATABASE_URL:**

1. Go to Supabase Dashboard > Settings > Database
2. Find "Connection string" section
3. Copy "Postgres URI" under "Connecting with URI"
4. Format: `postgresql://[user]:[password]@[host]:[port]/postgres?sslmode=require`

### Application Configuration (Required)

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `APP_ORIGIN` | Frontend origin (CORS) | `http://localhost:5173` | Yes |
| `API_ORIGIN` | Backend origin URL | `http://localhost:4000` | Yes |
| `FRONTEND_URL` | Frontend URL for links/redirects | `http://localhost:5173` | Yes |
| `ALLOWED_ORIGINS` | Comma-separated CORS allowed origins | `http://localhost:5173,http://localhost:4000` | Yes |
| `NODE_ENV` | Environment (development/production) | `development` or `production` | Yes |
| `PORT` | API server port | `4000` | Yes |

**Environment-specific values:**

Development:
```
APP_ORIGIN="http://localhost:5173"
API_ORIGIN="http://localhost:4000"
FRONTEND_URL="http://localhost:5173"
ALLOWED_ORIGINS="http://localhost:5173,http://localhost:4000"
NODE_ENV="development"
PORT="4000"
```

Production:
```
APP_ORIGIN="https://imaginethisprinted.com"
API_ORIGIN="https://api.imaginethisprinted.com"
FRONTEND_URL="https://imaginethisprinted.com"
ALLOWED_ORIGINS="https://imaginethisprinted.com,https://api.imaginethisprinted.com"
NODE_ENV="production"
PORT="4000"
```

### Authentication & Security (Required)

| Variable | Description | Requirements | Example |
|----------|-------------|--------------|---------|
| `JWT_SECRET` | JWT token signing secret | Minimum 32 characters, cryptographically secure | `5aD9FgqEL0NwZTsXzY6e1XUN7wrFrcqE` |

**How to generate a secure JWT_SECRET:**

Linux/Mac:
```bash
openssl rand -base64 32
```

Windows (PowerShell):
```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]])
```

Or use any secure random string generator online.

### Payment Processing - Stripe (Optional but Recommended)

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `STRIPE_PUBLISHABLE_KEY` | Stripe public key | `pk_test_...` or `pk_live_...` | No |
| `STRIPE_SECRET_KEY` | Stripe secret key (⚠️ KEEP SECRET) | `sk_test_...` or `sk_live_...` | No |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret (⚠️ KEEP SECRET) | `whsec_...` | No |

**Where to find Stripe credentials:**

1. Go to [Stripe Dashboard](https://dashboard.stripe.com/apikeys)
2. Copy API keys (use test keys for development)
3. For webhook secret:
   - Go to Developers > Webhooks
   - Create or select endpoint
   - Copy "Signing secret"

**Environment-specific values:**

Development:
```
STRIPE_PUBLISHABLE_KEY="pk_test_..."
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
```

Production:
```
STRIPE_PUBLISHABLE_KEY="pk_live_..."
STRIPE_SECRET_KEY="sk_live_..."
STRIPE_WEBHOOK_SECRET="whsec_..." (for production webhook)
```

### Email Service - Brevo (Optional but Recommended)

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `BREVO_API_KEY` | Brevo API key (⚠️ KEEP SECRET) | `xkeysib-...` | No |
| `BREVO_SENDER_EMAIL` | Verified sender email address | `noreply@imaginethisprinted.com` | No |
| `BREVO_SENDER_NAME` | Sender display name | `Imagine This Printed` | No |

**Where to find Brevo credentials:**

1. Go to [Brevo Dashboard](https://app.brevo.com)
2. Navigate to Settings > Account > SMTP & API
3. Copy API key
4. Verify sender email in: Senders > Sender list

**Usage:** Used for transactional emails (password reset, order confirmation, etc.)

### AWS S3 / File Storage (Optional but Recommended)

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `AWS_ACCESS_KEY_ID` | AWS access key | `AKIA...` | No |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key (⚠️ KEEP SECRET) | `...` | No |
| `AWS_REGION` | AWS region for S3 | `us-east-1` | No |
| `AWS_BUCKET_NAME` | S3 bucket name | `imagine-this-printed` | No |
| `S3_BUCKET_NAME` | Alias for AWS_BUCKET_NAME | `imagine-this-printed` | No |
| `CLOUDFRONT_URL` | CloudFront CDN URL (optional) | `https://xxx.cloudfront.net` | No |

**Where to find AWS credentials:**

1. Go to [AWS IAM Console](https://console.aws.amazon.com/iam/)
2. Users > Select user > Security credentials
3. Create access key if needed
4. Copy "Access Key ID" and "Secret Access Key"

**AWS Region examples:**
- `us-east-1` (N. Virginia)
- `us-east-2` (Ohio)
- `us-west-1` (N. California)
- `eu-west-1` (Ireland)
- `ap-southeast-1` (Singapore)

**Usage:** Used for storing product images, user uploads, and other files

---

## Getting Started Guide

### For New Developers (Local Development)

1. **Copy the example files:**
   ```bash
   cp .env.example .env
   cp backend/.env.example backend/.env
   ```

2. **Get Supabase credentials:**
   - Create a [Supabase account](https://app.supabase.com)
   - Create a new project
   - Go to Settings > API
   - Copy and paste credentials into both `.env` files

3. **Generate JWT secret:**
   ```bash
   openssl rand -base64 32
   ```
   - Paste result into `backend/.env` as `JWT_SECRET`

4. **Install dependencies:**
   ```bash
   npm install
   cd backend && npm install
   ```

5. **Start the application:**
   ```bash
   # Terminal 1: Start backend
   cd backend
   npm run build
   npm start

   # Terminal 2: Start frontend
   npm run dev
   ```

6. **Verify setup:**
   ```bash
   cd scripts
   npm run verify
   ```

### For Production Deployment

1. **Set up Supabase project:**
   - Create production project in Supabase
   - Run all database migrations
   - Configure authentication providers
   - Set up proper security policies

2. **Configure environment variables:**
   - Use production URLs for `APP_ORIGIN`, `API_ORIGIN`, `FRONTEND_URL`
   - Use production API keys for Stripe, Brevo, AWS
   - Use `NODE_ENV="production"`

3. **Deploy to Railway:**
   - Set environment variables in Railway dashboard
   - Deploy backend service
   - Deploy frontend service

---

## Environment-Specific Configuration

### Development Environment

```bash
# .env
VITE_SUPABASE_URL="https://xxx.supabase.co"
VITE_SUPABASE_ANON_KEY="..."
VITE_API_BASE="http://localhost:4000"
VITE_SITE_URL="http://localhost:5173"
VITE_STRIPE_PUBLISHABLE_KEY="pk_test_..."

# backend/.env
NODE_ENV="development"
PORT="4000"
SUPABASE_URL="https://xxx.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="..."
SUPABASE_ANON_KEY="..."
DATABASE_URL="postgresql://..."
APP_ORIGIN="http://localhost:5173"
API_ORIGIN="http://localhost:4000"
FRONTEND_URL="http://localhost:5173"
ALLOWED_ORIGINS="http://localhost:5173,http://localhost:4000"
JWT_SECRET="..." (32+ characters)
STRIPE_PUBLISHABLE_KEY="pk_test_..."
STRIPE_SECRET_KEY="sk_test_..."
BREVO_API_KEY="..."
AWS_ACCESS_KEY_ID="..."
AWS_SECRET_ACCESS_KEY="..."
```

### Production Environment

```bash
# .env (frontend)
VITE_SUPABASE_URL="https://xxx.supabase.co"
VITE_SUPABASE_ANON_KEY="..."
VITE_API_BASE="https://api.imaginethisprinted.com"
VITE_SITE_URL="https://imaginethisprinted.com"
VITE_STRIPE_PUBLISHABLE_KEY="pk_live_..."

# backend/.env (or Railway environment variables)
NODE_ENV="production"
PORT="4000"
SUPABASE_URL="https://xxx.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="..."
SUPABASE_ANON_KEY="..."
DATABASE_URL="postgresql://..."
APP_ORIGIN="https://imaginethisprinted.com"
API_ORIGIN="https://api.imaginethisprinted.com"
FRONTEND_URL="https://imaginethisprinted.com"
ALLOWED_ORIGINS="https://imaginethisprinted.com,https://api.imaginethisprinted.com"
JWT_SECRET="..." (32+ characters)
STRIPE_PUBLISHABLE_KEY="pk_live_..."
STRIPE_SECRET_KEY="sk_live_..."
STRIPE_WEBHOOK_SECRET="whsec_..." (production webhook)
BREVO_API_KEY="..."
AWS_ACCESS_KEY_ID="..."
AWS_SECRET_ACCESS_KEY="..."
CLOUDFRONT_URL="https://xxx.cloudfront.net"
```

---

## Security Best Practices

### Do's

- ✅ Use strong, randomly generated values for JWT_SECRET
- ✅ Rotate API keys regularly
- ✅ Use different keys for development and production
- ✅ Store `.env` files securely (never commit to git)
- ✅ Use environment-specific configuration files
- ✅ Restrict API keys to minimum required permissions
- ✅ Use HTTPS in production
- ✅ Enable RLS policies in Supabase
- ✅ Set proper CORS origins

### Don'ts

- ❌ Commit `.env` files to git (use `.env.example` instead)
- ❌ Share secret keys via email or chat
- ❌ Use the same keys for development and production
- ❌ Store secrets in frontend code or `.env` files
- ❌ Use weak JWT secrets
- ❌ Expose sensitive information in error messages
- ❌ Allow unrestricted CORS origins
- ❌ Commit AWS access keys or database passwords

### Git Protection

Ensure `.env` files are in `.gitignore`:

```
# .gitignore
.env
.env.local
.env.*.local
backend/.env
```

### API Key Rotation

Regularly rotate sensitive keys:

1. **Supabase:** Generate new keys in Settings > API
2. **Stripe:** Create new API keys in Developers > API keys
3. **Brevo:** Regenerate API key in Settings > Account
4. **AWS:** Create new access keys in IAM > Users

---

## Troubleshooting

### Environment Variable Not Loading

**Problem:** Variable shows as `undefined` in the application

**Solutions:**
1. Ensure variable is prefixed with `VITE_` in `.env` (frontend only)
2. Restart the dev server after changing `.env`
3. Check file spelling and quotes
4. Verify file is in correct location (`.env` at project root, `backend/.env` in backend directory)

### Supabase Connection Failed

**Problem:** "Failed to connect to Supabase" error

**Solutions:**
1. Verify `SUPABASE_URL` is correct (should look like `https://xxx.supabase.co`)
2. Verify `SUPABASE_ANON_KEY` or `SUPABASE_SERVICE_ROLE_KEY` are correct
3. Check internet connection
4. Verify project isn't paused in Supabase dashboard
5. Run verification script: `cd scripts && npm run verify`

### CORS Error

**Problem:** Frontend gets CORS error when calling backend

**Solutions:**
1. Verify `ALLOWED_ORIGINS` in `backend/.env` includes frontend URL
2. Ensure `APP_ORIGIN` matches actual frontend URL
3. Check if backend server is running and accessible
4. For development: ensure both local URLs are in `ALLOWED_ORIGINS`

### JWT Secret Error

**Problem:** "JWT_SECRET not set" or "Invalid JWT"

**Solutions:**
1. Verify `JWT_SECRET` is set in `backend/.env`
2. Ensure it's at least 32 characters
3. Check for special characters that need escaping
4. Regenerate if corrupted: `openssl rand -base64 32`

### Database Connection Failed

**Problem:** Cannot connect to database

**Solutions:**
1. Verify `DATABASE_URL` format is correct
2. Check password doesn't contain special characters (or URL-encode them)
3. Ensure Supabase project isn't paused
4. Verify `sslmode=require` is in the connection string
5. Check network/firewall isn't blocking connection

### Stripe Payment Fails

**Problem:** Stripe integration not working

**Solutions:**
1. Verify `STRIPE_PUBLISHABLE_KEY` is a test key (`pk_test_`) for development
2. Verify `STRIPE_SECRET_KEY` is set in backend (not frontend)
3. Ensure webhook secret matches webhook endpoint
4. Check Stripe account is in test mode for development
5. Verify webhook URL is publicly accessible

### Missing Dependencies

**Problem:** "BREVO_API_KEY is required" but file has it set

**Solutions:**
1. Check variable name is exactly correct (case-sensitive)
2. Verify no typos in variable name
3. Restart dev server
4. Check `.env` file has no syntax errors

---

## Quick Reference

### Essential Variables Checklist

**Frontend (.env)**
- [ ] `VITE_SUPABASE_URL`
- [ ] `VITE_SUPABASE_ANON_KEY`
- [ ] `VITE_API_BASE`
- [ ] `VITE_SITE_URL`

**Backend (backend/.env)**
- [ ] `SUPABASE_URL`
- [ ] `SUPABASE_SERVICE_ROLE_KEY`
- [ ] `SUPABASE_ANON_KEY`
- [ ] `DATABASE_URL`
- [ ] `APP_ORIGIN`
- [ ] `API_ORIGIN`
- [ ] `FRONTEND_URL`
- [ ] `ALLOWED_ORIGINS`
- [ ] `NODE_ENV`
- [ ] `PORT`
- [ ] `JWT_SECRET`

### Getting Credentials URLs

| Service | Where to Find Credentials |
|---------|--------------------------|
| Supabase | https://app.supabase.com/project/[PROJECT_ID]/settings/api |
| Stripe | https://dashboard.stripe.com/apikeys |
| Brevo | https://app.brevo.com/settings/account |
| AWS | https://console.aws.amazon.com/iam/ |

---

## Support

For issues with environment variables:

1. Check this documentation
2. Review `.env.example` files for correct format
3. Check backend logs: `backend/dist/index.js`
4. Run verification script: `cd scripts && npm run verify`
5. Check project documentation in `docs/` folder
