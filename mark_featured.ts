
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase env vars')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function markFeatured() {
    // Get 3 products
    const { data: products, error: fetchError } = await supabase
        .from('products')
        .select('id')
        .limit(3)

    if (fetchError) {
        console.error('Error fetching products:', fetchError)
        return
    }

    if (!products || products.length === 0) {
        console.log('No products found to mark as featured')
        return
    }

    const ids = products.map(p => p.id)
    console.log('Marking products as featured:', ids)

    const { error: updateError } = await supabase
        .from('products')
        .update({ is_featured: true })
        .in('id', ids)

    if (updateError) {
        console.error('Error updating products:', updateError)
    } else {
        console.log('Successfully marked products as featured')
    }
}

markFeatured()
