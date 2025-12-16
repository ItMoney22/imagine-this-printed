import React from 'react'
import { Upload, Sparkles, Wand2, Plus } from 'lucide-react'
import SheetPresets from './SheetPresets'
import LayersPanel from './LayersPanel'
import ITCBalance from './ITCBalance'
import SaveStatus from './SaveStatus'
import AddElementPanel from './AddElementPanel'
import type { Sheet, Layer, Pricing, FreeTrials } from '../../types'

interface LeftSidebarProps {
  sheet: Sheet
  layers: Layer[]
  setLayers: (layers: Layer[]) => void
  pricing: Pricing
  freeTrials: FreeTrials
  itcBalance: number
  isProcessing: boolean
  setIsProcessing: (processing: boolean) => void
  onLayerAdded: (layer: Layer) => void
  onSheetChange?: (sheet: Sheet) => void
  saveStatus?: 'saved' | 'saving' | 'unsaved' | 'offline' | 'error'
  lastSaved?: Date
}

export default function LeftSidebar({
  sheet,
  layers,
  setLayers,
  pricing,
  freeTrials,
  itcBalance,
  isProcessing,
  setIsProcessing,
  onLayerAdded,
  onSheetChange,
  saveStatus = 'saved',
  lastSaved
}: LeftSidebarProps) {
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [showAddElementPanel, setShowAddElementPanel] = React.useState(false)

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    setIsProcessing(true)

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const reader = new FileReader()

        reader.onload = (event) => {
          const img = new Image()
          img.onload = () => {
            const newLayer: Layer = {
              id: `layer-${Date.now()}-${i}`,
              type: 'image',
              name: file.name,
              visible: true,
              thumbnail: event.target?.result as string,
              x: 50,
              y: 50,
              width: img.width,
              height: img.height,
              rotation: 0,
              opacity: 1,
              zIndex: layers.length,
              imageUrl: event.target?.result as string
            }
            onLayerAdded(newLayer)
          }
          img.src = event.target?.result as string
        }

        reader.readAsDataURL(file)
      }
    } catch (error) {
      console.error('Error uploading files:', error)
    } finally {
      setIsProcessing(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleMrImagine = () => {
    // TODO: Open Mr. Imagine modal
    console.log('Mr. Imagine clicked')
  }

  const handleITPEnhance = () => {
    // TODO: Open ITP Enhance modal
    console.log('ITP Enhance clicked')
  }

  const handleAddElement = (element: Layer) => {
    onLayerAdded(element)
  }

  return (
    <>
      {showAddElementPanel && (
        <AddElementPanel
          onAddElement={handleAddElement}
          onClose={() => setShowAddElementPanel(false)}
        />
      )}
    <aside className="w-72 bg-card border-r border-primary/20 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-primary/20">
        <h2 className="text-lg font-semibold text-text">Design Tools</h2>
        <SaveStatus status={saveStatus} lastSaved={lastSaved} />
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Sheet Presets */}
        <div className="p-4 border-b border-primary/20">
          <SheetPresets sheet={sheet} onSheetChange={onSheetChange} />
        </div>

        {/* Upload & Add Element Buttons */}
        <div className="p-4 border-b border-primary/20 space-y-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            onClick={handleUploadClick}
            disabled={isProcessing}
            className="w-full px-4 py-3 bg-primary/10 hover:bg-primary/20 border border-primary/30 rounded-lg text-text font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Upload className="w-5 h-5" />
            Upload Image
          </button>

          <button
            onClick={() => setShowAddElementPanel(true)}
            disabled={isProcessing}
            className="w-full px-4 py-3 bg-secondary/10 hover:bg-secondary/20 border border-secondary/30 rounded-lg text-text font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="w-5 h-5" />
            Add Element
          </button>
        </div>

        {/* AI Tools */}
        <div className="p-4 border-b border-primary/20 space-y-3">
          <h3 className="text-sm font-semibold text-text mb-2">AI Tools</h3>

          {/* Mr. Imagine */}
          <button
            onClick={handleMrImagine}
            disabled={isProcessing}
            className="w-full px-4 py-3 bg-gradient-to-r from-purple-500/10 to-pink-500/10 hover:from-purple-500/20 hover:to-pink-500/20 border border-purple-500/30 rounded-lg text-text font-medium flex items-center justify-between gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-purple-400" />
              <span>Mr. Imagine</span>
            </div>
            {freeTrials.aiGeneration > 0 && (
              <span className="text-xs px-2 py-0.5 bg-purple-500/20 rounded-full text-purple-300">
                {freeTrials.aiGeneration} free
              </span>
            )}
          </button>

          {/* ITP Enhance */}
          <button
            onClick={handleITPEnhance}
            disabled={isProcessing}
            className="w-full px-4 py-3 bg-gradient-to-r from-yellow-500/10 to-orange-500/10 hover:from-yellow-500/20 hover:to-orange-500/20 border border-yellow-500/30 rounded-lg text-text font-medium flex items-center justify-between gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="flex items-center gap-2">
              <Wand2 className="w-5 h-5 text-yellow-400" />
              <span>ITP Enhance</span>
            </div>
            {(freeTrials.removeBackground > 0 || freeTrials.upscale > 0 || freeTrials.enhance > 0) && (
              <span className="text-xs px-2 py-0.5 bg-yellow-500/20 rounded-full text-yellow-300">
                {freeTrials.removeBackground + freeTrials.upscale + freeTrials.enhance} free
              </span>
            )}
          </button>
        </div>

        {/* Layers Panel */}
        <div className="p-4">
          <LayersPanel
            layers={layers}
            setLayers={setLayers}
          />
        </div>
      </div>

      {/* Footer - ITC Balance */}
      <div className="p-4 border-t border-primary/20 bg-card/50">
        <ITCBalance balance={itcBalance} />
      </div>
    </aside>
    </>
  )
}
