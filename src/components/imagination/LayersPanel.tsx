import React from 'react'
import { Eye, EyeOff, Trash2, Image, Sparkles, Type, GripVertical, Square } from 'lucide-react'
import type { Layer } from '../../types'

interface LayersPanelProps {
  layers: Layer[]
  setLayers: (layers: Layer[]) => void
  selectedLayerId?: string
  onLayerSelect?: (layerId: string) => void
}

const LAYER_TYPE_ICONS: Record<string, typeof Image> = {
  image: Image,
  ai_generated: Sparkles,
  text: Type,
  shape: Square
}

const LAYER_TYPE_COLORS: Record<string, string> = {
  image: 'text-blue-400',
  ai_generated: 'text-purple-400',
  text: 'text-green-400',
  shape: 'text-orange-400'
}

export default function LayersPanel({
  layers,
  setLayers,
  selectedLayerId,
  onLayerSelect
}: LayersPanelProps) {
  const [draggedIndex, setDraggedIndex] = React.useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = React.useState<number | null>(null)

  const handleToggleVisibility = (layerId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setLayers(
      layers.map(layer =>
        layer.id === layerId ? { ...layer, visible: !layer.visible } : layer
      )
    )
  }

  const handleDeleteLayer = (layerId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setLayers(layers.filter(layer => layer.id !== layerId))
  }

  const handleLayerClick = (layerId: string) => {
    if (onLayerSelect) {
      onLayerSelect(layerId)
    }
  }

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    setDragOverIndex(index)
  }

  const handleDragEnd = () => {
    if (draggedIndex !== null && dragOverIndex !== null && draggedIndex !== dragOverIndex) {
      const newLayers = [...layers]
      const [movedLayer] = newLayers.splice(draggedIndex, 1)
      newLayers.splice(dragOverIndex, 0, movedLayer)

      // Update zIndex based on new order
      const updatedLayers = newLayers.map((layer, index) => ({
        ...layer,
        zIndex: newLayers.length - index - 1
      }))

      setLayers(updatedLayers)
    }
    setDraggedIndex(null)
    setDragOverIndex(null)
  }

  const handleDragLeave = () => {
    setDragOverIndex(null)
  }

  // Sort layers by zIndex (highest first)
  const sortedLayers = [...layers].sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0))

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-text">Layers</h3>
        <span className="text-xs text-muted">{layers.length} layer{layers.length !== 1 ? 's' : ''}</span>
      </div>

      {layers.length === 0 ? (
        <div className="p-8 text-center">
          <Image className="w-12 h-12 mx-auto text-muted/30 mb-2" />
          <p className="text-sm text-muted">No layers yet</p>
          <p className="text-xs text-muted/70 mt-1">Upload or create an image to get started</p>
        </div>
      ) : (
        <div className="space-y-1">
          {sortedLayers.map((layer, index) => {
            const Icon = LAYER_TYPE_ICONS[layer.type] || Image
            const iconColor = LAYER_TYPE_COLORS[layer.type] || 'text-gray-400'
            const isSelected = selectedLayerId === layer.id
            const isDragging = draggedIndex === index
            const isDragOver = dragOverIndex === index

            return (
              <div
                key={layer.id}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                onDragLeave={handleDragLeave}
                onClick={() => handleLayerClick(layer.id)}
                className={`
                  group relative flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-all
                  ${isSelected
                    ? 'bg-primary/20 border-primary/50'
                    : 'bg-bg/30 border-primary/10 hover:bg-bg/50 hover:border-primary/20'
                  }
                  ${isDragging ? 'opacity-50' : ''}
                  ${isDragOver ? 'border-primary border-t-2' : ''}
                `}
              >
                {/* Drag Handle */}
                <div className="cursor-grab active:cursor-grabbing text-muted/50 group-hover:text-muted">
                  <GripVertical className="w-4 h-4" />
                </div>

                {/* Thumbnail */}
                <div className="w-10 h-10 rounded bg-bg/50 border border-primary/10 flex items-center justify-center overflow-hidden flex-shrink-0">
                  {layer.thumbnail ? (
                    <img
                      src={layer.thumbnail}
                      alt={layer.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Icon className={`w-5 h-5 ${iconColor}`} />
                  )}
                </div>

                {/* Layer Info */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-text truncate">
                    {layer.name}
                  </div>
                  <div className="text-xs text-muted flex items-center gap-1">
                    <Icon className={`w-3 h-3 ${iconColor}`} />
                    {layer.type.replace('_', ' ')}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => handleToggleVisibility(layer.id, e)}
                    className="p-1 hover:bg-bg/50 rounded transition-colors"
                    title={layer.visible ? 'Hide layer' : 'Show layer'}
                  >
                    {layer.visible ? (
                      <Eye className="w-4 h-4 text-text" />
                    ) : (
                      <EyeOff className="w-4 h-4 text-muted" />
                    )}
                  </button>
                  <button
                    onClick={(e) => handleDeleteLayer(layer.id, e)}
                    className="p-1 hover:bg-red-500/20 rounded transition-colors"
                    title="Delete layer"
                  >
                    <Trash2 className="w-4 h-4 text-red-400" />
                  </button>
                </div>

                {/* Layer Order Indicator */}
                <div className="absolute -left-1 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-primary/30 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
