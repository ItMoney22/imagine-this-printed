import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

(async () => {
  try {
    const { data: products, error } = await supabase
      .from('products')
      .select('id, name, images, category, created_at, metadata')
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw error;

    console.log('\n=== RECENT PRODUCTS (Last 20) ===\n');
    products.forEach((p, i) => {
      const num = i + 1;
      console.log(num + '. ' + p.name + ' (' + p.category + ')');
      console.log('   Created: ' + p.created_at);
      console.log('   AI Generated: ' + (p.metadata?.ai_generated ? 'YES' : 'NO'));
      console.log('   Images: ' + (p.images ? JSON.stringify(p.images) : 'NONE'));
      console.log('');
    });

    // Check for AI jobs
    const { data: jobs, error: jobError } = await supabase
      .from('ai_jobs')
      .select('id, product_id, type, status, output, created_at')
      .order('created_at', { ascending: false })
      .limit(10);

    if (!jobError && jobs) {
      console.log('\n=== RECENT AI JOBS (Last 10) ===\n');
      jobs.forEach((job, i) => {
        console.log((i + 1) + '. ' + job.type + ' - ' + job.status);
        console.log('   Product ID: ' + job.product_id);
        console.log('   Created: ' + job.created_at);
        console.log('   Output: ' + (job.output ? JSON.stringify(job.output).substring(0, 100) : 'NONE'));
        console.log('');
      });
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
})();
