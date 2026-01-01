import { Router, Request, Response } from 'express'
import { requireAuth, optionalAuth, requireRole } from '../middleware/supabaseAuth.js'
import { supabase } from '../lib/supabase.js'

const router = Router()

// Configuration constants
const COMMUNITY_CONFIG = {
  FREE_VOTE_POINTS: 1,
  PAID_BOOST_MULTIPLIER: 1, // 1 ITC = 1 boost point
  CREATOR_EARN_PER_BOOST: 1, // 1 ITC earned per boost received
  MIN_PAID_BOOST_ITC: 1,
  MAX_PAID_BOOST_ITC: 100,
  DEFAULT_PAGE_SIZE: 20,
  LEADERBOARD_SIZE: 10
}

// GET /api/community/feed - Get community feed with sorting and filtering
router.get('/feed', optionalAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    const {
      sort = 'most_boosted',
      filter = 'all',
      page = 1,
      limit = COMMUNITY_CONFIG.DEFAULT_PAGE_SIZE
    } = req.query

    const pageNum = Math.max(1, Number(page))
    const limitNum = Math.min(50, Math.max(1, Number(limit)))
    const offset = (pageNum - 1) * limitNum

    // First try community_posts table
    let query = supabase
      .from('community_posts')
      .select('*', { count: 'exact' })
      .in('status', ['active', 'featured'])

    // Apply type filter
    if (filter === 'designs') {
      query = query.eq('post_type', 'design')
    } else if (filter === 'vendor_products') {
      query = query.eq('post_type', 'vendor_product')
    }

    // Apply sorting
    switch (sort) {
      case 'recent':
        query = query.order('created_at', { ascending: false })
        break
      case 'trending':
        query = query
          .order('total_boost_score', { ascending: false })
          .order('created_at', { ascending: false })
        break
      case 'most_boosted':
      default:
        query = query.order('total_boost_score', { ascending: false })
        break
    }

    query = query.range(offset, offset + limitNum - 1)

    const { data: communityPosts, error: communityError, count: communityCount } = await query

    // If we have community posts, return them
    if (!communityError && communityPosts && communityPosts.length > 0) {
      let postsWithVoteStatus = communityPosts
      if (userId && communityPosts.length > 0) {
        const postIds = communityPosts.map(p => p.id)
        const { data: userVotes } = await supabase
          .from('community_boosts')
          .select('post_id')
          .eq('user_id', userId)
          .eq('boost_type', 'free_vote')
          .eq('status', 'active')
          .in('post_id', postIds)

        const votedPostIds = new Set(userVotes?.map(v => v.post_id) || [])
        postsWithVoteStatus = communityPosts.map(post => ({
          ...post,
          user_has_voted: votedPostIds.has(post.id)
        }))
      }

      return res.json({
        ok: true,
        posts: postsWithVoteStatus,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: communityCount || 0,
          totalPages: Math.ceil((communityCount || 0) / limitNum)
        }
      })
    }

    // FALLBACK: Query user-generated products directly when community_posts is empty
    console.log('[community/feed] No community posts found, falling back to user-generated products')

    let productsQuery = supabase
      .from('products')
      .select(`
        id,
        name,
        description,
        category,
        images,
        created_at,
        created_by_user_id,
        is_user_generated
      `, { count: 'exact' })
      .eq('is_user_generated', true)
      .eq('status', 'active')

    // Apply sorting
    productsQuery = productsQuery.order('created_at', { ascending: false })
    productsQuery = productsQuery.range(offset, offset + limitNum - 1)

    const { data: products, error: productsError, count: productsCount } = await productsQuery

    if (productsError) {
      console.error('[community/feed] Products fallback error:', productsError)
      return res.json({
        ok: true,
        posts: [],
        pagination: { page: pageNum, limit: limitNum, total: 0, totalPages: 0 }
      })
    }

    if (!products || products.length === 0) {
      return res.json({
        ok: true,
        posts: [],
        pagination: { page: pageNum, limit: limitNum, total: 0, totalPages: 0 }
      })
    }

    // Fetch product assets for mockups
    const productIds = products.map(p => p.id)
    const { data: assets } = await supabase
      .from('product_assets')
      .select('*')
      .in('product_id', productIds)
      .in('kind', ['mockup', 'source'])
      .order('display_order', { ascending: true })

    const assetsByProduct = (assets || []).reduce((acc: Record<string, any[]>, asset: any) => {
      if (!acc[asset.product_id]) acc[asset.product_id] = []
      acc[asset.product_id].push(asset)
      return acc
    }, {})

    // Fetch user profiles for creators
    const userIds = products.map(p => p.created_by_user_id).filter(Boolean)
    let userProfiles: Record<string, any> = {}
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('id, username, first_name, last_name, avatar_url')
        .in('id', userIds)

      if (profiles) {
        userProfiles = profiles.reduce((acc: Record<string, any>, p: any) => {
          acc[p.id] = p
          return acc
        }, {})
      }
    }

    // Transform products to community post format
    const transformedPosts = products.map(product => {
      const productAssets = assetsByProduct[product.id] || []
      const mockup = productAssets.find((a: any) => a.kind === 'mockup') || productAssets[0]
      const imageUrl = mockup?.url || (product.images as string[])?.[0] || ''
      const userProfile = product.created_by_user_id ? userProfiles[product.created_by_user_id] : null
      const creatorName = userProfile?.username ||
        (userProfile?.first_name && userProfile?.last_name
          ? `${userProfile.first_name} ${userProfile.last_name}`
          : 'Community Creator')

      return {
        id: product.id,
        post_type: 'design',
        product_id: product.id,
        creator_id: product.created_by_user_id,
        creator_username: creatorName,
        creator_display_name: creatorName,
        creator_avatar_url: userProfile?.avatar_url || null,
        creator_role: 'customer',
        title: product.name,
        description: product.description,
        primary_image_url: imageUrl,
        additional_images: (product.images as string[])?.slice(1) || [],
        status: 'active',
        free_vote_count: 0,
        paid_boost_count: 0,
        total_boost_score: 0,
        view_count: 0,
        created_at: product.created_at,
        user_has_voted: false
      }
    })

    return res.json({
      ok: true,
      posts: transformedPosts,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: productsCount || 0,
        totalPages: Math.ceil((productsCount || 0) / limitNum)
      }
    })
  } catch (error: any) {
    console.error('[community/feed] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// GET /api/community/leaderboard - Get top creators by boosts
router.get('/leaderboard', async (req: Request, res: Response): Promise<any> => {
  try {
    const { period = 'all_time', limit = COMMUNITY_CONFIG.LEADERBOARD_SIZE } = req.query

    // Use the view we created for leaderboard
    let query = supabase
      .from('community_leaderboard')
      .select('*')
      .limit(Number(limit))

    const { data: leaderboard, error } = await query

    if (error || !leaderboard || leaderboard.length === 0) {
      console.log('[community/leaderboard] No leaderboard data, falling back to products')

      // Fallback: Query user-generated products to create leaderboard
      const { data: products, error: productsError } = await supabase
        .from('products')
        .select('created_by_user_id')
        .eq('is_user_generated', true)
        .eq('approved', true)

      if (productsError || !products || products.length === 0) {
        return res.json({ ok: true, leaderboard: [] })
      }

      // Get unique creator IDs and count products
      const creatorCounts = new Map<string, number>()
      products.forEach(p => {
        if (p.created_by_user_id) {
          creatorCounts.set(p.created_by_user_id, (creatorCounts.get(p.created_by_user_id) || 0) + 1)
        }
      })

      const creatorIds = Array.from(creatorCounts.keys())
      if (creatorIds.length === 0) {
        return res.json({ ok: true, leaderboard: [] })
      }

      // Fetch user profiles
      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('id, username, first_name, last_name, avatar_url')
        .in('id', creatorIds)

      const profileMap = new Map(profiles?.map(p => [p.id, p]) || [])

      // Build leaderboard from products
      const leaderboardFromProducts = Array.from(creatorCounts.entries())
        .map(([creatorId, postCount]) => {
          const profile = profileMap.get(creatorId)
          const creatorName = profile?.username ||
            (profile?.first_name && profile?.last_name
              ? `${profile.first_name} ${profile.last_name}`
              : 'Community Creator')
          return {
            creator_id: creatorId,
            creator_username: creatorName,
            creator_display_name: creatorName,
            creator_avatar_url: profile?.avatar_url || null,
            post_count: postCount,
            total_boosts_received: 0
          }
        })
        .sort((a, b) => b.post_count - a.post_count)
        .slice(0, Number(limit))
        .map((entry, index) => ({ ...entry, rank: index + 1 }))

      return res.json({ ok: true, leaderboard: leaderboardFromProducts })
    }

    return res.json({ ok: true, leaderboard })
  } catch (error: any) {
    console.error('[community/leaderboard] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// POST /api/community/posts/:id/boost - Toggle free vote on a post
router.post('/posts/:id/boost', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    const { id: postId } = req.params

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    // Check if post exists
    const { data: post, error: postError } = await supabase
      .from('community_posts')
      .select('id, creator_id, creator_username, free_vote_count')
      .eq('id', postId)
      .in('status', ['active', 'featured'])
      .single()

    if (postError || !post) {
      return res.status(404).json({ error: 'Post not found' })
    }

    // Prevent self-voting
    if (post.creator_id === userId) {
      return res.status(400).json({ error: 'Cannot vote on your own post' })
    }

    // Check for existing free vote
    const { data: existingVote } = await supabase
      .from('community_boosts')
      .select('id')
      .eq('post_id', postId)
      .eq('user_id', userId)
      .eq('boost_type', 'free_vote')
      .eq('status', 'active')
      .single()

    if (existingVote) {
      // Toggle off - remove vote
      const { error: deleteError } = await supabase
        .from('community_boosts')
        .delete()
        .eq('id', existingVote.id)

      if (deleteError) {
        console.error('[community/boost] Delete error:', deleteError)
        return res.status(500).json({ error: 'Failed to remove vote' })
      }

      // Note: We don't revoke the ITC earned when unvoting
      // This is intentional to prevent gaming the system

      return res.json({
        ok: true,
        voted: false,
        message: 'Vote removed'
      })
    } else {
      // Add new vote
      const { data: newBoost, error: insertError } = await supabase
        .from('community_boosts')
        .insert({
          post_id: postId,
          user_id: userId,
          boost_type: 'free_vote',
          boost_points: COMMUNITY_CONFIG.FREE_VOTE_POINTS,
          itc_amount: 0
        })
        .select()
        .single()

      if (insertError) {
        console.error('[community/boost] Insert error:', insertError)
        return res.status(500).json({ error: 'Failed to add vote' })
      }

      // Credit ITC to creator
      await creditCreatorITC(post.creator_id, postId, newBoost.id, userId, 'free_vote')

      return res.json({
        ok: true,
        voted: true,
        message: 'Vote added! Creator earned 1 ITC'
      })
    }
  } catch (error: any) {
    console.error('[community/boost] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// POST /api/community/posts/:id/boost-paid - Paid ITC boost
router.post('/posts/:id/boost-paid', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    const { id: postId } = req.params
    const { itc_amount } = req.body

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    // Validate amount
    const amount = Number(itc_amount)
    if (isNaN(amount) || amount < COMMUNITY_CONFIG.MIN_PAID_BOOST_ITC || amount > COMMUNITY_CONFIG.MAX_PAID_BOOST_ITC) {
      return res.status(400).json({
        error: `ITC amount must be between ${COMMUNITY_CONFIG.MIN_PAID_BOOST_ITC} and ${COMMUNITY_CONFIG.MAX_PAID_BOOST_ITC}`
      })
    }

    // Check if post exists
    const { data: post, error: postError } = await supabase
      .from('community_posts')
      .select('id, creator_id, creator_username')
      .eq('id', postId)
      .in('status', ['active', 'featured'])
      .single()

    if (postError || !post) {
      return res.status(404).json({ error: 'Post not found' })
    }

    // Prevent self-boosting
    if (post.creator_id === userId) {
      return res.status(400).json({ error: 'Cannot boost your own post' })
    }

    // Check user's ITC balance
    const { data: wallet, error: walletError } = await supabase
      .from('user_wallets')
      .select('itc_balance')
      .eq('user_id', userId)
      .single()

    if (walletError || !wallet) {
      return res.status(404).json({ error: 'Wallet not found' })
    }

    if (wallet.itc_balance < amount) {
      return res.status(402).json({
        error: 'Insufficient ITC balance',
        required: amount,
        current: wallet.itc_balance
      })
    }

    // Deduct ITC from booster
    const newBalance = wallet.itc_balance - amount
    const { error: deductError } = await supabase
      .from('user_wallets')
      .update({ itc_balance: newBalance })
      .eq('user_id', userId)

    if (deductError) {
      console.error('[community/boost-paid] Deduct error:', deductError)
      return res.status(500).json({ error: 'Failed to deduct ITC' })
    }

    // Log the deduction transaction
    await supabase.from('itc_transactions').insert({
      user_id: userId,
      type: 'usage',
      amount: -amount,
      balance_after: newBalance,
      description: `Paid boost on community post`,
      reference_type: 'community_boost',
      reference_id: postId
    })

    // Create boost record
    const boostPoints = amount * COMMUNITY_CONFIG.PAID_BOOST_MULTIPLIER
    const { data: newBoost, error: insertError } = await supabase
      .from('community_boosts')
      .insert({
        post_id: postId,
        user_id: userId,
        boost_type: 'paid_boost',
        boost_points: boostPoints,
        itc_amount: amount
      })
      .select()
      .single()

    if (insertError) {
      console.error('[community/boost-paid] Insert error:', insertError)
      // Refund the ITC
      await supabase
        .from('user_wallets')
        .update({ itc_balance: wallet.itc_balance })
        .eq('user_id', userId)
      return res.status(500).json({ error: 'Failed to create boost' })
    }

    // Credit ITC to creator (1 ITC per boost, regardless of amount spent)
    await creditCreatorITC(post.creator_id, postId, newBoost.id, userId, 'paid_boost')

    console.log('[community/boost-paid] ✅ Paid boost created:', {
      postId,
      boosterId: userId,
      itcSpent: amount,
      boostPoints
    })

    return res.json({
      ok: true,
      message: `Boosted with ${amount} ITC! Creator earned 1 ITC`,
      boost_points: boostPoints,
      new_balance: newBalance
    })
  } catch (error: any) {
    console.error('[community/boost-paid] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// GET /api/community/my-earnings - Get user's boost earnings
router.get('/my-earnings', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    const { limit = 50, offset = 0 } = req.query

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { data: earnings, error, count } = await supabase
      .from('community_boost_earnings')
      .select('*, community_posts(title, primary_image_url)', { count: 'exact' })
      .eq('creator_id', userId)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1)

    if (error) {
      console.error('[community/my-earnings] Error:', error)
      return res.status(500).json({ error: 'Failed to fetch earnings' })
    }

    // Calculate total earned
    const { data: totalData } = await supabase
      .from('community_boost_earnings')
      .select('itc_earned')
      .eq('creator_id', userId)
      .eq('status', 'credited')

    const totalEarned = totalData?.reduce((sum, e) => sum + e.itc_earned, 0) || 0

    return res.json({
      ok: true,
      earnings,
      total_earned: totalEarned,
      count
    })
  } catch (error: any) {
    console.error('[community/my-earnings] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// POST /api/community/posts - Publish a design to community
router.post('/posts', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    const { product_id, title, description } = req.body

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    if (!product_id) {
      return res.status(400).json({ error: 'Product ID is required' })
    }

    // Get the product and verify ownership
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('id, name, description, images, created_by_user_id, status')
      .eq('id', product_id)
      .single()

    if (productError || !product) {
      return res.status(404).json({ error: 'Product not found' })
    }

    if (product.created_by_user_id !== userId) {
      return res.status(403).json({ error: 'You can only publish your own designs' })
    }

    // Check if already published
    const { data: existing } = await supabase
      .from('community_posts')
      .select('id')
      .eq('product_id', product_id)
      .single()

    if (existing) {
      return res.status(409).json({ error: 'This design is already published to community' })
    }

    // Get user profile for creator info
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('username, display_name, avatar_url, role')
      .eq('id', userId)
      .single()

    // Create community post
    const { data: newPost, error: insertError } = await supabase
      .from('community_posts')
      .insert({
        post_type: 'design',
        product_id: product_id,
        creator_id: userId,
        creator_username: profile?.username || 'anonymous',
        creator_display_name: profile?.display_name,
        creator_avatar_url: profile?.avatar_url,
        creator_role: profile?.role || 'customer',
        title: title || product.name,
        description: description || product.description,
        primary_image_url: product.images?.[0] || '',
        additional_images: product.images?.slice(1) || []
      })
      .select()
      .single()

    if (insertError) {
      console.error('[community/posts] Insert error:', insertError)
      return res.status(500).json({ error: 'Failed to publish to community' })
    }

    console.log('[community/posts] ✅ Design published to community:', newPost.id)

    return res.json({
      ok: true,
      post: newPost,
      message: 'Design published to community!'
    })
  } catch (error: any) {
    console.error('[community/posts] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// GET /api/community/posts/:id - Get single post details
router.get('/posts/:id', optionalAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    const { id: postId } = req.params

    const { data: post, error } = await supabase
      .from('community_posts')
      .select('*')
      .eq('id', postId)
      .single()

    if (error || !post) {
      return res.status(404).json({ error: 'Post not found' })
    }

    // Increment view count
    await supabase
      .from('community_posts')
      .update({ view_count: post.view_count + 1 })
      .eq('id', postId)

    // Check if user has voted
    let userHasVoted = false
    if (userId) {
      const { data: vote } = await supabase
        .from('community_boosts')
        .select('id')
        .eq('post_id', postId)
        .eq('user_id', userId)
        .eq('boost_type', 'free_vote')
        .eq('status', 'active')
        .single()
      userHasVoted = !!vote
    }

    return res.json({
      ok: true,
      post: { ...post, user_has_voted: userHasVoted }
    })
  } catch (error: any) {
    console.error('[community/posts/:id] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// Helper function to credit ITC to creator
async function creditCreatorITC(
  creatorId: string,
  postId: string,
  boostId: string,
  boosterId: string,
  boostType: 'free_vote' | 'paid_boost'
) {
  const itcToCredit = COMMUNITY_CONFIG.CREATOR_EARN_PER_BOOST

  try {
    // Get creator's wallet
    const { data: wallet, error: walletError } = await supabase
      .from('user_wallets')
      .select('itc_balance')
      .eq('user_id', creatorId)
      .single()

    if (walletError || !wallet) {
      console.error('[creditCreatorITC] Creator wallet not found:', creatorId)
      return
    }

    // Credit ITC to creator
    const newBalance = (wallet.itc_balance || 0) + itcToCredit
    const { error: updateError } = await supabase
      .from('user_wallets')
      .update({ itc_balance: newBalance })
      .eq('user_id', creatorId)

    if (updateError) {
      console.error('[creditCreatorITC] Update error:', updateError)
      return
    }

    // Log the transaction
    const { data: transaction } = await supabase
      .from('itc_transactions')
      .insert({
        user_id: creatorId,
        type: 'reward',
        amount: itcToCredit,
        balance_after: newBalance,
        description: `Community boost reward (${boostType})`,
        reference_type: 'community_boost',
        reference_id: boostId
      })
      .select()
      .single()

    // Record the earning
    await supabase.from('community_boost_earnings').insert({
      post_id: postId,
      creator_id: creatorId,
      boost_id: boostId,
      booster_id: boosterId,
      itc_earned: itcToCredit,
      boost_type: boostType,
      status: 'credited',
      itc_transaction_id: transaction?.id
    })

    console.log('[creditCreatorITC] ✅ Credited', itcToCredit, 'ITC to creator:', creatorId)
  } catch (error) {
    console.error('[creditCreatorITC] Error:', error)
  }
}

export default router
