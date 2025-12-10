import { useState, useRef } from 'react'

interface ProductPreviewCarouselProps {
  designImageUrl: string
  designName?: string
}

interface ProductMockup {
  id: string
  name: string
  icon: string
  aspectRatio: string
  designPosition: {
    top: string
    left: string
    width: string
    height: string
  }
  bgColor: string
  productShape: 'rectangle' | 'circle' | 'phone' | 'mug'
}

const PRODUCT_MOCKUPS: ProductMockup[] = [
  {
    id: 'tshirt',
    name: 'T-Shirt',
    icon: '👕',
    aspectRatio: 'aspect-[3/4]',
    designPosition: { top: '25%', left: '20%', width: '60%', height: '45%' },
    bgColor: 'bg-gray-100',
    productShape: 'rectangle'
  },
  {
    id: 'hoodie',
    name: 'Hoodie',
    icon: '🧥',
    aspectRatio: 'aspect-[3/4]',
    designPosition: { top: '30%', left: '22%', width: '56%', height: '40%' },
    bgColor: 'bg-gray-800',
    productShape: 'rectangle'
  },
  {
    id: 'mug',
    name: 'Mug',
    icon: '☕',
    aspectRatio: 'aspect-square',
    designPosition: { top: '20%', left: '15%', width: '70%', height: '60%' },
    bgColor: 'bg-white',
    productShape: 'mug'
  },
  {
    id: 'phonecase',
    name: 'Phone Case',
    icon: '📱',
    aspectRatio: 'aspect-[9/19]',
    designPosition: { top: '15%', left: '10%', width: '80%', height: '70%' },
    bgColor: 'bg-gray-900',
    productShape: 'phone'
  },
  {
    id: 'poster',
    name: 'Poster',
    icon: '🖼️',
    aspectRatio: 'aspect-[3/4]',
    designPosition: { top: '8%', left: '8%', width: '84%', height: '84%' },
    bgColor: 'bg-amber-50',
    productShape: 'rectangle'
  },
  {
    id: 'totebag',
    name: 'Tote Bag',
    icon: '👜',
    aspectRatio: 'aspect-square',
    designPosition: { top: '20%', left: '15%', width: '70%', height: '55%' },
    bgColor: 'bg-amber-100',
    productShape: 'rectangle'
  }
]

export const ProductPreviewCarousel = ({ designImageUrl, designName }: ProductPreviewCarouselProps) => {
  const [activeIndex, setActiveIndex] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  const scrollTo = (index: number) => {
    setActiveIndex(index)
    if (scrollRef.current) {
      const cardWidth = 200 + 16 // card width + gap
      scrollRef.current.scrollTo({
        left: index * cardWidth - (scrollRef.current.clientWidth / 2) + (cardWidth / 2),
        behavior: 'smooth'
      })
    }
  }

  const renderMockup = (mockup: ProductMockup) => {
    const baseClasses = "relative overflow-hidden shadow-lg"

    switch (mockup.productShape) {
      case 'mug':
        return (
          <div className={`${baseClasses} ${mockup.bgColor} rounded-lg ${mockup.aspectRatio} w-full`}>
            {/* Mug body */}
            <div className="absolute inset-x-4 top-4 bottom-4 bg-white rounded-lg shadow-inner overflow-hidden">
              {/* Mug handle */}
              <div className="absolute -right-6 top-1/4 w-8 h-1/2 border-4 border-gray-300 rounded-r-full" />
              {/* Design on mug */}
              <div
                className="absolute overflow-hidden rounded"
                style={{
                  top: mockup.designPosition.top,
                  left: mockup.designPosition.left,
                  width: mockup.designPosition.width,
                  height: mockup.designPosition.height
                }}
              >
                <img
                  src={designImageUrl}
                  alt={designName || 'Design preview'}
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          </div>
        )

      case 'phone':
        return (
          <div className={`${baseClasses} ${mockup.bgColor} rounded-[2rem] ${mockup.aspectRatio} w-full border-4 border-gray-700`}>
            {/* Phone notch */}
            <div className="absolute top-2 left-1/2 -translate-x-1/2 w-1/3 h-4 bg-gray-700 rounded-full" />
            {/* Design area */}
            <div
              className="absolute overflow-hidden rounded-xl"
              style={{
                top: mockup.designPosition.top,
                left: mockup.designPosition.left,
                width: mockup.designPosition.width,
                height: mockup.designPosition.height
              }}
            >
              <img
                src={designImageUrl}
                alt={designName || 'Design preview'}
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        )

      default:
        return (
          <div className={`${baseClasses} ${mockup.bgColor} rounded-xl ${mockup.aspectRatio} w-full`}>
            {/* T-shirt/Hoodie collar shape */}
            {(mockup.id === 'tshirt' || mockup.id === 'hoodie') && (
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/4 h-6 bg-inherit">
                <div className={`absolute inset-0 ${mockup.id === 'tshirt' ? 'rounded-b-full' : 'rounded-b-lg'} border-b-4 border-gray-300`} />
              </div>
            )}
            {/* Poster frame effect */}
            {mockup.id === 'poster' && (
              <div className="absolute inset-2 border-8 border-gray-800 rounded shadow-inner" />
            )}
            {/* Design placement */}
            <div
              className="absolute overflow-hidden rounded-lg shadow-sm"
              style={{
                top: mockup.designPosition.top,
                left: mockup.designPosition.left,
                width: mockup.designPosition.width,
                height: mockup.designPosition.height
              }}
            >
              <img
                src={designImageUrl}
                alt={designName || 'Design preview'}
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        )
    }
  }

  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-800">Preview on Products</h3>
        <span className="text-sm text-gray-500">{activeIndex + 1} / {PRODUCT_MOCKUPS.length}</span>
      </div>

      {/* Carousel */}
      <div
        ref={scrollRef}
        className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory scrollbar-hide"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {PRODUCT_MOCKUPS.map((mockup, index) => (
          <div
            key={mockup.id}
            onClick={() => scrollTo(index)}
            className={`flex-shrink-0 w-[180px] cursor-pointer transition-all duration-300 snap-center ${
              activeIndex === index
                ? 'scale-105 ring-2 ring-purple-500 ring-offset-2 rounded-xl'
                : 'opacity-70 hover:opacity-100'
            }`}
          >
            {renderMockup(mockup)}
            <div className="mt-2 text-center">
              <span className="text-xl">{mockup.icon}</span>
              <p className={`text-sm font-medium ${activeIndex === index ? 'text-purple-600' : 'text-gray-600'}`}>
                {mockup.name}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Navigation dots */}
      <div className="flex justify-center gap-2 mt-4">
        {PRODUCT_MOCKUPS.map((_, index) => (
          <button
            key={index}
            onClick={() => scrollTo(index)}
            className={`w-2 h-2 rounded-full transition-all ${
              activeIndex === index
                ? 'w-6 bg-purple-500'
                : 'bg-gray-300 hover:bg-gray-400'
            }`}
          />
        ))}
      </div>

      {/* Quick action */}
      <div className="mt-4 text-center">
        <p className="text-sm text-gray-500 mb-2">
          Love how it looks on {PRODUCT_MOCKUPS[activeIndex].name.toLowerCase()}?
        </p>
        <button className="text-purple-600 font-medium text-sm hover:text-purple-700 transition-colors">
          Add {PRODUCT_MOCKUPS[activeIndex].name} to Cart →
        </button>
      </div>
    </div>
  )
}

export default ProductPreviewCarousel
