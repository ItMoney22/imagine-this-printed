import React, { useState } from 'react';
import type { Layer, AutoLayoutPricing, FreeTrials } from '../../types';
import { imaginationApi } from '../../lib/api';
import { Loader2, Eraser, Maximize, Sparkles, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';

interface ITPEnhanceToolsProps {
  selectedLayers: Layer[];
  layers: Layer[];
  setLayers: (layers: Layer[]) => void;
  pricing: AutoLayoutPricing;
  freeTrials: FreeTrials;
  itcBalance: number;
  isProcessing: boolean;
  setIsProcessing: (processing: boolean) => void;
}

interface TrialCounts {
  removeBackground: number;
  upscale: number;
  enhance: number;
}

const ITPEnhanceTools: React.FC<ITPEnhanceToolsProps> = ({
  selectedLayers,
  layers,
  setLayers,
  pricing,
  freeTrials,
  itcBalance,
  isProcessing,
  setIsProcessing,
}) => {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [processingTool, setProcessingTool] = useState<string | null>(null);
  const [trialCounts, setTrialCounts] = useState<TrialCounts>(() => {
    const saved = localStorage.getItem('itp-image-tool-trials');
    if (saved) {
      return JSON.parse(saved);
    }
    return {
      removeBackground: freeTrials.removeBackground,
      upscale: freeTrials.upscale,
      enhance: freeTrials.enhance,
    };
  });

  const selectedLayer = selectedLayers[0];
  const isImageSelected = selectedLayer?.type === 'image';

  const saveTrialCounts = (counts: TrialCounts) => {
    setTrialCounts(counts);
    localStorage.setItem('itp-image-tool-trials', JSON.stringify(counts));
  };

  const useTrial = (tool: keyof TrialCounts) => {
    saveTrialCounts({
      ...trialCounts,
      [tool]: trialCounts[tool] - 1,
    });
  };

  const updateLayer = (id: string, updates: Partial<Layer>) => {
    setLayers(layers.map(l => l.id === id ? { ...l, ...updates } : l));
  };

  const handleRemoveBackground = async () => {
    if (!isImageSelected) return;

    const isFree = trialCounts.removeBackground > 0;
    if (!isFree && itcBalance < pricing.removeBackground) {
      setError('Insufficient ITC balance');
      return;
    }

    setError(null);
    setSuccess(null);
    setIsProcessing(true);
    setProcessingTool('removeBackground');

    try {
      const { data } = await imaginationApi.removeBackground({
        imageUrl: selectedLayer.imageUrl || selectedLayer.src || '',
        useTrial: isFree,
      });

      if (isFree) {
        useTrial('removeBackground');
      }

      const imageUrl = data.imageUrl || data.url || data.output;
      updateLayer(selectedLayer.id, {
        imageUrl,
        src: imageUrl,
        hasTransparency: true,
      });

      setSuccess('Background removed successfully');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to remove background');
    } finally {
      setIsProcessing(false);
      setProcessingTool(null);
    }
  };

  const handleUpscale = async (factor: 2 | 4) => {
    if (!isImageSelected) return;

    const cost = factor === 2 ? pricing.upscale2x : pricing.upscale4x;
    const isFree = trialCounts.upscale > 0;

    if (!isFree && itcBalance < cost) {
      setError('Insufficient ITC balance');
      return;
    }

    setError(null);
    setSuccess(null);
    setIsProcessing(true);
    setProcessingTool(`upscale${factor}x`);

    try {
      const { data } = await imaginationApi.upscaleImage({
        imageUrl: selectedLayer.imageUrl || selectedLayer.src || '',
        factor,
        useTrial: isFree,
      });

      if (isFree) {
        useTrial('upscale');
      }

      const imageUrl = data.imageUrl || data.url || data.output;
      updateLayer(selectedLayer.id, {
        imageUrl,
        src: imageUrl,
        dpi: (selectedLayer.dpi || 72) * factor,
      });

      setSuccess(`Image upscaled ${factor}x successfully`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to upscale image');
    } finally {
      setIsProcessing(false);
      setProcessingTool(null);
    }
  };

  const handleEnhance = async () => {
    if (!isImageSelected) return;

    const isFree = trialCounts.enhance > 0;
    if (!isFree && itcBalance < pricing.enhance) {
      setError('Insufficient ITC balance');
      return;
    }

    setError(null);
    setSuccess(null);
    setIsProcessing(true);
    setProcessingTool('enhance');

    try {
      const { data } = await imaginationApi.enhanceImage({
        imageUrl: selectedLayer.imageUrl || selectedLayer.src || '',
        useTrial: isFree,
      });

      if (isFree) {
        useTrial('enhance');
      }

      const imageUrl = data.imageUrl || data.url || data.output;
      updateLayer(selectedLayer.id, {
        imageUrl,
        src: imageUrl,
      });

      setSuccess('Image enhanced successfully');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to enhance image');
    } finally {
      setIsProcessing(false);
      setProcessingTool(null);
    }
  };

  const getDPIStatus = (dpi?: number) => {
    if (!dpi) return { icon: XCircle, text: 'Unknown DPI', color: 'text-muted' };
    if (dpi >= 300) return { icon: CheckCircle2, text: `${dpi} DPI - Excellent`, color: 'text-green-400' };
    if (dpi >= 150) return { icon: AlertTriangle, text: `${dpi} DPI - Medium Quality`, color: 'text-yellow-400' };
    return { icon: XCircle, text: `${dpi} DPI - Low Quality`, color: 'text-red-400' };
  };

  const dpiStatus = isImageSelected ? getDPIStatus(selectedLayer.dpi) : null;

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

      {!isImageSelected ? (
        <div className="text-center py-8">
          <p className="text-muted text-sm">Select an image layer to use tools</p>
        </div>
      ) : (
        <>
          {/* DPI Check */}
          {dpiStatus && (
            <div className={`p-3 bg-bg rounded border ${
              selectedLayer.dpi && selectedLayer.dpi >= 300
                ? 'border-green-500/30'
                : selectedLayer.dpi && selectedLayer.dpi >= 150
                ? 'border-yellow-500/30'
                : 'border-red-500/30'
            }`}>
              <div className="flex items-center gap-2">
                <dpiStatus.icon className={`w-4 h-4 ${dpiStatus.color}`} />
                <span className={`text-sm font-medium ${dpiStatus.color}`}>
                  {dpiStatus.text}
                </span>
              </div>
              {selectedLayer.dpi && selectedLayer.dpi < 300 && (
                <p className="text-xs text-muted mt-2">
                  {selectedLayer.dpi < 150
                    ? 'Consider upscaling for better print quality'
                    : 'Image may benefit from upscaling'}
                </p>
              )}
            </div>
          )}

          {/* Background Removal */}
          <div>
            <h4 className="text-xs font-medium text-muted mb-2">Background Tools</h4>
            <button
              onClick={handleRemoveBackground}
              disabled={isProcessing}
              className={`w-full flex items-center justify-between px-4 py-3 rounded transition-all ${
                isProcessing
                  ? 'bg-primary/10 text-muted cursor-not-allowed'
                  : 'bg-primary/20 hover:bg-primary/30 text-primary hover:shadow-glow'
              }`}
            >
              <div className="flex items-center gap-2">
                {processingTool === 'removeBackground' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Eraser className="w-4 h-4" />
                )}
                <span className="font-medium">Remove Background</span>
              </div>
              <span className={`text-xs ${
                trialCounts.removeBackground > 0 ? 'text-green-400' : 'text-accent'
              }`}>
                {trialCounts.removeBackground > 0
                  ? `FREE (${trialCounts.removeBackground} left)`
                  : `${pricing.removeBackground} ITC`}
              </span>
            </button>
          </div>

          {/* Upscaling */}
          <div>
            <h4 className="text-xs font-medium text-muted mb-2">Upscaling</h4>
            <div className="space-y-2">
              <button
                onClick={() => handleUpscale(2)}
                disabled={isProcessing}
                className={`w-full flex items-center justify-between px-4 py-3 rounded transition-all ${
                  isProcessing
                    ? 'bg-primary/10 text-muted cursor-not-allowed'
                    : 'bg-primary/20 hover:bg-primary/30 text-primary hover:shadow-glow'
                }`}
              >
                <div className="flex items-center gap-2">
                  {processingTool === 'upscale2x' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Maximize className="w-4 h-4" />
                  )}
                  <span className="font-medium">Upscale 2x</span>
                </div>
                <span className={`text-xs ${
                  trialCounts.upscale > 0 ? 'text-green-400' : 'text-accent'
                }`}>
                  {trialCounts.upscale > 0
                    ? `FREE (${trialCounts.upscale} left)`
                    : `${pricing.upscale2x} ITC`}
                </span>
              </button>

              <button
                onClick={() => handleUpscale(4)}
                disabled={isProcessing}
                className={`w-full flex items-center justify-between px-4 py-3 rounded transition-all ${
                  isProcessing
                    ? 'bg-primary/10 text-muted cursor-not-allowed'
                    : 'bg-primary/20 hover:bg-primary/30 text-primary hover:shadow-glow'
                }`}
              >
                <div className="flex items-center gap-2">
                  {processingTool === 'upscale4x' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Maximize className="w-4 h-4" />
                  )}
                  <span className="font-medium">Upscale 4x</span>
                </div>
                <span className={`text-xs ${
                  trialCounts.upscale > 0 ? 'text-green-400' : 'text-accent'
                }`}>
                  {trialCounts.upscale > 0
                    ? `FREE (${trialCounts.upscale} left)`
                    : `${pricing.upscale4x} ITC`}
                </span>
              </button>
            </div>
          </div>

          {/* Enhancement */}
          <div>
            <h4 className="text-xs font-medium text-muted mb-2">Enhancement</h4>
            <button
              onClick={handleEnhance}
              disabled={isProcessing}
              className={`w-full flex items-center justify-between px-4 py-3 rounded transition-all ${
                isProcessing
                  ? 'bg-primary/10 text-muted cursor-not-allowed'
                  : 'bg-primary/20 hover:bg-primary/30 text-primary hover:shadow-glow'
              }`}
            >
              <div className="flex items-center gap-2">
                {processingTool === 'enhance' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                <span className="font-medium">AI Enhance</span>
              </div>
              <span className={`text-xs ${
                trialCounts.enhance > 0 ? 'text-green-400' : 'text-accent'
              }`}>
                {trialCounts.enhance > 0
                  ? `FREE (${trialCounts.enhance} left)`
                  : `${pricing.enhance} ITC`}
              </span>
            </button>
          </div>

          {/* Info */}
          <div className="p-3 bg-bg rounded border border-primary/20">
            <p className="text-xs text-muted leading-relaxed">
              <strong>Remove Background:</strong> Automatically removes image background<br />
              <strong>Upscale:</strong> Increases resolution for better print quality<br />
              <strong>Enhance:</strong> AI-powered quality improvement
            </p>
          </div>
        </>
      )}
    </div>
  );
};

export default ITPEnhanceTools;
