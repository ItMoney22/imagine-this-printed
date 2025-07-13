import type { SocialPost, SocialSubmission, SocialComment, SocialAnalytics, Product } from '../types'

export class SocialService {
  // Get all approved social posts
  async getSocialPosts(
    sortBy: 'recent' | 'votes' | 'featured' = 'recent',
    platform?: string,
    tags?: string[]
  ): Promise<SocialPost[]> {
    try {
      // Mock data - in real app, this would query database
      const mockPosts: SocialPost[] = [
        {
          id: 'post_1',
          platform: 'tiktok',
          url: 'https://www.tiktok.com/@example/video/7234567890123456789',
          embedCode: '<iframe src="https://www.tiktok.com/embed/7234567890123456789" width="325" height="580" frameborder="0" allowfullscreen></iframe>',
          thumbnailUrl: 'https://images.unsplash.com/photo-1611162617474-5b21e879e113?w=400&h=600&fit=crop',
          title: 'Amazing custom t-shirt design!',
          description: 'Check out this incredible custom design I got printed 🔥',
          author: {
            username: '@creativejenny',
            displayName: 'Jenny Creates',
            profileImage: 'https://images.unsplash.com/photo-1494790108755-2616b612b47c?w=150&h=150&fit=crop'
          },
          submittedBy: 'user_123',
          submittedAt: '2025-01-10T15:30:00Z',
          approvedBy: 'admin_456',
          approvedAt: '2025-01-10T16:00:00Z',
          status: 'approved',
          tags: ['custom-design', 't-shirt', 'creative'],
          productIds: ['product_1'],
          modelIds: [],
          votes: 47,
          comments: [],
          isFeatured: true,
          featuredAt: '2025-01-10T16:00:00Z',
          viewCount: 1250,
          engagement: {
            likes: 234,
            shares: 45,
            comments: 23
          },
          metadata: {
            originalPostId: '7234567890123456789',
            duration: 15,
            aspectRatio: '9:16'
          }
        },
        {
          id: 'post_2',
          platform: 'instagram',
          url: 'https://www.instagram.com/p/ABC123DEF456/',
          thumbnailUrl: 'https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=400&h=400&fit=crop',
          title: 'Custom hoodie perfection ✨',
          description: 'Obsessed with my new custom hoodie design! The quality is amazing 💜',
          author: {
            username: '@style_maven',
            displayName: 'Style Maven',
            profileImage: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&h=150&fit=crop'
          },
          submittedBy: 'user_789',
          submittedAt: '2025-01-09T12:15:00Z',
          approvedBy: 'admin_456',
          approvedAt: '2025-01-09T14:30:00Z',
          status: 'approved',
          tags: ['hoodie', 'custom-print', 'style'],
          productIds: ['product_4'],
          modelIds: [],
          votes: 32,
          comments: [],
          isFeatured: false,
          viewCount: 890,
          engagement: {
            likes: 156,
            shares: 12,
            comments: 18
          },
          metadata: {
            originalPostId: 'ABC123DEF456',
            aspectRatio: '1:1'
          }
        },
        {
          id: 'post_3',
          platform: 'tiktok',
          url: 'https://www.tiktok.com/@example2/video/7234567890987654321',
          embedCode: '<iframe src="https://www.tiktok.com/embed/7234567890987654321" width="325" height="580" frameborder="0" allowfullscreen></iframe>',
          thumbnailUrl: 'https://images.unsplash.com/photo-1544145945-f90425340c7e?w=400&h=600&fit=crop',
          title: 'Custom tumbler unboxing!',
          description: 'Unboxing my personalized tumbler - the design came out perfect! 🥤',
          author: {
            username: '@coffee_lover_23',
            displayName: 'Coffee Addict',
            profileImage: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=150&h=150&fit=crop'
          },
          submittedBy: 'user_321',
          submittedAt: '2025-01-08T09:45:00Z',
          approvedBy: 'admin_456',
          approvedAt: '2025-01-08T11:00:00Z',
          status: 'approved',
          tags: ['tumbler', 'unboxing', 'personalized'],
          productIds: ['product_3'],
          modelIds: [],
          votes: 28,
          comments: [],
          isFeatured: false,
          viewCount: 675,
          engagement: {
            likes: 89,
            shares: 15,
            comments: 12
          },
          metadata: {
            originalPostId: '7234567890987654321',
            duration: 22,
            aspectRatio: '9:16'
          }
        },
        {
          id: 'post_4',
          platform: 'instagram',
          url: 'https://www.instagram.com/p/XYZ789GHI012/',
          thumbnailUrl: 'https://images.unsplash.com/photo-1503341504253-dff4815485f1?w=400&h=400&fit=crop',
          title: 'DTF transfer magic! ✨',
          description: 'Before and after of my DTF transfer application. The detail is incredible!',
          author: {
            username: '@craft_master',
            displayName: 'Craft Master',
            profileImage: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&h=150&fit=crop'
          },
          submittedBy: 'user_654',
          submittedAt: '2025-01-07T16:20:00Z',
          approvedBy: 'admin_456',
          approvedAt: '2025-01-07T17:15:00Z',
          status: 'featured',
          tags: ['dtf-transfer', 'tutorial', 'crafting'],
          productIds: ['product_2'],
          modelIds: [],
          votes: 65,
          comments: [],
          isFeatured: true,
          featuredAt: '2025-01-07T17:15:00Z',
          viewCount: 1580,
          engagement: {
            likes: 312,
            shares: 67,
            comments: 34
          },
          metadata: {
            originalPostId: 'XYZ789GHI012',
            aspectRatio: '1:1'
          }
        }
      ]

      let filteredPosts = mockPosts.filter(post => post.status === 'approved' || post.status === 'featured')

      // Filter by platform
      if (platform && platform !== 'all') {
        filteredPosts = filteredPosts.filter(post => post.platform === platform)
      }

      // Filter by tags
      if (tags && tags.length > 0) {
        filteredPosts = filteredPosts.filter(post => 
          tags.some(tag => post.tags.includes(tag))
        )
      }

      // Sort posts
      switch (sortBy) {
        case 'votes':
          filteredPosts.sort((a, b) => b.votes - a.votes)
          break
        case 'featured':
          filteredPosts.sort((a, b) => {
            if (a.isFeatured && !b.isFeatured) return -1
            if (!a.isFeatured && b.isFeatured) return 1
            return new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
          })
          break
        case 'recent':
        default:
          filteredPosts.sort((a, b) => 
            new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
          )
          break
      }

      return filteredPosts
    } catch (error) {
      console.error('Error fetching social posts:', error)
      return []
    }
  }

  // Get featured posts for homepage
  async getFeaturedPosts(limit: number = 5): Promise<SocialPost[]> {
    try {
      const allPosts = await this.getSocialPosts('featured')
      return allPosts.filter(post => post.isFeatured).slice(0, limit)
    } catch (error) {
      console.error('Error fetching featured posts:', error)
      return []
    }
  }

  // Submit new social content
  async submitSocialContent(submission: Omit<SocialSubmission, 'id' | 'submittedAt' | 'status'>): Promise<SocialSubmission> {
    try {
      const newSubmission: SocialSubmission = {
        id: `submission_${Date.now()}`,
        ...submission,
        submittedAt: new Date().toISOString(),
        status: 'pending'
      }

      // In real app, save to database
      console.log('New social submission:', newSubmission)
      
      return newSubmission
    } catch (error) {
      console.error('Error submitting social content:', error)
      throw new Error('Failed to submit content')
    }
  }

  // Get pending submissions (admin only)
  async getPendingSubmissions(): Promise<SocialSubmission[]> {
    try {
      // Mock pending submissions
      const mockSubmissions: SocialSubmission[] = [
        {
          id: 'submission_1',
          platform: 'tiktok',
          url: 'https://www.tiktok.com/@newuser/video/7234567890555555555',
          submittedBy: 'user_999',
          submittedAt: '2025-01-12T14:30:00Z',
          status: 'pending',
          submitterHandle: '@newuser',
          featuredProducts: ['Custom T-Shirt'],
          description: 'My first custom design from your shop!',
          notes: 'Love the quality and fast shipping!'
        },
        {
          id: 'submission_2',
          platform: 'instagram',
          url: 'https://www.instagram.com/p/NEW123POST456/',
          submittedBy: 'user_888',
          submittedAt: '2025-01-12T10:15:00Z',
          status: 'pending',
          submitterHandle: '@creative_designs',
          featuredProducts: ['Custom Hoodie', 'DTF Transfer'],
          description: 'Before and after using your DTF transfers on my hoodie',
          notes: 'Amazing results! Want to order more.'
        }
      ]

      return mockSubmissions.filter(sub => sub.status === 'pending')
    } catch (error) {
      console.error('Error fetching pending submissions:', error)
      return []
    }
  }

  // Approve/reject submission (admin only)
  async processSubmission(
    submissionId: string, 
    action: 'approve' | 'reject',
    adminId: string,
    adminNotes?: string,
    productIds?: string[],
    tags?: string[]
  ): Promise<SocialPost | null> {
    try {
      // In real app, update submission and create post if approved
      if (action === 'approve') {
        const approvedPost: SocialPost = {
          id: `post_${Date.now()}`,
          platform: 'tiktok', // Would get from submission
          url: 'https://example.com/post',
          title: 'User submitted content',
          author: {
            username: '@user',
            displayName: 'User'
          },
          submittedBy: 'user_123',
          submittedAt: new Date().toISOString(),
          approvedBy: adminId,
          approvedAt: new Date().toISOString(),
          status: 'approved',
          tags: tags || [],
          productIds: productIds || [],
          modelIds: [],
          votes: 0,
          comments: [],
          isFeatured: false,
          viewCount: 0,
          engagement: {
            likes: 0,
            shares: 0,
            comments: 0
          }
        }

        console.log('Approved submission:', submissionId, 'Post created:', approvedPost.id)
        return approvedPost
      } else {
        console.log('Rejected submission:', submissionId, 'Reason:', adminNotes)
        return null
      }
    } catch (error) {
      console.error('Error processing submission:', error)
      throw new Error('Failed to process submission')
    }
  }

  // Vote on a post
  async voteOnPost(postId: string, userId: string, direction: 'up' | 'down'): Promise<number> {
    try {
      // In real app, update vote count in database
      const currentVotes = Math.floor(Math.random() * 100) // Mock current votes
      const newVotes = direction === 'up' ? currentVotes + 1 : Math.max(0, currentVotes - 1)
      
      console.log(`User ${userId} voted ${direction} on post ${postId}. New vote count: ${newVotes}`)
      return newVotes
    } catch (error) {
      console.error('Error voting on post:', error)
      throw new Error('Failed to vote on post')
    }
  }

  // Add comment to post
  async addComment(postId: string, userId: string, username: string, content: string): Promise<SocialComment> {
    try {
      const newComment: SocialComment = {
        id: `comment_${Date.now()}`,
        postId,
        userId,
        username,
        content,
        createdAt: new Date().toISOString(),
        likes: 0
      }

      // In real app, save to database
      console.log('New comment added:', newComment)
      return newComment
    } catch (error) {
      console.error('Error adding comment:', error)
      throw new Error('Failed to add comment')
    }
  }

  // Feature/unfeature a post (admin only)
  async toggleFeaturePost(postId: string, adminId: string): Promise<boolean> {
    try {
      // In real app, update post featured status
      const isFeatured = Math.random() > 0.5 // Mock toggle
      console.log(`Post ${postId} ${isFeatured ? 'featured' : 'unfeatured'} by admin ${adminId}`)
      return isFeatured
    } catch (error) {
      console.error('Error toggling post feature:', error)
      throw new Error('Failed to toggle post feature')
    }
  }

  // Get posts featuring specific products
  async getPostsByProduct(productId: string): Promise<SocialPost[]> {
    try {
      const allPosts = await this.getSocialPosts()
      return allPosts.filter(post => post.productIds.includes(productId))
    } catch (error) {
      console.error('Error fetching posts by product:', error)
      return []
    }
  }

  // Get social analytics (admin only)
  async getSocialAnalytics(period: string = 'month'): Promise<SocialAnalytics> {
    try {
      // Mock analytics data
      const analytics: SocialAnalytics = {
        period: `Last ${period}`,
        totalPosts: 47,
        totalViews: 15420,
        totalEngagement: 2340,
        platformBreakdown: {
          tiktok: { count: 28, views: 9240, engagement: 1456 },
          instagram: { count: 15, views: 4680, engagement: 672 },
          youtube: { count: 3, views: 1200, engagement: 156 },
          twitter: { count: 1, views: 300, engagement: 56 }
        },
        topPerformingPosts: [
          {
            postId: 'post_1',
            title: 'Amazing custom t-shirt design!',
            platform: 'tiktok',
            views: 1250,
            engagement: 302
          },
          {
            postId: 'post_4',
            title: 'DTF transfer magic! ✨',
            platform: 'instagram',
            views: 1580,
            engagement: 413
          }
        ],
        featuredProducts: [
          {
            productId: 'product_1',
            productName: 'Custom T-Shirt',
            mentionCount: 12,
            totalViews: 4200
          },
          {
            productId: 'product_2',
            productName: 'DTF Transfer',
            mentionCount: 8,
            totalViews: 3100
          }
        ],
        submissionTrends: [
          { date: '2025-01-01', submissions: 5, approvals: 4 },
          { date: '2025-01-02', submissions: 3, approvals: 2 },
          { date: '2025-01-03', submissions: 7, approvals: 6 },
          { date: '2025-01-04', submissions: 4, approvals: 3 },
          { date: '2025-01-05', submissions: 6, approvals: 5 }
        ]
      }

      return analytics
    } catch (error) {
      console.error('Error fetching social analytics:', error)
      throw new Error('Failed to fetch social analytics')
    }
  }

  // Extract platform from URL
  extractPlatformFromUrl(url: string): 'tiktok' | 'instagram' | 'youtube' | 'twitter' | null {
    try {
      const lowerUrl = url.toLowerCase()
      
      if (lowerUrl.includes('tiktok.com')) return 'tiktok'
      if (lowerUrl.includes('instagram.com')) return 'instagram'
      if (lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be')) return 'youtube'
      if (lowerUrl.includes('twitter.com') || lowerUrl.includes('x.com')) return 'twitter'
      
      return null
    } catch (error) {
      console.error('Error extracting platform from URL:', error)
      return null
    }
  }

  // Validate social media URL
  validateSocialUrl(url: string): { isValid: boolean; platform?: string; error?: string } {
    try {
      const platform = this.extractPlatformFromUrl(url)
      
      if (!platform) {
        return {
          isValid: false,
          error: 'URL must be from TikTok, Instagram, YouTube, or Twitter'
        }
      }

      // Basic URL validation
      try {
        new URL(url)
      } catch {
        return {
          isValid: false,
          error: 'Invalid URL format'
        }
      }

      return {
        isValid: true,
        platform
      }
    } catch (error) {
      return {
        isValid: false,
        error: 'Failed to validate URL'
      }
    }
  }

  // Get embed code for platform (mock implementation)
  async getEmbedCode(url: string, platform: string): Promise<string | null> {
    try {
      // In real app, this would use platform APIs to get embed codes
      switch (platform) {
        case 'tiktok':
          // TikTok embed example (would use TikTok oEmbed API)
          const tiktokId = url.split('/video/')[1]?.split('?')[0]
          if (tiktokId) {
            return `<iframe src="https://www.tiktok.com/embed/${tiktokId}" width="325" height="580" frameborder="0" allowfullscreen></iframe>`
          }
          break
          
        case 'instagram':
          // Instagram embed (would use Instagram oEmbed API)
          return `<iframe src="${url}embed/" width="400" height="480" frameborder="0" scrolling="no" allowtransparency="true"></iframe>`
          
        case 'youtube':
          // YouTube embed
          const youtubeId = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/)?.[1]
          if (youtubeId) {
            return `<iframe width="560" height="315" src="https://www.youtube.com/embed/${youtubeId}" frameborder="0" allowfullscreen></iframe>`
          }
          break
          
        case 'twitter':
          // Twitter embed (would use Twitter API)
          return `<blockquote class="twitter-tweet"><a href="${url}"></a></blockquote>`
          
        default:
          return null
      }
      
      return null
    } catch (error) {
      console.error('Error getting embed code:', error)
      return null
    }
  }

  // Get products mentioned in social posts
  async getProductsWithSocialMentions(products: Product[]): Promise<Product[]> {
    try {
      const allPosts = await this.getSocialPosts()
      
      return products.map(product => {
        const mentions = allPosts.filter(post => post.productIds.includes(product.id))
        return {
          ...product,
          socialMentions: mentions.length,
          hasApprovedContent: mentions.length > 0
        }
      })
    } catch (error) {
      console.error('Error getting products with social mentions:', error)
      return products
    }
  }
}

export const socialService = new SocialService()