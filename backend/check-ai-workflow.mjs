import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

(async () => {
  try {
    // Check AI jobs
    const { data: jobs, error: jobsError } = await supabase
      .from('ai_jobs')
      .select('id, product_id, type, status, output, error, created_at')
      .order('created_at', { ascending: false })
      .limit(30);

    if (jobsError) throw jobsError;

    console.log('\n=== AI JOBS (Last 30) ===\n');
    jobs.forEach((job, i) => {
      console.log((i + 1) + '. ' + job.type + ' - ' + job.status);
      console.log('   Product ID: ' + job.product_id);
      console.log('   Created: ' + job.created_at);
      if (job.output) console.log('   Output: ' + JSON.stringify(job.output).substring(0, 150));
      if (job.error) console.log('   Error: ' + job.error);
      console.log('');
    });

    // Check product_assets
    const { data: assets, error: assetsError } = await supabase
      .from('product_assets')
      .select('product_id, kind, url, created_at')
      .order('created_at', { ascending: false })
      .limit(20);

    if (!assetsError && assets) {
      console.log('\n=== PRODUCT ASSETS (Last 20) ===\n');
      assets.forEach((asset, i) => {
        console.log((i + 1) + '. ' + asset.kind);
        console.log('   Product ID: ' + asset.product_id);
        console.log('   URL: ' + asset.url);
        console.log('   Created: ' + asset.created_at);
        console.log('');
      });
    }

    // Get AI-generated product details
    const { data: aiProducts, error: aiError } = await supabase
      .from('products')
      .select('id, name, images, metadata')
      .eq('metadata->>ai_generated', 'true')
      .order('created_at', { ascending: false })
      .limit(10);

    if (!aiError && aiProducts) {
      console.log('\n=== AI-GENERATED PRODUCTS ===\n');
      aiProducts.forEach((p, i) => {
        console.log((i + 1) + '. ' + p.name + ' [' + p.id + ']');
        console.log('   Prompt: ' + (p.metadata?.original_prompt || 'N/A'));
        console.log('   Images: ' + (p.images && p.images.length > 0 ? p.images.length + ' images' : 'NONE'));
        if (p.images && p.images.length > 0) {
          console.log('   First image: ' + p.images[0].substring(0, 100));
        }
        console.log('');
      });
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
})();
