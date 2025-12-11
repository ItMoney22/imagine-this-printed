import React, { useState } from 'react';
import type { Layer, Sheet, AutoLayoutPricing, FreeTrials } from '../../types';
import ObjectSettings from './ObjectSettings';
import AutoLayoutControls from './AutoLayoutControls';
import MrImaginePanel from './MrImaginePanel';
import NanoBananaTools from './NanoBananaTools';
import ExportPanel from './ExportPanel';

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

  const selectedLayers = layers.filter(layer => selectedLayerIds.includes(layer.id));
  const hasSelection = selectedLayers.length > 0;

  const tabs = [
    { id: 'properties' as TabType, label: 'Properties', icon: '⚙️' },
    { id: 'layout' as TabType, label: 'Layout', icon: '📐' },
    { id: 'ai' as TabType, label: 'Mr Imagine', icon: '🤖' },
    { id: 'tools' as TabType, label: 'Tools', icon: '🔧' },
    { id: 'export' as TabType, label: 'Export', icon: '📤' },
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
            <MrImaginePanel
              pricing={pricing}
              freeTrials={freeTrials}
              itcBalance={itcBalance}
              isProcessing={isProcessing}
              setIsProcessing={setIsProcessing}
              onImageGenerated={(imageUrl) => {
                // Add new image layer to canvas
                const newLayer: Layer = {
                  id: `layer-${Date.now()}`,
                  name: 'AI Generated',
                  type: 'image',
                  x: 0.5,
                  y: 0.5,
                  width: 3,
                  height: 3,
                  rotation: 0,
                  opacity: 1,
                  visible: true,
                  locked: false,
                  imageUrl,
                  dpi: 300,
                };
                setLayers([...layers, newLayer]);
              }}
            />
          </div>
        )}

        {activeTab === 'tools' && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-text">Image Tools</h3>
            <NanoBananaTools
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
            <h3 className="text-sm font-semibold text-text">Export</h3>
            <ExportPanel
              sheet={sheet}
              layers={layers}
              isProcessing={isProcessing}
              setIsProcessing={setIsProcessing}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default RightSidebar;
