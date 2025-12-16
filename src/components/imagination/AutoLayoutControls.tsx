import React, { useState } from 'react';
import type { Layer, Sheet, AutoLayoutPricing } from '../../types';
import { imaginationApi } from '../../lib/api';
import { Loader2, Grid3x3, Maximize2, AlignHorizontalJustifyCenter, AlignVerticalJustifyCenter, Columns } from 'lucide-react';

interface AutoLayoutControlsProps {
  sheet: Sheet;
  layers: Layer[];
  setLayers: (layers: Layer[]) => void;
  selectedLayerIds: string[];
  pricing: AutoLayoutPricing;
  itcBalance: number;
  isProcessing: boolean;
  setIsProcessing: (processing: boolean) => void;
}

const AutoLayoutControls: React.FC<AutoLayoutControlsProps> = ({
  sheet,
  layers,
  setLayers,
  selectedLayerIds,
  pricing,
  itcBalance,
  isProcessing,
  setIsProcessing,
}) => {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canAffordNest = itcBalance >= pricing.autoNest;
  const canAffordSmartFill = itcBalance >= pricing.smartFill;

  const handleAutoNest = async () => {
    if (!canAffordNest) {
      setError('Insufficient ITC balance for Auto-Nest');
      return;
    }

    if (layers.length < 2) {
      setError('Need at least 2 layers to auto-nest');
      return;
    }

    setError(null);
    setSuccess(null);
    setIsProcessing(true);

    try {
      const { data } = await imaginationApi.autoNest({
        sheetWidth: sheet.width,
        sheetHeight: sheet.height,
        layers: layers.map(l => ({
          id: l.id,
          width: l.width,
          height: l.height,
          rotation: l.rotation || 0,
        })),
        padding: 0.125, // 1/8 inch padding
      });

      // Update layer positions based on response
      const updatedLayers = layers.map(layer => {
        const newPos = data.positions?.find((p: any) => p.id === layer.id);
        return newPos ? {
          ...layer,
          x: newPos.x,
          y: newPos.y,
          rotation: newPos.rotation !== undefined ? newPos.rotation : layer.rotation
        } : layer;
      });

      setLayers(updatedLayers);
      setSuccess(`Auto-nested ${data.positions?.length || 0} objects. Efficiency: ${data.efficiency || 0}%`);
      setTimeout(() => setSuccess(null), 5000);
    } catch (err: any) {
      setError(err.message || 'Failed to auto-nest objects');
      setTimeout(() => setError(null), 5000);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSmartFill = async () => {
    if (!canAffordSmartFill) {
      setError('Insufficient ITC balance for Smart Fill');
      return;
    }

    if (layers.length === 0) {
      setError('Need at least 1 layer to smart fill');
      return;
    }

    setError(null);
    setSuccess(null);
    setIsProcessing(true);

    try {
      // Determine which layers to use as templates (selected or all)
      const layersToFill = selectedLayerIds.length > 0
        ? layers.filter(l => selectedLayerIds.includes(l.id))
        : layers;

      if (layersToFill.length === 0) {
        setError('Please select at least one layer to fill with');
        setIsProcessing(false);
        return;
      }

      const { data } = await imaginationApi.smartFill({
        sheetWidth: sheet.width,
        sheetHeight: sheet.height,
        layers: layersToFill.map(l => ({
          id: l.id,
          width: l.width,
          height: l.height,
        })),
        padding: 0.125,
      });

      // Create new layers from duplicates
      if (data.duplicates && Array.isArray(data.duplicates)) {
        const newLayers = data.duplicates.map((dup: any, index: number) => {
          // Find the source layer to copy properties from
          const sourceLayer = layers.find(l => l.id === dup.sourceId) || layersToFill[0];

          return {
            ...sourceLayer,
            id: `layer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${index}`,
            x: dup.x,
            y: dup.y,
            rotation: dup.rotation !== undefined ? dup.rotation : sourceLayer.rotation,
            zIndex: layers.length + index,
            name: `${sourceLayer.name || 'Layer'} (filled)`,
          };
        });

        setLayers([...layers, ...newLayers]);
        setSuccess(`Smart Fill complete. Added ${data.totalAdded || newLayers.length} duplicates. Coverage: ${data.coverage || 0}%`);
        setTimeout(() => setSuccess(null), 5000);
      } else {
        setError('No space available for duplicates');
        setTimeout(() => setError(null), 5000);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to smart fill');
      setTimeout(() => setError(null), 5000);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAlignHorizontal = () => {
    if (selectedLayerIds.length < 2) {
      setError('Select at least 2 objects to align');
      setTimeout(() => setError(null), 3000);
      return;
    }

    const selectedLayers = layers.filter(l => selectedLayerIds.includes(l.id));
    const avgY = selectedLayers.reduce((sum, l) => sum + l.y, 0) / selectedLayers.length;

    const updatedLayers = layers.map(layer =>
      selectedLayerIds.includes(layer.id) ? { ...layer, y: avgY } : layer
    );

    setLayers(updatedLayers);
    setSuccess('Objects aligned horizontally');
    setTimeout(() => setSuccess(null), 2000);
  };

  const handleAlignVertical = () => {
    if (selectedLayerIds.length < 2) {
      setError('Select at least 2 objects to align');
      setTimeout(() => setError(null), 3000);
      return;
    }

    const selectedLayers = layers.filter(l => selectedLayerIds.includes(l.id));
    const avgX = selectedLayers.reduce((sum, l) => sum + l.x, 0) / selectedLayers.length;

    const updatedLayers = layers.map(layer =>
      selectedLayerIds.includes(layer.id) ? { ...layer, x: avgX } : layer
    );

    setLayers(updatedLayers);
    setSuccess('Objects aligned vertically');
    setTimeout(() => setSuccess(null), 2000);
  };

  const handleDistribute = () => {
    if (selectedLayerIds.length < 3) {
      setError('Select at least 3 objects to distribute');
      setTimeout(() => setError(null), 3000);
      return;
    }

    const selectedLayers = layers.filter(l => selectedLayerIds.includes(l.id))
      .sort((a, b) => a.x - b.x);

    const minX = selectedLayers[0].x;
    const maxX = selectedLayers[selectedLayers.length - 1].x;
    const spacing = (maxX - minX) / (selectedLayers.length - 1);

    const updatedLayers = layers.map(layer => {
      const index = selectedLayers.findIndex(l => l.id === layer.id);
      if (index === -1 || index === 0 || index === selectedLayers.length - 1) {
        return layer;
      }
      return { ...layer, x: minX + spacing * index };
    });

    setLayers(updatedLayers);
    setSuccess('Objects distributed evenly');
    setTimeout(() => setSuccess(null), 2000);
  };

  return (
    <div className="space-y-4">
      {/* Error/Success Messages */}
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded text-sm text-red-400">
          {error}
        </div>
      )}
      {success && (
        <div className="p-3 bg-green-500/10 border border-green-500/30 rounded text-sm text-green-400">
          {success}
        </div>
      )}

      {/* AI-Powered Layout */}
      <div>
        <h4 className="text-xs font-medium text-muted mb-3">AI-Powered Layout</h4>
        <div className="space-y-2">
          <button
            onClick={handleAutoNest}
            disabled={isProcessing || !canAffordNest || layers.length < 2}
            className={`w-full flex items-center justify-between px-4 py-3 rounded transition-all ${
              isProcessing || !canAffordNest || layers.length < 2
                ? 'bg-primary/10 text-muted cursor-not-allowed'
                : 'bg-primary/20 hover:bg-primary/30 text-primary hover:shadow-glow'
            }`}
          >
            <div className="flex items-center gap-2">
              {isProcessing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Grid3x3 className="w-4 h-4" />
              )}
              <span className="font-medium">Auto-Nest</span>
            </div>
            <span className={`text-xs ${canAffordNest ? 'text-accent' : 'text-red-400'}`}>
              {pricing.autoNest} ITC
            </span>
          </button>

          <button
            onClick={handleSmartFill}
            disabled={isProcessing || !canAffordSmartFill || layers.length < 2}
            className={`w-full flex items-center justify-between px-4 py-3 rounded transition-all ${
              isProcessing || !canAffordSmartFill || layers.length < 2
                ? 'bg-primary/10 text-muted cursor-not-allowed'
                : 'bg-primary/20 hover:bg-primary/30 text-primary hover:shadow-glow'
            }`}
          >
            <div className="flex items-center gap-2">
              {isProcessing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Maximize2 className="w-4 h-4" />
              )}
              <span className="font-medium">Smart Fill</span>
            </div>
            <span className={`text-xs ${canAffordSmartFill ? 'text-accent' : 'text-red-400'}`}>
              {pricing.smartFill} ITC
            </span>
          </button>
        </div>
        {!canAffordNest && (
          <p className="text-xs text-red-400 mt-2">Insufficient ITC balance</p>
        )}
      </div>

      {/* Magic Spacing (Free) */}
      <div>
        <h4 className="text-xs font-medium text-muted mb-3">Magic Spacing (Free)</h4>
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={handleAlignHorizontal}
            disabled={isProcessing || selectedLayerIds.length < 2}
            className={`flex flex-col items-center gap-1 px-2 py-2 rounded transition-all ${
              isProcessing || selectedLayerIds.length < 2
                ? 'bg-bg text-muted cursor-not-allowed'
                : 'bg-bg hover:bg-primary/10 text-text border border-primary/30 hover:border-primary'
            }`}
            title="Align Horizontal"
          >
            <AlignHorizontalJustifyCenter className="w-4 h-4" />
            <span className="text-xs">Align H</span>
          </button>

          <button
            onClick={handleAlignVertical}
            disabled={isProcessing || selectedLayerIds.length < 2}
            className={`flex flex-col items-center gap-1 px-2 py-2 rounded transition-all ${
              isProcessing || selectedLayerIds.length < 2
                ? 'bg-bg text-muted cursor-not-allowed'
                : 'bg-bg hover:bg-primary/10 text-text border border-primary/30 hover:border-primary'
            }`}
            title="Align Vertical"
          >
            <AlignVerticalJustifyCenter className="w-4 h-4" />
            <span className="text-xs">Align V</span>
          </button>

          <button
            onClick={handleDistribute}
            disabled={isProcessing || selectedLayerIds.length < 3}
            className={`flex flex-col items-center gap-1 px-2 py-2 rounded transition-all ${
              isProcessing || selectedLayerIds.length < 3
                ? 'bg-bg text-muted cursor-not-allowed'
                : 'bg-bg hover:bg-primary/10 text-text border border-primary/30 hover:border-primary'
            }`}
            title="Distribute Evenly"
          >
            <Columns className="w-4 h-4" />
            <span className="text-xs">Distribute</span>
          </button>
        </div>
      </div>

      {/* Info Box */}
      <div className="p-3 bg-bg rounded border border-primary/20">
        <p className="text-xs text-muted leading-relaxed">
          <strong>Auto-Nest:</strong> Optimizes object placement for minimal waste<br />
          <strong>Smart Fill:</strong> Maximizes sheet coverage<br />
          <strong>Magic Spacing:</strong> Quick alignment tools
        </p>
      </div>
    </div>
  );
};

export default AutoLayoutControls;
