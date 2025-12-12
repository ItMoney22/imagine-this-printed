import React, { useState } from 'react'
import { Square, Circle, Star, Triangle, Minus, ArrowRight, Type, Image as ImageIcon, X } from 'lucide-react'
import type { Layer } from '../../types'

interface AddElementPanelProps {
  onAddElement: (element: Layer) => void
  onClose: () => void
}

// Basic clipart library
const CLIPART_LIBRARY = [
  { id: 'star', emoji: '⭐', name: 'Star' },
  { id: 'heart', emoji: '❤️', name: 'Heart' },
  { id: 'fire', emoji: '🔥', name: 'Fire' },
  { id: 'lightning', emoji: '⚡', name: 'Lightning' },
  { id: 'sparkles', emoji: '✨', name: 'Sparkles' },
  { id: 'sun', emoji: '☀️', name: 'Sun' },
  { id: 'moon', emoji: '🌙', name: 'Moon' },
  { id: 'cloud', emoji: '☁️', name: 'Cloud' },
  { id: 'rainbow', emoji: '🌈', name: 'Rainbow' },
  { id: 'flower', emoji: '🌸', name: 'Flower' },
  { id: 'tree', emoji: '🌲', name: 'Tree' },
  { id: 'music', emoji: '🎵', name: 'Music' },
  { id: 'peace', emoji: '☮️', name: 'Peace' },
  { id: 'check', emoji: '✓', name: 'Check' },
  { id: 'cross', emoji: '✕', name: 'Cross' },
]

export default function AddElementPanel({ onAddElement, onClose }: AddElementPanelProps) {
  const [activeTab, setActiveTab] = useState<'shapes' | 'text' | 'lines' | 'clipart'>('shapes')
  const [textInput, setTextInput] = useState('')
  const [fontFamily, setFontFamily] = useState('Arial')
  const [fontSize, setFontSize] = useState(48)

  // Create a shape layer
  const createShape = (shapeType: 'rectangle' | 'circle' | 'star' | 'triangle') => {
    const baseLayer: Layer = {
      id: `shape-${Date.now()}`,
      type: 'shape',
      name: `${shapeType.charAt(0).toUpperCase() + shapeType.slice(1)}`,
      visible: true,
      locked: false,
      x: 100,
      y: 100,
      width: 200,
      height: 200,
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      fill: '#8B5CF6', // Purple fill
      stroke: '#7C3AED', // Darker purple stroke
      strokeWidth: 2,
    }

    // Add shape-specific metadata
    const layer = {
      ...baseLayer,
      // Store shape type in metadata through the name for now
      // We'll use Konva's shape rendering based on the name
      metadata: { shapeType }
    } as Layer

    onAddElement(layer)
    onClose()
  }

  // Create a line/arrow layer
  const createLine = (isArrow: boolean = false) => {
    const layer: Layer = {
      id: `line-${Date.now()}`,
      type: 'shape',
      name: isArrow ? 'Arrow' : 'Line',
      visible: true,
      locked: false,
      x: 100,
      y: 100,
      width: 200,
      height: 0,
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      stroke: '#8B5CF6',
      strokeWidth: 4,
      metadata: { shapeType: 'line', isArrow }
    } as Layer

    onAddElement(layer)
    onClose()
  }

  // Create a text layer
  const createText = () => {
    if (!textInput.trim()) return

    const layer: Layer = {
      id: `text-${Date.now()}`,
      type: 'text',
      name: textInput.substring(0, 20) + (textInput.length > 20 ? '...' : ''),
      visible: true,
      locked: false,
      x: 100,
      y: 100,
      width: 400,
      height: fontSize * 1.5,
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      text: textInput,
      fontSize,
      fontFamily,
      color: '#000000',
    }

    onAddElement(layer)
    setTextInput('')
    onClose()
  }

  // Create a clipart (emoji) layer
  const createClipart = (emoji: string, name: string) => {
    // We'll render emojis as text but with a special marker
    const layer: Layer = {
      id: `clipart-${Date.now()}`,
      type: 'text',
      name: `Clipart: ${name}`,
      visible: true,
      locked: false,
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      text: emoji,
      fontSize: 72,
      fontFamily: 'Arial',
      color: '#000000',
      metadata: { isClipart: true }
    } as Layer

    onAddElement(layer)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border border-primary/30 rounded-lg shadow-xl w-[600px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-primary/20">
          <h2 className="text-xl font-semibold text-text">Add Element</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-primary/10 rounded transition-colors"
          >
            <X className="w-5 h-5 text-muted" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-primary/20">
          {[
            { id: 'shapes', label: 'Shapes', icon: Square },
            { id: 'text', label: 'Text', icon: Type },
            { id: 'lines', label: 'Lines', icon: Minus },
            { id: 'clipart', label: 'Clipart', icon: ImageIcon },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id as any)}
              className={`flex-1 px-4 py-3 flex items-center justify-center gap-2 transition-colors ${
                activeTab === id
                  ? 'bg-primary/10 text-primary border-b-2 border-primary'
                  : 'text-muted hover:bg-primary/5'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Shapes Tab */}
          {activeTab === 'shapes' && (
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => createShape('rectangle')}
                className="p-6 border-2 border-primary/20 rounded-lg hover:border-primary/50 hover:bg-primary/5 transition-all flex flex-col items-center gap-3"
              >
                <Square className="w-12 h-12 text-primary" />
                <span className="font-medium text-text">Rectangle</span>
              </button>

              <button
                onClick={() => createShape('circle')}
                className="p-6 border-2 border-primary/20 rounded-lg hover:border-primary/50 hover:bg-primary/5 transition-all flex flex-col items-center gap-3"
              >
                <Circle className="w-12 h-12 text-primary" />
                <span className="font-medium text-text">Circle</span>
              </button>

              <button
                onClick={() => createShape('triangle')}
                className="p-6 border-2 border-primary/20 rounded-lg hover:border-primary/50 hover:bg-primary/5 transition-all flex flex-col items-center gap-3"
              >
                <Triangle className="w-12 h-12 text-primary" />
                <span className="font-medium text-text">Triangle</span>
              </button>

              <button
                onClick={() => createShape('star')}
                className="p-6 border-2 border-primary/20 rounded-lg hover:border-primary/50 hover:bg-primary/5 transition-all flex flex-col items-center gap-3"
              >
                <Star className="w-12 h-12 text-primary" />
                <span className="font-medium text-text">Star</span>
              </button>
            </div>
          )}

          {/* Text Tab */}
          {activeTab === 'text' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text mb-2">
                  Text Content
                </label>
                <textarea
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder="Enter your text..."
                  className="w-full px-4 py-3 bg-bg border border-primary/20 rounded-lg text-text placeholder-muted focus:outline-none focus:border-primary/50 resize-none"
                  rows={3}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text mb-2">
                  Font Family
                </label>
                <select
                  value={fontFamily}
                  onChange={(e) => setFontFamily(e.target.value)}
                  className="w-full px-4 py-2 bg-bg border border-primary/20 rounded-lg text-text focus:outline-none focus:border-primary/50"
                >
                  <option value="Arial">Arial</option>
                  <option value="Helvetica">Helvetica</option>
                  <option value="Times New Roman">Times New Roman</option>
                  <option value="Georgia">Georgia</option>
                  <option value="Courier New">Courier New</option>
                  <option value="Verdana">Verdana</option>
                  <option value="Impact">Impact</option>
                  <option value="Comic Sans MS">Comic Sans MS</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-text mb-2">
                  Font Size: {fontSize}px
                </label>
                <input
                  type="range"
                  min="12"
                  max="144"
                  value={fontSize}
                  onChange={(e) => setFontSize(parseInt(e.target.value))}
                  className="w-full"
                />
              </div>

              <button
                onClick={createText}
                disabled={!textInput.trim()}
                className="w-full px-6 py-3 bg-primary hover:bg-primary/80 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add Text
              </button>
            </div>
          )}

          {/* Lines Tab */}
          {activeTab === 'lines' && (
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => createLine(false)}
                className="p-6 border-2 border-primary/20 rounded-lg hover:border-primary/50 hover:bg-primary/5 transition-all flex flex-col items-center gap-3"
              >
                <Minus className="w-12 h-12 text-primary" />
                <span className="font-medium text-text">Line</span>
              </button>

              <button
                onClick={() => createLine(true)}
                className="p-6 border-2 border-primary/20 rounded-lg hover:border-primary/50 hover:bg-primary/5 transition-all flex flex-col items-center gap-3"
              >
                <ArrowRight className="w-12 h-12 text-primary" />
                <span className="font-medium text-text">Arrow</span>
              </button>
            </div>
          )}

          {/* Clipart Tab */}
          {activeTab === 'clipart' && (
            <div className="grid grid-cols-5 gap-3">
              {CLIPART_LIBRARY.map((clip) => (
                <button
                  key={clip.id}
                  onClick={() => createClipart(clip.emoji, clip.name)}
                  className="aspect-square p-4 border-2 border-primary/20 rounded-lg hover:border-primary/50 hover:bg-primary/5 transition-all flex flex-col items-center justify-center gap-1"
                  title={clip.name}
                >
                  <span className="text-3xl">{clip.emoji}</span>
                  <span className="text-xs text-muted">{clip.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
