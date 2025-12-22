import { Router, Request, Response } from 'express'
import { requireAuth, requireRole } from '../middleware/supabaseAuth.js'
import { supabase } from '../lib/supabase.js'

const router = Router()

// Platform URL validators
const PLATFORM_PATTERNS: Record<string, RegExp> = {
  tiktok: /^https?:\/\/(www\.)?(tiktok\.com|vm\.tiktok\.com)\/.+/i,
  instagram: /^https?:\/\/(www\.)?instagram\.com\/(p|reel|tv)\/.+/i,
  youtube: /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\/.+/i,
  twitter: /^https?:\/\/(www\.)?(twitter\.com|x\.com)\/.+/i
}

// Validate platform URL
function validatePlatformUrl(platform: string, url: string): boolean {
  const pattern = PLATFORM_PATTERNS[platform.toLowerCase()]
  return pattern ? pattern.test(url) : false
}

// Extract platform from URL
function extractPlatform(url: string): string | null {
  for (const [platform, pattern] of Object.entries(PLATFORM_PATTERNS)) {
    if (pattern.test(url)) return platform
  }
  return null
}

// Generate embed code for a platform
function generateEmbedCode(platform: string, url: string): string {
  switch (platform.toLowerCase()) {
    case 'tiktok':
      return `<blockquote class="tiktok-embed" cite="${url}"><a href="${url}">TikTok Video</a></blockquote><script async src="https://www.tiktok.com/embed.js"></script>`
    case 'instagram':
      return `<blockquote class="instagram-media" data-instgrm-permalink="${url}"><a href="${url}">Instagram Post</a></blockquote><script async src="//www.instagram.com/embed.js"></script>`
    case 'youtube':
      const videoId = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/)?.[1]
      return videoId ? `<iframe width="560" height="315" src="https://www.youtube.com/embed/${videoId}" frameborder="0" allowfullscreen></iframe>` : ''
    case 'twitter':
      return `<blockquote class="twitter-tweet"><a href="${url}">Tweet</a></blockquote><script async src="https://platform.twitter.com/widgets.js"></script>`
    default:
      return ''
  }
}

// GET /api/social/submissions - Get pending submissions (admin only)
router.get('/submissions', requireAuth, requireRole(['admin', 'manager', 'founder']), async (req: Request, res: Response): Promise<any> => {
  try {
    const { status = 'pending' } = req.query

    const { data, error } = await supabase
      .from('social_submissions')
      .select('*')
      .eq('status', status as string)
      .order('submitted_at', { ascending: false })

    if (error) {
      console.error('[social] Error fetching submissions:', error)
      return res.status(500).json({ error: error.message })
    }

    return res.json({ submissions: data || [] })
  } catch (error: any) {
    console.error('[social] Submissions error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// POST /api/social/submissions - Submit content (authenticated user)
router.post('/submissions', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const { platform, url, description, submitterHandle, notes } = req.body
    const userId = req.user?.sub

    if (!url) {
      return res.status(400).json({ error: 'URL is required' })
    }

    // Auto-detect platform if not provided
    const detectedPlatform = platform || extractPlatform(url)
    if (!detectedPlatform) {
      return res.status(400).json({ error: 'Could not detect platform. Please provide a valid TikTok, Instagram, YouTube, or Twitter URL.' })
    }

    // Validate URL matches platform
    if (!validatePlatformUrl(detectedPlatform, url)) {
      return res.status(400).json({ error: `Invalid ${detectedPlatform} URL` })
    }

    // Check for duplicate submission
    const { data: existing } = await supabase
      .from('social_submissions')
      .select('id')
      .eq('url', url)
      .single()

    if (existing) {
      return res.status(409).json({ error: 'This content has already been submitted' })
    }

    const { data, error } = await supabase
      .from('social_submissions')
      .insert({
        platform: detectedPlatform,
        url,
        description,
        submitter_handle: submitterHandle,
        notes,
        submitted_by: userId,
        status: 'pending'
      })
      .select()
      .single()

    if (error) {
      console.error('[social] Error creating submission:', error)
      return res.status(500).json({ error: error.message })
    }

    console.log(`[social] New submission created: ${data.id} from ${userId}`)
    return res.status(201).json({ submission: data })
  } catch (error: any) {
    console.error('[social] Submission error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// POST /api/social/submissions/:id/process - Approve or reject a submission (admin only)
router.post('/submissions/:id/process', requireAuth, requireRole(['admin', 'manager', 'founder']), async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params
    const { action, tags, productIds, adminNotes, rejectionReason, title, authorUsername, authorDisplayName } = req.body
    const adminId = req.user?.sub

    if (!action || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Action must be "approve" or "reject"' })
    }

    // Get the submission
    const { data: submission, error: fetchError } = await supabase
      .from('social_submissions')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchError || !submission) {
      return res.status(404).json({ error: 'Submission not found' })
    }

    if (submission.status !== 'pending') {
      return res.status(400).json({ error: 'Submission has already been processed' })
    }

    // Update submission status
    const { error: updateError } = await supabase
      .from('social_submissions')
      .update({
        status: action === 'approve' ? 'approved' : 'rejected',
        admin_notes: adminNotes,
        rejection_reason: action === 'reject' ? rejectionReason : null,
        processed_by: adminId,
        processed_at: new Date().toISOString()
      })
      .eq('id', id)

    if (updateError) {
      console.error('[social] Error updating submission:', updateError)
      return res.status(500).json({ error: updateError.message })
    }

    // If approved, create a social post
    if (action === 'approve') {
      const embedCode = generateEmbedCode(submission.platform, submission.url)

      const { data: post, error: postError } = await supabase
        .from('social_posts')
        .insert({
          submission_id: id,
          platform: submission.platform,
          url: submission.url,
          embed_code: embedCode,
          title: title || submission.description?.substring(0, 100),
          description: submission.description,
          author_username: authorUsername || submission.submitter_handle,
          author_display_name: authorDisplayName || submission.submitter_handle,
          approved_by: adminId,
          status: 'approved',
          tags: tags || [],
          product_ids: productIds || []
        })
        .select()
        .single()

      if (postError) {
        console.error('[social] Error creating post:', postError)
        return res.status(500).json({ error: postError.message })
      }

      console.log(`[social] Submission ${id} approved, post ${post.id} created`)
      return res.json({ message: 'Submission approved', post })
    }

    console.log(`[social] Submission ${id} rejected`)
    return res.json({ message: 'Submission rejected' })
  } catch (error: any) {
    console.error('[social] Process error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// GET /api/social/posts - Get approved posts (public)
router.get('/posts', async (req: Request, res: Response): Promise<any> => {
  try {
    const { platform, featured, limit = '20', offset = '0', sort = 'recent' } = req.query

    let query = supabase
      .from('social_posts')
      .select('*')
      .in('status', ['approved', 'featured'])

    if (platform && platform !== 'all') {
      query = query.eq('platform', platform as string)
    }

    if (featured === 'true') {
      query = query.eq('is_featured', true)
    }

    // Sorting
    switch (sort) {
      case 'votes':
        query = query.order('votes', { ascending: false })
        break
      case 'views':
        query = query.order('view_count', { ascending: false })
        break
      default:
        query = query.order('approved_at', { ascending: false })
    }

    query = query.range(parseInt(offset as string), parseInt(offset as string) + parseInt(limit as string) - 1)

    const { data, error } = await query

    if (error) {
      console.error('[social] Error fetching posts:', error)
      return res.status(500).json({ error: error.message })
    }

    return res.json({ posts: data || [] })
  } catch (error: any) {
    console.error('[social] Posts error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// POST /api/social/posts/:id/feature - Toggle feature status (admin only)
router.post('/posts/:id/feature', requireAuth, requireRole(['admin', 'manager', 'founder']), async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params
    const { featured } = req.body

    const { data, error } = await supabase
      .from('social_posts')
      .update({
        is_featured: featured,
        status: featured ? 'featured' : 'approved',
        featured_at: featured ? new Date().toISOString() : null
      })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('[social] Error toggling feature:', error)
      return res.status(500).json({ error: error.message })
    }

    console.log(`[social] Post ${id} feature status: ${featured}`)
    return res.json({ post: data })
  } catch (error: any) {
    console.error('[social] Feature toggle error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// POST /api/social/posts/:id/vote - Vote on a post (authenticated user)
router.post('/posts/:id/vote', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params
    const { voteType } = req.body
    const userId = req.user?.sub

    if (!voteType || !['up', 'down'].includes(voteType)) {
      return res.status(400).json({ error: 'Vote type must be "up" or "down"' })
    }

    // Check for existing vote
    const { data: existingVote } = await supabase
      .from('social_votes')
      .select('*')
      .eq('post_id', id)
      .eq('user_id', userId)
      .single()

    let voteChange = 0

    if (existingVote) {
      if (existingVote.vote_type === voteType) {
        // Remove vote (clicking same button again)
        await supabase
          .from('social_votes')
          .delete()
          .eq('id', existingVote.id)

        voteChange = voteType === 'up' ? -1 : 1
      } else {
        // Change vote
        await supabase
          .from('social_votes')
          .update({ vote_type: voteType })
          .eq('id', existingVote.id)

        voteChange = voteType === 'up' ? 2 : -2
      }
    } else {
      // New vote
      await supabase
        .from('social_votes')
        .insert({
          post_id: id,
          user_id: userId,
          vote_type: voteType
        })

      voteChange = voteType === 'up' ? 1 : -1
    }

    // Update post vote count
    const { data: post } = await supabase
      .from('social_posts')
      .select('votes')
      .eq('id', id)
      .single()

    if (post) {
      await supabase
        .from('social_posts')
        .update({ votes: (post.votes || 0) + voteChange })
        .eq('id', id)
    }

    return res.json({ message: 'Vote recorded', voteChange })
  } catch (error: any) {
    console.error('[social] Vote error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// DELETE /api/social/posts/:id - Delete a post (admin only)
router.delete('/posts/:id', requireAuth, requireRole(['admin', 'manager', 'founder']), async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params

    const { error } = await supabase
      .from('social_posts')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('[social] Error deleting post:', error)
      return res.status(500).json({ error: error.message })
    }

    console.log(`[social] Post ${id} deleted`)
    return res.json({ message: 'Post deleted' })
  } catch (error: any) {
    console.error('[social] Delete error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// GET /api/social/analytics - Get social analytics (admin only)
router.get('/analytics', requireAuth, requireRole(['admin', 'manager', 'founder']), async (req: Request, res: Response): Promise<any> => {
  try {
    // Get total counts
    const { data: posts } = await supabase
      .from('social_posts')
      .select('platform, votes, view_count, is_featured')

    const { data: pendingSubmissions } = await supabase
      .from('social_submissions')
      .select('id')
      .eq('status', 'pending')

    const totalPosts = posts?.length || 0
    const totalViews = posts?.reduce((sum, p) => sum + (p.view_count || 0), 0) || 0
    const totalVotes = posts?.reduce((sum, p) => sum + (p.votes || 0), 0) || 0
    const featuredCount = posts?.filter(p => p.is_featured).length || 0
    const pendingCount = pendingSubmissions?.length || 0

    // Platform breakdown
    const platformBreakdown = {
      tiktok: posts?.filter(p => p.platform === 'tiktok').length || 0,
      instagram: posts?.filter(p => p.platform === 'instagram').length || 0,
      youtube: posts?.filter(p => p.platform === 'youtube').length || 0,
      twitter: posts?.filter(p => p.platform === 'twitter').length || 0
    }

    // Top performing posts
    const topPosts = [...(posts || [])]
      .sort((a, b) => (b.votes || 0) - (a.votes || 0))
      .slice(0, 5)

    return res.json({
      analytics: {
        totalPosts,
        totalViews,
        totalVotes,
        featuredCount,
        pendingCount,
        platformBreakdown,
        topPosts: topPosts.map(p => ({
          platform: p.platform,
          votes: p.votes,
          views: p.view_count
        }))
      }
    })
  } catch (error: any) {
    console.error('[social] Analytics error:', error)
    return res.status(500).json({ error: error.message })
  }
})

export default router
