import { useState } from 'react'
import {
  Box,
  CheckCircle,
  Clock,
  Download,
  Eye,
  Loader2,
  RotateCw,
  ShoppingCart,
  Trash2,
  XCircle,
  Zap
} from 'lucide-react'
import type { User3DModel, Model3DStatus } from '../../types'
import api from '../../lib/api'

interface Model3DCardProps {
  model: User3DModel
  onView: (model: User3DModel) => void
  onRefresh: () => void
}

const STATUS_CONFIG: Record<Model3DStatus, {
  label: string
  color: string
  bgColor: string
  icon: React.ComponentType<{ className?: string }>
}> = {
  queued: {
    label: 'Queued',
    color: 'text-gray-400',
    bgColor: 'bg-gray-500/20',
    icon: Clock
  },
  generating_concept: {
    label: 'Generating Concept',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/20',
    icon: Loader2
  },
  awaiting_approval: {
    label: 'Awaiting Approval',
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/20',
    icon: Eye
  },
  generating_angles: {
    label: 'Generating Views',
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/20',
    icon: Loader2
  },
  generating_3d: {
    label: 'Creating 3D Model',
    color: 'text-pink-400',
    bgColor: 'bg-pink-500/20',
    icon: Loader2
  },
  ready: {
    label: 'Ready',
    color: 'text-green-400',
    bgColor: 'bg-green-500/20',
    icon: CheckCircle
  },
  failed: {
    label: 'Failed',
    color: 'text-red-400',
    bgColor: 'bg-red-500/20',
    icon: XCircle
  }
}

const STYLE_LABELS: Record<string, string> = {
  realistic: 'Realistic',
  cartoon: 'Cartoon',
  low_poly: 'Low Poly',
  anime: 'Anime'
}

export function Model3DCard({ model, onView, onRefresh }: Model3DCardProps) {
  const [isApproving, setIsApproving] = useState(false)
  const [isGenerating3D, setIsGenerating3D] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const statusConfig = STATUS_CONFIG[model.status]
  const StatusIcon = statusConfig.icon
  const isProcessing = ['generating_concept', 'generating_angles', 'generating_3d'].includes(model.status)

  const handleApprove = async () => {
    setIsApproving(true)
    try {
      await api.post(`/3d-models/${model.id}/approve`)
      onRefresh()
    } catch (err) {
      console.error('Failed to approve:', err)
    } finally {
      setIsApproving(false)
    }
  }

  const handleGenerate3D = async () => {
    setIsGenerating3D(true)
    try {
      await api.post(`/3d-models/${model.id}/generate-3d`)
      onRefresh()
    } catch (err) {
      console.error('Failed to start 3D generation:', err)
    } finally {
      setIsGenerating3D(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Delete this 3D model? This cannot be undone.')) return
    setIsDeleting(true)
    try {
      await api.delete(`/3d-models/${model.id}`)
      onRefresh()
    } catch (err) {
      console.error('Failed to delete:', err)
    } finally {
      setIsDeleting(false)
    }
  }

  // Check if we have all angles for "Generate 3D" button
  const hasAllAngles = model.angle_images?.front && model.angle_images?.back &&
                       model.angle_images?.left && model.angle_images?.right

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden hover:border-purple-500/50 transition-all group">
      {/* Image Preview */}
      <div className="relative aspect-square bg-bg">
        {model.concept_image_url ? (
          <img
            src={model.concept_image_url}
            alt={model.prompt}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Box className="w-12 h-12 text-muted" />
          </div>
        )}

        {/* Status Badge */}
        <div className={`absolute top-2 left-2 px-2 py-1 rounded-lg ${statusConfig.bgColor} flex items-center gap-1.5`}>
          <StatusIcon className={`w-3.5 h-3.5 ${statusConfig.color} ${isProcessing ? 'animate-spin' : ''}`} />
          <span className={`text-xs font-medium ${statusConfig.color}`}>
            {statusConfig.label}
          </span>
        </div>

        {/* Style Badge */}
        <div className="absolute top-2 right-2 px-2 py-1 rounded-lg bg-black/60 backdrop-blur-sm">
          <span className="text-xs text-white/80">
            {STYLE_LABELS[model.style]}
          </span>
        </div>

        {/* Hover Actions Overlay */}
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          <button
            onClick={() => onView(model)}
            className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
            title="View Details"
          >
            <Eye className="w-5 h-5" />
          </button>
          {model.status === 'ready' && (
            <button
              onClick={() => window.open(model.glb_url || '', '_blank')}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
              title="Download GLB"
            >
              <Download className="w-5 h-5" />
            </button>
          )}
          {!isProcessing && (
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className="p-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400 transition-colors"
              title="Delete"
            >
              {isDeleting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 className="w-5 h-5" />}
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        <p className="text-text font-medium text-sm line-clamp-2 mb-2">
          {model.prompt}
        </p>

        <div className="flex items-center justify-between text-xs text-muted mb-3">
          <span>{new Date(model.created_at).toLocaleDateString()}</span>
          <span>{model.itc_charged} ITC used</span>
        </div>

        {/* Action Buttons based on status */}
        {model.status === 'awaiting_approval' && (
          <button
            onClick={handleApprove}
            disabled={isApproving}
            className="w-full py-2 px-4 rounded-lg bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white font-medium text-sm flex items-center justify-center gap-2 transition-all"
          >
            {isApproving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Approving...</span>
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4" />
                <span>Approve & Continue</span>
              </>
            )}
          </button>
        )}

        {hasAllAngles && model.status !== 'generating_3d' && model.status !== 'ready' && (
          <button
            onClick={handleGenerate3D}
            disabled={isGenerating3D}
            className="w-full py-2 px-4 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-medium text-sm flex items-center justify-center gap-2 transition-all"
          >
            {isGenerating3D ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Starting...</span>
              </>
            ) : (
              <>
                <Zap className="w-4 h-4" />
                <span>Generate 3D Model</span>
              </>
            )}
          </button>
        )}

        {model.status === 'ready' && (
          <div className="flex gap-2">
            <button
              onClick={() => onView(model)}
              className="flex-1 py-2 px-3 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 font-medium text-sm flex items-center justify-center gap-1.5 transition-all"
            >
              <Eye className="w-4 h-4" />
              <span>View</span>
            </button>
            <button
              onClick={() => onView(model)}
              className="flex-1 py-2 px-3 rounded-lg bg-green-500/20 hover:bg-green-500/30 text-green-400 font-medium text-sm flex items-center justify-center gap-1.5 transition-all"
            >
              <ShoppingCart className="w-4 h-4" />
              <span>Order Print</span>
            </button>
          </div>
        )}

        {model.status === 'failed' && (
          <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20">
            <p className="text-xs text-red-400 line-clamp-2">
              {model.error_message || 'Generation failed. Please try again.'}
            </p>
          </div>
        )}

        {isProcessing && (
          <div className="flex items-center justify-center gap-2 text-muted text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Processing...</span>
          </div>
        )}
      </div>
    </div>
  )
}

export default Model3DCard
