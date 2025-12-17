
import React from 'react'
import { ChevronDown, FileText } from 'lucide-react'
import type { Sheet } from '../../types'

interface SheetPresetsProps {
  sheet: Sheet
  onSheetChange?: (sheet: Sheet) => void
  presets?: any
}

const PRINT_TYPE_ICONS: Record<string, string> = {
  dtf: '🎨',
  uv_dtf: '✨',
  sublimation: '🌈'
}

const PRINT_TYPE_LABELS: Record<string, string> = {
  dtf: 'DTF',
  uv_dtf: 'UV DTF',
  sublimation: 'Sublimation'
}

export default function SheetPresets({ sheet, onSheetChange, presets }: SheetPresetsProps) {
  const [isOpen, setIsOpen] = React.useState(false)
  const dropdownRef = React.useRef<HTMLDivElement>(null)

  // Derive available options from presets
  const currentPresetConfig = presets ? presets[sheet.printType] : null
  const availableOptions = React.useMemo(() => {
    if (!currentPresetConfig) return []
    return currentPresetConfig.heights.map((h: number) => ({
      width: currentPresetConfig.width,
      height: h,
      label: `${currentPresetConfig.width}" x ${h}"`
    }))
  }, [currentPresetConfig])

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handlePresetChange = (option: { width: number; height: number; label: string }) => {
    if (onSheetChange) {
      onSheetChange({
        ...sheet,
        width: option.width,
        height: option.height,
        name: `${sheet.name.split(' - ')[0]} - ${option.label}`
      })
    }
    setIsOpen(false)
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-text">Sheet Configuration</h3>

      {/* Print Type Display */}
      <div className="flex items-center gap-3 p-3 bg-bg/50 rounded-lg border border-primary/10">
        <FileText className="w-5 h-5 text-primary" />
        <div className="flex-1">
          <div className="text-xs text-muted">Print Type</div>
          <div className="text-sm font-medium text-text flex items-center gap-1">
            <span>{PRINT_TYPE_ICONS[sheet.printType] || '🖨️'}</span>
            {PRINT_TYPE_LABELS[sheet.printType] || sheet.printType}
          </div>
        </div>
      </div>

      {/* Sheet Size Selector */}
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          disabled={!currentPresetConfig}
          className="w-full flex items-center justify-between gap-2 p-3 bg-bg/50 hover:bg-bg/70 rounded-lg border border-primary/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div className="flex-1 text-left">
            <div className="text-xs text-muted">Sheet Size</div>
            <div className="text-sm font-medium text-text">
              {sheet.width}" × {sheet.height}"
            </div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {/* Dropdown */}
        {isOpen && availableOptions.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-primary/20 rounded-lg shadow-lg z-10 overflow-hidden max-h-60 overflow-y-auto">
            {availableOptions.map((option: any) => (
              <button
                key={option.label}
                onClick={() => handlePresetChange(option)}
                className={`w-full px-3 py-2 text-left hover:bg-primary/10 transition-colors ${sheet.width === option.width && sheet.height === option.height
                    ? 'bg-primary/20 text-primary'
                    : 'text-text'
                  }`}
              >
                <div className="text-sm font-medium">{option.label}</div>
                <div className="text-xs text-muted">
                  {option.width * option.height} sq in
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Sheet Info */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="p-2 bg-bg/30 rounded border border-primary/10">
          <div className="text-muted flex items-center gap-1">
            Width
            <span className="text-[10px] bg-primary/20 px-1 rounded" title="Width is fixed for this print type">FIXED</span>
          </div>
          <div className="text-text font-medium">{sheet.width}"</div>
        </div>
        <div className="p-2 bg-bg/30 rounded border border-primary/10">
          <div className="text-muted">Height</div>
          <div className="text-text font-medium">{sheet.height}"</div>
        </div>
      </div>
    </div>
  )
}
