// src/components/imagination/ImageCompareModal.tsx
// BEFORE/AFTER image comparison modal with draggable slider

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X, ZoomIn, ZoomOut, RotateCcw, Check, ArrowLeft, ArrowRight } from 'lucide-react';
import { CHECKERBOARD_BG } from './checkerboard';

interface ImageCompareModalProps {
  isOpen: boolean;
  onClose: () => void;
  beforeImage: string;
  afterImage: string;
  beforeLabel?: string;
  afterLabel?: string;
  title?: string;
  onAccept?: () => void;
  onRevert?: () => void;
  metadata?: {
    beforeDimensions?: { width: number; height: number };
    afterDimensions?: { width: number; height: number };
    beforeDpi?: number;
    afterDpi?: number;
    operation?: string;
  };
}

const ImageCompareModal: React.FC<ImageCompareModalProps> = ({
  isOpen,
  onClose,
  beforeImage,
  afterImage,
  beforeLabel = 'Before',
  afterLabel = 'After',
  title = 'Compare Results',
  onAccept,
  onRevert,
  metadata,
}) => {
  const [sliderPosition, setSliderPosition] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [viewMode, setViewMode] = useState<'slider' | 'side-by-side' | 'toggle'>('slider');
  const [showAfter, setShowAfter] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });

  // Load image dimensions
  useEffect(() => {
    if (afterImage) {
      const img = new Image();
      img.onload = () => {
        setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.src = afterImage;
    }
  }, [afterImage]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPosition(percentage);
  }, [isDragging]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = e.touches[0].clientX - rect.left;
    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPosition(percentage);
  }, []);

  useEffect(() => {
    const handleGlobalMouseUp = () => setIsDragging(false);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') setSliderPosition(p => Math.max(0, p - 5));
      if (e.key === 'ArrowRight') setSliderPosition(p => Math.min(100, p + 5));
      if (e.key === ' ') {
        e.preventDefault();
        setShowAfter(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-card text-text rounded-2xl shadow-2xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-primary/20 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-serif font-bold text-text">{title}</h2>
            {metadata?.operation && (
              <p className="text-sm text-muted mt-1">
                Operation: {metadata.operation}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-primary/10 rounded-full transition-colors"
          >
            <X className="w-5 h-5 text-muted" />
          </button>
        </div>

        {/* View mode tabs */}
        <div className="px-6 py-3 border-b border-primary/10 flex items-center gap-4">
          <div className="flex bg-bg rounded-lg p-1">
            <button
              onClick={() => setViewMode('slider')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'slider' ? 'bg-card text-text shadow-sm' : 'text-muted hover:text-text'
              }`}
            >
              Slider
            </button>
            <button
              onClick={() => setViewMode('side-by-side')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'side-by-side' ? 'bg-card text-text shadow-sm' : 'text-muted hover:text-text'
              }`}
            >
              Side by Side
            </button>
            <button
              onClick={() => setViewMode('toggle')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'toggle' ? 'bg-card text-text shadow-sm' : 'text-muted hover:text-text'
              }`}
            >
              Toggle
            </button>
          </div>

          {/* Zoom controls */}
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={() => setZoom(z => Math.max(0.5, z - 0.25))}
              className="p-1.5 hover:bg-primary/10 rounded-lg transition-colors"
              title="Zoom out"
            >
              <ZoomOut className="w-4 h-4 text-muted" />
            </button>
            <span className="text-sm text-muted min-w-[3rem] text-center">{Math.round(zoom * 100)}%</span>
            <button
              onClick={() => setZoom(z => Math.min(3, z + 0.25))}
              className="p-1.5 hover:bg-primary/10 rounded-lg transition-colors"
              title="Zoom in"
            >
              <ZoomIn className="w-4 h-4 text-muted" />
            </button>
            <button
              onClick={() => { setZoom(1); setSliderPosition(50); }}
              className="p-1.5 hover:bg-primary/10 rounded-lg transition-colors"
              title="Reset view"
            >
              <RotateCcw className="w-4 h-4 text-muted" />
            </button>
          </div>
        </div>

        {/* Compare view */}
        <div className="flex-1 overflow-auto p-6 bg-bg">
          {viewMode === 'slider' && (
            <div
              ref={containerRef}
              className={`relative w-full aspect-square max-h-[60vh] mx-auto ${CHECKERBOARD_BG} rounded-xl overflow-hidden shadow-lg cursor-col-resize select-none`}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onTouchMove={handleTouchMove}
              style={{ transform: `scale(${zoom})`, transformOrigin: 'center' }}
            >
              {/* Before image (full) */}
              <img
                src={beforeImage}
                alt={beforeLabel}
                className="absolute inset-0 w-full h-full object-contain"
                draggable={false}
              />

              {/* After image (clipped) */}
              <div
                className="absolute inset-0 overflow-hidden"
                style={{ clipPath: `inset(0 ${100 - sliderPosition}% 0 0)` }}
              >
                <img
                  src={afterImage}
                  alt={afterLabel}
                  className="absolute inset-0 w-full h-full object-contain"
                  draggable={false}
                />
              </div>

              {/* Slider line */}
              <div
                className="absolute top-0 bottom-0 w-1 bg-white shadow-lg cursor-col-resize"
                style={{ left: `${sliderPosition}%`, transform: 'translateX(-50%)' }}
              >
                {/* Slider handle */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 bg-white rounded-full shadow-lg flex items-center justify-center">
                  <ArrowLeft className="w-3 h-3 text-stone-600 -mr-0.5" />
                  <ArrowRight className="w-3 h-3 text-stone-600 -ml-0.5" />
                </div>
              </div>

              {/* Labels */}
              <div className="absolute top-4 left-4 px-3 py-1.5 bg-black/70 text-white text-sm font-medium rounded-full">
                {beforeLabel}
              </div>
              <div className="absolute top-4 right-4 px-3 py-1.5 bg-purple-600 text-white text-sm font-medium rounded-full">
                {afterLabel}
              </div>
            </div>
          )}

          {viewMode === 'side-by-side' && (
            <div className="grid grid-cols-2 gap-4 max-h-[60vh]" style={{ transform: `scale(${zoom})`, transformOrigin: 'center' }}>
              <div className={`relative ${CHECKERBOARD_BG} rounded-xl overflow-hidden shadow-lg`}>
                <img src={beforeImage} alt={beforeLabel} className="w-full h-full object-contain" />
                <div className="absolute top-4 left-4 px-3 py-1.5 bg-black/70 text-white text-sm font-medium rounded-full">
                  {beforeLabel}
                </div>
              </div>
              <div className={`relative ${CHECKERBOARD_BG} rounded-xl overflow-hidden shadow-lg`}>
                <img src={afterImage} alt={afterLabel} className="w-full h-full object-contain" />
                <div className="absolute top-4 left-4 px-3 py-1.5 bg-purple-600 text-white text-sm font-medium rounded-full">
                  {afterLabel}
                </div>
              </div>
            </div>
          )}

          {viewMode === 'toggle' && (
            <div className="relative max-h-[60vh] mx-auto" style={{ transform: `scale(${zoom})`, transformOrigin: 'center' }}>
              <div className={`relative ${CHECKERBOARD_BG} rounded-xl overflow-hidden shadow-lg`}>
                <img
                  src={showAfter ? afterImage : beforeImage}
                  alt={showAfter ? afterLabel : beforeLabel}
                  className="w-full h-full object-contain transition-opacity duration-300"
                />
                <div className={`absolute top-4 left-4 px-3 py-1.5 ${showAfter ? 'bg-purple-600' : 'bg-black/70'} text-white text-sm font-medium rounded-full`}>
                  {showAfter ? afterLabel : beforeLabel}
                </div>
              </div>
              <button
                onClick={() => setShowAfter(prev => !prev)}
                className="mt-4 mx-auto block px-6 py-2 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 transition-colors"
              >
                Toggle View (Space)
              </button>
            </div>
          )}
        </div>

        {/* Metadata display */}
        {metadata && (metadata.beforeDimensions || metadata.afterDimensions || metadata.beforeDpi || metadata.afterDpi) && (
          <div className="px-6 py-3 bg-bg border-t border-primary/10">
            <div className="flex items-center justify-center gap-8 text-sm">
              {metadata.beforeDimensions && (
                <div className="text-muted">
                  <span className="font-medium text-text">Before:</span> {metadata.beforeDimensions.width} × {metadata.beforeDimensions.height}px
                  {metadata.beforeDpi && <span className="ml-2 text-muted">({metadata.beforeDpi} DPI)</span>}
                </div>
              )}
              {metadata.afterDimensions && (
                <div className="text-purple-400">
                  <span className="font-medium">After:</span> {metadata.afterDimensions.width} × {metadata.afterDimensions.height}px
                  {metadata.afterDpi && <span className="ml-2 text-purple-300">({metadata.afterDpi} DPI)</span>}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer actions */}
        <div className="px-6 py-4 border-t border-primary/20 flex items-center justify-between bg-card">
          <p className="text-sm text-muted">
            Use arrow keys to adjust slider, Space to toggle
          </p>
          <div className="flex items-center gap-3">
            {onRevert && (
              <button
                onClick={onRevert}
                className="px-4 py-2 text-text hover:bg-primary/10 rounded-lg font-medium transition-colors"
              >
                Revert to Original
              </button>
            )}
            {onAccept && (
              <button
                onClick={onAccept}
                className="px-6 py-2 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 transition-colors flex items-center gap-2"
              >
                <Check className="w-4 h-4" />
                Accept Changes
              </button>
            )}
            <button
              onClick={onClose}
              className="px-4 py-2 bg-primary/10 text-text rounded-lg font-medium hover:bg-primary/20 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImageCompareModal;
