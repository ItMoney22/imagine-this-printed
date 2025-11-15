import { startWorker } from './ai-jobs-worker.js'

console.log('=================================')
console.log('AI Jobs Worker Starting...')
console.log('=================================')
console.log('Environment check:')
console.log('- SUPABASE_URL:', process.env.SUPABASE_URL ? 'Set' : 'MISSING')
console.log('- SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'Set' : 'MISSING')
console.log('- REPLICATE_API_TOKEN:', process.env.REPLICATE_API_TOKEN ? 'Set' : 'MISSING')
console.log('- OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? 'Set' : 'MISSING')
console.log('=================================')

startWorker()

console.log('Worker is running. Press Ctrl+C to stop.')
