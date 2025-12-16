import React, { useState, useCallback } from 'react';
import type { Layer, Sheet, AutoLayoutPricing, FreeTrials } from '../../types';
import ObjectSettings from './ObjectSettings';
import AutoLayoutControls from './AutoLayoutControls';
import MrImaginePanel from './MrImaginePanel';
import MrImagineModal from './MrImagineModal';
import ITPEnhanceTools from './ITPEnhanceTools';
import ExportPanel from './ExportPanel';

// Default size for AI-generated images (inches) - large enough to be visible
const DEFAULT_AI_IMAGE_SIZE = 6;

/**
 * Load an image and calculate proper layer dimensions
 * Maintains aspect ratio while fitting within a default size
 */
function loadImageAndGetDimensions(imageUrl: string): Promise<{ width: number; height: number; originalWidth: number; originalHeight: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const { naturalWidth, naturalHeight } = img;
      const aspectRatio = naturalWidth / naturalHeight;

      // Calculate dimensions in inches, fitting within default size while maintaining aspect ratio
      let width: number;
      let height: number;

      if (aspectRatio >= 1) {
        // Landscape or square - width is the limiting factor
        width = DEFAULT_AI_IMAGE_SIZE;
        height = DEFAULT_AI_IMAGE_SIZE / aspectRatio;
      } else {
        // Portrait - height is the limiting factor
        height = DEFAULT_AI_IMAGE_SIZE;
        width = DEFAULT_AI_IMAGE_SIZE * aspectRatio;
      }

      resolve({
        width,
        height,
        originalWidth: naturalWidth,
        originalHeight: naturalHeight
      });
    };
    img.onerror = () => {
      // Fallback to default size if image fails to load
      console.warn('[RightSidebar] Failed to load image dimensions, using defaults');
      resolve({
        width: DEFAULT_AI_IMAGE_SIZE,
        height: DEFAULT_AI_IMAGE_SIZE,
        originalWidth: 1024,
        originalHeight: 1024
      });
    };
    img.src = imageUrl;
  });
}

interface RightSidebarProps {
  sheet: Sheet;
  layers: Layer[];
  setLayers: (layers: Layer[]) => void;
  selectedLayerIds: string[];
  pricing: AutoLayoutPricing;
  freeTrials: FreeTrials;
  itcBalance: number;
  isProcessing: boolean;
  setIsProcessing: (processing: boolean) => void;
}

type TabType = 'properties' | 'layout' | 'ai' | 'tools' | 'export';

const RightSidebar: React.FC<RightSidebarProps> = ({
  sheet,
  layers,
  setLayers,
  selectedLayerIds,
  pricing,
  freeTrials,
  itcBalance,
  isProcessing,
  setIsProcessing,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('properties');
  const [isMrImagineModalOpen, setIsMrImagineModalOpen] = useState(false);

  const selectedLayers = layers.filter(layer => selectedLayerIds.includes(layer.id));

  // Handler for adding AI-generated images to the canvas with proper dimensions
  const handleAddAIImage = useCallback(async (imageUrl: string, closeModal = false) => {
    try {
      // Load image and calculate proper dimensions
      const { width, height, originalWidth, originalHeight } = await loadImageAndGetDimensions(imageUrl);

      // Calculate DPI based on actual image size and layer dimensions
      const dpi = Math.round(originalWidth / width);

      // Position near center of sheet (with slight offset to avoid overlap)
      const centerX = sheet.width / 2 - width / 2;
      const centerY = sheet.height / 2 - height / 2;

      const newLayer: Layer = {
        id: `layer-${Date.now()}`,
        name: 'AI Generated',
        type: 'image',
        x: Math.max(0.25, centerX),
        y: Math.max(0.25, centerY),
        width,
        height,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        imageUrl,
        dpi,
        metadata: {
          originalWidth,
          originalHeight,
          source: 'mr-imagine'
        }
      };

      setLayers([...layers, newLayer]);

      if (closeModal) {
        setIsMrImagineModalOpen(false);
      }
    } catch (err) {
      console.error('[RightSidebar] Failed to add AI image:', err);
      // Fallback to default dimensions if anything fails
      const newLayer: Layer = {
        id: `layer-${Date.now()}`,
        name: 'AI Generated',
        type: 'image',
        x: sheet.width / 2 - DEFAULT_AI_IMAGE_SIZE / 2,
        y: sheet.height / 2 - DEFAULT_AI_IMAGE_SIZE / 2,
        width: DEFAULT_AI_IMAGE_SIZE,
        height: DEFAULT_AI_IMAGE_SIZE,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        imageUrl,
        dpi: 300,
      };
      setLayers([...layers, newLayer]);

      if (closeModal) {
        setIsMrImagineModalOpen(false);
      }
    }
  }, [sheet, layers, setLayers]);
  const hasSelection = selectedLayers.length > 0;

  const tabs = [
    { id: 'properties' as TabType, label: 'Properties', icon: '⚙️' },
    { id: 'layout' as TabType, label: 'Layout', icon: '📐' },
    { id: 'ai' as TabType, label: 'Mr Imagine', icon: '🤖' },
    { id: 'tools' as TabType, label: 'Tools', icon: '🔧' },
    { id: 'export' as TabType, label: 'Add to Cart', icon: '🛒' },
  ];

  return (
    <div className="w-72 bg-card border-l border-primary/30 flex flex-col h-full">
      {/* Tab Navigation */}
      <div className="flex border-b border-primary/30">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 px-2 py-3 text-xs font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-primary/20 text-primary border-b-2 border-primary'
                : 'text-muted hover:text-text hover:bg-primary/5'
            }`}
            title={tab.label}
          >
            <span className="text-base">{tab.icon}</span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'properties' && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-text">Object Settings</h3>
            {hasSelection ? (
              <ObjectSettings
                selectedLayers={selectedLayers}
                layers={layers}
                setLayers={setLayers}
              />
            ) : (
              <div className="text-center py-8">
                <p className="text-muted text-sm">Select an element to view properties</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'layout' && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-text">Auto Layout</h3>
            <AutoLayoutControls
              sheet={sheet}
              layers={layers}
              setLayers={setLayers}
              selectedLayerIds={selectedLayerIds}
              pricing={pricing}
              itcBalance={itcBalance}
              isProcessing={isProcessing}
              setIsProcessing={setIsProcessing}
            />
          </div>
        )}

        {activeTab === 'ai' && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-text">AI Generation</h3>

            {/* Mr. Imagine Modal Launcher */}
            <button
              onClick={() => setIsMrImagineModalOpen(true)}
              className="w-full p-4 bg-gradient-to-r from-purple-600 to-pink-500 rounded-xl text-white font-semibold text-sm hover:from-purple-700 hover:to-pink-600 transition-all shadow-lg hover:shadow-xl flex items-center justify-center gap-3 group"
            >
              <img
                src="/mr-imagine/mr-imagine-waving.png"
                alt="Mr. Imagine"
                className="w-10 h-10 object-contain group-hover:scale-110 transition-transform"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
              <span>Open Mr. Imagine Studio</span>
            </button>

            {/* Quick generate panel (compact fallback) */}
            <div className="mt-4 pt-4 border-t border-primary/20">
              <p className="text-xs text-muted mb-3">Quick Generate:</p>
              <MrImaginePanel
                pricing={pricing}
                freeTrials={freeTrials}
                itcBalance={itcBalance}
                isProcessing={isProcessing}
                setIsProcessing={setIsProcessing}
                onImageGenerated={(imageUrl) => handleAddAIImage(imageUrl, false)}
              />
            </div>
          </div>
        )}

        {activeTab === 'tools' && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-text">Image Tools</h3>
            <ITPEnhanceTools
              selectedLayers={selectedLayers}
              layers={layers}
              setLayers={setLayers}
              pricing={pricing}
              freeTrials={freeTrials}
              itcBalance={itcBalance}
              isProcessing={isProcessing}
              setIsProcessing={setIsProcessing}
            />
          </div>
        )}

        {activeTab === 'export' && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-text">Add to Cart</h3>
            <ExportPanel
              sheet={sheet}
              layers={layers}
              isProcessing={isProcessing}
              setIsProcessing={setIsProcessing}
            />
          </div>
        )}
      </div>

      {/* Mr. Imagine Modal */}
      <MrImagineModal
        isOpen={isMrImagineModalOpen}
        onClose={() => setIsMrImagineModalOpen(false)}
        pricing={pricing}
        freeTrials={freeTrials}
        itcBalance={itcBalance}
        onImageGenerated={(imageUrl) => handleAddAIImage(imageUrl, true)}
      />
    </div>
  );
};

export default RightSidebar;
