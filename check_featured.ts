
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase env vars')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function checkFeatured() {
    const { data, error } = await supabase
        .from('products')
        .select('id, name, is_featured')
        .eq('is_featured', true)

    if (error) {
        console.error('Error:', error)
    } else {
        console.log('Featured Products:', data)
    }
}

checkFeatured()
