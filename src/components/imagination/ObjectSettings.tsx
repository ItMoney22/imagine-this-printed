import React from 'react';
import type { Layer } from '../../types';
import { Trash2, Copy } from 'lucide-react';

interface ObjectSettingsProps {
  selectedLayers: Layer[];
  layers: Layer[];
  setLayers: (layers: Layer[]) => void;
}

const ObjectSettings: React.FC<ObjectSettingsProps> = ({
  selectedLayers,
  layers,
  setLayers,
}) => {
  if (selectedLayers.length === 0) {
    return null;
  }

  const isMultiSelect = selectedLayers.length > 1;
  const layer = selectedLayers[0];

  const updateLayer = (id: string, updates: Partial<Layer>) => {
    setLayers(layers.map(l => l.id === id ? { ...l, ...updates } : l));
  };

  const deleteSelected = () => {
    const selectedIds = new Set(selectedLayers.map(l => l.id));
    setLayers(layers.filter(l => !selectedIds.has(l.id)));
  };

  const duplicateSelected = () => {
    const newLayers = selectedLayers.map(l => ({
      ...l,
      id: `layer-${Date.now()}-${Math.random()}`,
      name: `${l.name} Copy`,
      x: l.x + 0.25,
      y: l.y + 0.25,
    }));
    setLayers([...layers, ...newLayers]);
  };

  if (isMultiSelect) {
    return (
      <div className="space-y-4">
        <div className="p-3 bg-bg rounded border border-primary/20">
          <p className="text-sm text-muted">{selectedLayers.length} objects selected</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={duplicateSelected}
            className="flex items-center justify-center gap-2 px-3 py-2 bg-primary/20 hover:bg-primary/30 text-primary rounded text-sm transition-colors"
          >
            <Copy className="w-4 h-4" />
            Duplicate
          </button>
          <button
            onClick={deleteSelected}
            className="flex items-center justify-center gap-2 px-3 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded text-sm transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Layer Name */}
      <div>
        <label className="block text-xs font-medium text-muted mb-1">Name</label>
        <input
          type="text"
          value={layer.name}
          onChange={(e) => updateLayer(layer.id, { name: e.target.value })}
          className="w-full px-3 py-1.5 bg-bg border border-primary/30 rounded text-sm text-text focus:outline-none focus:border-primary"
        />
      </div>

      {/* Position */}
      <div>
        <label className="block text-xs font-medium text-muted mb-2">Position (inches)</label>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-muted mb-1">X</label>
            <input
              type="number"
              value={layer.x.toFixed(2)}
              onChange={(e) => updateLayer(layer.id, { x: parseFloat(e.target.value) || 0 })}
              step="0.1"
              className="w-full px-2 py-1.5 bg-bg border border-primary/30 rounded text-sm text-text focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Y</label>
            <input
              type="number"
              value={layer.y.toFixed(2)}
              onChange={(e) => updateLayer(layer.id, { y: parseFloat(e.target.value) || 0 })}
              step="0.1"
              className="w-full px-2 py-1.5 bg-bg border border-primary/30 rounded text-sm text-text focus:outline-none focus:border-primary"
            />
          </div>
        </div>
      </div>

      {/* Size */}
      <div>
        <label className="block text-xs font-medium text-muted mb-2">Size (inches)</label>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-muted mb-1">W</label>
            <input
              type="number"
              value={layer.width.toFixed(2)}
              onChange={(e) => updateLayer(layer.id, { width: parseFloat(e.target.value) || 0.1 })}
              step="0.1"
              min="0.1"
              className="w-full px-2 py-1.5 bg-bg border border-primary/30 rounded text-sm text-text focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">H</label>
            <input
              type="number"
              value={layer.height.toFixed(2)}
              onChange={(e) => updateLayer(layer.id, { height: parseFloat(e.target.value) || 0.1 })}
              step="0.1"
              min="0.1"
              className="w-full px-2 py-1.5 bg-bg border border-primary/30 rounded text-sm text-text focus:outline-none focus:border-primary"
            />
          </div>
        </div>
      </div>

      {/* Rotation */}
      <div>
        <label className="block text-xs font-medium text-muted mb-1">Rotation (degrees)</label>
        <input
          type="number"
          value={layer.rotation}
          onChange={(e) => updateLayer(layer.id, { rotation: parseFloat(e.target.value) || 0 })}
          step="15"
          className="w-full px-3 py-1.5 bg-bg border border-primary/30 rounded text-sm text-text focus:outline-none focus:border-primary"
        />
      </div>

      {/* Opacity */}
      <div>
        <label className="block text-xs font-medium text-muted mb-1">
          Opacity: {Math.round((layer.opacity ?? 1) * 100)}%
        </label>
        <input
          type="range"
          min="0"
          max="100"
          value={(layer.opacity ?? 1) * 100}
          onChange={(e) => updateLayer(layer.id, { opacity: parseInt(e.target.value) / 100 })}
          className="w-full"
        />
      </div>

      {/* Type-specific properties */}
      {layer.type === 'text' && (
        <>
          <div>
            <label className="block text-xs font-medium text-muted mb-1">Text</label>
            <textarea
              value={layer.text || ''}
              onChange={(e) => updateLayer(layer.id, { text: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 bg-bg border border-primary/30 rounded text-sm text-text focus:outline-none focus:border-primary resize-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1">Font Size</label>
            <input
              type="number"
              value={layer.fontSize || 16}
              onChange={(e) => updateLayer(layer.id, { fontSize: parseInt(e.target.value) || 16 })}
              min="8"
              max="200"
              className="w-full px-3 py-1.5 bg-bg border border-primary/30 rounded text-sm text-text focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1">Color</label>
            <input
              type="color"
              value={layer.fill || '#000000'}
              onChange={(e) => updateLayer(layer.id, { fill: e.target.value })}
              className="w-full h-10 bg-bg border border-primary/30 rounded cursor-pointer"
            />
          </div>
        </>
      )}

      {layer.type === 'shape' && (
        <>
          <div>
            <label className="block text-xs font-medium text-muted mb-1">Fill Color</label>
            <input
              type="color"
              value={layer.fill || '#000000'}
              onChange={(e) => updateLayer(layer.id, { fill: e.target.value })}
              className="w-full h-10 bg-bg border border-primary/30 rounded cursor-pointer"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1">Stroke Color</label>
            <input
              type="color"
              value={layer.stroke || '#000000'}
              onChange={(e) => updateLayer(layer.id, { stroke: e.target.value })}
              className="w-full h-10 bg-bg border border-primary/30 rounded cursor-pointer"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1">Stroke Width</label>
            <input
              type="number"
              value={layer.strokeWidth || 0}
              onChange={(e) => updateLayer(layer.id, { strokeWidth: parseFloat(e.target.value) || 0 })}
              min="0"
              step="0.5"
              className="w-full px-3 py-1.5 bg-bg border border-primary/30 rounded text-sm text-text focus:outline-none focus:border-primary"
            />
          </div>
        </>
      )}

      {layer.type === 'image' && layer.dpi && (
        <div className="p-3 bg-bg rounded border border-primary/20">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">DPI:</span>
            <span className={`text-sm font-medium ${
              layer.dpi >= 300 ? 'text-green-400' : layer.dpi >= 150 ? 'text-yellow-400' : 'text-red-400'
            }`}>
              {layer.dpi}
            </span>
          </div>
          {layer.dpi < 300 && (
            <p className="text-xs text-yellow-400 mt-1">
              {layer.dpi < 150 ? 'Low quality - may print poorly' : 'Medium quality - consider upscaling'}
            </p>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-primary/20">
        <button
          onClick={duplicateSelected}
          className="flex items-center justify-center gap-2 px-3 py-2 bg-primary/20 hover:bg-primary/30 text-primary rounded text-sm transition-colors"
        >
          <Copy className="w-4 h-4" />
          Duplicate
        </button>
        <button
          onClick={deleteSelected}
          className="flex items-center justify-center gap-2 px-3 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded text-sm transition-colors"
        >
          <Trash2 className="w-4 h-4" />
          Delete
        </button>
      </div>
    </div>
  );
};

export default ObjectSettings;
