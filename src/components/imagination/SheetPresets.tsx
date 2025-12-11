import React from 'react'
import { ChevronDown, FileText } from 'lucide-react'
import type { Sheet, PrintType } from '../../types'

interface SheetPresetsProps {
  sheet: Sheet
  onSheetChange?: (sheet: Sheet) => void
}

const SHEET_PRESETS: Record<string, { width: number; height: number; label: string }[]> = {
  dtf: [
    { width: 13, height: 16, label: '13" x 16"' },
    { width: 13, height: 19, label: '13" x 19"' },
    { width: 22, height: 60, label: '22" x 60"' }
  ],
  uv_dtf: [
    { width: 8.5, height: 11, label: '8.5" x 11"' },
    { width: 11, height: 17, label: '11" x 17"' }
  ],
  sublimation: [
    { width: 8.5, height: 11, label: '8.5" x 11"' },
    { width: 11, height: 17, label: '11" x 17"' },
    { width: 13, height: 19, label: '13" x 19"' }
  ]
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

export default function SheetPresets({ sheet, onSheetChange }: SheetPresetsProps) {
  const [isOpen, setIsOpen] = React.useState(false)
  const dropdownRef = React.useRef<HTMLDivElement>(null)

  const presets = SHEET_PRESETS[sheet.printType] || SHEET_PRESETS.dtf

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handlePresetChange = (preset: { width: number; height: number; label: string }) => {
    if (onSheetChange) {
      onSheetChange({
        ...sheet,
        width: preset.width,
        height: preset.height
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
          className="w-full flex items-center justify-between gap-2 p-3 bg-bg/50 hover:bg-bg/70 rounded-lg border border-primary/10 transition-colors"
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
        {isOpen && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-primary/20 rounded-lg shadow-lg z-10 overflow-hidden">
            {presets.map((preset) => (
              <button
                key={preset.label}
                onClick={() => handlePresetChange(preset)}
                className={`w-full px-3 py-2 text-left hover:bg-primary/10 transition-colors ${
                  sheet.width === preset.width && sheet.height === preset.height
                    ? 'bg-primary/20 text-primary'
                    : 'text-text'
                }`}
              >
                <div className="text-sm font-medium">{preset.label}</div>
                <div className="text-xs text-muted">
                  {preset.width * preset.height} sq in
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Sheet Info */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="p-2 bg-bg/30 rounded border border-primary/10">
          <div className="text-muted">Width</div>
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
