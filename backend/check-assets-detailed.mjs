import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

(async () => {
  const productId = '99e51821-4ea3-441a-bbbf-d0ccf403a02b';

  console.log('\n=== Checking Product Details ===\n');
  const { data: product, error: productError } = await supabase
    .from('products')
    .select('id, name, images, metadata')
    .eq('id', productId)
    .single();

  if (productError) {
    console.error('Error fetching product:', productError);
  } else {
    console.log('Product:', product.name);
    console.log('Images array:', product.images);
    console.log('AI Generated:', product.metadata?.ai_generated);
  }

  console.log('\n=== Checking AI Jobs for this product ===\n');
  const { data: jobs, error: jobsError } = await supabase
    .from('ai_jobs')
    .select('*')
    .eq('product_id', productId);

  if (jobsError) {
    console.error('Error fetching jobs:', jobsError);
  } else {
    console.log('Total jobs:', jobs.length);
    jobs.forEach(job => {
      console.log(`- ${job.type}: ${job.status}`);
    });
  }

  console.log('\n=== Checking Product Assets for this product ===\n');
  const { data: assets, error: assetsError } = await supabase
    .from('product_assets')
    .select('*')
    .eq('product_id', productId);

  if (assetsError) {
    console.error('Error fetching assets:', assetsError);
  } else {
    console.log('Total assets:', assets.length);
    assets.forEach(asset => {
      console.log(`- ${asset.kind}: ${asset.url.substring(0, 80)}...`);
    });
  }
})();
