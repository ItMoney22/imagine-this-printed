import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Play, Pause, Volume2, VolumeX, ArrowRight, Sparkles } from 'lucide-react'
import DesignStudioModal from './DesignStudioModal'

export function Hero() {
  const [showDesignModal, setShowDesignModal] = useState(false)
  const [isPlaying, setIsPlaying] = useState(true)
  const [isMuted, setIsMuted] = useState(true)
  const [isLoaded, setIsLoaded] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.play().catch(() => {
        // Autoplay blocked, that's okay
      })
    }
  }, [])

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause()
      } else {
        videoRef.current.play()
      }
      setIsPlaying(!isPlaying)
    }
  }

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted
      setIsMuted(!isMuted)
    }
  }

  return (
    <>
      {/* Full-Screen Video Hero */}
      <section className="relative w-full h-screen overflow-hidden">
        {/* Video Background */}
        <div className="absolute inset-0">
          <video
            ref={videoRef}
            className={`w-full h-full object-cover transition-opacity duration-1000 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
            autoPlay
            muted
            loop
            playsInline
            onLoadedData={() => setIsLoaded(true)}
            poster="/mr-imagine/mr-imagine-standing-happy.png"
          >
            <source src="/mr-imagine/mr-imagine-hero.mp4" type="video/mp4" />
          </video>

          {/* Fallback gradient if video doesn't load - Purple themed */}
          {!isLoaded && (
            <div className="absolute inset-0 bg-gradient-to-br from-purple-100 via-fuchsia-50 to-blue-100" />
          )}
        </div>

        {/* Overlay with gradient fade - Deep purple dark overlay */}
        <div className="absolute inset-0 hero-overlay-dark" />

        {/* Purple ambient glow */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/20 rounded-full blur-[150px]" />
          <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-blue-500/15 rounded-full blur-[120px]" />
          <div className="absolute top-1/2 right-1/3 w-64 h-64 bg-pink-500/10 rounded-full blur-[100px]" />
        </div>

        {/* Subtle grain texture */}
        <div className="absolute inset-0 grain pointer-events-none" />

        {/* Video Controls - Purple themed */}
        <div className="absolute bottom-8 right-8 z-20 flex items-center gap-3">
          <button
            onClick={togglePlay}
            className="p-3 rounded-full bg-purple-500/20 backdrop-blur-md border border-purple-300/30 text-white hover:bg-purple-500/30 transition-all duration-300"
            aria-label={isPlaying ? 'Pause video' : 'Play video'}
          >
            {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
          </button>
          <button
            onClick={toggleMute}
            className="p-3 rounded-full bg-purple-500/20 backdrop-blur-md border border-purple-300/30 text-white hover:bg-purple-500/30 transition-all duration-300"
            aria-label={isMuted ? 'Unmute video' : 'Mute video'}
          >
            {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
          </button>
        </div>

        {/* Hero Content - With Mr. Imagine integration */}
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <div className="max-w-6xl mx-auto px-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
              {/* Left: Text Content */}
              <div className="text-center lg:text-left">
                {/* Badge - Purple themed */}
                <div className="animate-fade-up mb-6">
                  <span className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-purple-500/20 backdrop-blur-md border border-purple-400/30 text-purple-100 text-sm font-medium tracking-wide">
                    <Sparkles className="w-4 h-4 text-purple-300" />
                    AI-Powered Custom Printing
                  </span>
                </div>

                {/* Main Headline - Purple gradient accent */}
                <h1 className="animate-fade-up-delay-1 font-display text-5xl sm:text-6xl lg:text-7xl text-white leading-none tracking-tight mb-6">
                  <span className="block">Imagine It.</span>
                  <span className="block mt-2">
                    <em className="italic bg-gradient-to-r from-purple-300 via-pink-300 to-blue-300 bg-clip-text text-transparent">Print</em> It.
                  </span>
                </h1>

                {/* Subheadline */}
                <p className="animate-fade-up-delay-2 max-w-xl text-lg text-purple-100/80 font-light leading-relaxed mb-8">
                  Transform your creative vision into premium custom products.
                  From AI-generated designs to professional DTF transfers —
                  we bring your imagination to life.
                </p>

                {/* CTA Buttons - Purple themed */}
                <div className="animate-fade-up-delay-3 flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4">
                  <button
                    onClick={() => setShowDesignModal(true)}
                    className="group flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-purple-500 to-purple-600 text-white font-semibold rounded-full hover:from-purple-600 hover:to-purple-700 transition-all duration-300 shadow-lg shadow-purple-500/30 hover:shadow-xl hover:shadow-purple-500/40 hover:-translate-y-1"
                  >
                    <Sparkles className="w-5 h-5" />
                    Start Creating
                    <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
                  </button>

                  <Link
                    to="/catalog"
                    className="group flex items-center gap-3 px-8 py-4 bg-white/10 backdrop-blur-sm border-2 border-white/30 text-white font-semibold rounded-full hover:bg-white/20 hover:border-white/50 transition-all duration-300"
                  >
                    Browse Products
                    <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
                  </Link>
                </div>

                {/* Trust Indicators */}
                <div className="animate-fade-up-delay-4 mt-10 flex flex-wrap items-center justify-center lg:justify-start gap-6 text-purple-200/60 text-sm">
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-purple-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span>Free Design Tools</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-purple-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span>Fast Turnaround</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-purple-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span>Premium Quality</span>
                  </div>
                </div>
              </div>

              {/* Right: Mr. Imagine Character */}
              <div className="hidden lg:flex items-center justify-center">
                <div className="relative">
                  {/* Glow effect behind Mr. Imagine */}
                  <div className="absolute inset-0 bg-gradient-to-t from-purple-500/30 via-purple-400/20 to-transparent rounded-full blur-3xl scale-110 animate-mr-imagine-glow" />

                  {/* Mr. Imagine Character */}
                  <div className="relative animate-mr-imagine-bob">
                    <img
                      src="/mr-imagine/mr-imagine-waving.png"
                      alt="Mr. Imagine - Your AI Design Assistant"
                      className="w-80 h-auto drop-shadow-2xl"
                    />

                    {/* Speech Bubble */}
                    <div className="absolute -top-4 -right-8 bg-white rounded-2xl px-5 py-3 shadow-xl animate-fade-up-delay-2">
                      <div className="relative">
                        <p className="text-sm font-medium text-gray-800">
                          Let's create something
                          <span className="text-purple-600"> amazing!</span>
                        </p>
                        {/* Speech bubble tail */}
                        <div className="absolute -bottom-3 left-6 w-4 h-4 bg-white transform rotate-45" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Scroll Indicator - Purple themed */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 animate-scroll">
          <div className="flex flex-col items-center gap-2 text-purple-300/50">
            <span className="text-xs uppercase tracking-widest">Scroll</span>
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </div>
        </div>
      </section>

      <DesignStudioModal
        isOpen={showDesignModal}
        onClose={() => setShowDesignModal(false)}
      />
    </>
  )
}
