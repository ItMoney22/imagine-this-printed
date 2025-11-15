import { useState } from 'react'
import { Link } from 'react-router-dom'
import DesignStudioModal from './DesignStudioModal'

export function Hero() {
  const [showDesignModal, setShowDesignModal] = useState(false)

  return (
    <>
      <section className="relative overflow-hidden">
        {/* Gradient Background */}
        <div className="neon-gradient dark:neon-gradient light:neon-gradient-light">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-24 sm:py-32 lg:py-40">
            <div className="text-center relative z-10">
              {/* Main Heading */}
              <h1 className="font-display text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-extrabold text-white text-glow tracking-tight">
                Imagine This Printed
              </h1>

              {/* Subheading */}
              <p className="mt-6 max-w-2xl mx-auto text-base sm:text-lg md:text-xl text-white/90 font-medium">
                Transform your creative vision into reality with custom DTF transfers,
                premium apparel, and cutting-edge 3D printing solutions.
              </p>

              {/* CTA Buttons */}
              <div className="mt-10 flex flex-col sm:flex-row justify-center gap-4">
                <Link
                  to="/products"
                  className="group relative px-8 py-4 bg-white dark:bg-text text-bg rounded-2xl font-bold text-lg shadow-glowLg hover:scale-[1.02] transition-all duration-300"
                >
                  <span className="relative z-10">Shop Products</span>
                  <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-primary to-secondary opacity-0 group-hover:opacity-20 transition-opacity"></div>
                </Link>

                <button
                  onClick={() => setShowDesignModal(true)}
                  className="px-8 py-4 border-2 border-white/30 dark:border-white/30 text-white rounded-2xl font-semibold text-lg hover:bg-white/10 dark:hover:bg-white/10 shadow-glowSm transition-all duration-300 backdrop-blur-sm"
                >
                  Create Design
                </button>
              </div>

            {/* Feature Pills */}
            <div className="mt-12 flex flex-wrap justify-center gap-3">
              <div className="px-4 py-2 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-white text-sm font-medium">
                ⚡ Same-Day Printing
              </div>
              <div className="px-4 py-2 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-white text-sm font-medium">
                🎨 Custom Designs
              </div>
              <div className="px-4 py-2 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-white text-sm font-medium">
                🚀 Fast Shipping
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Circuit Pattern Overlay */}
      <img
        src="/assets/bg/bg-circuit.svg"
        alt=""
        aria-hidden="true"
        className="absolute inset-0 w-full h-full object-cover mix-blend-overlay opacity-20 pointer-events-none text-white dark:text-purple-300"
      />
    </section>

    <DesignStudioModal
      isOpen={showDesignModal}
      onClose={() => setShowDesignModal(false)}
    />
    </>
  )
}

