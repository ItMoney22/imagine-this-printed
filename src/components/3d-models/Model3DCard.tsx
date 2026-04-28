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
  awaiting_3d_generation: {
    label: 'Pick size to generate',
    color: 'text-primary',
    bgColor: 'bg-primary/20',
    icon: Zap
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
  const [isDeleting, setIsDeleting] = useState(false)

  const statusConfig = STATUS_CONFIG[model.status]
  const StatusIcon = statusConfig.icon
  const isProcessing = ['generating_concept', 'generating_angles', 'generating_3d'].includes(model.status)

  const handleDelete = async () => {
    if (!confirm('Delete this 3D model? This cannot be undone.')) return
    setIsDeleting(true)
    try {
      await api.delete(`/api/3d-models/${model.id}`)
      onRefresh()
    } catch (err) {
      console.error('Failed to delete:', err)
    } finally {
      setIsDeleting(false)
    }
  }

  // Tripo3D works directly from concept; legacy TRELLIS path needed all 4 angles.
  const hasConcept = !!model.concept_image_url

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

        {/* Size tier badge — only when ready and tier is set */}
        {model.status === 'ready' && model.size_tier && (
          <div className="absolute bottom-2 left-2 px-2 py-1 rounded-lg bg-primary/80 backdrop-blur-sm border border-primary/40">
            <span className="text-[10px] text-white font-bold uppercase tracking-wider">
              {model.size_tier} · {model.print_height_mm}mm
            </span>
          </div>
        )}

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

        {/* Action Buttons based on status — concept-ready states all route to the
            detail modal where the user picks a size + generates in one click. */}
        {hasConcept && (model.status === 'awaiting_approval' || model.status === 'awaiting_3d_generation') && (
          <button
            onClick={() => onView(model)}
            className="w-full py-2 px-4 rounded-lg bg-gradient-to-r from-primary to-secondary hover:from-primary/90 hover:to-secondary/90 text-white font-medium text-sm flex items-center justify-center gap-2 transition-all"
          >
            <Zap className="w-4 h-4" />
            <span>Pick size & generate</span>
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
