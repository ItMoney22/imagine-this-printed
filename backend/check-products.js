require('dotenv').config({ path: '../.env.local' });
const { createClient } = require('@supabase/supabase-js');

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
  } catch (err) {
    console.error('Error:', err.message);
  }
})();
