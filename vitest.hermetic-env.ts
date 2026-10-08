// Tests never reach a paid or outbound service with a real key, whoever runs them.
//
// The ship tool runs `npm run verify` inside zero-engine, and the engine loads
// david-trinidad-com/.env.local into its own process.env at boot, so every test
// run it spawns inherits that box's real keys. With a real OPENAI_API_KEY,
// services/etsy-seo-composer.ts builds a live client and etsy-copy-repair's
// "without a model" tests made a paid gpt call each and timed out at 5 s: the
// gate went red on every ITP ship (task e086c595, 2026-10-07). A test that wants
// one of these set sets it itself, after this file has run.
const REAL_KEYS = [
  // model and image providers (paid per call)
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'XAI_API_KEY',
  'GROK_API_KEY',
  'REPLICATE_API_TOKEN',
  'TRIPO_API_KEY',
  'REMOVEBG_API_KEY',
  'FAL_KEY',
  // money, mail and marketplaces (real side effects)
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'RESEND_API_KEY',
  'SHIPPO_API_KEY',
  'ETSY_KEYSTRING',
  'ETSY_SHARED_SECRET',
  'TURNSTILE_SECRET_KEY',
  // the live database and the fleet's internal routes
  'DATABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'CRON_SECRET',
  'JIMMY_DASHBOARD_INTERNAL_SECRET',
  'WATCHTOWER_INTERNAL_SECRET',
  'PRINT_BRIDGE_TOKEN',
]

for (const key of REAL_KEYS) delete process.env[key]

export { REAL_KEYS }
