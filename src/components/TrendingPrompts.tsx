import { useState } from 'react'

interface TrendingPromptsProps {
  onSelectPrompt: (prompt: string) => void
}

interface TrendingPrompt {
  id: string
  prompt: string
  category: string
  icon: string
  gradient: string
  popularity: number // 1-5 fire icons
}

const TRENDING_PROMPTS: TrendingPrompt[] = [
  {
    id: '1',
    prompt: 'A majestic galaxy cat with laser eyes floating through a nebula',
    category: 'Cosmic',
    icon: '🌌',
    gradient: 'from-purple-600 to-blue-600',
    popularity: 5
  },
  {
    id: '2',
    prompt: 'Vintage sunset with palm trees silhouette in synthwave style',
    category: 'Retro',
    icon: '🌴',
    gradient: 'from-orange-500 to-pink-600',
    popularity: 5
  },
  {
    id: '3',
    prompt: 'Geometric mountain landscape with aurora borealis in minimalist art style',
    category: 'Nature',
    icon: '🏔️',
    gradient: 'from-teal-500 to-cyan-600',
    popularity: 4
  },
  {
    id: '4',
    prompt: 'Neon cyberpunk city street at night with rain reflections',
    category: 'Sci-Fi',
    icon: '🌃',
    gradient: 'from-pink-500 to-purple-700',
    popularity: 5
  },
  {
    id: '5',
    prompt: 'Cute kawaii panda eating ramen in Japanese anime style',
    category: 'Cute',
    icon: '🐼',
    gradient: 'from-green-500 to-emerald-600',
    popularity: 4
  },
  {
    id: '6',
    prompt: 'Vintage motorcycle with flames in classic tattoo art style',
    category: 'Classic',
    icon: '🏍️',
    gradient: 'from-red-500 to-orange-600',
    popularity: 3
  },
  {
    id: '7',
    prompt: 'Astronaut riding a whale through space surrounded by stars',
    category: 'Surreal',
    icon: '🚀',
    gradient: 'from-indigo-500 to-purple-600',
    popularity: 4
  },
  {
    id: '8',
    prompt: 'Floral skull with roses and butterflies in watercolor style',
    category: 'Artistic',
    icon: '💀',
    gradient: 'from-rose-500 to-pink-600',
    popularity: 4
  }
]

const CATEGORIES = ['All', 'Cosmic', 'Retro', 'Nature', 'Sci-Fi', 'Cute', 'Classic', 'Surreal', 'Artistic']

export const TrendingPrompts = ({ onSelectPrompt }: TrendingPromptsProps) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const filteredPrompts = selectedCategory === 'All'
    ? TRENDING_PROMPTS
    : TRENDING_PROMPTS.filter(p => p.category === selectedCategory)

  const displayedPrompts = isExpanded ? filteredPrompts : filteredPrompts.slice(0, 4)

  return (
    <div className="w-full">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 bg-gradient-to-r from-purple-50 to-pink-50 rounded-xl hover:from-purple-100 hover:to-pink-100 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl">✨</span>
          <div className="text-left">
            <h3 className="font-semibold text-gray-800">Need Inspiration?</h3>
            <p className="text-sm text-gray-500">Click a trending prompt to get started</p>
          </div>
        </div>
        <div className={`transform transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
          <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="mt-4 animate-fade-in">
          {/* Category Pills */}
          <div className="flex gap-2 overflow-x-auto pb-3 scrollbar-hide">
            {CATEGORIES.map(category => (
              <button
                key={category}
                onClick={() => setSelectedCategory(category)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
                  selectedCategory === category
                    ? 'bg-purple-600 text-white shadow-lg shadow-purple-200'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {category}
              </button>
            ))}
          </div>

          {/* Prompts Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
            {displayedPrompts.map(prompt => (
              <button
                key={prompt.id}
                onClick={() => onSelectPrompt(prompt.prompt)}
                onMouseEnter={() => setHoveredId(prompt.id)}
                onMouseLeave={() => setHoveredId(null)}
                className={`group relative p-4 rounded-xl border border-gray-100 text-left transition-all hover:shadow-lg hover:border-purple-200 overflow-hidden ${
                  hoveredId === prompt.id ? 'scale-[1.02]' : ''
                }`}
              >
                {/* Background gradient on hover */}
                <div className={`absolute inset-0 bg-gradient-to-br ${prompt.gradient} opacity-0 group-hover:opacity-5 transition-opacity`} />

                {/* Content */}
                <div className="relative">
                  {/* Header */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{prompt.icon}</span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full bg-gradient-to-r ${prompt.gradient} text-white`}>
                        {prompt.category}
                      </span>
                    </div>
                    <div className="flex">
                      {Array.from({ length: prompt.popularity }).map((_, i) => (
                        <span key={i} className="text-xs">🔥</span>
                      ))}
                    </div>
                  </div>

                  {/* Prompt Text */}
                  <p className="text-sm text-gray-700 line-clamp-2 group-hover:text-gray-900">
                    {prompt.prompt}
                  </p>

                  {/* Use This Button */}
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-xs text-gray-400 group-hover:text-purple-500 transition-colors">
                      Click to use this prompt
                    </span>
                    <svg
                      className="w-4 h-4 text-gray-300 group-hover:text-purple-500 group-hover:translate-x-1 transition-all"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Show More / Less */}
          {filteredPrompts.length > 4 && (
            <button
              onClick={() => setIsExpanded(prev => !prev)}
              className="w-full mt-4 py-2 text-sm text-purple-600 hover:text-purple-700 font-medium"
            >
              {displayedPrompts.length < filteredPrompts.length
                ? `Show ${filteredPrompts.length - displayedPrompts.length} more prompts`
                : 'Show less'}
            </button>
          )}
        </div>
      )}

      {/* Collapsed Preview */}
      {!isExpanded && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
          {TRENDING_PROMPTS.slice(0, 4).map(prompt => (
            <button
              key={prompt.id}
              onClick={() => onSelectPrompt(prompt.prompt)}
              className={`flex-shrink-0 px-4 py-2 rounded-full bg-gradient-to-r ${prompt.gradient} text-white text-sm font-medium hover:shadow-lg transition-shadow`}
            >
              {prompt.icon} {prompt.category}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Compact inline version for sidebar or smaller spaces
export const TrendingPromptsCompact = ({ onSelectPrompt }: TrendingPromptsProps) => {
  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">
        Quick Start Ideas
      </p>
      <div className="flex flex-wrap gap-2">
        {TRENDING_PROMPTS.slice(0, 6).map(prompt => (
          <button
            key={prompt.id}
            onClick={() => onSelectPrompt(prompt.prompt)}
            className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-purple-100 text-gray-700 hover:text-purple-700 rounded-full transition-colors"
            title={prompt.prompt}
          >
            {prompt.icon} {prompt.category}
          </button>
        ))}
      </div>
    </div>
  )
}

export default TrendingPrompts
