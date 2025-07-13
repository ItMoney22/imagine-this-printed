import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import type { ThreeDModel } from '../types'

const ModelGallery: React.FC = () => {
  const { user } = useAuth()
  const [models, setModels] = useState<ThreeDModel[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [newModel, setNewModel] = useState({
    title: '',
    description: '',
    category: 'figurines' as const,
    file: null as File | null
  })

  const categories = [
    { id: 'all', name: 'All Models' },
    { id: 'figurines', name: 'Figurines' },
    { id: 'tools', name: 'Tools' },
    { id: 'decorative', name: 'Decorative' },
    { id: 'functional', name: 'Functional' },
    { id: 'toys', name: 'Toys' }
  ]

  // Mock data - replace with real Supabase queries
  useEffect(() => {
    const mockModels: ThreeDModel[] = [
      {
        id: '1',
        title: 'Dragon Figurine',
        description: 'Detailed fantasy dragon figure perfect for tabletop gaming',
        fileUrl: '/models/dragon.stl',
        previewUrl: 'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=300&h=300&fit=crop',
        category: 'figurines',
        uploadedBy: 'user123',
        approved: true,
        votes: 45,
        points: 150,
        createdAt: '2025-01-08T10:00:00Z',
        fileType: 'stl'
      },
      {
        id: '2',
        title: 'Phone Stand',
        description: 'Adjustable phone stand with multiple viewing angles',
        fileUrl: '/models/phone-stand.stl',
        previewUrl: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=300&h=300&fit=crop',
        category: 'functional',
        uploadedBy: 'user456',
        approved: true,
        votes: 32,
        points: 96,
        createdAt: '2025-01-07T14:30:00Z',
        fileType: 'stl'
      },
      {
        id: '3',
        title: 'Decorative Vase',
        description: 'Modern geometric vase design for home decoration',
        fileUrl: '/models/vase.obj',
        previewUrl: 'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=300&h=300&fit=crop',
        category: 'decorative',
        uploadedBy: user?.id || 'currentUser',
        approved: false,
        votes: 8,
        points: 24,
        createdAt: '2025-01-09T16:45:00Z',
        fileType: 'obj'
      }
    ]
    setModels(mockModels)
  }, [user?.id])

  const filteredModels = selectedCategory === 'all' 
    ? models.filter(m => m.approved)
    : models.filter(m => m.approved && m.category === selectedCategory)

  const handleVote = (modelId: string) => {
    if (!user) {
      alert('Please sign in to vote')
      return
    }

    setModels(prev => prev.map(model => 
      model.id === modelId 
        ? { ...model, votes: model.votes + 1, points: model.points + 3 }
        : model
    ))

    // In real app, update Supabase and award points to uploader
    alert('Vote cast! The creator earned 3 points.')
  }

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!newModel.file) {
      alert('Please select a file')
      return
    }

    // In real app, upload to Supabase Storage
    const model: ThreeDModel = {
      id: Date.now().toString(),
      title: newModel.title,
      description: newModel.description,
      fileUrl: `/models/${newModel.file.name}`,
      category: newModel.category,
      uploadedBy: user?.id || '',
      approved: false,
      votes: 0,
      points: 0,
      createdAt: new Date().toISOString(),
      fileType: newModel.file.name.split('.').pop() as any
    }

    setModels([model, ...models])
    
    // Reset form
    setNewModel({
      title: '',
      description: '',
      category: 'figurines',
      file: null
    })
    
    setShowUploadModal(false)
    alert('Model uploaded and submitted for approval!')
  }

  const downloadModel = (model: ThreeDModel) => {
    // In real app, track download and serve from Supabase Storage
    alert(`Downloading ${model.title}...`)
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">3D Model Gallery</h1>
            <p className="text-gray-600">Discover and download amazing 3D models from our community</p>
          </div>
          <button
            onClick={() => setShowUploadModal(true)}
            className="bg-purple-600 hover:bg-purple-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
          >
            Upload Model
          </button>
        </div>
      </div>

      {/* Categories */}
      <div className="mb-8">
        <div className="flex flex-wrap gap-2">
          {categories.map((category) => (
            <button
              key={category.id}
              onClick={() => setSelectedCategory(category.id)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                selectedCategory === category.id
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {category.name}
            </button>
          ))}
        </div>
      </div>

      {/* Models Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {filteredModels.map((model) => (
          <div key={model.id} className="bg-white rounded-lg shadow-lg overflow-hidden hover:shadow-xl transition-shadow">
            <div className="relative">
              <img 
                src={model.previewUrl || 'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=300&h=300&fit=crop'} 
                alt={model.title}
                className="w-full h-48 object-cover"
              />
              <div className="absolute top-2 right-2">
                <span className="bg-black bg-opacity-75 text-white px-2 py-1 rounded text-xs font-medium">
                  .{model.fileType}
                </span>
              </div>
            </div>
            
            <div className="p-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">{model.title}</h3>
              <p className="text-gray-600 text-sm mb-3 line-clamp-2">{model.description}</p>
              
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-3">
                  <button
                    onClick={() => handleVote(model.id)}
                    className="flex items-center space-x-1 text-gray-600 hover:text-purple-600"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                    </svg>
                    <span className="text-sm">{model.votes}</span>
                  </button>
                  
                  <div className="flex items-center space-x-1 text-yellow-600">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                    </svg>
                    <span className="text-sm">{model.points}</span>
                  </div>
                </div>
                
                <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded">
                  {model.category}
                </span>
              </div>
              
              <div className="flex space-x-2">
                <button
                  onClick={() => downloadModel(model)}
                  className="flex-1 bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium py-2 px-3 rounded transition-colors"
                >
                  Download
                </button>
                <button className="flex-1 bg-gray-600 hover:bg-gray-700 text-white text-sm font-medium py-2 px-3 rounded transition-colors">
                  Preview
                </button>
              </div>
              
              <div className="mt-3 text-xs text-gray-500">
                Uploaded on {new Date(model.createdAt).toLocaleDateString()}
              </div>
            </div>
          </div>
        ))}
      </div>

      {filteredModels.length === 0 && (
        <div className="text-center py-12">
          <svg className="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No models found</h3>
          <p className="text-gray-600">No 3D models available in this category yet.</p>
        </div>
      )}

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-semibold text-gray-900">Upload 3D Model</h3>
              <button
                onClick={() => setShowUploadModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleUpload} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Model Title</label>
                <input
                  type="text"
                  value={newModel.title}
                  onChange={(e) => setNewModel(prev => ({ ...prev, title: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                <textarea
                  value={newModel.description}
                  onChange={(e) => setNewModel(prev => ({ ...prev, description: e.target.value }))}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Category</label>
                <select
                  value={newModel.category}
                  onChange={(e) => setNewModel(prev => ({ ...prev, category: e.target.value as any }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  {categories.slice(1).map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">3D Model File</label>
                <input
                  type="file"
                  accept=".stl,.3mf,.obj,.glb"
                  onChange={(e) => setNewModel(prev => ({ ...prev, file: e.target.files?.[0] || null }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">Supported formats: .stl, .3mf, .obj, .glb</p>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                <div className="flex">
                  <svg className="w-4 h-4 text-blue-600 mr-2 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div className="text-sm text-blue-700">
                    <p className="font-medium">Upload Guidelines:</p>
                    <ul className="mt-1 text-xs">
                      <li>• Models must be original or properly licensed</li>
                      <li>• File size limit: 50MB</li>
                      <li>• Admin approval required before public listing</li>
                    </ul>
                  </div>
                </div>
              </div>

              <div className="flex space-x-3">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-700 font-medium py-2 px-4 rounded transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-purple-600 hover:bg-purple-700 text-white font-medium py-2 px-4 rounded transition-colors"
                >
                  Upload
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default ModelGallery