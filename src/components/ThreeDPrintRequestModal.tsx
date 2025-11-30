import React, { useState } from 'react'

interface ThreeDPrintRequestModalProps {
    isOpen: boolean
    onClose: () => void
    initialModel?: { title: string; fileUrl: string }
}

const ThreeDPrintRequestModal: React.FC<ThreeDPrintRequestModalProps> = ({ isOpen, onClose, initialModel }) => {
    const [activeTab, setActiveTab] = useState<'upload' | 'idea'>(initialModel ? 'upload' : 'upload')
    const [formData, setFormData] = useState({
        material: 'pla',
        color: 'white',
        scale: 100,
        description: '',
        file: null as File | null,
        referenceImage: null as File | null
    })

    if (!isOpen) return null

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        // In a real app, this would send data to the backend
        console.log('Submitting 3D Print Request:', { type: activeTab, ...formData, initialModel })
        alert('Quote request submitted! We will review your request and get back to you shortly.')
        onClose()
    }

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <div className="bg-card rounded-xl shadow-2xl max-w-2xl w-full overflow-hidden border card-border">
                {/* Header */}
                <div className="bg-gradient-to-r from-purple-600 to-indigo-600 p-6 text-white">
                    <div className="flex justify-between items-center">
                        <h2 className="text-2xl font-bold">Request 3D Print</h2>
                        <button onClick={onClose} className="text-white hover:text-gray-200 transition-colors">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                    <p className="opacity-90 mt-2">
                        {initialModel
                            ? `Get a quote for "${initialModel.title}"`
                            : 'Bring your ideas to life with our 3D printing service'}
                    </p>
                </div>

                {/* Tabs */}
                {!initialModel && (
                    <div className="flex border-b card-border">
                        <button
                            className={`flex-1 py-4 text-center font-medium transition-colors ${activeTab === 'upload'
                                    ? 'text-purple-600 border-b-2 border-purple-600 bg-purple-50'
                                    : 'text-muted hover:text-text hover:bg-gray-50'
                                }`}
                            onClick={() => setActiveTab('upload')}
                        >
                            Upload Model (STL/OBJ)
                        </button>
                        <button
                            className={`flex-1 py-4 text-center font-medium transition-colors ${activeTab === 'idea'
                                    ? 'text-purple-600 border-b-2 border-purple-600 bg-purple-50'
                                    : 'text-muted hover:text-text hover:bg-gray-50'
                                }`}
                            onClick={() => setActiveTab('idea')}
                        >
                            I Have an Idea
                        </button>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="p-6 space-y-6">
                    {/* Upload Tab Content */}
                    {activeTab === 'upload' && (
                        <div className="space-y-4">
                            {!initialModel && (
                                <div>
                                    <label className="block text-sm font-medium text-text mb-2">3D Model File</label>
                                    <div className="border-2 border-dashed card-border rounded-lg p-8 text-center hover:border-purple-500 transition-colors bg-gray-50">
                                        <input
                                            type="file"
                                            accept=".stl,.obj,.3mf"
                                            onChange={(e) => setFormData({ ...formData, file: e.target.files?.[0] || null })}
                                            className="hidden"
                                            id="model-upload"
                                        />
                                        <label htmlFor="model-upload" className="cursor-pointer">
                                            <svg className="mx-auto h-12 w-12 text-gray-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                            </svg>
                                            <span className="block text-sm font-medium text-purple-600">Click to upload STL/OBJ</span>
                                            <span className="block text-xs text-muted mt-1">Max size 50MB</span>
                                        </label>
                                        {formData.file && (
                                            <div className="mt-4 p-2 bg-green-50 text-green-700 rounded text-sm flex items-center justify-center">
                                                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                </svg>
                                                {formData.file.name}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-text mb-2">Material</label>
                                    <select
                                        value={formData.material}
                                        onChange={(e) => setFormData({ ...formData, material: e.target.value })}
                                        className="w-full px-3 py-2 border card-border rounded-md focus:ring-2 focus:ring-purple-500 focus:outline-none"
                                    >
                                        <option value="pla">PLA (Standard)</option>
                                        <option value="petg">PETG (Durable)</option>
                                        <option value="tpu">TPU (Flexible)</option>
                                        <option value="resin">Resin (High Detail)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-text mb-2">Color</label>
                                    <select
                                        value={formData.color}
                                        onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                                        className="w-full px-3 py-2 border card-border rounded-md focus:ring-2 focus:ring-purple-500 focus:outline-none"
                                    >
                                        <option value="white">White</option>
                                        <option value="black">Black</option>
                                        <option value="grey">Grey</option>
                                        <option value="red">Red</option>
                                        <option value="blue">Blue</option>
                                        <option value="green">Green</option>
                                        <option value="custom">Custom (Specify in notes)</option>
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-text mb-2">Scale (%)</label>
                                <div className="flex items-center space-x-4">
                                    <input
                                        type="range"
                                        min="10"
                                        max="200"
                                        value={formData.scale}
                                        onChange={(e) => setFormData({ ...formData, scale: parseInt(e.target.value) })}
                                        className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
                                    />
                                    <span className="w-16 text-right font-mono">{formData.scale}%</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Idea Tab Content */}
                    {activeTab === 'idea' && (
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-text mb-2">Describe your idea</label>
                                <textarea
                                    value={formData.description}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                    rows={4}
                                    placeholder="I need a replacement part for my dishwasher..."
                                    className="w-full px-3 py-2 border card-border rounded-md focus:ring-2 focus:ring-purple-500 focus:outline-none"
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-text mb-2">Reference Image (Optional)</label>
                                <input
                                    type="file"
                                    accept="image/*"
                                    onChange={(e) => setFormData({ ...formData, referenceImage: e.target.files?.[0] || null })}
                                    className="w-full px-3 py-2 border card-border rounded-md focus:ring-2 focus:ring-purple-500 focus:outline-none"
                                />
                            </div>
                        </div>
                    )}

                    {/* Common Fields */}
                    <div>
                        <label className="block text-sm font-medium text-text mb-2">Additional Notes</label>
                        <textarea
                            rows={2}
                            className="w-full px-3 py-2 border card-border rounded-md focus:ring-2 focus:ring-purple-500 focus:outline-none"
                            placeholder="Any specific requirements or questions?"
                        />
                    </div>

                    {/* Footer */}
                    <div className="pt-4 border-t card-border flex justify-end space-x-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-medium text-text bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="px-6 py-2 text-sm font-medium text-white bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 rounded-lg shadow-lg hover:shadow-xl transition-all transform hover:-translate-y-0.5"
                        >
                            Request Quote
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}

export default ThreeDPrintRequestModal
