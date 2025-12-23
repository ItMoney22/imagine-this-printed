// Diagnostic script to check orders in database
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '../backend/.env') })

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  console.log('SUPABASE_URL:', supabaseUrl ? 'SET' : 'MISSING')
  console.log('SUPABASE_SERVICE_ROLE_KEY:', supabaseServiceKey ? 'SET' : 'MISSING')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function debugOrders() {
  console.log('\n========== ORDER DEBUGGING ==========\n')

  // 1. Check total orders count
  console.log('1. CHECKING ORDERS TABLE...')
  const { data: orders, error: ordersError, count } = await supabase
    .from('orders')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .limit(20)

  if (ordersError) {
    console.error('   ERROR fetching orders:', ordersError)
  } else {
    console.log(`   Total orders in database: ${count}`)
    console.log(`   Retrieved ${orders?.length || 0} most recent orders`)

    if (orders && orders.length > 0) {
      console.log('\n   Recent orders:')
      orders.forEach((o, i) => {
        console.log(`   ${i + 1}. ID: ${o.id.slice(0, 8)}... | Order#: ${o.order_number || 'N/A'} | Status: ${o.status} | Total: $${o.total} | Created: ${o.created_at}`)
      })
    }
  }

  // 2. Check order_items table
  console.log('\n2. CHECKING ORDER_ITEMS TABLE...')
  const { data: orderItems, error: itemsError, count: itemsCount } = await supabase
    .from('order_items')
    .select('*', { count: 'exact' })
    .limit(20)

  if (itemsError) {
    console.error('   ERROR fetching order_items:', itemsError)
  } else {
    console.log(`   Total order items in database: ${itemsCount}`)
    console.log(`   Retrieved ${orderItems?.length || 0} items`)

    if (orderItems && orderItems.length > 0) {
      console.log('\n   Sample order items:')
      orderItems.slice(0, 5).forEach((item, i) => {
        console.log(`   ${i + 1}. Order: ${item.order_id?.slice(0, 8)}... | Product: ${item.product_name} | Qty: ${item.quantity} | Price: $${item.price}`)
      })
    }
  }

  // 3. Check orders with metadata.items (fallback data)
  console.log('\n3. CHECKING ORDERS WITH METADATA.ITEMS...')
  const { data: ordersWithMeta, error: metaError } = await supabase
    .from('orders')
    .select('id, order_number, metadata, created_at')
    .not('metadata', 'is', null)
    .limit(10)

  if (metaError) {
    console.error('   ERROR checking metadata:', metaError)
  } else {
    const withItems = ordersWithMeta?.filter(o => o.metadata?.items?.length > 0) || []
    console.log(`   Orders with metadata.items: ${withItems.length}`)

    if (withItems.length > 0) {
      console.log('\n   Sample metadata items:')
      withItems.slice(0, 3).forEach((o, i) => {
        console.log(`   ${i + 1}. Order: ${o.order_number || o.id.slice(0, 8)} has ${o.metadata.items.length} items in metadata`)
        o.metadata.items.slice(0, 2).forEach((item, j) => {
          console.log(`      - ${item.name || item.product?.name || 'Unknown'}: $${item.price || item.product?.price || 0}`)
        })
      })
    }
  }

  // 4. Check orders by status
  console.log('\n4. ORDER STATUS BREAKDOWN...')
  const statuses = ['pending', 'processing', 'paid', 'shipped', 'delivered', 'completed', 'cancelled']
  for (const status of statuses) {
    const { count } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('status', status)
    if (count > 0) {
      console.log(`   ${status}: ${count}`)
    }
  }

  // 5. Check user_profiles for admin users
  console.log('\n5. CHECKING ADMIN/MANAGER USERS...')
  const { data: admins, error: adminsError } = await supabase
    .from('user_profiles')
    .select('user_id, username, email, role')
    .in('role', ['admin', 'manager', 'founder'])

  if (adminsError) {
    console.error('   ERROR fetching admins:', adminsError)
  } else {
    console.log(`   Found ${admins?.length || 0} admin/manager/founder users:`)
    admins?.forEach(a => {
      console.log(`   - ${a.username || a.email} (${a.role})`)
    })
  }

  // 6. Check RLS policies
  console.log('\n6. CHECKING IF get_user_role() FUNCTION EXISTS...')
  const { data: funcCheck, error: funcError } = await supabase.rpc('get_user_role')
  if (funcError) {
    console.log('   get_user_role() function call result:', funcError.message)
    if (funcError.message.includes('does not exist')) {
      console.log('   ⚠️  FUNCTION MISSING - This may block RLS policies')
    }
  } else {
    console.log('   get_user_role() returned:', funcCheck)
  }

  // 7. Test the exact query the backend uses
  console.log('\n7. TESTING BACKEND QUERY (no auth)...')
  const { data: backendTest, error: backendError } = await supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)

  if (backendError) {
    console.error('   Backend query error:', backendError)
  } else {
    console.log(`   Backend query returned ${backendTest?.length || 0} orders`)
  }

  console.log('\n========== END DEBUGGING ==========\n')
}

debugOrders().catch(console.error)
