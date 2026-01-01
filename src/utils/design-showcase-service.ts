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

      // Fetch user-generated products with their mockups
      const { data: products, error: productsError } = await supabase
        .from('products')
        .select(`
          id,
          name,
          description,
          category,
          images,
          created_at,
          created_by_user_id
        `)
        .eq('is_user_generated', true)
        .eq('approved', true)
        .order('created_at', { ascending: false })
        .limit(limit)

      if (productsError) {
        console.error('Error fetching user products:', productsError)
      } else if (products && products.length > 0) {
        // Fetch product assets for each product to get mockups
        const productIds = products.map(p => p.id)
        const { data: assets } = await supabase
          .from('product_assets')
          .select('*')
          .in('product_id', productIds)
          .in('kind', ['mockup', 'source'])
          .order('display_order', { ascending: true })

        const assetsByProduct = (assets || []).reduce((acc, asset) => {
          if (!acc[asset.product_id]) acc[asset.product_id] = []
          acc[asset.product_id].push(asset)
          return acc
        }, {} as Record<string, ProductAsset[]>)

        // Fetch user profiles for creators
        const userIds = products.map(p => p.created_by_user_id).filter(Boolean)
        let userProfiles: Record<string, any> = {}

        if (userIds.length > 0) {
          const { data: profiles } = await supabase
            .from('user_profiles')
            .select('id, username, first_name, last_name, avatar_url')
            .in('id', userIds)

          if (profiles) {
            userProfiles = profiles.reduce((acc, p) => {
              acc[p.id] = p
              return acc
            }, {} as Record<string, any>)
          }
        }

        for (const product of products) {
          const productAssets = assetsByProduct[product.id] || []
          const mockup = productAssets.find((a: ProductAsset) => a.kind === 'mockup') || productAssets[0]
          const imageUrl = mockup?.url || (product.images as string[])?.[0] || ''

          if (imageUrl) {
            const userProfile = product.created_by_user_id ? userProfiles[product.created_by_user_id] : null
            const creatorName = userProfile?.username ||
              (userProfile?.first_name && userProfile?.last_name
                ? `${userProfile.first_name} ${userProfile.last_name}`
                : 'Community Creator')

            items.push({
              id: `product_${product.id}`,
              type: 'product',
              title: product.name,
              description: product.description || undefined,
              imageUrl,
              category: product.category,
              creatorName,
              creatorAvatar: userProfile?.avatar_url,
              createdAt: product.created_at,
              productId: product.id
            })
          }
        }
      }

      // Fetch approved 3D models
      const { data: models, error: modelsError } = await supabase
        .from('three_d_models')
        .select(`
          id,
          title,
          description,
          preview_url,
          category,
          created_at,
          uploaded_by
        `)
        .eq('approved', true)
        .order('created_at', { ascending: false })
        .limit(limit)

      if (modelsError) {
        console.error('Error fetching 3D models:', modelsError)
      } else if (models && models.length > 0) {
        // Fetch user profiles for uploaders
        const uploaderIds = models.map(m => m.uploaded_by).filter(Boolean)
        let uploaderProfiles: Record<string, any> = {}

        if (uploaderIds.length > 0) {
          const { data: profiles } = await supabase
            .from('user_profiles')
            .select('id, username, first_name, last_name, avatar_url')
            .in('id', uploaderIds)

          if (profiles) {
            uploaderProfiles = profiles.reduce((acc, p) => {
              acc[p.id] = p
              return acc
            }, {} as Record<string, any>)
          }
        }

        for (const model of models) {
          if (model.preview_url) {
            const userProfile = model.uploaded_by ? uploaderProfiles[model.uploaded_by] : null
            const creatorName = userProfile?.username ||
              (userProfile?.first_name && userProfile?.last_name
                ? `${userProfile.first_name} ${userProfile.last_name}`
                : 'Community Creator')

            items.push({
              id: `model_${model.id}`,
              type: '3d_model',
              title: model.title,
              description: model.description || undefined,
              imageUrl: model.preview_url,
              category: model.category,
              creatorName,
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
