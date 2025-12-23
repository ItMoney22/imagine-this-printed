// src/components/imagination/SheetCanvas.tsx

import React, { useRef, useEffect, useCallback } from 'react';
import { Stage, Layer, Rect, Image, Transformer, Line, Text, Circle, Star, RegularPolygon } from 'react-konva';
import Konva from 'konva';
import useImage from 'use-image';
import type { ImaginationSheet, ImaginationLayer, CanvasState } from '../../types';
import { calculateDpi, getDpiQualityDisplay, type DpiInfo } from '../../utils/dpi-calculator';

interface SheetCanvasProps {
  sheet: ImaginationSheet;
  layers: ImaginationLayer[];
  setLayers: React.Dispatch<React.SetStateAction<ImaginationLayer[]>>;
  selectedLayerIds: string[];
  selectLayer: (id: string, multi?: boolean) => void;
  clearSelection: () => void;
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  gridEnabled: boolean;
  snapEnabled: boolean;
  canvasState: CanvasState | null;
  updateCanvasState: (state: CanvasState) => void;
  showCutLines?: boolean;
  mirrorForSublimation?: boolean;
  showSafeMargin?: boolean;
}

// DPI for print = 300, screen DPI ~ 96
const PRINT_DPI = 300;
const SCREEN_DPI = 96;
const PIXELS_PER_INCH = SCREEN_DPI; // Use screen DPI for canvas

// Konva Image element
const CanvasImage: React.FC<{
  layer: ImaginationLayer;
  isSelected: boolean;
  onSelect: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  onChange: (attrs: Partial<ImaginationLayer>) => void;
  showCutLines?: boolean;
}> = ({ layer, isSelected, onSelect, onChange, showCutLines }) => {
  const imageUrl = layer.processed_url || layer.source_url;
  const [image] = useImage(imageUrl || '', 'anonymous');
  const shapeRef = useRef<Konva.Image>(null);
  const trRef = useRef<Konva.Transformer>(null);

  useEffect(() => {
    if (isSelected && trRef.current && shapeRef.current) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected]);

  // Set initial dimensions when image loads (for legacy layers with pixel-based dimensions)
  // New layers should be created with proper inch-based dimensions
  useEffect(() => {
    if (image && shapeRef.current && (layer.width === 100 || layer.width * PIXELS_PER_INCH < 50)) {
      // Legacy layer or very small dimension - set to proper inches
      const aspectRatio = image.width / image.height;
      const targetWidthInches = 4; // 4 inches default
      const targetHeightInches = targetWidthInches / aspectRatio;

      onChange({
        width: targetWidthInches,
        height: targetHeightInches
      });
    }
  }, [image, layer.width, onChange]);

  if (!image) return null;

  return (
    <>
      <Image
        ref={shapeRef}
        image={image}
        x={layer.position_x * PIXELS_PER_INCH}
        y={layer.position_y * PIXELS_PER_INCH}
        width={layer.width * PIXELS_PER_INCH}
        height={layer.height * PIXELS_PER_INCH}
        rotation={layer.rotation}
        scaleX={layer.scale_x}
        scaleY={layer.scale_y}
        opacity={layer.metadata?.opacity ?? 1}
        draggable={!(layer.metadata?.locked ?? false)}
        onClick={onSelect}
        onTap={onSelect}
        onDragEnd={(e) => {
          if (layer.metadata?.locked) return;
          onChange({
            position_x: e.target.x() / PIXELS_PER_INCH,
            position_y: e.target.y() / PIXELS_PER_INCH
          });
        }}
        onTransformEnd={(e) => {
          if (layer.metadata?.locked) return;
          const node = shapeRef.current;
          if (!node) return;

          // node.width() and node.height() return pixels (since we rendered with PIXELS_PER_INCH multiplier)
          const newWidthPixels = node.width() * node.scaleX();
          const newHeightPixels = node.height() * node.scaleY();

          // Convert back to inches for storage
          const newWidthInches = newWidthPixels / PIXELS_PER_INCH;
          const newHeightInches = newHeightPixels / PIXELS_PER_INCH;

          // Recalculate DPI if we have original dimensions
          let newDpiInfo: DpiInfo | undefined = undefined;
          if (layer.metadata?.originalWidth && layer.metadata?.originalHeight) {
            newDpiInfo = calculateDpi(
              layer.metadata.originalWidth,
              layer.metadata.originalHeight,
              newWidthInches,
              newHeightInches
            );
          }

          onChange({
            position_x: node.x() / PIXELS_PER_INCH,
            position_y: node.y() / PIXELS_PER_INCH,
            width: newWidthInches,
            height: newHeightInches,
            rotation: node.rotation(),
            scale_x: 1,
            scale_y: 1,
            metadata: {
              ...layer.metadata,
              dpiInfo: newDpiInfo || layer.metadata?.dpiInfo,
            }
          });

          // Reset scale after applying
          node.scaleX(1);
          node.scaleY(1);
        }}
      />
      {showCutLines && (
        <Rect
          x={layer.position_x * PIXELS_PER_INCH}
          y={layer.position_y * PIXELS_PER_INCH}
          width={layer.width * PIXELS_PER_INCH}
          height={layer.height * PIXELS_PER_INCH}
          rotation={layer.rotation}
          scaleX={layer.scale_x}
          scaleY={layer.scale_y}
          stroke="#FF0000"
          strokeWidth={2}
          dash={[5, 5]}
          listening={false}
        />
      )}
      {/* DPI Quality Indicator */}
      {layer.metadata?.dpiInfo && (layer.metadata.dpiInfo.quality === 'warning' || layer.metadata.dpiInfo.quality === 'danger') && (
        <>
          {/* Warning border overlay */}
          <Rect
            x={layer.position_x * PIXELS_PER_INCH}
            y={layer.position_y * PIXELS_PER_INCH}
            width={layer.width * PIXELS_PER_INCH}
            height={layer.height * PIXELS_PER_INCH}
            rotation={layer.rotation}
            scaleX={layer.scale_x}
            scaleY={layer.scale_y}
            stroke={layer.metadata.dpiInfo.quality === 'danger' ? '#EF4444' : '#F59E0B'}
            strokeWidth={3}
            listening={false}
          />
          {/* DPI badge in top-left corner */}
          <Rect
            x={layer.position_x * PIXELS_PER_INCH}
            y={layer.position_y * PIXELS_PER_INCH - 24}
            width={80}
            height={20}
            fill={layer.metadata.dpiInfo.quality === 'danger' ? '#EF4444' : '#F59E0B'}
            cornerRadius={4}
            listening={false}
          />
          <Text
            x={layer.position_x * PIXELS_PER_INCH + 4}
            y={layer.position_y * PIXELS_PER_INCH - 21}
            text={`${layer.metadata.dpiInfo.dpi} DPI`}
            fontSize={12}
            fontFamily="sans-serif"
            fill="white"
            listening={false}
          />
        </>
      )}
      {isSelected && !(layer.metadata?.locked ?? false) && (
        <Transformer
          ref={trRef}
          boundBoxFunc={(oldBox, newBox) => {
            // Limit minimum size
            if (newBox.width < 20 || newBox.height < 20) {
              return oldBox;
            }
            return newBox;
          }}
          rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
          rotationSnapTolerance={5}
        />
      )}
    </>
  );
};

// Konva Text element
const CanvasText: React.FC<{
  layer: ImaginationLayer;
  isSelected: boolean;
  onSelect: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  onChange: (attrs: Partial<ImaginationLayer>) => void;
}> = ({ layer, isSelected, onSelect, onChange }) => {
  const shapeRef = useRef<Konva.Text>(null);
  const trRef = useRef<Konva.Transformer>(null);

  useEffect(() => {
    if (isSelected && trRef.current && shapeRef.current) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected]);

  const text = layer.metadata?.text || '';
  const fontSize = layer.metadata?.fontSize || 48;
  const fontFamily = layer.metadata?.fontFamily || 'Arial';
  const color = layer.metadata?.color || '#000000';

  return (
    <>
      <Text
        ref={shapeRef}
        x={layer.position_x * PIXELS_PER_INCH}
        y={layer.position_y * PIXELS_PER_INCH}
        text={text}
        fontSize={fontSize}
        fontFamily={fontFamily}
        fill={color}
        rotation={layer.rotation}
        opacity={layer.metadata?.opacity ?? 1}
        draggable={!(layer.metadata?.locked ?? false)}
        onClick={onSelect}
        onTap={onSelect}
        onDragEnd={(e) => {
          if (layer.metadata?.locked) return;
          onChange({
            position_x: e.target.x() / PIXELS_PER_INCH,
            position_y: e.target.y() / PIXELS_PER_INCH
          });
        }}
        onTransformEnd={(e) => {
          if (layer.metadata?.locked) return;
          const node = shapeRef.current;
          if (!node) return;

          // For text, we mainly care about position and rotation
          // Scale affects font size
          const newScaleX = node.scaleX();
          const newFontSize = fontSize * newScaleX;

          onChange({
            position_x: node.x() / PIXELS_PER_INCH,
            position_y: node.y() / PIXELS_PER_INCH,
            rotation: node.rotation(),
            metadata: {
              ...layer.metadata,
              fontSize: newFontSize,
            }
          });

          // Reset scale
          node.scaleX(1);
          node.scaleY(1);
        }}
      />
      {isSelected && !(layer.metadata?.locked ?? false) && (
        <Transformer
          ref={trRef}
          rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
          rotationSnapTolerance={5}
          enabledAnchors={['middle-left', 'middle-right']}
        />
      )}
    </>
  );
};

// Konva Shape element (rectangle, circle, star, triangle, line)
const CanvasShape: React.FC<{
  layer: ImaginationLayer;
  isSelected: boolean;
  onSelect: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  onChange: (attrs: Partial<ImaginationLayer>) => void;
}> = ({ layer, isSelected, onSelect, onChange }) => {
  const shapeRef = useRef<any>(null);
  const trRef = useRef<Konva.Transformer>(null);

  useEffect(() => {
    if (isSelected && trRef.current && shapeRef.current) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected]);

  const shapeType = layer.metadata?.shapeType || 'rectangle';
  const fill = layer.metadata?.fill || '#8B5CF6';
  const stroke = layer.metadata?.stroke || '#7C3AED';
  const strokeWidth = layer.metadata?.strokeWidth || 2;
  const isArrow = layer.metadata?.isArrow || false;

  const baseProps = {
    x: layer.position_x * PIXELS_PER_INCH,
    y: layer.position_y * PIXELS_PER_INCH,
    rotation: layer.rotation,
    opacity: layer.metadata?.opacity ?? 1,
    draggable: !(layer.metadata?.locked ?? false),
    onClick: onSelect,
    onTap: onSelect,
    onDragEnd: (e: any) => {
      if (layer.metadata?.locked) return;
      onChange({
        position_x: e.target.x() / PIXELS_PER_INCH,
        position_y: e.target.y() / PIXELS_PER_INCH
      });
    },
    onTransformEnd: (e: any) => {
      if (layer.metadata?.locked) return;
      const node = shapeRef.current;
      if (!node) return;

      // Get pixel dimensions after transform
      const newWidthPixels = node.width ? node.width() * node.scaleX() : layer.width * PIXELS_PER_INCH;
      const newHeightPixels = node.height ? node.height() * node.scaleY() : layer.height * PIXELS_PER_INCH;

      // Convert back to inches for storage
      onChange({
        position_x: node.x() / PIXELS_PER_INCH,
        position_y: node.y() / PIXELS_PER_INCH,
        width: newWidthPixels / PIXELS_PER_INCH,
        height: newHeightPixels / PIXELS_PER_INCH,
        rotation: node.rotation(),
        scale_x: 1,
        scale_y: 1,
      });

      // Reset scale
      node.scaleX(1);
      node.scaleY(1);
    }
  };

  // Convert inches to pixels for rendering
  const widthPx = layer.width * PIXELS_PER_INCH;
  const heightPx = layer.height * PIXELS_PER_INCH;

  let shapeElement = null;

  switch (shapeType) {
    case 'rectangle':
      shapeElement = (
        <Rect
          ref={shapeRef}
          {...baseProps}
          width={widthPx}
          height={heightPx}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      );
      break;

    case 'circle':
      const radius = Math.min(widthPx, heightPx) / 2;
      shapeElement = (
        <Circle
          ref={shapeRef}
          {...baseProps}
          radius={radius}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      );
      break;

    case 'star':
      shapeElement = (
        <Star
          ref={shapeRef}
          {...baseProps}
          numPoints={5}
          innerRadius={Math.min(widthPx, heightPx) / 4}
          outerRadius={Math.min(widthPx, heightPx) / 2}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      );
      break;

    case 'triangle':
      shapeElement = (
        <RegularPolygon
          ref={shapeRef}
          {...baseProps}
          sides={3}
          radius={Math.min(widthPx, heightPx) / 2}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      );
      break;

    case 'line':
      const points = isArrow
        ? [0, 0, widthPx, 0]
        : [0, 0, widthPx, 0];
      shapeElement = (
        <Line
          ref={shapeRef}
          {...baseProps}
          points={points}
          stroke={stroke}
          strokeWidth={strokeWidth}
          lineCap="round"
          lineJoin="round"
          pointerLength={isArrow ? 10 : 0}
          pointerWidth={isArrow ? 10 : 0}
        />
      );
      break;

    default:
      return null;
  }

  return (
    <>
      {shapeElement}
      {isSelected && !(layer.metadata?.locked ?? false) && (
        <Transformer
          ref={trRef}
          rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
          rotationSnapTolerance={5}
          boundBoxFunc={(oldBox, newBox) => {
            // Limit minimum size
            if (newBox.width < 20 || newBox.height < 20) {
              return oldBox;
            }
            return newBox;
          }}
        />
      )}
    </>
  );
};

const SheetCanvas: React.FC<SheetCanvasProps> = ({
  sheet,
  layers,
  setLayers,
  selectedLayerIds,
  selectLayer,
  clearSelection,
  zoom,
  setZoom,
  gridEnabled,
  snapEnabled,
  canvasState,
  updateCanvasState,
  showCutLines = false,
  mirrorForSublimation = false,
  showSafeMargin = false
}) => {
  const stageRef = useRef<Konva.Stage>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = React.useState({ width: 800, height: 600 });

  // Pan state for large sheet navigation
  const [panOffset, setPanOffset] = React.useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = React.useState(false);
  const [lastPointerPosition, setLastPointerPosition] = React.useState({ x: 0, y: 0 });

  // Sheet dimensions in pixels
  const sheetWidth = sheet.sheet_width * PIXELS_PER_INCH;
  const sheetHeight = sheet.sheet_height * PIXELS_PER_INCH;

  // Resize handler
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setStageSize({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight
        });
      }
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Reset pan when zoom changes significantly or sheet changes
  useEffect(() => {
    // Don't reset pan automatically - let user control it
  }, [zoom, sheet.id]);

  // Center sheet in view (with pan offset for navigation)
  const baseOffsetX = (stageSize.width - sheetWidth * zoom) / 2;
  const baseOffsetY = (stageSize.height - sheetHeight * zoom) / 2;
  const offsetX = baseOffsetX + panOffset.x;
  const offsetY = baseOffsetY + panOffset.y;

  // Constrain pan to keep sheet visible
  const constrainPan = useCallback((newPanX: number, newPanY: number) => {
    const scaledWidth = sheetWidth * zoom;
    const scaledHeight = sheetHeight * zoom;

    // Allow panning with some margin (50px) to ensure sheet is always partially visible
    const margin = 50;
    const minX = -(scaledWidth - margin);
    const maxX = stageSize.width - margin;
    const minY = -(scaledHeight - margin);
    const maxY = stageSize.height - margin;

    // If sheet fits in view, center it
    if (scaledWidth <= stageSize.width) {
      newPanX = 0;
    } else {
      // Constrain horizontal pan
      const effectiveMinX = minX - baseOffsetX;
      const effectiveMaxX = maxX - baseOffsetX - scaledWidth;
      newPanX = Math.max(effectiveMinX, Math.min(effectiveMaxX, newPanX));
    }

    if (scaledHeight <= stageSize.height) {
      newPanY = 0;
    } else {
      // Constrain vertical pan
      const effectiveMinY = minY - baseOffsetY;
      const effectiveMaxY = maxY - baseOffsetY - scaledHeight;
      newPanY = Math.max(effectiveMinY, Math.min(effectiveMaxY, newPanY));
    }

    return { x: newPanX, y: newPanY };
  }, [sheetWidth, sheetHeight, zoom, stageSize, baseOffsetX, baseOffsetY]);

  // Mouse wheel zoom (with Ctrl) or pan (without Ctrl)
  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();

    // Ctrl+scroll = zoom, plain scroll = pan vertically, Shift+scroll = pan horizontally
    if (e.evt.ctrlKey || e.evt.metaKey) {
      // Zoom
      const scaleBy = 1.1;
      const oldScale = zoom;
      const newScale = e.evt.deltaY < 0
        ? Math.min(oldScale * scaleBy, 4)
        : Math.max(oldScale / scaleBy, 0.25);

      setZoom(newScale);
    } else {
      // Pan - deltaY for vertical, deltaX for horizontal (or shift+deltaY)
      const panSpeed = 1;
      let deltaX = e.evt.deltaX * panSpeed;
      let deltaY = e.evt.deltaY * panSpeed;

      // Shift+scroll for horizontal pan
      if (e.evt.shiftKey) {
        deltaX = e.evt.deltaY * panSpeed;
        deltaY = 0;
      }

      const newPan = constrainPan(panOffset.x - deltaX, panOffset.y - deltaY);
      setPanOffset(newPan);
    }
  }, [zoom, setZoom, panOffset, constrainPan]);

  // Panning: Left click on empty space, middle mouse button, or Alt+drag
  const handleMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    // Middle mouse button (button 1) or Alt key held - always pan
    if (e.evt.button === 1 || (e.evt.button === 0 && e.evt.altKey)) {
      e.evt.preventDefault();
      setIsPanning(true);
      setLastPointerPosition({ x: e.evt.clientX, y: e.evt.clientY });
      return;
    }

    // Left click on empty canvas background - pan (grab tool behavior)
    if (e.evt.button === 0) {
      const target = e.target;
      const isBackground = target === e.target.getStage() || target.name() === 'sheet-background';
      if (isBackground) {
        e.evt.preventDefault();
        setIsPanning(true);
        setLastPointerPosition({ x: e.evt.clientX, y: e.evt.clientY });
      }
    }
  }, []);

  const handleMouseMove = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!isPanning) return;

    const dx = e.evt.clientX - lastPointerPosition.x;
    const dy = e.evt.clientY - lastPointerPosition.y;

    const newPan = constrainPan(panOffset.x + dx, panOffset.y + dy);
    setPanOffset(newPan);
    setLastPointerPosition({ x: e.evt.clientX, y: e.evt.clientY });
  }, [isPanning, lastPointerPosition, panOffset, constrainPan]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  // Touch support for mobile panning
  const handleTouchStart = useCallback((e: Konva.KonvaEventObject<TouchEvent>) => {
    if (e.evt.touches.length === 2) {
      // Two-finger touch for panning (anywhere)
      const touch1 = e.evt.touches[0];
      const touch2 = e.evt.touches[1];
      const centerX = (touch1.clientX + touch2.clientX) / 2;
      const centerY = (touch1.clientY + touch2.clientY) / 2;
      setLastPointerPosition({ x: centerX, y: centerY });
      setIsPanning(true);
    } else if (e.evt.touches.length === 1) {
      // Single finger on background - pan (grab tool behavior)
      const target = e.target;
      const isBackground = target === e.target.getStage() || target.name() === 'sheet-background';
      if (isBackground) {
        const touch = e.evt.touches[0];
        setLastPointerPosition({ x: touch.clientX, y: touch.clientY });
        setIsPanning(true);
      }
    }
  }, []);

  const handleTouchMove = useCallback((e: Konva.KonvaEventObject<TouchEvent>) => {
    if (!isPanning) return;

    let centerX: number, centerY: number;

    if (e.evt.touches.length === 2) {
      const touch1 = e.evt.touches[0];
      const touch2 = e.evt.touches[1];
      centerX = (touch1.clientX + touch2.clientX) / 2;
      centerY = (touch1.clientY + touch2.clientY) / 2;
    } else if (e.evt.touches.length === 1) {
      centerX = e.evt.touches[0].clientX;
      centerY = e.evt.touches[0].clientY;
    } else {
      return;
    }

    const dx = centerX - lastPointerPosition.x;
    const dy = centerY - lastPointerPosition.y;

    const newPan = constrainPan(panOffset.x + dx, panOffset.y + dy);
    setPanOffset(newPan);
    setLastPointerPosition({ x: centerX, y: centerY });
  }, [isPanning, lastPointerPosition, panOffset, constrainPan]);

  const handleTouchEnd = useCallback(() => {
    setIsPanning(false);
  }, []);

  // Reset pan to center
  const resetPan = useCallback(() => {
    setPanOffset({ x: 0, y: 0 });
  }, []);

  // Update layer handler
  const handleLayerChange = useCallback((layerId: string, attrs: Partial<ImaginationLayer>) => {
    setLayers(prev => prev.map(l =>
      l.id === layerId ? { ...l, ...attrs } : l
    ));
  }, [setLayers]);

  // Click on empty space to deselect
  const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.target === e.target.getStage() || e.target.name() === 'sheet-background') {
      clearSelection();
    }
  };

  // Grid lines
  const gridLines = [];
  if (gridEnabled) {
    const gridSize = 0.25 * PIXELS_PER_INCH; // 0.25 inch grid

    // Vertical lines
    for (let x = 0; x <= sheetWidth; x += gridSize) {
      gridLines.push(
        <Line
          key={`v-${x}`}
          points={[x, 0, x, sheetHeight]}
          stroke="#333"
          strokeWidth={0.5}
          opacity={0.3}
        />
      );
    }

    // Horizontal lines
    for (let y = 0; y <= sheetHeight; y += gridSize) {
      gridLines.push(
        <Line
          key={`h-${y}`}
          points={[0, y, sheetWidth, y]}
          stroke="#333"
          strokeWidth={0.5}
          opacity={0.3}
        />
      );
    }
  }

  // Determine if sheet is larger than viewport (needs pan controls)
  const needsPan = sheetHeight * zoom > stageSize.height || sheetWidth * zoom > stageSize.width;

  return (
    <div ref={containerRef} className="w-full h-full bg-neutral-900 overflow-hidden relative">
      {/* Pan navigation hint - shows when sheet is larger than viewport */}
      {needsPan && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 bg-black/70 text-white text-xs rounded-full pointer-events-none flex items-center gap-2">
          <span>Click & drag to pan</span>
          <span className="text-white/60">|</span>
          <span>Ctrl+Scroll to zoom</span>
        </div>
      )}

      {/* Reset pan button - shows when panned away from center */}
      {(panOffset.x !== 0 || panOffset.y !== 0) && (
        <button
          onClick={resetPan}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg shadow-lg hover:bg-purple-700 transition-colors"
        >
          Center Sheet
        </button>
      )}

      <Stage
        ref={stageRef}
        width={stageSize.width}
        height={stageSize.height}
        scaleX={mirrorForSublimation ? -zoom : zoom}
        scaleY={zoom}
        x={mirrorForSublimation ? offsetX + sheetWidth * zoom : offsetX}
        y={offsetY}
        onWheel={handleWheel}
        onClick={handleStageClick}
        onTap={handleStageClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
      >
        {/* Background Layer */}
        <Layer>
          {/* Sheet Background */}
          <Rect
            name="sheet-background"
            x={0}
            y={0}
            width={sheetWidth}
            height={sheetHeight}
            fill="#ffffff"
            shadowColor="black"
            shadowBlur={20}
            shadowOpacity={0.3}
          />

          {/* Grid */}
          {gridLines}

          {/* Sheet Border */}
          <Rect
            x={0}
            y={0}
            width={sheetWidth}
            height={sheetHeight}
            stroke="#666"
            strokeWidth={2}
            listening={false}
          />

          {/* Safe Margin - 0.25" from edge */}
          {showSafeMargin && (
            <Rect
              x={0.25 * PIXELS_PER_INCH}
              y={0.25 * PIXELS_PER_INCH}
              width={sheetWidth - 0.5 * PIXELS_PER_INCH}
              height={sheetHeight - 0.5 * PIXELS_PER_INCH}
              stroke="#FF6B00"
              strokeWidth={2}
              dash={[10, 5]}
              listening={false}
            />
          )}
        </Layer>

        {/* Elements Layer */}
        <Layer>
          {layers
            .sort((a, b) => a.z_index - b.z_index)
            .map(layer => {
              const commonProps = {
                key: layer.id,
                layer,
                isSelected: selectedLayerIds.includes(layer.id),
                onSelect: (e: Konva.KonvaEventObject<MouseEvent>) => {
                  e.cancelBubble = true;
                  selectLayer(layer.id, e.evt.shiftKey);
                },
                onChange: (attrs: Partial<ImaginationLayer>) => handleLayerChange(layer.id, attrs),
              };

              // Render based on layer type
              if (layer.layer_type === 'text') {
                return <CanvasText {...commonProps} />;
              } else if (layer.layer_type === 'shape') {
                return <CanvasShape {...commonProps} />;
              } else {
                // Image or AI-generated layers
                return <CanvasImage {...commonProps} showCutLines={showCutLines} />;
              }
            })}
        </Layer>
      </Stage>

      {/* Rulers */}
      <div className="absolute top-0 left-12 right-0 h-6 bg-card border-b border-primary/20 flex items-end overflow-hidden pointer-events-none">
        {Array.from({ length: Math.ceil(sheet.sheet_width) + 1 }, (_, i) => (
          <div
            key={i}
            className="text-xs text-muted absolute"
            style={{ left: offsetX + i * PIXELS_PER_INCH * zoom - 8 }}
          >
            {i}"
          </div>
        ))}
      </div>

      <div className="absolute top-6 left-0 bottom-0 w-6 bg-card border-r border-primary/20 flex flex-col items-end overflow-hidden pointer-events-none">
        {Array.from({ length: Math.ceil(sheet.sheet_height) + 1 }, (_, i) => (
          <div
            key={i}
            className="text-xs text-muted absolute"
            style={{ top: offsetY + i * PIXELS_PER_INCH * zoom - 8 }}
          >
            {i}"
          </div>
        ))}
      </div>
    </div>
  );
};

export default SheetCanvas;
