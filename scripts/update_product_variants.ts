
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://czzyrmizvjqlifcivrhn.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN6enlybWl6dmpxbGlmY2l2cmhuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI0Mjk2MDMsImV4cCI6MjA2ODAwNTYwM30.x81uOOyApsnues3CA7QJeETIypgk0rBvC_bzxlZ_VGs'

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
