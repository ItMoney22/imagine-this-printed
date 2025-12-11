// src/components/imagination/SheetCanvas.tsx

import React, { useRef, useEffect, useCallback } from 'react';
import { Stage, Layer, Rect, Image, Transformer, Line } from 'react-konva';
import Konva from 'konva';
import useImage from 'use-image';
import type { ImaginationSheet, ImaginationLayer, CanvasState } from '../../types';

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
}> = ({ layer, isSelected, onSelect, onChange }) => {
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

  // Set initial dimensions when image loads
  useEffect(() => {
    if (image && shapeRef.current && layer.width === 100 && layer.height === 100) {
      // Default size - set to actual image size scaled to 2 inches
      const aspectRatio = image.width / image.height;
      const targetWidth = 2 * PIXELS_PER_INCH; // 2 inches
      const targetHeight = targetWidth / aspectRatio;

      onChange({
        width: targetWidth,
        height: targetHeight
      });
    }
  }, [image, layer.width, layer.height, onChange]);

  if (!image) return null;

  return (
    <>
      <Image
        ref={shapeRef}
        image={image}
        x={layer.position_x * PIXELS_PER_INCH}
        y={layer.position_y * PIXELS_PER_INCH}
        width={layer.width}
        height={layer.height}
        rotation={layer.rotation}
        scaleX={layer.scale_x}
        scaleY={layer.scale_y}
        draggable
        onClick={onSelect}
        onTap={onSelect}
        onDragEnd={(e) => {
          onChange({
            position_x: e.target.x() / PIXELS_PER_INCH,
            position_y: e.target.y() / PIXELS_PER_INCH
          });
        }}
        onTransformEnd={(e) => {
          const node = shapeRef.current;
          if (!node) return;

          onChange({
            position_x: node.x() / PIXELS_PER_INCH,
            position_y: node.y() / PIXELS_PER_INCH,
            width: node.width() * node.scaleX(),
            height: node.height() * node.scaleY(),
            rotation: node.rotation(),
            scale_x: 1,
            scale_y: 1
          });

          // Reset scale after applying
          node.scaleX(1);
          node.scaleY(1);
        }}
      />
      {isSelected && (
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
  updateCanvasState
}) => {
  const stageRef = useRef<Konva.Stage>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = React.useState({ width: 800, height: 600 });

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

  // Center sheet in view
  const offsetX = (stageSize.width - sheetWidth * zoom) / 2;
  const offsetY = (stageSize.height - sheetHeight * zoom) / 2;

  // Mouse wheel zoom
  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();

    const scaleBy = 1.1;
    const oldScale = zoom;
    const newScale = e.evt.deltaY < 0
      ? Math.min(oldScale * scaleBy, 4)
      : Math.max(oldScale / scaleBy, 0.25);

    setZoom(newScale);
  }, [zoom, setZoom]);

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

  return (
    <div ref={containerRef} className="w-full h-full bg-neutral-900 overflow-hidden">
      <Stage
        ref={stageRef}
        width={stageSize.width}
        height={stageSize.height}
        scaleX={zoom}
        scaleY={zoom}
        x={offsetX}
        y={offsetY}
        onWheel={handleWheel}
        onClick={handleStageClick}
        onTap={handleStageClick}
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
        </Layer>

        {/* Elements Layer */}
        <Layer>
          {layers
            .sort((a, b) => a.z_index - b.z_index)
            .map(layer => (
              <CanvasImage
                key={layer.id}
                layer={layer}
                isSelected={selectedLayerIds.includes(layer.id)}
                onSelect={(e) => {
                  e.cancelBubble = true;
                  selectLayer(layer.id, e.evt.shiftKey);
                }}
                onChange={(attrs) => handleLayerChange(layer.id, attrs)}
              />
            ))}
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
