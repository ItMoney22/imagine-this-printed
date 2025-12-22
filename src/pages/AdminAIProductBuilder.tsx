import React from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
import AdminCreateProductWizard from '../components/AdminCreateProductWizard'

const AdminAIProductBuilder: React.FC = () => {
  const { user } = useAuth()

  // Check if user is admin or manager
  if (!user || (user.role !== 'admin' && user.role !== 'manager')) {
    return (
      <div className="min-h-screen bg-bg text-text py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-8 backdrop-blur-sm">
            <div className="flex items-center space-x-3 text-red-400">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <p className="text-lg font-medium">
                Access denied. This page is for administrators and managers only.
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg text-text py-8">
      {/* Background Elements */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-[128px] opacity-50 mix-blend-screen animate-pulse-slow" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-secondary/20 rounded-full blur-[128px] opacity-50 mix-blend-screen animate-pulse-slow delay-1000" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header Section */}
        <div className="mb-12 text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-4 bg-clip-text text-transparent bg-gradient-to-r from-primary via-purple-400 to-secondary drop-shadow-[0_0_15px_rgba(168,85,247,0.5)]">
            AI Product Builder
          </h1>
          <p className="text-xl text-muted max-w-2xl mx-auto">
            Create stunning products with the power of AI. Describe your vision, and we'll generate the artwork, mockups, and metadata instantly.
          </p>
        </div>

        {/* Main Content */}
        <div className="bg-card/30 backdrop-blur-md border border-white/10 rounded-3xl p-1 shadow-2xl ring-1 ring-white/5">
          <div className="bg-bg/50 rounded-[20px] p-6 md:p-8">
            <AdminCreateProductWizard />
          </div>
        </div>
      </div>
    </div>
  )
}

export default AdminAIProductBuilder

