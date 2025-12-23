// src/components/imagination/ITPEnhanceModal.tsx
// ITP Enhance Lightbox for image enhancement tools

import React, { useState, useEffect } from 'react';
import {
  X,
  Wand2,
  Loader2,
  Check,
  AlertCircle,
  Image as ImageIcon,
  Maximize2,
  Sparkles,
  ArrowRight,
  RefreshCw
} from 'lucide-react';
import type { ImaginationLayer } from '../../types';

interface ITPEnhanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedLayer: ImaginationLayer | null;
  itcBalance: number;
  getFreeTrial: (feature: string) => number;
  getFeaturePrice: (feature: string) => number;
  onRemoveBackground: () => Promise<void>;
  onUpscale: () => Promise<void>;
  onEnhance: () => Promise<void>;
  onReimagine: () => void;
  isRemovingBg: boolean;
  isUpscaling: boolean;
  isEnhancing: boolean;
  isProcessing: boolean;
}

const ITPEnhanceModal: React.FC<ITPEnhanceModalProps> = ({
  isOpen,
  onClose,
  selectedLayer,
  itcBalance,
  getFreeTrial,
  getFeaturePrice,
  onRemoveBackground,
  onUpscale,
  onEnhance,
  onReimagine,
  isRemovingBg,
  isUpscaling,
  isEnhancing,
  isProcessing
}) => {
  const [activeProcess, setActiveProcess] = useState<string | null>(null);

  // Update active process state when any operation starts/ends
  useEffect(() => {
    if (isRemovingBg) setActiveProcess('bg_remove');
    else if (isUpscaling) setActiveProcess('upscale');
    else if (isEnhancing) setActiveProcess('enhance');
    else setActiveProcess(null);
  }, [isRemovingBg, isUpscaling, isEnhancing]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const hasSelectedImage = selectedLayer &&
    (selectedLayer.layer_type === 'image' || selectedLayer.layer_type === 'ai_generated');

  const imageUrl = selectedLayer?.processed_url || selectedLayer?.source_url;

  const tools = [
    {
      id: 'bg_remove',
      name: 'Remove Background',
      description: 'AI removes background, keeping only the subject',
      icon: ImageIcon,
      color: 'from-red-400 to-rose-500',
      bgColor: 'bg-red-50',
      borderColor: 'border-red-200',
      freeTrials: getFreeTrial('bg_remove'),
      price: getFeaturePrice('bg_remove'),
      isLoading: isRemovingBg,
      onClick: onRemoveBackground
    },
    {
      id: 'upscale',
      name: 'Upscale 2x',
      description: 'Double the resolution with AI enhancement',
      icon: Maximize2,
      color: 'from-blue-400 to-cyan-500',
      bgColor: 'bg-blue-50',
      borderColor: 'border-blue-200',
      freeTrials: getFreeTrial('upscale_2x'),
      price: getFeaturePrice('upscale_2x'),
      isLoading: isUpscaling,
      onClick: onUpscale
    },
    {
      id: 'enhance',
      name: 'Enhance Quality',
      description: 'Improve colors, contrast, and clarity',
      icon: Sparkles,
      color: 'from-purple-400 to-violet-500',
      bgColor: 'bg-purple-50',
      borderColor: 'border-purple-200',
      freeTrials: getFreeTrial('enhance'),
      price: getFeaturePrice('enhance'),
      isLoading: isEnhancing,
      onClick: onEnhance
    },
    {
      id: 'reimagine',
      name: 'Reimagine It',
      description: 'Transform your image with AI magic',
      icon: RefreshCw,
      color: 'from-pink-400 to-rose-500',
      bgColor: 'bg-pink-50',
      borderColor: 'border-pink-200',
      freeTrials: 0,
      price: getFeaturePrice('generate'),
      isLoading: false,
      onClick: () => {
        onReimagine();
        onClose();
      }
    }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="relative bg-gradient-to-br from-amber-400 via-orange-500 to-red-500 px-6 py-5">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-sm">
              <Wand2 className="w-7 h-7 text-white" />
            </div>

            <div>
              <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                ITP Enhance
              </h2>
              <p className="text-white/80 text-sm mt-1">
                AI-powered tools to perfect your images
              </p>
            </div>
          </div>

          {/* Balance indicator */}
          <div className="absolute bottom-4 right-4">
            <span className="px-3 py-1 bg-white/20 text-white text-xs font-medium rounded-full backdrop-blur-sm">
              Balance: {itcBalance} ITC
            </span>
          </div>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto p-6">
          {!hasSelectedImage ? (
            <div className="text-center py-12">
              <div className="w-20 h-20 mx-auto mb-4 bg-stone-100 rounded-full flex items-center justify-center">
                <ImageIcon className="w-10 h-10 text-stone-400" />
              </div>
              <h3 className="text-lg font-semibold text-stone-800 mb-2">
                No Image Selected
              </h3>
              <p className="text-stone-500 text-sm max-w-sm mx-auto">
                Please select an image layer on your canvas to use enhancement tools.
              </p>
              <button
                onClick={onClose}
                className="mt-6 px-6 py-2.5 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg font-medium transition-colors"
              >
                Close
              </button>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-6">
              {/* Left: Preview */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-stone-500 uppercase tracking-wider">
                  Selected Image
                </h3>
                <div className="aspect-square bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHJlY3Qgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBmaWxsPSIjZjVmNWY1Ii8+PHJlY3QgeD0iMTAiIHk9IjEwIiB3aWR0aD0iMTAiIGhlaWdodD0iMTAiIGZpbGw9IiNmNWY1ZjUiLz48L3BhdHRlcm4+PC9kZWZzPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InVybCgjZ3JpZCkiLz48L3N2Zz4=')] rounded-xl border border-stone-200 overflow-hidden flex items-center justify-center">
                  {imageUrl && (
                    <img
                      src={imageUrl}
                      alt="Selected layer"
                      className="max-w-full max-h-full object-contain"
                    />
                  )}
                </div>
                <p className="text-xs text-stone-500 text-center">
                  {selectedLayer?.metadata?.name || 'Image Layer'}
                </p>
              </div>

              {/* Right: Tools */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-stone-500 uppercase tracking-wider">
                  Enhancement Tools
                </h3>

                {tools.map((tool) => {
                  const Icon = tool.icon;
                  const isActive = activeProcess === tool.id;
                  const isDisabled = isProcessing && !isActive;

                  return (
                    <button
                      key={tool.id}
                      onClick={tool.onClick}
                      disabled={isDisabled || tool.isLoading}
                      className={`w-full p-4 rounded-xl text-left transition-all flex items-center gap-4 ${tool.bgColor} ${tool.borderColor} border hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${tool.color} flex items-center justify-center flex-shrink-0`}>
                        {tool.isLoading ? (
                          <Loader2 className="w-6 h-6 text-white animate-spin" />
                        ) : (
                          <Icon className="w-6 h-6 text-white" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-stone-800">
                          {tool.isLoading ? `${tool.name}...` : tool.name}
                        </div>
                        <div className="text-xs text-stone-500 mt-0.5">
                          {tool.description}
                        </div>
                        <div className="text-xs mt-1 font-medium">
                          {tool.freeTrials > 0 ? (
                            <span className="text-green-600">{tool.freeTrials} free remaining</span>
                          ) : (
                            <span className="text-amber-600">{tool.price} ITC</span>
                          )}
                        </div>
                      </div>
                      <ArrowRight className="w-5 h-5 text-stone-400 flex-shrink-0" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-stone-50 border-t border-stone-200 flex items-center justify-between">
          <p className="text-xs text-stone-500">
            Tip: Enhancements are applied to the selected layer
          </p>
          <button
            onClick={onClose}
            className="px-4 py-2 text-stone-600 hover:text-stone-800 font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default ITPEnhanceModal;
