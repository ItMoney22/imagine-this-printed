import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { socialService } from '../utils/social-service'
import type { SocialPost } from '../types'

interface FeaturedSocialContentProps {
  limit?: number
}

const FeaturedSocialContent: React.FC<FeaturedSocialContentProps> = ({ limit = 5 }) => {
  const [featuredPosts, setFeaturedPosts] = useState<SocialPost[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [currentSlide, setCurrentSlide] = useState(0)

  useEffect(() => {
    loadFeaturedPosts()
  }, [])

  useEffect(() => {
    if (featuredPosts.length > 1) {
      const interval = setInterval(() => {
        setCurrentSlide(prev => (prev + 1) % featuredPosts.length)
      }, 5000) // Auto-advance every 5 seconds
      
      return () => clearInterval(interval)
    }
  }, [featuredPosts.length])

  const loadFeaturedPosts = async () => {
    try {
      const posts = await socialService.getFeaturedPosts(limit)
      setFeaturedPosts(posts)
    } catch (error) {
      console.error('Error loading featured posts:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const getPlatformIcon = (platform: string) => {
    switch (platform) {
      case 'tiktok': return '🎵'
      case 'instagram': return '📷'
      case 'youtube': return '📹'
      case 'twitter': return '🐦'
      default: return '📱'
    }
  }

  const getPlatformColor = (platform: string) => {
    switch (platform) {
      case 'tiktok': return 'bg-black text-white'
      case 'instagram': return 'bg-pink-500 text-white'
      case 'youtube': return 'bg-red-600 text-white'
      case 'twitter': return 'bg-blue-500 text-white'
      default: return 'bg-gray-500 text-white'
    }
  }

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
    return num.toString()
  }

  if (isLoading) {
    return (
      <div className="animate-pulse">
        <div className="h-96 bg-gray-200 rounded-lg"></div>
      </div>
    )
  }

  if (featuredPosts.length === 0) {
    return null
  }

  return (
    <div className="relative bg-white rounded-lg shadow-lg overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
        <div>
          <h3 className="text-lg font-medium text-gray-900">As Seen on Social Media</h3>
          <p className="text-sm text-gray-600">Real customers sharing their amazing creations</p>
        </div>
        <Link 
          to="/community" 
          className="text-purple-600 hover:text-purple-800 text-sm font-medium"
        >
          View All →
        </Link>
      </div>

      <div className="relative h-96">
        {featuredPosts.map((post, index) => (
          <div
            key={post.id}
            className={`absolute inset-0 transition-opacity duration-500 ${
              index === currentSlide ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <div className="flex h-full">
              {/* Post Content */}
              <div className="flex-1 relative">
                {post.platform === 'tiktok' && post.embedCode ? (
                  <div 
                    className="w-full h-full flex items-center justify-center bg-black"
                    dangerouslySetInnerHTML={{ __html: post.embedCode }}
                  />
                ) : (
                  <img
                    src={post.thumbnailUrl || 'https://via.placeholder.com/400x400?text=Social+Post'}
                    alt={post.title}
                    className="w-full h-full object-cover"
                  />
                )}
                
                {/* Platform Badge */}
                <div className="absolute top-4 left-4">
                  <span className={`px-3 py-1 text-sm rounded-full ${getPlatformColor(post.platform)}`}>
                    {getPlatformIcon(post.platform)} {post.platform}
                  </span>
                </div>
                
                {/* Featured Badge */}
                <div className="absolute top-4 right-4">
                  <span className="px-3 py-1 text-sm rounded-full bg-yellow-100 text-yellow-800">
                    ⭐ Featured
                  </span>
                </div>
              </div>

              {/* Post Info */}
              <div className="w-80 p-6 flex flex-col justify-between">
                <div>
                  <div className="flex items-center space-x-3 mb-4">
                    <img
                      src={post.author.profileImage || 'https://via.placeholder.com/40x40?text=User'}
                      alt={post.author.displayName}
                      className="w-10 h-10 rounded-full"
                    />
                    <div>
                      <p className="font-medium text-gray-900">{post.author.displayName}</p>
                      <p className="text-sm text-gray-600">@{post.author.username}</p>
                    </div>
                  </div>

                  <h4 className="text-xl font-semibold text-gray-900 mb-3">{post.title}</h4>
                  {post.description && (
                    <p className="text-gray-600 mb-4 line-clamp-3">{post.description}</p>
                  )}

                  {/* Tags */}
                  {post.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-4">
                      {post.tags.slice(0, 3).map(tag => (
                        <span key={tag} className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  {/* Engagement Stats */}
                  <div className="flex items-center justify-between text-sm text-gray-600 mb-4">
                    <div className="flex items-center space-x-4">
                      <span>👀 {formatNumber(post.viewCount)}</span>
                      <span>❤️ {formatNumber(post.engagement.likes)}</span>
                      <span>👍 {post.votes}</span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex space-x-3">
                    <a
                      href={post.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 btn-secondary text-center text-sm"
                    >
                      View Original
                    </a>
                    <Link
                      to="/community"
                      className="flex-1 btn-primary text-center text-sm"
                    >
                      See More
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Navigation Dots */}
      {featuredPosts.length > 1 && (
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex space-x-2">
          {featuredPosts.map((_, index) => (
            <button
              key={index}
              onClick={() => setCurrentSlide(index)}
              className={`w-3 h-3 rounded-full transition-colors ${
                index === currentSlide ? 'bg-white' : 'bg-white bg-opacity-50'
              }`}
            />
          ))}
        </div>
      )}

      {/* Navigation Arrows */}
      {featuredPosts.length > 1 && (
        <>
          <button
            onClick={() => setCurrentSlide(prev => (prev - 1 + featuredPosts.length) % featuredPosts.length)}
            className="absolute left-4 top-1/2 transform -translate-y-1/2 bg-black bg-opacity-50 text-white p-2 rounded-full hover:bg-opacity-75 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            onClick={() => setCurrentSlide(prev => (prev + 1) % featuredPosts.length)}
            className="absolute right-4 top-1/2 transform -translate-y-1/2 bg-black bg-opacity-50 text-white p-2 rounded-full hover:bg-opacity-75 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </>
      )}
    </div>
  )
}

export default FeaturedSocialContent
