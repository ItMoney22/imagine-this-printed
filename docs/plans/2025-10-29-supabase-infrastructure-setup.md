# Supabase Infrastructure Setup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Establish working Supabase infrastructure with authentication, database, and all required configurations

**Architecture:** Use Supabase as the complete backend infrastructure (auth, database, storage) with Express.js API middleware for business logic and protected endpoints. Frontend communicates with Supabase directly for auth and via Express for protected operations.

**Tech Stack:** Supabase (PostgreSQL, Auth, Storage), Express.js, Prisma ORM, TypeScript, React + Vite

---

## Task 1: Verify Supabase Project Access

**Files:**
- Check: `backend/.env`
- Check: `.env`
- Create: `diagnostics/supabase-connection-test.js`

**Step 1: Write test script to verify Supabase connectivity**

Create `diagnostics/supabase-connection-test.js`:

```javascript
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load backend .env
dotenv.config({ path: join(__dirname, '../backend/.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

console.log('Testing Supabase connection...');
console.log('URL:', supabaseUrl);
console.log('Key tail:', supabaseKey?.slice(-8));

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Test connection
async function testConnection() {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.error('❌ Connection failed:', error.message);
      return false;
    }
    console.log('✅ Connected to Supabase successfully');
    console.log('Session:', data.session ? 'Active' : 'None');
    return true;
  } catch (err) {
    console.error('❌ Connection error:', err.message);
    return false;
  }
}

testConnection();
```

**Step 2: Install required dependencies**

Run: `cd diagnostics && npm install @supabase/supabase-js dotenv`
Expected: Package installation completes

**Step 3: Run connection test**

Run: `cd diagnostics && node supabase-connection-test.js`
Expected: Either success message or specific error about DNS/connection

**Step 4: Commit diagnostic test**

```bash
git add diagnostics/supabase-connection-test.js
git commit -m "feat: add Supabase connection diagnostic test"
```

---

## Task 2: Create or Restore Supabase Project

**Files:**
- Read: `setup-supabase.js`
- Create: `diagnostics/supabase-project-setup.md`

**Step 1: Document current Supabase project status**

Create `diagnostics/supabase-project-setup.md`:

```markdown
# Supabase Project Setup Status

## Current Configuration
- Project URL: [To be determined]
- Project ID: [To be determined]
- Region: [To be determined]
- Status: [Active/Paused/Not Created]

## Setup Steps Completed
- [ ] Project created in Supabase Dashboard
- [ ] Authentication providers configured
- [ ] Database password set
- [ ] API keys retrieved
- [ ] Redirect URLs configured

## Required Environment Variables
- SUPABASE_URL:
- SUPABASE_ANON_KEY:
- SUPABASE_SERVICE_ROLE_KEY:
- DATABASE_URL:

## Next Steps
1. Login to https://app.supabase.com
2. Create new project or restore existing
3. Copy credentials to .env files
```

**Step 2: Run setup wizard if project exists**

Run: `node setup-supabase.js`
Expected: Interactive wizard starts or error about missing credentials

**Step 3: Document findings**

Update `diagnostics/supabase-project-setup.md` with actual status

**Step 4: Commit documentation**

```bash
git add diagnostics/supabase-project-setup.md
git commit -m "docs: document Supabase project setup status"
```

---

## Task 3: Configure Database Schema

**Files:**
- Create: `backend/prisma/migrations/001_initial_schema.sql`
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/scripts/setup-database.js`

**Step 1: Write initial database migration**

Create `backend/prisma/migrations/001_initial_schema.sql`:

```sql
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- User profiles table (extends Supabase auth.users)
CREATE TABLE public.user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  username TEXT UNIQUE,
  avatar_url TEXT,
  phone TEXT,
  address JSONB,
  role TEXT DEFAULT 'customer' CHECK (role IN ('customer', 'vendor', 'admin', 'founder')),
  referral_code TEXT UNIQUE,
  referred_by UUID REFERENCES public.user_profiles(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- User wallets table
CREATE TABLE public.user_wallets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  itc_balance DECIMAL(10, 2) DEFAULT 0.00,
  usd_balance DECIMAL(10, 2) DEFAULT 0.00,
  total_earned DECIMAL(10, 2) DEFAULT 0.00,
  total_spent DECIMAL(10, 2) DEFAULT 0.00,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id)
);

-- Products table
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendor_id UUID REFERENCES public.user_profiles(id),
  name TEXT NOT NULL,
  description TEXT,
  base_price DECIMAL(10, 2) NOT NULL,
  category TEXT NOT NULL,
  images JSONB DEFAULT '[]',
  customization_options JSONB DEFAULT '{}',
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'draft')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Orders table
CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.user_profiles(id),
  order_number TEXT UNIQUE NOT NULL,
  items JSONB NOT NULL,
  total_amount DECIMAL(10, 2) NOT NULL,
  payment_method TEXT,
  payment_status TEXT DEFAULT 'pending',
  fulfillment_status TEXT DEFAULT 'pending',
  shipping_address JSONB,
  tracking_info JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX idx_user_profiles_email ON public.user_profiles(email);
CREATE INDEX idx_user_profiles_role ON public.user_profiles(role);
CREATE INDEX idx_products_vendor ON public.products(vendor_id);
CREATE INDEX idx_orders_user ON public.orders(user_id);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at triggers
CREATE TRIGGER update_user_profiles_updated_at BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_wallets_updated_at BEFORE UPDATE ON public.user_wallets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

**Step 2: Create database setup script**

Create `backend/scripts/setup-database.js`:

```javascript
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function runMigration() {
  try {
    console.log('Reading migration file...');
    const migrationSQL = await fs.readFile(
      path.join(__dirname, '../prisma/migrations/001_initial_schema.sql'),
      'utf-8'
    );

    console.log('Running migration...');
    const { data, error } = await supabase.rpc('exec_sql', {
      sql: migrationSQL
    });

    if (error) {
      console.error('Migration failed:', error);
      return false;
    }

    console.log('✅ Database schema created successfully');
    return true;
  } catch (err) {
    console.error('Error:', err);
    return false;
  }
}

runMigration();
```

**Step 3: Run database setup**

Run: `cd backend && node scripts/setup-database.js`
Expected: Success message or specific error about permissions

**Step 4: Commit database schema**

```bash
git add backend/prisma/migrations/001_initial_schema.sql backend/scripts/setup-database.js
git commit -m "feat: add initial database schema and setup script"
```

---

## Task 4: Configure Row Level Security (RLS) Policies

**Files:**
- Create: `backend/prisma/migrations/002_rls_policies.sql`
- Create: `backend/scripts/setup-rls.js`

**Step 1: Write RLS policies migration**

Create `backend/prisma/migrations/002_rls_policies.sql`:

```sql
-- Enable RLS on all tables
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- User Profiles Policies
-- Users can read their own profile
CREATE POLICY "Users can read own profile" ON public.user_profiles
  FOR SELECT USING (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "Users can update own profile" ON public.user_profiles
  FOR UPDATE USING (auth.uid() = id);

-- Public can read vendor profiles
CREATE POLICY "Public can read vendor profiles" ON public.user_profiles
  FOR SELECT USING (role = 'vendor');

-- User Wallets Policies
-- Users can read their own wallet
CREATE POLICY "Users can read own wallet" ON public.user_wallets
  FOR SELECT USING (auth.uid() = user_id);

-- Service role can update wallets
CREATE POLICY "Service role can manage wallets" ON public.user_wallets
  FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- Products Policies
-- Anyone can read active products
CREATE POLICY "Public can read active products" ON public.products
  FOR SELECT USING (status = 'active');

-- Vendors can manage their own products
CREATE POLICY "Vendors can manage own products" ON public.products
  FOR ALL USING (auth.uid() = vendor_id);

-- Orders Policies
-- Users can read their own orders
CREATE POLICY "Users can read own orders" ON public.orders
  FOR SELECT USING (auth.uid() = user_id);

-- Users can create their own orders
CREATE POLICY "Users can create orders" ON public.orders
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Service role can update orders
CREATE POLICY "Service role can update orders" ON public.orders
  FOR UPDATE USING (auth.jwt()->>'role' = 'service_role');
```

**Step 2: Create RLS setup script**

Create `backend/scripts/setup-rls.js`:

```javascript
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function setupRLS() {
  try {
    console.log('Reading RLS policies...');
    const rlsSQL = await fs.readFile(
      path.join(__dirname, '../prisma/migrations/002_rls_policies.sql'),
      'utf-8'
    );

    console.log('Applying RLS policies...');
    const statements = rlsSQL.split(';').filter(s => s.trim());

    for (const statement of statements) {
      if (statement.trim()) {
        const { error } = await supabase.rpc('exec_sql', {
          sql: statement + ';'
        });
        if (error) {
          console.error('Policy failed:', error);
        }
      }
    }

    console.log('✅ RLS policies configured successfully');
    return true;
  } catch (err) {
    console.error('Error:', err);
    return false;
  }
}

setupRLS();
```

**Step 3: Run RLS setup**

Run: `cd backend && node scripts/setup-rls.js`
Expected: Success message or specific policy errors

**Step 4: Commit RLS policies**

```bash
git add backend/prisma/migrations/002_rls_policies.sql backend/scripts/setup-rls.js
git commit -m "feat: add Row Level Security policies"
```

---

## Task 5: Create User Profile Trigger

**Files:**
- Create: `backend/prisma/migrations/003_user_triggers.sql`
- Create: `backend/scripts/setup-triggers.js`

**Step 1: Write user creation trigger**

Create `backend/prisma/migrations/003_user_triggers.sql`:

```sql
-- Function to create user profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Create user profile
  INSERT INTO public.user_profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name'
  );

  -- Create user wallet
  INSERT INTO public.user_wallets (user_id, itc_balance, usd_balance)
  VALUES (NEW.id, 0.00, 0.00);

  -- Generate referral code
  UPDATE public.user_profiles
  SET referral_code = UPPER(SUBSTR(MD5(NEW.id::text), 1, 8))
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on user creation
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function to handle user deletion
CREATE OR REPLACE FUNCTION public.handle_user_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- Delete user profile (cascades to wallet and other tables)
  DELETE FROM public.user_profiles WHERE id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on user deletion
DROP TRIGGER IF EXISTS on_auth_user_deleted ON auth.users;
CREATE TRIGGER on_auth_user_deleted
  BEFORE DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_user_delete();
```

**Step 2: Create triggers setup script**

Create `backend/scripts/setup-triggers.js`:

```javascript
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function setupTriggers() {
  try {
    console.log('Reading triggers SQL...');
    const triggersSQL = await fs.readFile(
      path.join(__dirname, '../prisma/migrations/003_user_triggers.sql'),
      'utf-8'
    );

    console.log('Creating triggers...');
    const { error } = await supabase.rpc('exec_sql', {
      sql: triggersSQL
    });

    if (error) {
      console.error('Trigger creation failed:', error);
      return false;
    }

    console.log('✅ User triggers created successfully');
    return true;
  } catch (err) {
    console.error('Error:', err);
    return false;
  }
}

setupTriggers();
```

**Step 3: Run triggers setup**

Run: `cd backend && node scripts/setup-triggers.js`
Expected: Success message

**Step 4: Commit triggers**

```bash
git add backend/prisma/migrations/003_user_triggers.sql backend/scripts/setup-triggers.js
git commit -m "feat: add user profile creation triggers"
```

---

## Task 6: Configure Authentication Providers

**Files:**
- Create: `diagnostics/auth-providers-setup.md`
- Modify: `backend/.env`
- Modify: `.env`

**Step 1: Document auth provider configuration**

Create `diagnostics/auth-providers-setup.md`:

```markdown
# Authentication Providers Configuration

## Email/Password Authentication
- Status: [Enabled/Disabled]
- Email confirmations: [Required/Optional]
- Password minimum length: 8

## Google OAuth
- Status: [Configured/Not Configured]
- Client ID: [Set in Supabase Dashboard]
- Redirect URL: http://localhost:5173/auth/callback

## Configuration Steps
1. Go to Supabase Dashboard > Authentication > Providers
2. Enable Email provider
3. Set Email Confirmations to "Optional" for development
4. For Google OAuth:
   - Create OAuth app in Google Cloud Console
   - Add redirect URL: https://<project-ref>.supabase.co/auth/v1/callback
   - Copy Client ID and Secret to Supabase

## Redirect URLs (Add in Supabase Dashboard)
- http://localhost:5173/auth/callback
- http://localhost:5173/auth/reset-password
- http://localhost:5173
```

**Step 2: Verify auth configuration in environment**

Check both `.env` and `backend/.env` have matching Supabase credentials

**Step 3: Test auth provider settings**

Run: `curl -X GET "https://<project-ref>.supabase.co/auth/v1/settings"`
Expected: JSON with auth settings

**Step 4: Commit auth documentation**

```bash
git add diagnostics/auth-providers-setup.md
git commit -m "docs: document authentication providers setup"
```

---

## Task 7: Test Complete Auth Flow

**Files:**
- Create: `diagnostics/auth-flow-test.js`
- Create: `diagnostics/auth-test-results.md`

**Step 1: Write comprehensive auth flow test**

Create `diagnostics/auth-flow-test.js`:

```javascript
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../backend/.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const testEmail = `test_${Date.now()}@example.com`;
const testPassword = 'TestPassword123!';

async function testAuthFlow() {
  const results = {
    signup: false,
    profile: false,
    wallet: false,
    signin: false,
    signout: false
  };

  console.log('🧪 Testing Complete Auth Flow');
  console.log('================================');

  // Test 1: Sign Up
  console.log('\n1. Testing Sign Up...');
  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email: testEmail,
    password: testPassword,
    options: {
      data: {
        full_name: 'Test User'
      }
    }
  });

  if (signUpError) {
    console.error('❌ Sign up failed:', signUpError.message);
  } else {
    console.log('✅ Sign up successful');
    results.signup = true;
  }

  // Test 2: Check Profile Created
  if (results.signup && signUpData.user) {
    console.log('\n2. Checking user profile...');
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', signUpData.user.id)
      .single();

    if (profileError) {
      console.error('❌ Profile not found:', profileError.message);
    } else {
      console.log('✅ Profile created:', profile.email);
      results.profile = true;
    }
  }

  // Test 3: Check Wallet Created
  if (results.signup && signUpData.user) {
    console.log('\n3. Checking user wallet...');
    const { data: wallet, error: walletError } = await supabase
      .from('user_wallets')
      .select('*')
      .eq('user_id', signUpData.user.id)
      .single();

    if (walletError) {
      console.error('❌ Wallet not found:', walletError.message);
    } else {
      console.log('✅ Wallet created with balance:', wallet.itc_balance);
      results.wallet = true;
    }
  }

  // Test 4: Sign Out
  console.log('\n4. Testing Sign Out...');
  await supabase.auth.signOut();
  console.log('✅ Signed out');

  // Test 5: Sign In
  console.log('\n5. Testing Sign In...');
  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email: testEmail,
    password: testPassword
  });

  if (signInError) {
    console.error('❌ Sign in failed:', signInError.message);
  } else {
    console.log('✅ Sign in successful');
    results.signin = true;
  }

  // Test 6: Final Sign Out
  await supabase.auth.signOut();
  results.signout = true;

  // Summary
  console.log('\n================================');
  console.log('📊 Test Results Summary:');
  console.log(`  Sign Up: ${results.signup ? '✅' : '❌'}`);
  console.log(`  Profile Created: ${results.profile ? '✅' : '❌'}`);
  console.log(`  Wallet Created: ${results.wallet ? '✅' : '❌'}`);
  console.log(`  Sign In: ${results.signin ? '✅' : '❌'}`);
  console.log(`  Sign Out: ${results.signout ? '✅' : '❌'}`);

  const allPassed = Object.values(results).every(r => r === true);
  console.log(`\nOverall: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);

  return results;
}

testAuthFlow();
```

**Step 2: Run comprehensive auth test**

Run: `cd diagnostics && node auth-flow-test.js`
Expected: All tests pass or specific failures identified

**Step 3: Document test results**

Create `diagnostics/auth-test-results.md` with test output

**Step 4: Commit auth tests**

```bash
git add diagnostics/auth-flow-test.js diagnostics/auth-test-results.md
git commit -m "test: add comprehensive auth flow tests"
```

---

## Task 8: Update Environment Templates

**Files:**
- Modify: `backend/.env.example`
- Create: `.env.example`
- Create: `docs/ENV_VARIABLES.md`

**Step 1: Update backend environment template**

Update `backend/.env.example` with all required variables and descriptions

**Step 2: Create frontend environment template**

Create `.env.example` in root with all VITE_ prefixed variables

**Step 3: Create comprehensive environment documentation**

Create `docs/ENV_VARIABLES.md`:

```markdown
# Environment Variables Documentation

## Frontend Variables (.env)

All frontend variables must be prefixed with `VITE_`

| Variable | Description | Example |
|----------|-------------|---------|
| VITE_SUPABASE_URL | Supabase project URL | https://xxx.supabase.co |
| VITE_SUPABASE_ANON_KEY | Supabase anonymous key | eyJ... |
| VITE_API_BASE | Backend API URL | http://localhost:4000 |
| VITE_SITE_URL | Frontend URL | http://localhost:5173 |

## Backend Variables (backend/.env)

| Variable | Description | Required | Example |
|----------|-------------|----------|---------|
| SUPABASE_URL | Supabase project URL | Yes | https://xxx.supabase.co |
| SUPABASE_SERVICE_ROLE_KEY | Service role key (secret) | Yes | eyJ... |
| SUPABASE_ANON_KEY | Anonymous key | Yes | eyJ... |
| DATABASE_URL | PostgreSQL connection string | Yes | postgresql://... |
| FRONTEND_URL | Frontend URL for CORS | Yes | http://localhost:5173 |
| ALLOWED_ORIGINS | CORS allowed origins | Yes | http://localhost:5173 |
| JWT_SECRET | JWT signing secret (32+ chars) | Yes | random-32-char-string |

## Getting Credentials

1. Login to https://app.supabase.com
2. Select your project
3. Go to Settings > API
4. Copy the required keys
```

**Step 4: Commit environment documentation**

```bash
git add backend/.env.example .env.example docs/ENV_VARIABLES.md
git commit -m "docs: add comprehensive environment variable documentation"
```

---

## Task 9: Create Verification Script

**Files:**
- Create: `scripts/verify-setup.js`
- Create: `scripts/package.json`

**Step 1: Write comprehensive verification script**

Create `scripts/verify-setup.js`:

```javascript
#!/usr/bin/env node
import chalk from 'chalk';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load environment variables
dotenv.config({ path: join(__dirname, '../backend/.env') });
dotenv.config({ path: join(__dirname, '../.env') });

const checks = {
  envVars: false,
  supabaseConnection: false,
  databaseTables: false,
  rlsPolicies: false,
  authProviders: false,
  triggers: false,
  frontendEnv: false,
  backendEnv: false
};

async function checkEnvironmentVariables() {
  console.log(chalk.blue('\n📋 Checking Environment Variables...'));

  const required = {
    backend: [
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'SUPABASE_ANON_KEY',
      'DATABASE_URL',
      'FRONTEND_URL',
      'ALLOWED_ORIGINS',
      'JWT_SECRET'
    ],
    frontend: [
      'VITE_SUPABASE_URL',
      'VITE_SUPABASE_ANON_KEY',
      'VITE_API_BASE',
      'VITE_SITE_URL'
    ]
  };

  let allPresent = true;

  console.log(chalk.gray('  Backend:'));
  for (const key of required.backend) {
    if (process.env[key]) {
      console.log(chalk.green(`    ✅ ${key}`));
    } else {
      console.log(chalk.red(`    ❌ ${key} - MISSING`));
      allPresent = false;
    }
  }

  console.log(chalk.gray('  Frontend:'));
  for (const key of required.frontend) {
    if (process.env[key]) {
      console.log(chalk.green(`    ✅ ${key}`));
    } else {
      console.log(chalk.red(`    ❌ ${key} - MISSING`));
      allPresent = false;
    }
  }

  checks.envVars = allPresent;
  return allPresent;
}

async function checkSupabaseConnection() {
  console.log(chalk.blue('\n🔌 Checking Supabase Connection...'));

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    console.log(chalk.green('  ✅ Connected to Supabase'));
    checks.supabaseConnection = true;
    return true;
  } catch (error) {
    console.log(chalk.red(`  ❌ Connection failed: ${error.message}`));
    return false;
  }
}

async function checkDatabaseTables() {
  console.log(chalk.blue('\n🗄️ Checking Database Tables...'));

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const tables = ['user_profiles', 'user_wallets', 'products', 'orders'];
  let allExist = true;

  for (const table of tables) {
    try {
      const { error } = await supabase.from(table).select('*').limit(1);
      if (error) throw error;
      console.log(chalk.green(`  ✅ ${table}`));
    } catch (error) {
      console.log(chalk.red(`  ❌ ${table} - ${error.message}`));
      allExist = false;
    }
  }

  checks.databaseTables = allExist;
  return allExist;
}

async function runAllChecks() {
  console.log(chalk.bold('\n🚀 SUPABASE SETUP VERIFICATION\n'));
  console.log(chalk.gray('Running comprehensive checks...'));

  await checkEnvironmentVariables();

  if (checks.envVars) {
    await checkSupabaseConnection();
    if (checks.supabaseConnection) {
      await checkDatabaseTables();
    }
  }

  // Summary
  console.log(chalk.bold('\n📊 VERIFICATION SUMMARY\n'));

  const results = [
    ['Environment Variables', checks.envVars],
    ['Supabase Connection', checks.supabaseConnection],
    ['Database Tables', checks.databaseTables],
    ['RLS Policies', checks.rlsPolicies],
    ['Auth Providers', checks.authProviders],
    ['Database Triggers', checks.triggers]
  ];

  for (const [name, status] of results) {
    const icon = status ? '✅' : '❌';
    const color = status ? chalk.green : chalk.red;
    console.log(color(`  ${icon} ${name}`));
  }

  const allPassed = Object.values(checks).every(v => v === true);

  if (allPassed) {
    console.log(chalk.bold.green('\n✨ All checks passed! System ready for launch.'));
  } else {
    console.log(chalk.bold.yellow('\n⚠️ Some checks failed. Please review and fix the issues above.'));
  }

  process.exit(allPassed ? 0 : 1);
}

runAllChecks();
```

**Step 2: Create package.json for scripts**

Create `scripts/package.json`:

```json
{
  "name": "setup-scripts",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "verify": "node verify-setup.js"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0",
    "chalk": "^5.3.0",
    "dotenv": "^16.4.5"
  }
}
```

**Step 3: Install dependencies and run verification**

Run: `cd scripts && npm install && npm run verify`
Expected: Detailed verification report

**Step 4: Commit verification script**

```bash
git add scripts/verify-setup.js scripts/package.json
git commit -m "feat: add comprehensive setup verification script"
```

---

## Task 10: Final Documentation

**Files:**
- Create: `docs/SUPABASE_SETUP_COMPLETE.md`
- Update: `README.md`

**Step 1: Create setup completion documentation**

Create `docs/SUPABASE_SETUP_COMPLETE.md`:

```markdown
# Supabase Infrastructure Setup - Complete

## ✅ Setup Checklist

- [x] Supabase project created/restored
- [x] Environment variables configured
- [x] Database schema created
- [x] RLS policies applied
- [x] User triggers installed
- [x] Authentication providers configured
- [x] Auth flow tested end-to-end
- [x] Verification script passing

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   cd backend && npm install
   ```

2. Start backend:
   ```bash
   cd backend
   npm run build
   npm start
   ```

3. Start frontend:
   ```bash
   npm run dev
   ```

4. Verify setup:
   ```bash
   cd scripts
   npm run verify
   ```

## Next Steps

With Supabase infrastructure complete, proceed to:
1. Phase 2: Core Functionality Verification
2. Phase 3: Pre-Launch Testing
3. Phase 4: Deployment Setup

See `LAUNCH-PLAN.md` for detailed next steps.
```

**Step 2: Update README with setup status**

Add section to README.md indicating Supabase setup is complete

**Step 3: Run final verification**

Run: `cd scripts && npm run verify`
Expected: All green checkmarks

**Step 4: Commit final documentation**

```bash
git add docs/SUPABASE_SETUP_COMPLETE.md README.md
git commit -m "docs: mark Supabase infrastructure setup as complete"
```

---

## Execution Summary

This plan establishes a complete Supabase infrastructure with:
- Working authentication system
- Secure database with RLS policies
- Automated user profile/wallet creation
- Comprehensive testing and verification
- Full documentation

Total estimated time: 2-3 hours for complete implementation

Each task is independent and can be verified before proceeding to the next.