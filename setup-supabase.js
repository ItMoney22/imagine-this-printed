#!/usr/bin/env node

import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

console.log(`
╔════════════════════════════════════════════════════════════╗
║         IMAGINE THIS PRINTED - SUPABASE SETUP WIZARD        ║
╚════════════════════════════════════════════════════════════╝

This wizard will help you configure your Supabase connection.

You'll need:
1. Supabase Project URL
2. Supabase Anon/Public Key
3. Supabase Service Role Key (for backend)
4. Database URL (optional but recommended)

Get these from: https://app.supabase.com
→ Select your project → Settings → API

`);

async function main() {
  try {
    // Get Supabase credentials
    console.log('📝 Enter your Supabase credentials:\n');

    const supabaseUrl = await question('Supabase Project URL (e.g., https://abc123.supabase.co): ');
    const supabaseAnonKey = await question('Supabase Anon/Public Key (starts with eyJ...): ');
    const supabaseServiceKey = await question('Supabase Service Role Key (keep secret!): ');
    const databaseUrl = await question('Database URL (press Enter to skip): ');

    // Frontend configuration
    console.log('\n📝 Frontend configuration:\n');
    const frontendUrl = await question('Frontend URL for local dev (default: http://localhost:5173): ') || 'http://localhost:5173';
    const backendUrl = await question('Backend URL for local dev (default: http://localhost:4000): ') || 'http://localhost:4000';

    // Additional optional settings
    console.log('\n📝 Optional settings (press Enter to skip):\n');
    const stripePublishableKey = await question('Stripe Publishable Key (pk_test_...): ');
    const jwtSecret = await question('JWT Secret (min 32 chars, or we\'ll generate one): ') ||
                      generateRandomString(32);

    // Update frontend .env
    const frontendEnvPath = path.join(__dirname, '.env');
    const frontendEnvContent = `# Supabase Configuration
VITE_SUPABASE_URL="${supabaseUrl}"
VITE_SUPABASE_ANON_KEY="${supabaseAnonKey}"

# API Configuration
VITE_API_BASE="${backendUrl}"
VITE_SITE_URL="${frontendUrl}"

# Stripe (Optional)
VITE_STRIPE_PUBLISHABLE_KEY="${stripePublishableKey || 'pk_test_placeholder'}"

# ITC Token (Optional)
VITE_ITC_WALLET_ADDRESS="${'0x0000000000000000000000000000000000000000'}"
VITE_ITC_USD_RATE="0.10"
`;

    fs.writeFileSync(frontendEnvPath, frontendEnvContent);
    console.log('✅ Frontend .env updated');

    // Update backend .env
    const backendEnvPath = path.join(__dirname, 'backend', '.env');
    const backendEnvContent = `# Supabase (Database)
SUPABASE_URL="${supabaseUrl}"
SUPABASE_SERVICE_ROLE_KEY="${supabaseServiceKey}"
SUPABASE_ANON_KEY="${supabaseAnonKey}"
DATABASE_URL="${databaseUrl || 'postgresql://postgres:password@db.placeholder.supabase.co:5432/postgres'}"

# Application Settings
APP_ORIGIN="${frontendUrl}"
API_ORIGIN="${backendUrl}"
FRONTEND_URL="${frontendUrl}"
ALLOWED_ORIGINS="${frontendUrl},${backendUrl}"
NODE_ENV="development"
PORT="4000"

# Authentication
JWT_SECRET="${jwtSecret}"

# Stripe (Optional)
STRIPE_PUBLISHABLE_KEY="${stripePublishableKey || 'pk_test_placeholder'}"
STRIPE_SECRET_KEY="sk_test_placeholder"
STRIPE_WEBHOOK_SECRET="whsec_placeholder"

# Email Service - Brevo (Optional)
BREVO_API_KEY=""
BREVO_SENDER_EMAIL="noreply@yourdomain.com"
BREVO_SENDER_NAME="Imagine This Printed"

# AWS S3 (Optional)
AWS_ACCESS_KEY_ID=""
AWS_SECRET_ACCESS_KEY=""
AWS_REGION="us-east-1"
AWS_BUCKET_NAME=""
S3_BUCKET_NAME=""
CLOUDFRONT_URL=""
`;

    fs.writeFileSync(backendEnvPath, backendEnvContent);
    console.log('✅ Backend .env updated');

    // Test connection
    console.log('\n🔍 Testing Supabase connection...');
    const testUrl = `${supabaseUrl}/rest/v1/`;

    try {
      const response = await fetch(testUrl, {
        headers: {
          'apikey': supabaseAnonKey,
          'Authorization': `Bearer ${supabaseAnonKey}`
        }
      });

      if (response.status === 200 || response.status === 406) {
        console.log('✅ Successfully connected to Supabase!');
      } else {
        console.log(`⚠️  Connection test returned status ${response.status}`);
        console.log('   This might be normal if your database is empty.');
      }
    } catch (error) {
      console.log('⚠️  Could not verify connection. Please check your credentials.');
      console.log('   Error:', error.message);
    }

    console.log(`
╔════════════════════════════════════════════════════════════╗
║                    SETUP COMPLETE! 🎉                       ║
╚════════════════════════════════════════════════════════════╝

Next steps:

1. Configure Supabase Authentication:
   → Go to: ${supabaseUrl.replace('.supabase.co', '.supabase.com')}/project/_/auth/providers
   → Enable Email/Password authentication
   → (Optional) Enable Google OAuth
   → Add redirect URLs:
     - ${frontendUrl}/auth/callback
     - ${frontendUrl}/auth/reset-password

2. Set up Database Tables:
   Run the SQL migrations in your Supabase SQL editor:
   → Check 'backend/prisma/schema.prisma' for the data model
   → Or run: npx prisma migrate dev (if configured)

3. Start the application:

   Terminal 1 - Backend:
   $ cd backend
   $ npm install
   $ npm run build
   $ npm start

   Terminal 2 - Frontend:
   $ npm install
   $ npm run dev

4. Test authentication:
   → Open ${frontendUrl}
   → Try signing up with a new account
   → Check browser console for [AUTH] logs

Need help? Check:
- diagnostics/RUNBOOK.md
- diagnostics/supabase-checklist.md

`);

  } catch (error) {
    console.error('❌ Setup failed:', error);
  } finally {
    rl.close();
  }
}

function generateRandomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

main();