import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Lightbulb, Sparkles } from 'lucide-react'
import DesignStudioModal from './DesignStudioModal'

export function Hero() {
  const [showDesignModal, setShowDesignModal] = useState(false)

  return (
    <>
      <section className="relative overflow-hidden min-h-[80vh] flex items-center justify-center bg-bg">
        {/* Background Elements */}
        <div className="absolute inset-0 bg-[url('/assets/bg/grid.svg')] opacity-20"></div>
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full max-w-4xl bg-primary/20 blur-[120px] rounded-full pointer-events-none"></div>

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          {/* Neon Lightbulb Icon */}
          <div className="mb-8 relative inline-block">
            <div className="absolute inset-0 bg-primary blur-[40px] opacity-50 animate-pulse"></div>
            <Lightbulb className="w-32 h-32 text-white drop-shadow-[0_0_15px_rgba(168,85,247,0.8)] mx-auto relative z-10" strokeWidth={1.5} />
          </div>

          {/* Main Heading */}
          <h1 className="font-display text-6xl sm:text-7xl md:text-8xl font-bold text-transparent bg-clip-text bg-gradient-to-b from-gray-900 to-primary/80 dark:from-white dark:to-primary/50 drop-shadow-none dark:drop-shadow-[0_0_25px_rgba(168,85,247,0.5)] tracking-tighter mb-4">
            IMAGINE
            <br />
            <span className="text-primary drop-shadow-[0_0_15px_rgba(168,85,247,0.5)] dark:drop-shadow-[0_0_30px_rgba(168,85,247,0.8)]">THIS</span>
            <br />
            PRINTED
          </h1>

          {/* Subheading */}
          <p className="mt-8 max-w-2xl mx-auto text-lg sm:text-xl text-muted font-light tracking-wide">
            Custom printing solutions for your creative vision.
            <br />
            From DTF transfers to personalized apparel.
          </p>

          {/* CTA Buttons */}
          <div className="mt-12 flex flex-col sm:flex-row justify-center gap-6">
            <Link
              to="/catalog"
              className="group relative px-8 py-4 bg-transparent border border-primary/50 text-primary hover:text-white hover:bg-primary/20 hover:border-primary rounded-lg font-display tracking-wider text-sm uppercase transition-all duration-300 shadow-[0_0_20px_rgba(168,85,247,0.2)] hover:shadow-[0_0_30px_rgba(168,85,247,0.6)]"
            >
              Shop Products
            </Link>

            <button
              onClick={() => setShowDesignModal(true)}
              className="group relative px-8 py-4 bg-transparent border border-secondary/50 text-secondary hover:text-white hover:bg-secondary/20 hover:border-secondary rounded-lg font-display tracking-wider text-sm uppercase transition-all duration-300 shadow-[0_0_20px_rgba(59,130,246,0.2)] hover:shadow-[0_0_30px_rgba(59,130,246,0.6)]"
            >
              Create Design
            </button>
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

