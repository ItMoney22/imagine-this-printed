import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { designShowcaseService } from '../utils/design-showcase-service'
import type { ShowcaseItem } from '../utils/design-showcase-service'

interface FeaturedSocialContentProps {
  limit?: number
}

const FeaturedSocialContent: React.FC<FeaturedSocialContentProps> = ({ limit = 8 }) => {
  const [showcaseItems, setShowcaseItems] = useState<ShowcaseItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [currentSlide, setCurrentSlide] = useState(0)

  useEffect(() => {
    loadFeaturedDesigns()
  }, [limit])

  useEffect(() => {
    if (showcaseItems.length > 1) {
      const interval = setInterval(() => {
        setCurrentSlide(prev => (prev + 1) % showcaseItems.length)
      }, 5000) // Auto-advance every 5 seconds

      return () => clearInterval(interval)
    }
  }, [showcaseItems.length])

  const loadFeaturedDesigns = async () => {
    try {
      setIsLoading(true)
      const designs = await designShowcaseService.getFeaturedDesigns(limit)
      setShowcaseItems(designs)
    } catch (error) {
      console.error('Error loading featured designs:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const getTypeBadge = (item: ShowcaseItem) => {
    return designShowcaseService.getTypeBadge(item.type)
  }

  const getCategoryLabel = (category: string) => {
    return designShowcaseService.getCategoryLabel(category)
  }

  if (isLoading) {
    return (
      <div className="animate-pulse">
        <div className="h-96 bg-card/50 rounded-lg"></div>
      </div>
    )
  }

  if (showcaseItems.length === 0) {
    return null
  }

  return (
    <div className="relative bg-card rounded-lg shadow-lg overflow-hidden border border-primary/20">
      <div className="flex items-center justify-between px-6 py-4 border-b border-primary/20">
        <div>
          <h3 className="text-lg font-medium text-text">Customer Showcase</h3>
          <p className="text-sm text-muted">Amazing designs created by our community</p>
        </div>
        <Link
          to="/community"
          className="text-primary hover:text-primary/80 text-sm font-medium transition-colors"
        >
          View All →
        </Link>
      </div>

      <div className="relative h-96">
        {showcaseItems.map((item, index) => (
          <div
            key={item.id}
            className={`absolute inset-0 transition-opacity duration-500 ${
              index === currentSlide ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          >
            <div className="flex h-full">
              {/* Image Content */}
              <div className="flex-1 relative">
                <img
                  src={item.imageUrl}
                  alt={item.title}
                  className="w-full h-full object-contain bg-bg"
                />

                {/* Type Badge */}
                <div className="absolute top-4 left-4">
                  <span className={`px-3 py-1 text-sm rounded-full ${getTypeBadge(item).color} text-white`}>
                    {getTypeBadge(item).icon} {getTypeBadge(item).label}
                  </span>
                </div>

                {/* Category Badge */}
                <div className="absolute top-4 right-4">
                  <span className="px-3 py-1 text-sm rounded-full bg-secondary/90 text-white">
                    {getCategoryLabel(item.category)}
                  </span>
                </div>
              </div>

              {/* Item Info */}
              <div className="w-80 p-6 flex flex-col justify-between bg-card">
                <div>
                  {/* Creator Info */}
                  <div className="flex items-center space-x-3 mb-4">
                    {item.creatorAvatar ? (
                      <img
                        src={item.creatorAvatar}
                        alt={item.creatorName || 'Creator'}
                        className="w-10 h-10 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                        <span className="text-primary text-lg">
                          {(item.creatorName || 'A')[0].toUpperCase()}
                        </span>
                      </div>
                    )}
                    <div>
                      <p className="font-medium text-text">{item.creatorName || 'Anonymous'}</p>
                      <p className="text-sm text-muted">Creator</p>
                    </div>
                  </div>

                  <h4 className="text-xl font-semibold text-text mb-3">{item.title}</h4>
                  {item.description && (
                    <p className="text-muted mb-4 line-clamp-3">{item.description}</p>
                  )}

                  {/* Date */}
                  <div className="text-sm text-muted mb-4">
                    Created {new Date(item.createdAt).toLocaleDateString()}
                  </div>
                </div>

                <div>
                  {/* Actions */}
                  <div className="flex space-x-3">
                    {item.type === 'product' && item.productId && (
                      <Link
                        to={`/products/${item.productId}`}
                        className="flex-1 btn-primary text-center text-sm"
                      >
                        View Product
                      </Link>
                    )}
                    {item.type === '3d_model' && (
                      <Link
                        to="/3d-models"
                        className="flex-1 btn-primary text-center text-sm"
                      >
                        View 3D Gallery
                      </Link>
                    )}
                    <Link
                      to="/imagination-station"
                      className="flex-1 btn-secondary text-center text-sm"
                    >
                      Create Yours
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Navigation Dots */}
      {showcaseItems.length > 1 && (
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex space-x-2 z-10">
          {showcaseItems.map((_, index) => (
            <button
              key={index}
              onClick={() => setCurrentSlide(index)}
              className={`w-3 h-3 rounded-full transition-colors ${
                index === currentSlide
                  ? 'bg-primary'
                  : 'bg-primary/30 hover:bg-primary/50'
              }`}
            />
          ))}
        </div>
      )}

      {/* Navigation Arrows */}
      {showcaseItems.length > 1 && (
        <>
          <button
            onClick={() => setCurrentSlide(prev => (prev - 1 + showcaseItems.length) % showcaseItems.length)}
            className="absolute left-4 top-1/2 transform -translate-y-1/2 bg-bg/80 text-text p-2 rounded-full hover:bg-bg transition-colors border border-primary/30"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            onClick={() => setCurrentSlide(prev => (prev + 1) % showcaseItems.length)}
            className="absolute right-4 top-1/2 transform -translate-y-1/2 bg-bg/80 text-text p-2 rounded-full hover:bg-bg transition-colors border border-primary/30"
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
