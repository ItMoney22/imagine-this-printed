import { useState } from 'react'

interface SocialShareButtonsProps {
  productId?: string
  productName?: string
  productImage?: string
  creatorUsername?: string
  // For design completion flow
  designImageUrl?: string
  designName?: string
}

export const SocialShareButtons = ({
  productId,
  productName,
  productImage,
  creatorUsername,
  designImageUrl,
  designName
}: SocialShareButtonsProps) => {
  const [copied, setCopied] = useState(false)
  const [showMenu, setShowMenu] = useState(false)

  // Determine share content based on context
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://imaginethisprinted.com'
  const imageUrl = productImage || designImageUrl || ''
  const name = productName || designName || 'My Custom Design'

  const generateShareUrl = (platform: string) => {
    const path = productId ? `/products/${productId}` : '/create-design'
    return `${baseUrl}${path}?utm_source=share&utm_medium=${platform}&utm_campaign=user_design`
  }

  const shareText = creatorUsername
    ? `Check out "${name}" created by @${creatorUsername} on ImagineThisPrinted!`
    : `Check out my custom "${name}" design on ImagineThisPrinted!`

  const handleShare = (platform: string, url: string) => {
    window.open(url, '_blank', 'width=600,height=500')
  }

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(generateShareUrl('copy'))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: name,
          text: shareText,
          url: generateShareUrl('native')
        })
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setShowMenu(true)
        }
      }
    } else {
      setShowMenu(true)
    }
  }

  const platforms = [
    {
      name: 'Twitter',
      icon: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      ),
      url: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(generateShareUrl('twitter'))}`,
      bgColor: 'bg-black hover:bg-gray-800'
    },
    {
      name: 'Facebook',
      icon: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
        </svg>
      ),
      url: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(generateShareUrl('facebook'))}&quote=${encodeURIComponent(shareText)}`,
      bgColor: 'bg-blue-600 hover:bg-blue-700'
    },
    {
      name: 'Pinterest',
      icon: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0C5.373 0 0 5.372 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738.098.119.112.224.083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.631-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12 0-6.628-5.373-12-12-12z" />
        </svg>
      ),
      url: `https://pinterest.com/pin/create/button/?url=${encodeURIComponent(generateShareUrl('pinterest'))}&media=${encodeURIComponent(imageUrl)}&description=${encodeURIComponent(shareText)}`,
      bgColor: 'bg-red-600 hover:bg-red-700'
    }
  ]

  return (
    <div className="relative">
      {/* Compact Mode - Single Button */}
      <button
        onClick={handleNativeShare}
        className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-full font-medium text-sm hover:from-purple-600 hover:to-pink-600 transition-all shadow-lg hover:shadow-xl"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
        </svg>
        Share
      </button>

      {/* Dropdown Menu */}
      {showMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
          <div className="absolute bottom-full mb-2 left-0 bg-white rounded-xl shadow-2xl border border-gray-100 p-2 z-50 min-w-[200px] animate-fade-in">
            <p className="text-xs text-gray-400 px-3 py-1 uppercase tracking-wider">Share to</p>

            {platforms.map((platform) => (
              <button
                key={platform.name}
                onClick={() => { handleShare(platform.name.toLowerCase(), platform.url); setShowMenu(false) }}
                className="w-full flex items-center gap-3 px-3 py-2 hover:bg-gray-50 rounded-lg transition-colors"
              >
                <div className={`w-8 h-8 ${platform.bgColor} rounded-full flex items-center justify-center text-white`}>
                  {platform.icon}
                </div>
                <span className="text-gray-700 font-medium">{platform.name}</span>
              </button>
            ))}

            <div className="my-2 border-t border-gray-100" />

            <button
              onClick={() => { handleCopyLink(); setShowMenu(false) }}
              className="w-full flex items-center gap-3 px-3 py-2 hover:bg-gray-50 rounded-lg transition-colors"
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${copied ? 'bg-green-500' : 'bg-gray-200'}`}>
                {copied ? (
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                )}
              </div>
              <span className="text-gray-700 font-medium">{copied ? 'Copied!' : 'Copy Link'}</span>
            </button>
          </div>
        </>
      )}

      {/* Toast */}
      {copied && !showMenu && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-4 py-2 rounded-full text-sm font-medium shadow-lg z-50 animate-fade-in">
          Link copied to clipboard!
        </div>
      )}
    </div>
  )
}

// Inline variant - shows all buttons horizontally
export const SocialShareInline = ({
  productId,
  productName,
  productImage,
  creatorUsername,
  designImageUrl,
  designName
}: SocialShareButtonsProps) => {
  const [copied, setCopied] = useState(false)

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://imaginethisprinted.com'
  const imageUrl = productImage || designImageUrl || ''
  const name = productName || designName || 'My Custom Design'

  const generateShareUrl = (platform: string) => {
    const path = productId ? `/products/${productId}` : '/create-design'
    return `${baseUrl}${path}?utm_source=share&utm_medium=${platform}&utm_campaign=user_design`
  }

  const shareText = creatorUsername
    ? `Check out "${name}" created by @${creatorUsername} on ImagineThisPrinted!`
    : `Check out my custom "${name}" design on ImagineThisPrinted!`

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(generateShareUrl('copy'))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-muted text-sm">Share:</span>

      {/* Twitter */}
      <a
        href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(generateShareUrl('twitter'))}`}
        target="_blank"
        rel="noopener noreferrer"
        className="w-10 h-10 bg-black hover:bg-gray-800 rounded-full flex items-center justify-center transition-colors"
        title="Share on Twitter/X"
      >
        <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      </a>

      {/* Facebook */}
      <a
        href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(generateShareUrl('facebook'))}&quote=${encodeURIComponent(shareText)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="w-10 h-10 bg-blue-600 hover:bg-blue-700 rounded-full flex items-center justify-center transition-colors"
        title="Share on Facebook"
      >
        <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
        </svg>
      </a>

      {/* Pinterest */}
      <a
        href={`https://pinterest.com/pin/create/button/?url=${encodeURIComponent(generateShareUrl('pinterest'))}&media=${encodeURIComponent(imageUrl)}&description=${encodeURIComponent(shareText)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="w-10 h-10 bg-red-600 hover:bg-red-700 rounded-full flex items-center justify-center transition-colors"
        title="Share on Pinterest"
      >
        <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0C5.373 0 0 5.372 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738.098.119.112.224.083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.631-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12 0-6.628-5.373-12-12-12z" />
        </svg>
      </a>

      {/* Copy Link */}
      <button
        onClick={handleCopyLink}
        className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
          copied ? 'bg-green-500' : 'bg-gray-200 hover:bg-gray-300'
        }`}
        title={copied ? 'Copied!' : 'Copy link'}
      >
        {copied ? (
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
        )}
      </button>
    </div>
  )
}

export default SocialShareButtons
