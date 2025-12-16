// AI Generation - Mr. Imagine (3.1)
const handleAiGenerate = async () => {
  if (!aiPrompt.trim() || !sheet) return;

  setIsGenerating(true);
  setIsProcessing(true);
  try {
    const { data } = await imaginationApi.generateImage({
      prompt: aiPrompt,
      style: aiStyle,
      useTrial: getFreeTrial('generate') > 0
    });

    if (data.imageUrl) {
      const img = new Image();
      img.onload = () => {
        const maxSizeInches = 6;
        const maxSizePixels = maxSizeInches * PIXELS_PER_INCH;
        let w = img.width;
        let h = img.height;
        if (w > maxSizePixels || h > maxSizePixels) {
          const scale = maxSizePixels / Math.max(w, h);
          w *= scale;
          h *= scale;
        }

        const newLayer: ImaginationLayer = {
          id: `layer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          sheet_id: sheet.id,
          layer_type: 'image' as LayerType,
          source_url: data.imageUrl,
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
            name: `AI - ${aiPrompt.substring(0, 20)}`,
            visible: true,
            locked: false,
            opacity: 1,
          },
          created_at: new Date().toISOString(),
        };

        setLayers(prev => [...prev, newLayer]);
        setSelectedLayerIds([newLayer.id]);
        setSaveStatus('unsaved');
        setAiPrompt('');
      };
      img.src = data.imageUrl;
    }

    const { data: pricingData } = await imaginationApi.getPricing();
    setPricing(pricingData?.pricing || []);
    setFreeTrials(pricingData?.freeTrials || []);
  } catch (error: any) {
    console.error('AI generation failed:', error);
    alert(`Failed to generate image: ${error.message || 'Unknown error'}`);
  } finally {
    setIsGenerating(false);
    setIsProcessing(false);
  }
};

// Remove Background - ITP Enhance Engine (3.2)
const handleRemoveBackground = async () => {
  if (selectedLayerIds.length === 0 || !sheet) return;

  const selectedLayer = layers.find(l => l.id === selectedLayerIds[0]);
  if (!selectedLayer || selectedLayer.layer_type !== 'image') return;

  const imageUrl = selectedLayer.processed_url || selectedLayer.source_url;
  if (!imageUrl) return;

  setIsRemovingBg(true);
  setIsProcessing(true);
  try {
    const { data } = await imaginationApi.removeBackground({
      imageUrl,
      useTrial: getFreeTrial('bg_remove') > 0
    });

    if (data.processedUrl) {
      setLayers(prev => prev.map(l =>
        l.id === selectedLayer.id ? { ...l, processed_url: data.processedUrl } : l
      ));
      setSaveStatus('unsaved');
    }

    const { data: pricingData } = await imaginationApi.getPricing();
    setPricing(pricingData?.pricing || []);
    setFreeTrials(pricingData?.freeTrials || []);
  } catch (error: any) {
    console.error('Background removal failed:', error);
    alert(`Failed to remove background: ${error.message || 'Unknown error'}`);
  } finally {
    setIsRemovingBg(false);
    setIsProcessing(false);
  }
};

// Upscale Image - ITP Enhance Engine (3.3)
const handleUpscale = async (factor: 2 | 4) => {
  if (selectedLayerIds.length === 0 || !sheet) return;

  const selectedLayer = layers.find(l => l.id === selectedLayerIds[0]);
  if (!selectedLayer || selectedLayer.layer_type !== 'image') return;

  const imageUrl = selectedLayer.processed_url || selectedLayer.source_url;
  if (!imageUrl) return;

  const featureKey = factor === 2 ? 'upscale_2x' : 'upscale_4x';

  setIsUpscaling(true);
  setIsProcessing(true);
  try {
    const { data } = await imaginationApi.upscaleImage({
      imageUrl,
      factor,
      useTrial: getFreeTrial(featureKey) > 0
    });

    if (data.processedUrl) {
      const img = new Image();
      img.onload = () => {
        setLayers(prev => prev.map(l =>
          l.id === selectedLayer.id ? {
            ...l,
            processed_url: data.processedUrl,
            width: img.width,
            height: img.height
          } : l
        ));
        setSaveStatus('unsaved');
      };
      img.src = data.processedUrl;
    }

    const { data: pricingData } = await imaginationApi.getPricing();
    setPricing(pricingData?.pricing || []);
    setFreeTrials(pricingData?.freeTrials || []);
  } catch (error: any) {
    console.error('Upscale failed:', error);
    alert(`Failed to upscale image: ${error.message || 'Unknown error'}`);
  } finally {
    setIsUpscaling(false);
    setIsProcessing(false);
  }
};

// Enhance Quality - ITP Enhance Engine (3.4)
const handleEnhance = async () => {
  if (selectedLayerIds.length === 0 || !sheet) return;

  const selectedLayer = layers.find(l => l.id === selectedLayerIds[0]);
  if (!selectedLayer || selectedLayer.layer_type !== 'image') return;

  const imageUrl = selectedLayer.processed_url || selectedLayer.source_url;
  if (!imageUrl) return;

  setIsEnhancing(true);
  setIsProcessing(true);
  try {
    const { data } = await imaginationApi.enhanceImage({
      imageUrl,
      useTrial: getFreeTrial('enhance') > 0
    });

    if (data.processedUrl) {
      setLayers(prev => prev.map(l =>
        l.id === selectedLayer.id ? { ...l, processed_url: data.processedUrl } : l
      ));
      setSaveStatus('unsaved');
    }

    const { data: pricingData } = await imaginationApi.getPricing();
    setPricing(pricingData?.pricing || []);
    setFreeTrials(pricingData?.freeTrials || []);
  } catch (error: any) {
    console.error('Enhancement failed:', error);
    alert(`Failed to enhance image: ${error.message || 'Unknown error'}`);
  } finally {
    setIsEnhancing(false);
    setIsProcessing(false);
  }
};

// =======================
// UI Button Wiring Changes
// =======================

// 1. AI Panel - Update Generate button (line ~1150)
// Change from:
//   disabled={isProcessing || !aiPrompt.trim()}
// To:
//   disabled={isGenerating || !aiPrompt.trim()}

// Change from:
//   {isProcessing ? (
// To:
//   {isGenerating ? (

// 2. Tools Panel - Remove Background button (line ~1090)
// Add onClick handler:
<button
  onClick={handleRemoveBackground}
  disabled={isRemovingBg}
  className="w-full px-4 py-3 bg-white border border-amber-200 rounded-lg text-left hover:bg-amber-50 transition-colors disabled:opacity-50 flex items-center justify-between"
>
  <div className="flex items-center gap-3">
    <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
      {isRemovingBg ? (
        <Loader2 className="w-4 h-4 text-amber-600 animate-spin" />
      ) : (
        <ImageIcon className="w-4 h-4 text-amber-600" />
      )}
    </div>
    <div>
      <div className="font-medium text-stone-800">
        {isRemovingBg ? 'Removing...' : 'Remove Background'}
      </div>
      <div className="text-xs text-stone-500">
        {getFreeTrial('bg_remove') > 0 ? `${getFreeTrial('bg_remove')} free` : `${getFeaturePrice('bg_remove')} ITC`}
      </div>
    </div>
  </div>
  <ArrowRight className="w-4 h-4 text-stone-400" />
</button>

// 3. Tools Panel - Upscale button (line ~1107)
// Add onClick handler:
<button
  onClick={() => handleUpscale(2)}
  disabled={isUpscaling}
  className="w-full px-4 py-3 bg-white border border-amber-200 rounded-lg text-left hover:bg-amber-50 transition-colors disabled:opacity-50 flex items-center justify-between"
>
  <div className="flex items-center gap-3">
    <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
      {isUpscaling ? (
        <Loader2 className="w-4 h-4 text-amber-600 animate-spin" />
      ) : (
        <Maximize2 className="w-4 h-4 text-amber-600" />
      )}
    </div>
    <div>
      <div className="font-medium text-stone-800">
        {isUpscaling ? 'Upscaling...' : 'Upscale 2x'}
      </div>
      <div className="text-xs text-stone-500">
        {getFreeTrial('upscale_2x') > 0 ? `${getFreeTrial('upscale_2x')} free` : `${getFeaturePrice('upscale_2x')} ITC`}
      </div>
    </div>
  </div>
  <ArrowRight className="w-4 h-4 text-stone-400" />
</button>

// 4. Tools Panel - Enhance button (line ~1125)
// Add onClick handler:
<button
  onClick={handleEnhance}
  disabled={isEnhancing}
  className="w-full px-4 py-3 bg-white border border-amber-200 rounded-lg text-left hover:bg-amber-50 transition-colors disabled:opacity-50 flex items-center justify-between"
>
  <div className="flex items-center gap-3">
    <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
      {isEnhancing ? (
        <Loader2 className="w-4 h-4 text-amber-600 animate-spin" />
      ) : (
        <Sparkles className="w-4 h-4 text-amber-600" />
      )}
    </div>
    <div>
      <div className="font-medium text-stone-800">
        {isEnhancing ? 'Enhancing...' : 'Enhance Quality'}
      </div>
      <div className="text-xs text-stone-500">
        {getFreeTrial('enhance') > 0 ? `${getFreeTrial('enhance')} free` : `${getFeaturePrice('enhance')} ITC`}
      </div>
    </div>
  </div>
  <ArrowRight className="w-4 h-4 text-stone-400" />
</button>
