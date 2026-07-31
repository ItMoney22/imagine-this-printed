
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing Supabase config. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (or SUPABASE_URL / SUPABASE_ANON_KEY) before running this script.')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function updateProductVariants() {
    console.log('🔄 Fetching an active product...')

    const { data: products, error: fetchError } = await supabase
        .from('products')
        .select('id, name')
        .eq('is_active', true)
        .limit(1)

    if (fetchError) {
        console.error('❌ Error fetching product:', fetchError)
        return
    }

    if (!products || products.length === 0) {
        console.error('❌ No active products found.')
        return
    }

    const product = products[0]
    console.log(`📝 Updating product: ${product.name} (${product.id})`)

    const sizes = ['S', 'M', 'L', 'XL']
    const colors = ['Red', 'Blue', 'Black']

    const { error: updateError } = await supabase
        .from('products')
        .update({ sizes, colors })
        .eq('id', product.id)

    if (updateError) {
        console.error('❌ Error updating product variants:', updateError)
    } else {
        console.log('✅ Product variants updated successfully!')
        console.log(`   Sizes: ${sizes.join(', ')}`)
        console.log(`   Colors: ${colors.join(', ')}`)
    }
}

updateProductVariants()
