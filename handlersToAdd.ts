// Auto-Nest: Optimize layer positions to minimize wasted space
const handleAutoNest = async () => {
  if (!sheet || layers.length === 0) return;

  setIsProcessing(true);
  try {
    // Prepare layer data for API
    const layerData = layers.map(layer => ({
      id: layer.id,
      width: layer.width,
      height: layer.height,
      rotation: layer.rotation || 0,
    }));

    // Call Auto-Nest API
    const { data } = await imaginationApi.autoNest({
      sheetWidth: sheet.sheet_width,
      sheetHeight: sheet.sheet_height,
      layers: layerData,
      padding: 0.25, // 0.25 inch padding between items
    });

    // Update layer positions based on API response
    if (data.positions && Array.isArray(data.positions)) {
      setLayers(prev => prev.map(layer => {
        const newPosition = data.positions.find((p: any) => p.id === layer.id);
        if (newPosition) {
          return {
            ...layer,
            position_x: newPosition.x,
            position_y: newPosition.y,
            rotation: newPosition.rotation !== undefined ? newPosition.rotation : layer.rotation,
          };
        }
        return layer;
      }));
      setSaveStatus('unsaved');
    }
  } catch (error) {
    console.error('Auto-Nest failed:', error);
    alert('Auto-Nest optimization failed. Please try again.');
  } finally {
    setIsProcessing(false);
  }
};

// Smart Fill: Fill empty space with duplicates of selected design
const handleSmartFill = async () => {
  if (!sheet || layers.length === 0) return;

  // Determine which layers to duplicate (selected or all)
  const layersToFill = selectedLayerIds.length > 0
    ? layers.filter(l => selectedLayerIds.includes(l.id))
    : layers;

  if (layersToFill.length === 0) return;

  setIsProcessing(true);
  try {
    // Prepare layer data for API
    const layerData = layersToFill.map(layer => ({
      id: layer.id,
      width: layer.width,
      height: layer.height,
    }));

    // Call Smart Fill API
    const { data } = await imaginationApi.smartFill({
      sheetWidth: sheet.sheet_width,
      sheetHeight: sheet.sheet_height,
      layers: layerData,
      padding: 0.25, // 0.25 inch padding between items
    });

    // Add duplicate layers returned from API
    if (data.duplicates && Array.isArray(data.duplicates)) {
      const newLayers = data.duplicates.map((dup: any) => {
        // Find the source layer to copy properties from
        const sourceLayer = layers.find(l => l.id === dup.sourceId) || layersToFill[0];

        return {
          ...sourceLayer,
          id: `layer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          position_x: dup.x,
          position_y: dup.y,
          rotation: dup.rotation !== undefined ? dup.rotation : sourceLayer.rotation,
          z_index: layers.length + data.duplicates.indexOf(dup),
          metadata: {
            ...sourceLayer.metadata,
            name: `${sourceLayer.metadata?.name || 'Layer'} (filled)`,
          },
        } as ImaginationLayer;
      });

      setLayers(prev => [...prev, ...newLayers]);
      setSaveStatus('unsaved');
    }
  } catch (error) {
    console.error('Smart Fill failed:', error);
    alert('Smart Fill optimization failed. Please try again.');
  } finally {
    setIsProcessing(false);
  }
};
