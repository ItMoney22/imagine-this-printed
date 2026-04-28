import { supabase } from '../lib/supabase'
import type { Product, ThreeDModel, ProductAsset } from '../types'

export interface ShowcaseItem {
  id: string
  type: 'product' | '3d_model'
  title: string
  description?: string
  imageUrl: string
  category: string
  creatorName?: string
  creatorAvatar?: string
  createdAt: string
  productId?: string // For linking to product page
  modelId?: string // For linking to 3D model gallery
}

export class DesignShowcaseService {
  // Get featured user designs (products + 3D models)
  async getFeaturedDesigns(limit: number = 10): Promise<ShowcaseItem[]> {
    try {
      const items: ShowcaseItem[] = []

      // Fetch products and 3D models in parallel
      const [productsResult, modelsResult] = await Promise.all([
        supabase
          .from('products')
          .select('id, name, description, category, images, created_at, created_by_user_id')
          .eq('is_user_generated', true)
          .eq('approved', true)
          .order('created_at', { ascending: false })
          .limit(limit),
        supabase
          .from('three_d_models')
          .select('id, title, description, preview_url, category, created_at, uploaded_by')
          .eq('approved', true)
          .order('created_at', { ascending: false })
          .limit(limit)
      ])

      const products = productsResult.data
      const models = modelsResult.data

      if (productsResult.error) console.error('Error fetching user products:', productsResult.error)
      if (modelsResult.error) console.error('Error fetching 3D models:', modelsResult.error)

      // Collect all user IDs for a single profile fetch
      const productUserIds = (products || []).map(p => p.created_by_user_id).filter(Boolean)
      const modelUserIds = (models || []).map(m => m.uploaded_by).filter(Boolean)
      const allUserIds = [...new Set([...productUserIds, ...modelUserIds])]

      // Fetch product assets and all user profiles in parallel
      const productIds = (products || []).map(p => p.id)
      const [assetsResult, profilesResult] = await Promise.all([
        productIds.length > 0
          ? supabase
              .from('product_assets')
              .select('*')
              .in('product_id', productIds)
              .in('kind', ['mockup', 'source'])
              .order('display_order', { ascending: true })
          : Promise.resolve({ data: null }),
        allUserIds.length > 0
          ? supabase
              .from('user_profiles')
              .select('id, username, first_name, last_name, avatar_url')
              .in('id', allUserIds)
          : Promise.resolve({ data: null })
      ])

      const assetsByProduct = (assetsResult.data || []).reduce((acc, asset) => {
        if (!acc[asset.product_id]) acc[asset.product_id] = []
        acc[asset.product_id].push(asset)
        return acc
      }, {} as Record<string, ProductAsset[]>)

      const userProfiles = (profilesResult.data || []).reduce((acc, p) => {
        acc[p.id] = p
        return acc
      }, {} as Record<string, any>)

      const getCreatorName = (profile: any) =>
        profile?.username ||
        (profile?.first_name && profile?.last_name
          ? `${profile.first_name} ${profile.last_name}`
          : 'Community Creator')

      // Process products
      if (products && products.length > 0) {
        for (const product of products) {
          const productAssets = assetsByProduct[product.id] || []
          const mockup = productAssets.find((a: ProductAsset) => a.kind === 'mockup') || productAssets[0]
          const imageUrl = mockup?.url || (product.images as string[])?.[0] || ''

          if (imageUrl) {
            const userProfile = product.created_by_user_id ? userProfiles[product.created_by_user_id] : null
            items.push({
              id: `product_${product.id}`,
              type: 'product',
              title: product.name,
              description: product.description || undefined,
              imageUrl,
              category: product.category,
              creatorName: getCreatorName(userProfile),
              creatorAvatar: userProfile?.avatar_url,
              createdAt: product.created_at,
              productId: product.id
            })
          }
        }
      }

      // Process 3D models
      if (models && models.length > 0) {
        for (const model of models) {
          if (model.preview_url) {
            const userProfile = model.uploaded_by ? userProfiles[model.uploaded_by] : null
            items.push({
              id: `model_${model.id}`,
              type: '3d_model',
              title: model.title,
              description: model.description || undefined,
              imageUrl: model.preview_url,
              category: model.category,
              creatorName: getCreatorName(userProfile),
              creatorAvatar: userProfile?.avatar_url,
              createdAt: model.created_at,
              modelId: model.id
            })
          }
        }
      }

      // Sort by date to mix products and models
      items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

      return items.slice(0, limit)
    } catch (error) {
      console.error('Error fetching featured designs:', error)
      return []
    }
  }

  // Get products by category for filtering
  async getDesignsByCategory(category: string, limit: number = 10): Promise<ShowcaseItem[]> {
    const allDesigns = await this.getFeaturedDesigns(limit * 2)
    return allDesigns.filter(d => d.category === category).slice(0, limit)
  }

  // Get category label for display
  getCategoryLabel(category: string): string {
    const labels: Record<string, string> = {
      'shirts': 'T-Shirts',
      'hoodies': 'Hoodies',
      'tumblers': 'Tumblers',
      'dtf-transfers': 'DTF Transfers',
      '3d-models': '3D Models',
      'figurines': '3D Figurines',
      'tools': '3D Tools',
      'decorative': '3D Decor',
      'functional': '3D Functional',
      'toys': '3D Toys'
    }
    return labels[category] || category
  }

  // Get badge info for item type
  getTypeBadge(type: 'product' | '3d_model'): { label: string; color: string; icon: string } {
    if (type === '3d_model') {
      return { label: '3D Model', color: 'bg-blue-500', icon: '🎨' }
    }
    return { label: 'Design', color: 'bg-purple-500', icon: '✨' }
  }
}

export const designShowcaseService = new DesignShowcaseService()
