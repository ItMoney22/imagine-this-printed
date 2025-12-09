interface SocialShareButtonsProps {
    productId: string
    productName: string
    productImage: string
    creatorUsername: string
}

export const SocialShareButtons = ({ productId, productName, productImage, creatorUsername }: SocialShareButtonsProps) => {
    const shareUrl = `https://imaginethisprinted.com/products/${productId}`
    const shareText = `Check out "${productName}" created by @${creatorUsername} on ImagineThisPrinted!`

    const platforms = [
        {
            name: 'Twitter',
            icon: '🐦',
            url: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`,
            color: 'hover:bg-blue-500/20'
        },
        {
            name: 'Facebook',
            icon: '👤',
            url: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`,
            color: 'hover:bg-blue-600/20'
        },
        {
            name: 'Pinterest',
            icon: '📌',
            url: `https://pinterest.com/pin/create/button/?url=${encodeURIComponent(shareUrl)}&media=${encodeURIComponent(productImage)}&description=${encodeURIComponent(shareText)}`,
            color: 'hover:bg-red-500/20'
        }
    ]

    return (
        <div className="flex items-center gap-3">
            <span className="text-muted text-sm">Share:</span>
            {platforms.map((platform) => (
                <a
                    key={platform.name}
                    href={platform.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`
            flex items-center gap-2 bg-card/90 border border-primary/20 rounded-lg px-4 py-2
            transition-all ${platform.color}
          `}
                >
                    <span>{platform.icon}</span>
                    <span className="text-text text-sm">{platform.name}</span>
                </a>
            ))}
        </div>
    )
}
