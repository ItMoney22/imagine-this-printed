// One-off: give a live product whose slug came from its upload's file name a
// slug made from its real name, through the same rule the Step Flow's publish
// now applies (services/step-flow/product-slug.ts), with the old slug kept in
// metadata.replaces so links already sent still land (task 62822de3; first
// run: the Folgers tee 9c3b3d19, slug 1d2b8a23-0cdd-4dd3-b010-ba2ce3a7bc77).
//
//   cd backend
//   tsx --env-file=.env scripts/reslug-product.ts <product-id>           # dry run: prints the plan
//   tsx --env-file=.env scripts/reslug-product.ts <product-id> --apply   # writes it
//
// Does nothing to a product whose slug already came from a real name.
import { supabase } from '../lib/supabase.js'
import { findReslug } from '../services/step-flow/product-slug.js'

const [id, flag] = process.argv.slice(2)
if (!id) {
  console.error('usage: tsx --env-file=.env scripts/reslug-product.ts <product-id> [--apply]')
  process.exit(1)
}

const { data: product, error } = await supabase.from('products').select('id, name, slug, status, metadata').eq('id', id).single()
if (error || !product) throw new Error(`product ${id}: ${error?.message || 'not found'}`)

const plan = await findReslug(supabase, product, product.name)
console.log(JSON.stringify({ id, name: product.name, slug: product.slug, plan }, null, 2))
if (!plan) {
  console.log('nothing to do: the slug already came from a real name')
  process.exit(0)
}
if (flag !== '--apply') {
  console.log('dry run: pass --apply to write it')
  process.exit(0)
}

// Guarded on the old slug, so a concurrent rename makes this a no-op instead
// of a clobber. metadata is merged over the row as just read.
const { data: saved, error: writeError } = await supabase
  .from('products')
  .update({ slug: plan.slug, metadata: { ...product.metadata, replaces: plan.replaces, slug_source: 'name' } })
  .eq('id', id)
  .eq('slug', product.slug)
  .select('id, slug, metadata')
  .single()
if (writeError || !saved) throw new Error(`write failed: ${writeError?.message || 'slug changed underneath, nothing written'}`)

// Read back both ways a link reaches it: the new slug, and the old one through metadata.replaces.
const bySlug = await supabase.from('products').select('id').eq('slug', plan.slug)
const byOld = await supabase.from('products').select('id, slug').contains('metadata', { replaces: [product.slug] }).eq('status', 'active')
console.log(JSON.stringify({ saved: { id: saved.id, slug: saved.slug, replaces: saved.metadata?.replaces }, bySlug: bySlug.data, byOldSlug: byOld.data }, null, 2))
