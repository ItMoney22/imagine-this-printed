import React from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
import AdminCreateProductWizard from '../components/AdminCreateProductWizard'

const AdminAIProductBuilder: React.FC = () => {
  const { user } = useAuth()

  // Check if user is admin or manager
  if (!user || (user.role !== 'admin' && user.role !== 'manager')) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">
            Access denied. This page is for administrators and managers only.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-text mb-2">AI Product Builder</h1>
        <p className="text-muted">
          Create products using AI. Describe your product idea, and our AI will generate product
          images, mockups, and all necessary metadata.
        </p>
      </div>

      <AdminCreateProductWizard />
    </div>
  )
}

export default AdminAIProductBuilder

