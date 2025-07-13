import React from 'react'

interface SocialBadgeProps {
  platform?: 'tiktok' | 'instagram' | 'youtube' | 'twitter'
  type?: 'as_seen_on' | 'featured_in' | 'trending'
  size?: 'small' | 'medium' | 'large'
  className?: string
}

const SocialBadge: React.FC<SocialBadgeProps> = ({ 
  platform = 'tiktok', 
  type = 'as_seen_on', 
  size = 'medium',
  className = '' 
}) => {
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
      case 'instagram': return 'bg-gradient-to-br from-purple-600 via-pink-600 to-orange-400 text-white'
      case 'youtube': return 'bg-red-600 text-white'
      case 'twitter': return 'bg-blue-500 text-white'
      default: return 'bg-gray-500 text-white'
    }
  }

  const getBadgeText = (type: string, platform: string) => {
    switch (type) {
      case 'as_seen_on':
        return `As Seen on ${platform.charAt(0).toUpperCase() + platform.slice(1)}`
      case 'featured_in':
        return `Featured on ${platform.charAt(0).toUpperCase() + platform.slice(1)}`
      case 'trending':
        return `Trending on ${platform.charAt(0).toUpperCase() + platform.slice(1)}`
      default:
        return `On ${platform.charAt(0).toUpperCase() + platform.slice(1)}`
    }
  }

  const getSizeClasses = (size: string) => {
    switch (size) {
      case 'small':
        return 'px-2 py-1 text-xs'
      case 'large':
        return 'px-4 py-2 text-sm'
      case 'medium':
      default:
        return 'px-3 py-1 text-xs'
    }
  }

  return (
    <div className={`inline-flex items-center space-x-1 rounded-full font-medium ${getPlatformColor(platform)} ${getSizeClasses(size)} ${className}`}>
      <span className="text-lg">{getPlatformIcon(platform)}</span>
      <span>{getBadgeText(type, platform)}</span>
    </div>
  )
}

export default SocialBadge