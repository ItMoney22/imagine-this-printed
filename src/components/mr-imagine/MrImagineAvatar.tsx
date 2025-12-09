import React, { useState, useEffect } from 'react'
import { MR_IMAGINE_CONFIG, getMrImagineAsset, type MrImagineExpression } from './config'

export interface MrImagineAvatarProps {
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'hero'
  expression?: MrImagineExpression
  pose?: 'standing' | 'waistUp' | 'head'
  animate?: boolean
  glow?: boolean
  className?: string
  onClick?: () => void
}

const sizeClasses = {
  sm: 'w-10 h-10',
  md: 'w-16 h-16',
  lg: 'w-24 h-24',
  xl: 'w-32 h-32',
  hero: 'w-48 h-48 sm:w-64 sm:h-64 md:w-80 md:h-80',
}

export const MrImagineAvatar: React.FC<MrImagineAvatarProps> = ({
  size = 'md',
  expression = 'default',
  pose = 'standing',
  animate = true,
  glow = true,
  className = '',
  onClick,
}) => {
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageError, setImageError] = useState(false)
  const [currentImage, setCurrentImage] = useState<string>('')

  useEffect(() => {
    const imagePath = getMrImagineAsset(pose, expression)
    setCurrentImage(imagePath)
    setImageLoaded(false)
    setImageError(false)
  }, [pose, expression])

  const handleImageLoad = () => {
    setImageLoaded(true)
    setImageError(false)
  }

  const handleImageError = () => {
    setImageError(true)
    setImageLoaded(true)
  }

  const animationClass = animate
    ? 'animate-[mr-imagine-bob_2s_ease-in-out_infinite]'
    : ''

  const glowClass = glow
    ? 'drop-shadow-[0_0_15px_rgba(168,85,247,0.5)]'
    : ''

  const interactiveClass = onClick
    ? 'cursor-pointer hover:scale-105 transition-transform duration-200'
    : ''

  return (
    <div
      className={`relative inline-flex items-center justify-center ${sizeClasses[size]} ${className}`}
      onClick={onClick}
    >
      {/* Glow backdrop */}
      {glow && (
        <div
          className="absolute inset-0 bg-primary/30 blur-xl rounded-full animate-pulse"
          style={{ transform: 'scale(1.2)' }}
        />
      )}

      {/* Loading placeholder */}
      {!imageLoaded && !imageError && (
        <div className={`${sizeClasses[size]} bg-primary/20 rounded-full animate-pulse flex items-center justify-center`}>
          <span className="text-primary text-2xl">?</span>
        </div>
      )}

      {/* Fallback placeholder when image fails */}
      {imageError && (
        <div
          className={`${sizeClasses[size]} bg-gradient-to-br from-primary/40 to-secondary/40 rounded-full flex items-center justify-center border-2 border-primary/30 ${interactiveClass}`}
        >
          <span className="text-white font-display text-lg">Mr.I</span>
        </div>
      )}

      {/* Main avatar image */}
      {currentImage && !imageError && (
        <img
          src={currentImage}
          alt={`${MR_IMAGINE_CONFIG.name} - ${expression}`}
          className={`
            relative z-10
            ${sizeClasses[size]}
            object-contain
            ${animationClass}
            ${glowClass}
            ${interactiveClass}
            ${imageLoaded ? 'opacity-100' : 'opacity-0'}
            transition-opacity duration-300
          `}
          onLoad={handleImageLoad}
          onError={handleImageError}
        />
      )}
    </div>
  )
}

// CSS for custom animation (add to global styles or use Tailwind plugin)
// @keyframes mr-imagine-bob {
//   0%, 100% { transform: translateY(0); }
//   50% { transform: translateY(-5px); }
// }
