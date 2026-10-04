// MUST be the first import — see backend/load-env.ts.
import '../load-env.js'
import { startWorker } from './ai-jobs-worker.js'
import { startEtsyWorker } from './etsy-jobs-worker.js'
import { startTryOnRetentionSweep } from './tryon-retention-sweep.js'
import { startMrsImagineDaily } from './mrs-imagine-daily.js'
import { startStepFlowStallSweep } from './step-flow-stall-sweep.js'
import { startDeliveryTrackingSweep } from './delivery-tracking-sweep.js'
import { startHeartbeat } from './heartbeat.js'

// Process-level crash handlers. Node 20 defaults to
// --unhandled-rejections=throw, so ANY unhandled promise rejection anywhere in
// this process (a missed .catch(), a fire-and-forget async call) otherwise
// crashes the worker with no log line explaining why. Logging with the full
// stack here, then exiting non-zero, converts a silent/confusing death into a
// diagnosable one and hands off to Render's service-level restart (Render
// Background Workers restart automatically on a non-zero exit — see NEEDS
// DAVID in the handoff for confirming that's actually configured this way for
// this service, since it isn't set via an in-repo render.yaml).
process.on('unhandledRejection', (reason) => {
  console.error('[worker] 💥 Unhandled rejection:', reason instanceof Error ? reason.stack : reason)
  process.exit(1)
})

process.on('uncaughtException', (error) => {
  console.error('[worker] 💥 Uncaught exception:', error?.stack || error)
  process.exit(1)
})

console.log('=================================')
console.log('AI Jobs Worker Starting...')
console.log('=================================')
console.log('Environment check:')
console.log('- SUPABASE_URL:', process.env.SUPABASE_URL ? 'Set' : 'MISSING')
console.log('- SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'Set' : 'MISSING')
console.log('- REPLICATE_API_TOKEN:', process.env.REPLICATE_API_TOKEN ? 'Set' : 'MISSING')
console.log('- OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? 'Set' : 'MISSING')
console.log('- SHIPPO_API_TOKEN:', process.env.SHIPPO_API_TOKEN ? 'Set' : 'MISSING (live delivery tracking off)')
console.log('=================================')

startWorker()
startEtsyWorker()
// Privacy: expires shopper try-on photos out of GCS on a timer. See
// backend/worker/tryon-retention-sweep.ts and docs/VIRTUAL_TRYON.md §7.
startTryOnRetentionSweep()
// Mrs. Imagine's unattended daily batch (research through Etsy drafts) is OFF
// by default as of 2026-09-02 — she now pitches phrases inside the Step Flow
// instead of generating whole products on her own. Set MRS_IMAGINE_DAILY=true
// to re-arm the old end-to-end clock; startMrsImagineDaily() logs which mode
// it started in.
startMrsImagineDaily()
// Step Flow shots render INLINE in the API process, so an API restart mid-render
// strands them at 'running' forever — no Redo, no Skip, and Continue blocked for
// that product. This fails them so the admin gets the buttons back. See
// backend/worker/step-flow-stall-sweep.ts.
startStepFlowStallSweep()
// Polls the carrier for every shipped order, moves delivered ones to
// 'delivered' and mails the buyer their thank-you coupon. Needs
// SHIPPO_API_TOKEN; logs and stays dark without it. See
// backend/worker/delivery-tracking-sweep.ts.
startDeliveryTrackingSweep()

// Liveness. One stdout line a minute carrying uptime, memory and per-loop tick
// counts. This is the probe for "did Fly park the machine?" — the platform
// gives no error when it does, and the audit_logs heartbeat behind
// GET /api/health/worker is only hourly, so up to an hour of a dead worker
// reads as healthy. An uptime that RESETS in these lines is the tell.
// See backend/worker/heartbeat.ts and docs/migration/render-to-fly/STEP-2-DEPLOY-CONFIG.md.
startHeartbeat()

console.log('Worker is running. Press Ctrl+C to stop.')
