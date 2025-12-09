import React, { useState, useRef } from 'react'
import { MrImagineAvatar } from './MrImagineAvatar'
import { MR_IMAGINE_CONFIG, type MrImagineExpression } from './config'
import { Sparkles, Volume2, VolumeX } from 'lucide-react'

interface MrImagineHeroProps {
  showSpeechBubble?: boolean
  speechText?: string
  useVideo?: boolean
  className?: string
}

export const MrImagineHero: React.FC<MrImagineHeroProps> = ({
  showSpeechBubble = true,
  speechText = "Let's create something amazing together!",
  useVideo = true,
  className = '',
}) => {
  const [expression, setExpression] = useState<MrImagineExpression>('waving')
  const [isHovered, setIsHovered] = useState(false)
  const [videoLoaded, setVideoLoaded] = useState(false)
  const [videoError, setVideoError] = useState(false)
  const [isMuted, setIsMuted] = useState(true)
  const videoRef = useRef<HTMLVideoElement>(null)

  const handleMouseEnter = () => {
    setIsHovered(true)
    setExpression('happy')
  }

  const handleMouseLeave = () => {
    setIsHovered(false)
    setExpression('waving')
  }

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted
      setIsMuted(!isMuted)
    }
  }

  const showVideo = useVideo && !videoError

  return (
    <div
      className={`relative inline-flex flex-col items-center ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Speech Bubble */}
      {showSpeechBubble && (
        <div
          className={`
            absolute -top-4 left-1/2 -translate-x-1/2 -translate-y-full z-20
            px-5 py-3 bg-card/90 backdrop-blur-sm border border-primary/30
            rounded-2xl rounded-bl-md shadow-lg
            transform transition-all duration-300
            ${isHovered ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}
          `}
        >
          <p className="text-text text-sm font-medium whitespace-nowrap flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            {speechText}
          </p>
          {/* Speech bubble tail */}
          <div className="absolute -bottom-2 left-8 w-4 h-4 bg-card/90 border-r border-b border-primary/30 transform rotate-45" />
        </div>
      )}

      {/* Mr. Imagine Character */}
      <div className="relative group cursor-pointer">
        {/* Animated glow backdrop */}
        <div className="absolute inset-0 bg-primary/20 blur-[60px] rounded-full animate-pulse" style={{ transform: 'scale(1.5)' }} />

        {/* Secondary glow ring */}
        <div className="absolute inset-0 bg-secondary/10 blur-[40px] rounded-full animate-pulse" style={{ transform: 'scale(1.3)', animationDelay: '0.5s' }} />

        {/* Video or Avatar */}
        {showVideo ? (
          <div className="relative z-10 w-48 h-48 sm:w-64 sm:h-64 md:w-80 md:h-80 overflow-hidden rounded-2xl">
            {/* Loading state */}
            {!videoLoaded && (
              <div className="absolute inset-0 flex items-center justify-center bg-primary/10 rounded-2xl">
                <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              </div>
            )}

            {/* Video */}
            <video
              ref={videoRef}
              src={MR_IMAGINE_CONFIG.assets.heroVideo}
              autoPlay
              loop
              muted={isMuted}
              playsInline
              onLoadedData={() => setVideoLoaded(true)}
              onError={() => setVideoError(true)}
              className={`w-full h-full object-cover rounded-2xl transition-opacity duration-300 ${
                videoLoaded ? 'opacity-100' : 'opacity-0'
              }`}
            />

            {/* Mute/Unmute button */}
            {videoLoaded && (
              <button
                onClick={toggleMute}
                className="absolute bottom-3 right-3 p-2 bg-bg/80 backdrop-blur-sm rounded-full border border-primary/20 hover:bg-primary/20 transition-colors z-10"
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted ? (
                  <VolumeX className="w-4 h-4 text-text" />
                ) : (
                  <Volume2 className="w-4 h-4 text-primary" />
                )}
              </button>
            )}
          </div>
        ) : (
          <MrImagineAvatar
            size="hero"
            pose="standing"
            expression={expression}
            animate={true}
            glow={true}
          />
        )}
      </div>

      {/* Name badge */}
      <div className="mt-4 px-4 py-2 bg-card/80 backdrop-blur-sm border border-primary/20 rounded-full shadow-glow">
        <span className="text-primary font-display text-sm tracking-wider">
          {MR_IMAGINE_CONFIG.name}
        </span>
      </div>
    </div>
  )
}
