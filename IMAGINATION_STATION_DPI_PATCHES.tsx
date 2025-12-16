// ============================================================================
// PATCH 1: Add this import after line 19 (after SheetCanvas import)
// ============================================================================
import { calculateDpi, getDpiQualityDisplay, getDpiFromMetadata, formatDpi, type DpiInfo, type DpiQuality } from '../utils/dpi-calculator';


// ============================================================================
// PATCH 2: Replace the entire handleFileUpload function (lines 237-293)
// ============================================================================
  // Handle file upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !sheet) return;

    setIsProcessing(true);
    try {
      for (const file of Array.from(files)) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const img = new Image();
          img.onload = () => {
            // Store original dimensions for DPI calculation
            const originalWidth = img.width;
            const originalHeight = img.height;

            // Scale image to fit on sheet (max 6 inches, in pixels)
            const maxSizeInches = 6;
            const maxSizePixels = maxSizeInches * PIXELS_PER_INCH;
            let w = img.width;
            let h = img.height;
            if (w > maxSizePixels || h > maxSizePixels) {
              const scale = maxSizePixels / Math.max(w, h);
              w *= scale;
              h *= scale;
            }

            // Calculate DPI based on original image and canvas size
            const dpiInfo = calculateDpi(originalWidth, originalHeight, w, h);

            const newLayer: ImaginationLayer = {
              id: `layer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              sheet_id: sheet.id,
              layer_type: 'image' as LayerType,
              source_url: event.target?.result as string,
              processed_url: null,
              position_x: 1,
              position_y: 1,
              width: w,
              height: h,
              rotation: 0,
              scale_x: 1,
              scale_y: 1,
              z_index: layers.length,
              metadata: {
                name: file.name.replace(/\.[^/.]+$/, ''),
                visible: true,
                locked: false,
                opacity: 1,
                dpiInfo, // Store DPI information in metadata
              },
              created_at: new Date().toISOString(),
            };
            setLayers(prev => [...prev, newLayer]);
            setSelectedLayerIds([newLayer.id]);
            setSaveStatus('unsaved');
          };
          img.src = event.target?.result as string;
        };
        reader.readAsDataURL(file);
      }
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };


// ============================================================================
// PATCH 3: Add this new function after handleFileUpload (after line 293)
// ============================================================================
  // Recalculate DPI when layer size changes
  const recalculateDpi = (layer: ImaginationLayer, newWidth: number, newHeight: number): DpiInfo | null => {
    const dpiInfo = getDpiFromMetadata(layer.metadata);
    if (!dpiInfo) return null;

    return calculateDpi(
      dpiInfo.originalWidth,
      dpiInfo.originalHeight,
      newWidth,
      newHeight
    );
  };


// ============================================================================
// PATCH 4: Update Width input onChange handler (around line 898)
// Replace the onChange handler for the Width input
// ============================================================================
                          <input
                            type="number"
                            value={Math.round(selectedLayers[0].width)}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              setLayers(prev => prev.map(l => {
                                if (l.id === selectedLayers[0].id) {
                                  const newDpiInfo = recalculateDpi(l, val, l.height);
                                  return {
                                    ...l,
                                    width: val,
                                    metadata: {
                                      ...l.metadata,
                                      dpiInfo: newDpiInfo || l.metadata?.dpiInfo
                                    }
                                  };
                                }
                                return l;
                              }));
                              setSaveStatus('unsaved');
                            }}
                            className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                            step="10"
                          />


// ============================================================================
// PATCH 5: Update Height input onChange handler (around line 914)
// Replace the onChange handler for the Height input
// ============================================================================
                          <input
                            type="number"
                            value={Math.round(selectedLayers[0].height)}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              setLayers(prev => prev.map(l => {
                                if (l.id === selectedLayers[0].id) {
                                  const newDpiInfo = recalculateDpi(l, l.width, val);
                                  return {
                                    ...l,
                                    height: val,
                                    metadata: {
                                      ...l.metadata,
                                      dpiInfo: newDpiInfo || l.metadata?.dpiInfo
                                    }
                                  };
                                }
                                return l;
                              }));
                              setSaveStatus('unsaved');
                            }}
                            className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                            step="10"
                          />


// ============================================================================
// PATCH 6: Update layer item in sidebar (around line 716-729)
// Replace the "Layer controls" section to add DPI indicator
// ============================================================================
                        {/* Layer controls */}
                        <div className="flex items-center gap-1">
                          {/* DPI Indicator */}
                          {layer.layer_type === 'image' && (() => {
                            const dpiInfo = getDpiFromMetadata(layer.metadata);
                            if (dpiInfo) {
                              const display = getDpiQualityDisplay(dpiInfo.quality);
                              return (
                                <div
                                  className={`w-2 h-2 rounded-full ${display.indicatorColor}`}
                                  title={`${formatDpi(dpiInfo.dpi)} - ${display.description}`}
                                />
                              );
                            }
                            return null;
                          })()}

                          <button
                            onClick={(e) => { e.stopPropagation(); toggleLayerVisibility(layer.id); }}
                            className="p-1 text-stone-400 hover:text-stone-600"
                          >
                            {isVisible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleLayerLock(layer.id); }}
                            className="p-1 text-stone-400 hover:text-stone-600"
                          >
                            {isLocked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                          </button>
                        </div>


// ============================================================================
// PATCH 7: Add DPI Warning Panel in Properties Panel (around line 850)
// Add this AFTER the Selected Layer name display section
// ============================================================================
                    <div>
                      <h3 className="text-sm font-semibold text-stone-800 mb-3">Selected Layer</h3>
                      <p className="text-stone-600">{selectedLayers[0].metadata?.name || `Layer ${selectedLayers[0].z_index + 1}`}</p>
                    </div>

                    {/* DPI Quality Warning */}
                    {selectedLayers[0].layer_type === 'image' && (() => {
                      const dpiInfo = getDpiFromMetadata(selectedLayers[0].metadata);
                      if (dpiInfo) {
                        const display = getDpiQualityDisplay(dpiInfo.quality);
                        return (
                          <div className={`p-4 ${display.bgColor} border ${display.borderColor} rounded-xl`}>
                            <div className="flex items-start gap-3">
                              <div className={`w-10 h-10 ${display.indicatorColor} rounded-lg flex items-center justify-center text-white text-lg font-bold shrink-0`}>
                                {display.icon}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <h4 className={`font-semibold ${display.color}`}>
                                    Print Quality: {display.label}
                                  </h4>
                                </div>
                                <p className={`text-sm ${display.color} mb-2`}>
                                  {display.description}
                                </p>
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                  <div>
                                    <span className="text-stone-500">DPI:</span>
                                    <span className={`ml-1 font-semibold ${display.color}`}>
                                      {dpiInfo.dpi}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-stone-500">Size:</span>
                                    <span className={`ml-1 font-semibold ${display.color}`}>
                                      {dpiInfo.canvasSizeInches.width}" × {dpiInfo.canvasSizeInches.height}"
                                    </span>
                                  </div>
                                  <div className="col-span-2">
                                    <span className="text-stone-500">Original:</span>
                                    <span className={`ml-1 font-semibold ${display.color}`}>
                                      {dpiInfo.originalWidth} × {dpiInfo.originalHeight} px
                                    </span>
                                  </div>
                                </div>
                                {dpiInfo.quality === 'danger' && (
                                  <div className="mt-3 pt-3 border-t border-red-200">
                                    <p className="text-xs text-red-700 font-medium">
                                      Warning: This image will not print well.
                                    </p>
                                    <ul className="text-xs text-red-600 mt-1 ml-4 list-disc space-y-0.5">
                                      <li>Use a higher resolution image</li>
                                      <li>Reduce the print size</li>
                                      <li>Try the Upscale tool to improve quality</li>
                                    </ul>
                                  </div>
                                )}
                                {dpiInfo.quality === 'warning' && (
                                  <div className="mt-3 pt-3 border-t border-amber-200">
                                    <p className="text-xs text-amber-700">
                                      Tip: For best results, use a higher resolution image or reduce the print size.
                                    </p>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    })()}

                    <div>
                      <h4 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-3">Position</h4>
