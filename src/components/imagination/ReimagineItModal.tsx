import React, { useState, useCallback } from 'react';
import { imaginationApi } from '../../lib/api';

interface ReimagineItModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string;
  layerName: string;
  onAcceptReimaged: (newImageUrl: string) => void;
  onKeepOriginal: () => void;
}

type ViewMode = 'input' | 'compare' | 'loading';

const EXAMPLE_PROMPTS = [
  'Add a crown on top',
  'Add sparkles and magic effects',
  'Add a sunset background',
  'Add flames around it',
  'Add a neon glow effect',
  'Add cartoon eyes and a smile',
  'Add butterfly wings',
  'Add a galaxy background',
];

const ReimagineItModal: React.FC<ReimagineItModalProps> = ({
  isOpen,
  onClose,
  imageUrl,
  layerName,
  onAcceptReimaged,
  onKeepOriginal,
}) => {
  const [prompt, setPrompt] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('input');
  const [reimaginedUrl, setReimaginedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState<'side-by-side' | 'slider'>('side-by-side');
  const [sliderPosition, setSliderPosition] = useState(50);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) {
      setError('Please enter a prompt describing what to add');
      return;
    }

    setViewMode('loading');
    setError(null);

    try {
      const { data } = await imaginationApi.reimagineImage({
        imageUrl,
        prompt: prompt.trim(),
      });

      const newUrl = data.processedUrl || data.imageUrl || data.url;
      if (newUrl) {
        setReimaginedUrl(newUrl);
        setViewMode('compare');
      } else {
        throw new Error('No image URL returned');
      }
    } catch (err: any) {
      console.error('Reimagine failed:', err);
      setError(err.response?.data?.error || err.message || 'Failed to reimagine image');
      setViewMode('input');
    }
  }, [imageUrl, prompt]);

  const handleAccept = useCallback(() => {
    if (reimaginedUrl) {
      onAcceptReimaged(reimaginedUrl);
      handleReset();
    }
  }, [reimaginedUrl, onAcceptReimaged]);

  const handleKeepOriginal = useCallback(() => {
    onKeepOriginal();
    handleReset();
  }, [onKeepOriginal]);

  const handleReset = useCallback(() => {
    setPrompt('');
    setViewMode('input');
    setReimaginedUrl(null);
    setError(null);
    onClose();
  }, [onClose]);

  const handleTryAgain = useCallback(() => {
    setViewMode('input');
    setReimaginedUrl(null);
  }, []);

  const handleSliderMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.min(100, Math.max(0, (x / rect.width) * 100));
    setSliderPosition(percentage);
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-card rounded-2xl shadow-2xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-500 via-pink-500 to-purple-600 p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-3xl">&#10024;</span>
            <div>
              <h2 className="text-xl font-bold text-white">Reimagine It</h2>
              <p className="text-white/80 text-sm">Transform your image with AI magic</p>
            </div>
          </div>
          <button
            onClick={handleReset}
            className="text-white/80 hover:text-white p-2 rounded-lg hover:bg-white/10 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {viewMode === 'input' && (
            <div className="space-y-6">
              {/* Current Image Preview */}
              <div className="text-center">
                <p className="text-muted text-sm mb-2">Current Image: {layerName}</p>
                <div className="inline-block rounded-xl overflow-hidden border-2 border-primary/30 bg-[url('/checkered-bg.png')] bg-repeat">
                  <img
                    src={imageUrl}
                    alt="Current"
                    className="max-w-[300px] max-h-[200px] object-contain"
                    crossOrigin="anonymous"
                  />
                </div>
              </div>

              {/* Prompt Input */}
              <div>
                <label className="block text-sm font-medium text-text mb-2">
                  What do you want to add to this image?
                </label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="e.g., Add a crown on top, add sparkles, add a sunset background..."
                  className="w-full px-4 py-3 bg-bg border border-primary/30 rounded-xl text-text placeholder-muted focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                  rows={3}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.ctrlKey) {
                      handleGenerate();
                    }
                  }}
                />
                <p className="text-xs text-muted mt-1">Press Ctrl+Enter to generate</p>
              </div>

              {/* Example Prompts */}
              <div>
                <p className="text-sm text-muted mb-2">Try these ideas:</p>
                <div className="flex flex-wrap gap-2">
                  {EXAMPLE_PROMPTS.map((example) => (
                    <button
                      key={example}
                      onClick={() => setPrompt(example)}
                      className="px-3 py-1.5 text-xs bg-primary/10 hover:bg-primary/20 text-primary rounded-full transition-colors"
                    >
                      {example}
                    </button>
                  ))}
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                  {error}
                </div>
              )}

              {/* Generate Button */}
              <button
                onClick={handleGenerate}
                disabled={!prompt.trim()}
                className="w-full py-4 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 disabled:from-gray-400 disabled:to-gray-500 text-white font-bold rounded-xl transition-all shadow-lg hover:shadow-xl disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <span className="text-xl">&#10024;</span>
                <span>Reimagine It</span>
              </button>
            </div>
          )}

          {viewMode === 'loading' && (
            <div className="flex flex-col items-center justify-center py-16 space-y-6">
              <div className="relative">
                <img
                  src="/mr-imagine/mr-imagine-waving.png"
                  alt="Mr. Imagine"
                  className="w-32 h-32 object-contain animate-bounce"
                />
                <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-20 h-2 bg-purple-500/30 rounded-full blur-sm animate-pulse" />
              </div>
              <div className="text-center">
                <p className="text-lg font-semibold text-text">Mr. Imagine is working his magic...</p>
                <p className="text-sm text-muted">Adding "{prompt}" to your image</p>
              </div>
            </div>
          )}

          {viewMode === 'compare' && reimaginedUrl && (
            <div className="space-y-6">
              {/* Compare Mode Toggle */}
              <div className="flex justify-center gap-2">
                <button
                  onClick={() => setCompareMode('side-by-side')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    compareMode === 'side-by-side'
                      ? 'bg-primary text-white'
                      : 'bg-primary/10 text-primary hover:bg-primary/20'
                  }`}
                >
                  Side by Side
                </button>
                <button
                  onClick={() => setCompareMode('slider')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    compareMode === 'slider'
                      ? 'bg-primary text-white'
                      : 'bg-primary/10 text-primary hover:bg-primary/20'
                  }`}
                >
                  Slider Compare
                </button>
              </div>

              {/* Comparison View */}
              {compareMode === 'side-by-side' ? (
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center">
                    <p className="text-sm font-medium text-muted mb-2">Original</p>
                    <div className="rounded-xl overflow-hidden border-2 border-primary/30 bg-[url('/checkered-bg.png')] bg-repeat">
                      <img
                        src={imageUrl}
                        alt="Original"
                        className="w-full h-auto max-h-[300px] object-contain"
                        crossOrigin="anonymous"
                      />
                    </div>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-purple-500 mb-2">Reimagined</p>
                    <div className="rounded-xl overflow-hidden border-2 border-purple-500/50 bg-[url('/checkered-bg.png')] bg-repeat">
                      <img
                        src={reimaginedUrl}
                        alt="Reimagined"
                        className="w-full h-auto max-h-[300px] object-contain"
                        crossOrigin="anonymous"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  className="relative rounded-xl overflow-hidden border-2 border-primary/30 cursor-ew-resize select-none"
                  onMouseMove={handleSliderMove}
                >
                  {/* Original (background) */}
                  <img
                    src={imageUrl}
                    alt="Original"
                    className="w-full h-auto max-h-[400px] object-contain"
                    crossOrigin="anonymous"
                  />
                  {/* Reimagined (overlay with clip) */}
                  <div
                    className="absolute inset-0 overflow-hidden"
                    style={{ clipPath: `inset(0 ${100 - sliderPosition}% 0 0)` }}
                  >
                    <img
                      src={reimaginedUrl}
                      alt="Reimagined"
                      className="w-full h-auto max-h-[400px] object-contain"
                      crossOrigin="anonymous"
                    />
                  </div>
                  {/* Slider line */}
                  <div
                    className="absolute top-0 bottom-0 w-1 bg-purple-500 shadow-lg"
                    style={{ left: `${sliderPosition}%`, transform: 'translateX(-50%)' }}
                  >
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-purple-500 rounded-full flex items-center justify-center shadow-lg">
                      <span className="text-white text-sm">&#8596;</span>
                    </div>
                  </div>
                  {/* Labels */}
                  <div className="absolute top-2 left-2 px-2 py-1 bg-black/50 rounded text-white text-xs">Original</div>
                  <div className="absolute top-2 right-2 px-2 py-1 bg-purple-500/80 rounded text-white text-xs">Reimagined</div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="grid grid-cols-3 gap-3">
                <button
                  onClick={handleKeepOriginal}
                  className="py-3 bg-bg border border-primary/30 hover:bg-primary/10 text-text font-medium rounded-xl transition-colors"
                >
                  Keep Original
                </button>
                <button
                  onClick={handleTryAgain}
                  className="py-3 bg-primary/10 hover:bg-primary/20 text-primary font-medium rounded-xl transition-colors"
                >
                  Try Again
                </button>
                <button
                  onClick={handleAccept}
                  className="py-3 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white font-bold rounded-xl transition-all shadow-lg hover:shadow-xl"
                >
                  Use Reimagined
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReimagineItModal;
