// src/pages/ImaginationStation.tsx
// Imagination Station - Imagination Sheet™ Builder with Editorial Design

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/SupabaseAuthContext';
import { useCart } from '../context/CartContext';
import { imaginationApi, apiFetch } from '../lib/api';
import ErrorBoundary from '../components/ErrorBoundary';
import type {
  ImaginationSheet,
  ImaginationLayer,
  CanvasState,
  PrintType,
  ImaginationPricing,
  FreeTrialStatus,
  LayerType,
  Product,
} from '../types';
import { SheetCanvas, AddElementPanel, ImageCompareModal, MrImagineModal, ReimagineItModal } from '../components/imagination';
import type { Layer as SimpleLayer } from '../types';
import { calculateDpi, getDpiQualityDisplay, type DpiInfo } from '../utils/dpi-calculator';
import {
  Sparkles,
  Upload,
  Layers,
  Settings,
  ShoppingCart,
  Wand2,
  Grid3X3,
  Magnet,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronDown,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  RotateCcw,
  Copy,
  Move,
  Image as ImageIcon,
  Type,
  Square,
  Circle,
  LayoutGrid,
  Maximize2,
  Save,
  Clock,
  CheckCircle,
  AlertCircle,
  Loader2,
  ArrowRight,
  Coins,
  PanelLeft,
  PanelRight,
  User,
  Scissors,
  FlipHorizontal,
  Maximize,
  RefreshCw,
  Home,
  ShoppingBag,
  Undo2,
  Redo2
} from 'lucide-react';

// Sheet preset configurations
// Sheet presets - FIXED WIDTHS by print type, heights must match backend/config/imagination-presets.ts
// Sheet UI configurations (static data like colors/icons)
const PRESET_UI_CONFIG: Record<string, any> = {
  dtf: {
    color: 'from-purple-500 to-violet-600',
    bgColor: 'bg-purple-50',
    borderColor: 'border-purple-200',
    textColor: 'text-purple-700',
    icon: '🎨',
  },
  uv_dtf: {
    color: 'from-blue-500 to-cyan-500',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    textColor: 'text-blue-700',
    icon: '✨',
  },
  sublimation: {
    color: 'from-pink-500 to-rose-500',
    bgColor: 'bg-pink-50',
    borderColor: 'border-pink-200',
    textColor: 'text-pink-700',
    icon: '🌈',
  }
};

// Canvas constants
const PIXELS_PER_INCH = 96;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 3;

const ImaginationStation: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { addToCart } = useCart();

  // Wallet state - fetch lazily since it's not loaded with user for performance
  const [walletBalance, setWalletBalance] = useState<number>(0);

  // Fetch wallet balance on mount
  useEffect(() => {
    const fetchWallet = async () => {
      if (!user?.id) return;
      try {
        const response = await apiFetch('/api/wallet/get');
        if (response?.wallet?.itc_balance) {
          setWalletBalance(Number(response.wallet.itc_balance));
        }
      } catch (err) {
        console.error('[ImaginationStation] Failed to fetch wallet:', err);
      }
    };
    fetchWallet();
  }, [user?.id]);

  const itcBalance = walletBalance;
  const canvasRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasProcessedUrlImage = useRef(false);

  // Sheet state
  const [sheet, setSheet] = useState<ImaginationSheet | null>(null);
  const [layers, setLayers] = useState<ImaginationLayer[]>([]);
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]);
  const [recentSheets, setRecentSheets] = useState<ImaginationSheet[]>([]);
  const [canvasState, setCanvasState] = useState<CanvasState | null>(null);

  // UI state
  const [zoom, setZoom] = useState(0.5);
  const [gridEnabled, setGridEnabled] = useState(true);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [activePanel, setActivePanel] = useState<'layers' | 'tools' | 'ai' | 'export'>('layers');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const [leftSidebarVisible, setLeftSidebarVisible] = useState(true);
  const [rightSidebarVisible, setRightSidebarVisible] = useState(true);
  const [showProjectsModal, setShowProjectsModal] = useState(false);
  const [showMrImagineModal, setShowMrImagineModal] = useState(false);
  const [showReimagineItModal, setShowReimagineItModal] = useState(false);
  const [reimagineItLayerId, setReimagineItLayerId] = useState<string | null>(null);

  // Canvas features state
  const [showCutLines, setShowCutLines] = useState(false);
  const [mirrorForSublimation, setMirrorForSublimation] = useState(false);
  const [showSafeMargin, setShowSafeMargin] = useState(false);

  // Cart/Export options
  const [includeCutlines, setIncludeCutlines] = useState(false);

  // Loading states
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [presets, setPresets] = useState<any>(null); // State for dynamic presets

  // Pricing
  const [pricing, setPricing] = useState<ImaginationPricing[]>([]);
  const [freeTrials, setFreeTrials] = useState<FreeTrialStatus[]>([]);

  // AI Panel state
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiStyle, setAiStyle] = useState('vibrant');
  const [showAddElementPanel, setShowAddElementPanel] = useState(false);

  // Processing states for individual tools
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRemovingBg, setIsRemovingBg] = useState(false);
  const [isUpscaling, setIsUpscaling] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);

  // Compare modal state for before/after comparison
  const [compareModal, setCompareModal] = useState<{
    isOpen: boolean;
    beforeImage: string;
    afterImage: string;
    layerId: string;
    operation: string;
    beforeDimensions?: { width: number; height: number };
    afterDimensions?: { width: number; height: number };
    beforeDpi?: number;
    afterDpi?: number;
  } | null>(null);

  // Undo/Redo history
  const [layerHistory, setLayerHistory] = useState<ImaginationLayer[][]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const isUndoRedoAction = useRef(false);
  const lastAutosaveRef = useRef<number>(Date.now());

  // Track layer changes for undo/redo
  useEffect(() => {
    // Skip if this is an undo/redo action
    if (isUndoRedoAction.current) {
      isUndoRedoAction.current = false;
      return;
    }

    // Only track if we have layers and sheet
    if (!sheet || layers.length === 0) return;

    // Avoid duplicate entries
    const lastEntry = layerHistory[historyIndex];
    if (lastEntry && JSON.stringify(lastEntry) === JSON.stringify(layers)) {
      return;
    }

    // Add new history entry, removing any forward history
    const newHistory = [...layerHistory.slice(0, historyIndex + 1), [...layers]];
    // Keep max 50 history entries
    if (newHistory.length > 50) {
      newHistory.shift();
    }
    setLayerHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  }, [layers, sheet]);

  // Undo function
  const handleUndo = useCallback(() => {
    if (historyIndex <= 0) return;
    isUndoRedoAction.current = true;
    const newIndex = historyIndex - 1;
    setHistoryIndex(newIndex);
    setLayers(layerHistory[newIndex]);
    setSaveStatus('unsaved');
  }, [historyIndex, layerHistory]);

  // Redo function
  const handleRedo = useCallback(() => {
    if (historyIndex >= layerHistory.length - 1) return;
    isUndoRedoAction.current = true;
    const newIndex = historyIndex + 1;
    setHistoryIndex(newIndex);
    setLayers(layerHistory[newIndex]);
    setSaveStatus('unsaved');
  }, [historyIndex, layerHistory]);

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      }
      // Ctrl+Y for redo (Windows)
      if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo]);

  // Autosave every 30 seconds when there are unsaved changes
  useEffect(() => {
    if (saveStatus !== 'unsaved' || !sheet) return;

    const autosaveInterval = setInterval(() => {
      const now = Date.now();
      // Only autosave if at least 30 seconds have passed since last save
      if (now - lastAutosaveRef.current >= 30000) {
        console.log('[Autosave] Saving changes...');
        lastAutosaveRef.current = now;
        // Don't await - fire and forget for autosave
        (async () => {
          try {
            await saveSheetSilent();
            console.log('[Autosave] Saved successfully');
          } catch (err) {
            console.error('[Autosave] Failed:', err);
          }
        })();
      }
    }, 5000); // Check every 5 seconds

    return () => clearInterval(autosaveInterval);
  }, [saveStatus, sheet]);

  // Load data on mount
  useEffect(() => {
    loadInitialData();
  }, [id]);

  // Store pending image from URL params (to add after sheet is created)
  const [pendingImage, setPendingImage] = useState<{ url: string; name: string } | null>(null);

  // Check for URL parameters on mount - store for later if no sheet exists
  useEffect(() => {
    const addImageUrl = searchParams.get('addImage');
    const productName = searchParams.get('productName');

    if (addImageUrl && !hasProcessedUrlImage.current) {
      setPendingImage({ url: addImageUrl, name: productName || 'Product Image' });
      // Clear the URL params
      setSearchParams({});
    }
  }, [searchParams, setSearchParams]);

  // Handle adding pending image once sheet exists
  useEffect(() => {
    const addPendingImageToSheet = () => {
      if (!pendingImage || hasProcessedUrlImage.current || !sheet) return;

      const { url: addImageUrl, name: productName } = pendingImage;
      hasProcessedUrlImage.current = true;
      setPendingImage(null);

      // Load the image to get dimensions
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const originalWidth = img.naturalWidth;
        const originalHeight = img.naturalHeight;

        // Calculate layer dimensions in INCHES (max 6 inches, maintaining aspect ratio)
        const maxSizeInches = 6;
        const aspectRatio = originalWidth / originalHeight;
        let widthInches: number;
        let heightInches: number;

        if (aspectRatio >= 1) {
          // Landscape or square - width is the limiting factor
          widthInches = maxSizeInches;
          heightInches = maxSizeInches / aspectRatio;
        } else {
          // Portrait - height is the limiting factor
          heightInches = maxSizeInches;
          widthInches = maxSizeInches * aspectRatio;
        }

        // Calculate DPI for the layer size in inches
        const dpiInfo = calculateDpi(originalWidth, originalHeight, widthInches, heightInches);

        // Create new layer
        const newLayer: ImaginationLayer = {
          id: `layer-${Date.now()}`,
          sheet_id: sheet.id,
          layer_type: 'image' as LayerType,
          source_url: addImageUrl,
          processed_url: null,
          position_x: 1,
          position_y: 1,
          width: widthInches,
          height: heightInches,
          rotation: 0,
          scale_x: 1,
          scale_y: 1,
          z_index: layers.length,
          metadata: {
            name: productName,
            visible: true,
            locked: false,
            opacity: 1,
            dpiInfo,
            originalWidth,
            originalHeight,
          },
          created_at: new Date().toISOString(),
        };

        setLayers(prev => [...prev, newLayer]);
        setSelectedLayerIds([newLayer.id]);
        setSaveStatus('unsaved');
      };
      img.onerror = () => {
        console.error('Failed to load product image:', addImageUrl);
      };
      img.src = addImageUrl;
    };

    addPendingImageToSheet();
  }, [sheet, pendingImage, layers.length]);

  const loadInitialData = async () => {
    setIsLoading(true);
    try {
      // Load pricing and free trials (combined endpoint)
      try {
        const { data: pricingData } = await imaginationApi.getPricing();
        // Backend returns { pricing: [...], freeTrials: [...] }
        setPricing(pricingData?.pricing || []);
        setFreeTrials(pricingData?.freeTrials || []);
      } catch (e) {
        console.log('Pricing not available:', e);
      }

      // Load presets
      try {
        const { data: presetData } = await imaginationApi.getPresets();
        // Merge API data with UI config
        const merged: any = {};
        if (presetData) {
          Object.keys(presetData).forEach(key => {
            merged[key] = {
              ...presetData[key],
              ...(PRESET_UI_CONFIG[key] || {}),
              name: presetData[key].displayName, // Map displayName to name for compatibility
              allowMirror: presetData[key].rules?.mirror,
              allowCutlines: presetData[key].rules?.cutlineOption,
              heights: presetData[key].sizes ? presetData[key].sizes.map((s: any) => s.height).sort((a: number, b: number) => a - b) : []
            };
          });
          setPresets(merged);
        }
      } catch (e) {
        console.error('Failed to load presets:', e);
      }

      // Load specific sheet if ID provided
      if (id) {
        const { data: sheetData } = await imaginationApi.getSheet(id);
        setSheet(sheetData);
        // Load layers directly - they're already in ImaginationLayer format
        if (sheetData.layers) {
          setLayers(sheetData.layers);
        }
        // Load canvas state if available
        if (sheetData.canvas_state) {
          setCanvasState(sheetData.canvas_state);
          if (sheetData.canvas_state.stage?.scale) {
            setZoom(sheetData.canvas_state.stage.scale);
          }
          if (typeof sheetData.canvas_state.gridEnabled === 'boolean') {
            setGridEnabled(sheetData.canvas_state.gridEnabled);
          }
          if (typeof sheetData.canvas_state.snapEnabled === 'boolean') {
            setSnapEnabled(sheetData.canvas_state.snapEnabled);
          }
        }
      } else {
        // Load recent sheets
        try {
          const { data: sheetsData } = await imaginationApi.getSheets();
          setRecentSheets(sheetsData || []);
        } catch (e) {
          console.log('Could not load recent sheets');
        }
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Create new sheet
  const createSheet = async (printType: PrintType, height: number) => {
    setIsCreating(true);
    try {
      if (!presets) {
        alert('Configuration is loading...');
        setIsCreating(false);
        return;
      }
      const preset = presets[printType];
      console.log('Creating sheet:', { print_type: printType, height, preset_name: preset.name });
      const { data } = await imaginationApi.createSheet({
        name: `${preset.name} Sheet - ${preset.width}" x ${height}"`,
        print_type: printType,
        sheet_height: height
      });
      console.log('Sheet created:', data);
      navigate(`/imagination-station/${data.id}`);
    } catch (error: any) {
      console.error('Failed to create sheet:', error);
      console.error('Error response:', error.response?.data);
      const errorMsg = error.response?.data?.error || error.message || 'Unknown error';
      alert(`Failed to create sheet: ${errorMsg}`);
    } finally {
      setIsCreating(false);
    }
  };

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
            // Store original dimensions for DPI calculation (in pixels)
            const originalWidth = img.width;
            const originalHeight = img.height;

            // Calculate layer dimensions in INCHES (max 6 inches, maintaining aspect ratio)
            const maxSizeInches = 6;
            const aspectRatio = originalWidth / originalHeight;
            let widthInches: number;
            let heightInches: number;

            if (aspectRatio >= 1) {
              // Landscape or square - width is the limiting factor
              widthInches = maxSizeInches;
              heightInches = maxSizeInches / aspectRatio;
            } else {
              // Portrait - height is the limiting factor
              heightInches = maxSizeInches;
              widthInches = maxSizeInches * aspectRatio;
            }

            // Calculate DPI for the layer size in inches
            const dpiInfo = calculateDpi(originalWidth, originalHeight, widthInches, heightInches);

            const newLayer: ImaginationLayer = {
              id: `layer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              sheet_id: sheet.id,
              layer_type: 'image' as LayerType,
              source_url: event.target?.result as string,
              processed_url: null,
              position_x: 1,
              position_y: 1,
              width: widthInches,
              height: heightInches,
              rotation: 0,
              scale_x: 1,
              scale_y: 1,
              z_index: layers.length,
              metadata: {
                name: file.name.replace(/\.[^/.]+$/, ''),
                visible: true,
                locked: false,
                opacity: 1,
                dpiInfo, // Store DPI information
                originalWidth, // Store original dimensions for recalculation
                originalHeight,
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

  // Recalculate DPI when layer size changes
  const recalculateDpi = (layer: ImaginationLayer, newWidth?: number, newHeight?: number): DpiInfo | undefined => {
    const originalWidth = layer.metadata?.originalWidth;
    const originalHeight = layer.metadata?.originalHeight;

    if (!originalWidth || !originalHeight) return undefined;

    const w = newWidth ?? layer.width;
    const h = newHeight ?? layer.height;

    return calculateDpi(originalWidth, originalHeight, w, h);
  };

  // Layer operations
  const selectLayer = (layerId: string, multi = false) => {
    if (multi) {
      setSelectedLayerIds(prev =>
        prev.includes(layerId) ? prev.filter(id => id !== layerId) : [...prev, layerId]
      );
    } else {
      setSelectedLayerIds([layerId]);
    }
  };

  const toggleLayerVisibility = (layerId: string) => {
    setLayers(prev => prev.map(l =>
      l.id === layerId ? {
        ...l,
        metadata: { ...l.metadata, visible: !(l.metadata?.visible ?? true) }
      } : l
    ));
    setSaveStatus('unsaved');
  };

  const toggleLayerLock = (layerId: string) => {
    setLayers(prev => prev.map(l =>
      l.id === layerId ? {
        ...l,
        metadata: { ...l.metadata, locked: !(l.metadata?.locked ?? false) }
      } : l
    ));
    setSaveStatus('unsaved');
  };

  const deleteSelectedLayers = () => {
    if (selectedLayerIds.length === 0) return;
    setLayers(prev => prev.filter(l => !selectedLayerIds.includes(l.id)));
    setSelectedLayerIds([]);
    setSaveStatus('unsaved');
  };

  const duplicateSelectedLayers = () => {
    if (selectedLayerIds.length === 0) return;
    const newLayers = layers
      .filter(l => selectedLayerIds.includes(l.id))
      .map(l => ({
        ...l,
        id: `layer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        metadata: {
          ...l.metadata,
          name: `${l.metadata?.name || 'Layer'} (copy)`,
        },
        position_x: l.position_x + 0.5,
        position_y: l.position_y + 0.5,
        z_index: layers.length,
      }));
    setLayers(prev => [...prev, ...newLayers]);
    setSelectedLayerIds(newLayers.map(l => l.id));
    setSaveStatus('unsaved');
  };

  // Add element from Add Element panel
  const handleAddElement = (element: SimpleLayer) => {
    if (!sheet) return;

    // Convert SimpleLayer to ImaginationLayer
    const newLayer: ImaginationLayer = {
      id: element.id,
      sheet_id: sheet.id,
      layer_type: element.type,
      source_url: element.src || null,
      processed_url: null,
      position_x: element.x / PIXELS_PER_INCH,
      position_y: element.y / PIXELS_PER_INCH,
      width: element.width,
      height: element.height,
      rotation: element.rotation,
      scale_x: 1,
      scale_y: 1,
      z_index: layers.length,
      metadata: {
        name: element.name,
        visible: element.visible,
        locked: element.locked || false,
        opacity: element.opacity || 1,
        // Text properties
        text: element.text,
        fontSize: element.fontSize,
        fontFamily: element.fontFamily,
        color: element.color,
        // Shape properties
        shapeType: element.metadata?.shapeType,
        fill: element.fill,
        stroke: element.stroke,
        strokeWidth: element.strokeWidth,
        isArrow: element.metadata?.isArrow,
        isClipart: element.metadata?.isClipart,
      },
      created_at: new Date().toISOString(),
    };

    setLayers(prev => [...prev, newLayer]);
    setSelectedLayerIds([newLayer.id]);
    setSaveStatus('unsaved');
    setShowAddElementPanel(false);
  };

  // Reset canvas
  const resetCanvas = () => {
    if (layers.length === 0) return;

    const confirmed = window.confirm(
      'Are you sure you want to reset the canvas? This will remove all layers and cannot be undone.'
    );

    if (confirmed) {
      setLayers([]);
      setSelectedLayerIds([]);
      setZoom(0.5);
      setGridEnabled(true);
      setSnapEnabled(true);
      setShowCutLines(false);
      setMirrorForSublimation(false);
      setShowSafeMargin(false);
      setSaveStatus('unsaved');
    }
  };

  // AI Generation with Mr. Imagine
  const handleAiGenerate = async () => {
    if (!aiPrompt.trim()) return;
    if (!sheet) {
      alert('Please select a sheet first');
      return;
    }

    setIsProcessing(true);
    try {
      // Check if user has free trial or enough ITC
      const useTrial = getFreeTrial('generate') > 0;

      // Call AI generation API
      const { data } = await imaginationApi.generateImage({
        prompt: aiPrompt,
        style: aiStyle,
        useTrial
      });

      if (data.imageUrl) {
        // Load the generated image
        const img = new Image();
        img.crossOrigin = 'anonymous';

        await new Promise<void>((resolve, reject) => {
          img.onload = () => {
            // Calculate size - max 6 inches
            const maxSizeInches = 6;
            const maxSizePixels = maxSizeInches * PIXELS_PER_INCH;
            let width = img.width;
            let height = img.height;

            if (width > maxSizePixels || height > maxSizePixels) {
              const scale = Math.min(maxSizePixels / width, maxSizePixels / height);
              width = width * scale;
              height = height * scale;
            }

            // Create new layer
            const newLayer: ImaginationLayer = {
              id: `layer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              sheet_id: sheet.id,
              layer_type: 'image',
              source_url: data.imageUrl,
              processed_url: null,
              position_x: 1,
              position_y: 1,
              width: width / PIXELS_PER_INCH,
              height: height / PIXELS_PER_INCH,
              rotation: 0,
              scale_x: 1,
              scale_y: 1,
              z_index: layers.length,
              metadata: {
                name: `AI Generated - ${aiPrompt.substring(0, 30)}...`,
                originalWidth: img.width,
                originalHeight: img.height,
                generatedBy: 'mr_imagine',
                prompt: aiPrompt,
                style: aiStyle
              },
              created_at: new Date().toISOString(),
            };

            setLayers(prev => [...prev, newLayer]);
            setSaveStatus('unsaved');
            setAiPrompt(''); // Clear prompt after generation
            resolve();
          };
          img.onerror = () => reject(new Error('Failed to load generated image'));
          img.src = data.imageUrl;
        });

        // Refresh free trials if used
        if (useTrial) {
          const { data: pricingData } = await imaginationApi.getPricing();
          setFreeTrials(pricingData?.freeTrials || []);
        }
      }
    } catch (error: any) {
      console.error('AI Generation failed:', error);
      const msg = error.response?.data?.error || 'Image generation failed. Please try again.';
      alert(msg);
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle image generated from MrImagineModal
  const handleMrImagineImageGenerated = useCallback(async (imageUrl: string) => {
    if (!sheet) {
      console.error('[handleMrImagineImageGenerated] No sheet available');
      return;
    }

    try {
      // Load the image to get dimensions
      const img = new Image();
      img.crossOrigin = 'anonymous';

      await new Promise<void>((resolve, reject) => {
        img.onload = () => {
          // Calculate size - max 6 inches while maintaining aspect ratio
          const maxSizeInches = 6;
          const aspectRatio = img.width / img.height;
          let widthInches: number;
          let heightInches: number;

          if (aspectRatio >= 1) {
            // Landscape or square
            widthInches = maxSizeInches;
            heightInches = maxSizeInches / aspectRatio;
          } else {
            // Portrait
            heightInches = maxSizeInches;
            widthInches = maxSizeInches * aspectRatio;
          }

          // Calculate DPI based on original image size
          const dpiInfo = calculateDpi(
            img.width,
            img.height,
            widthInches,
            heightInches
          );

          // Create new layer with proper ImaginationLayer type
          const newLayer: ImaginationLayer = {
            id: `layer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            sheet_id: sheet.id,
            layer_type: 'ai_generated',
            source_url: imageUrl,
            processed_url: null,
            position_x: (sheet.sheet_width - widthInches) / 2, // Center horizontally
            position_y: (sheet.sheet_height - heightInches) / 2, // Center vertically
            width: widthInches,
            height: heightInches,
            rotation: 0,
            scale_x: 1,
            scale_y: 1,
            z_index: layers.length,
            metadata: {
              name: 'Mr. Imagine Design',
              originalWidth: img.width,
              originalHeight: img.height,
              generatedBy: 'mr_imagine_modal',
              dpiInfo,
              source: 'mr-imagine'
            },
            created_at: new Date().toISOString(),
          };

          setLayers(prev => [...prev, newLayer]);
          setSaveStatus('unsaved');
          setShowMrImagineModal(false);
          resolve();
        };
        img.onerror = () => {
          // Fallback with default dimensions
          const newLayer: ImaginationLayer = {
            id: `layer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            sheet_id: sheet.id,
            layer_type: 'ai_generated',
            source_url: imageUrl,
            processed_url: null,
            position_x: (sheet.sheet_width - 6) / 2,
            position_y: (sheet.sheet_height - 6) / 2,
            width: 6,
            height: 6,
            rotation: 0,
            scale_x: 1,
            scale_y: 1,
            z_index: layers.length,
            metadata: {
              name: 'Mr. Imagine Design',
              generatedBy: 'mr_imagine_modal',
              source: 'mr-imagine'
            },
            created_at: new Date().toISOString(),
          };
          setLayers(prev => [...prev, newLayer]);
          setSaveStatus('unsaved');
          setShowMrImagineModal(false);
          resolve();
        };
        img.src = imageUrl;
      });
    } catch (err) {
      console.error('[handleMrImagineImageGenerated] Error:', err);
    }
  }, [sheet, layers.length, setLayers, setSaveStatus]);

  // Calculate sheet price based on size
  const calculateSheetPrice = (printType: PrintType, height: number): number => {
    const preset = presets ? presets[printType] : null;
    if (!preset) return 0;
    const sqInches = preset.width * height;
    const pricePerSqInch = 0.02; // $0.02 per square inch base
    return Math.round(sqInches * pricePerSqInch * 100) / 100;
  };

  // Add to Cart handler
  const handleAddToCart = async () => {
    if (!sheet || layers.length === 0) {
      alert('Please add some designs to your sheet before ordering.');
      return;
    }

    // Check for critical DPI issues (both uploaded images and AI-generated)
    const dangerLayers = layers.filter(layer =>
      (layer.layer_type === 'image' || layer.layer_type === 'ai_generated') &&
      layer.metadata?.dpiInfo &&
      layer.metadata.dpiInfo.quality === 'danger'
    );

    const warningLayers = layers.filter(layer =>
      (layer.layer_type === 'image' || layer.layer_type === 'ai_generated') &&
      layer.metadata?.dpiInfo &&
      layer.metadata.dpiInfo.quality === 'warning'
    );

    // Prevent checkout if there are critical DPI issues
    if (dangerLayers.length > 0) {
      const layerNames = dangerLayers.map(l => l.metadata?.name || 'Untitled').join(', ');
      alert(
        `Cannot proceed to cart: ${dangerLayers.length} layer(s) have critically low DPI (below 100).\n\n` +
        `Affected layers: ${layerNames}\n\n` +
        `These images will look very pixelated when printed. Please:\n` +
        `• Reduce the size of these images, or\n` +
        `• Upload higher resolution versions, or\n` +
        `• Use the Upscale tool to improve quality`
      );
      return;
    }

    // Warn about low quality but allow to proceed
    if (warningLayers.length > 0) {
      const layerNames = warningLayers.map(l => l.metadata?.name || 'Untitled').join(', ');
      const proceed = window.confirm(
        `Warning: ${warningLayers.length} layer(s) have low DPI (100-150).\n\n` +
        `Affected layers: ${layerNames}\n\n` +
        `These images may appear slightly pixelated when printed.\n\n` +
        `Do you want to continue anyway?`
      );

      if (!proceed) {
        return;
      }
    }

    setIsProcessing(true);
    try {
      // First, save the current sheet state
      await saveSheet();

      // Generate a preview thumbnail from the canvas
      const canvas = canvasRef.current?.querySelector('canvas');
      let thumbnailUrl = '';
      if (canvas) {
        thumbnailUrl = canvas.toDataURL('image/png', 0.5); // Lower quality for thumbnail
      }

      // Update sheet with thumbnail
      if (thumbnailUrl) {
        await imaginationApi.updateSheet(sheet.id, {
          thumbnail_url: thumbnailUrl
        });
      }

      // Calculate price
      const price = calculateSheetPrice(sheet.print_type as PrintType, sheet.sheet_height);
      const preset = presets ? presets[sheet.print_type as PrintType] : { name: sheet.print_type };

      // Create a Product-like object for the cart
      const imaginationSheetProduct: Product = {
        id: `imagination-sheet-${sheet.id}`,
        name: sheet.name,
        description: `${preset.name} Imagination Sheet™ - ${sheet.sheet_width}" × ${sheet.sheet_height}" with ${layers.length} design${layers.length !== 1 ? 's' : ''}`,
        price: price,
        category: 'dtf-transfers',
        images: [thumbnailUrl || '/placeholder-imagination-sheet.png'],
        inStock: true,
        metadata: {
          sheetId: sheet.id,
          printType: sheet.print_type,
          sheetWidth: sheet.sheet_width,
          sheetHeight: sheet.sheet_height,
          layerCount: layers.length,
          includeCutlines: showCutLines,
          mirrorForSublimation: sheet.print_type === 'sublimation' ? mirrorForSublimation : false,
        }
      };

      // Add to cart with design data
      addToCart(
        imaginationSheetProduct,
        1,
        undefined, // no size selection
        undefined, // no color selection
        undefined, // no custom design URL
        {
          elements: layers,
          template: 'imagination-sheet',
          mockupUrl: thumbnailUrl,
          canvasSnapshot: JSON.stringify(canvasState)
        }
      );

      // Show success message and navigate
      alert(`Imagination Sheet™ added to cart! Price: $${price.toFixed(2)}`);
      navigate('/cart');
    } catch (error) {
      console.error('Failed to add to cart:', error);
      alert('Failed to add sheet to cart. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

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

  // Handle Remove Background for selected layer
  const handleRemoveBackground = async () => {
    if (!sheet || selectedLayerIds.length === 0) return;

    const selectedLayer = layers.find(l => selectedLayerIds.includes(l.id) && (l.layer_type === 'image' || l.layer_type === 'ai_generated'));
    if (!selectedLayer) {
      alert('Please select an image layer');
      return;
    }

    const imageUrl = selectedLayer.processed_url || selectedLayer.source_url;
    if (!imageUrl) {
      alert('No image URL found for this layer');
      return;
    }

    setIsRemovingBg(true);
    try {
      const useTrial = getFreeTrial('bg_remove') > 0;
      const { data } = await imaginationApi.removeBackground({ imageUrl, useTrial });

      // Use processedUrl or fallback to other response keys
      const newUrl = data.processedUrl || data.imageUrl || data.url || data.output;
      if (newUrl) {
        // Update the layer with the processed image
        setLayers(prev => prev.map(l =>
          l.id === selectedLayer.id
            ? { ...l, processed_url: newUrl }
            : l
        ));
        setSaveStatus('unsaved');

        // Refresh free trials if used
        if (useTrial) {
          const { data: pricingData } = await imaginationApi.getPricing();
          setFreeTrials(pricingData?.freeTrials || []);
        }
      }
    } catch (error: any) {
      console.error('Remove Background failed:', error);
      const msg = error.response?.data?.error || 'Remove background failed. Please try again.';
      alert(msg);
    } finally {
      setIsRemovingBg(false);
    }
  };

  // Handle Upscale for selected layer
  const handleUpscale = async () => {
    if (!sheet || selectedLayerIds.length === 0) return;

    const selectedLayer = layers.find(l => selectedLayerIds.includes(l.id) && (l.layer_type === 'image' || l.layer_type === 'ai_generated'));
    if (!selectedLayer) {
      alert('Please select an image layer');
      return;
    }

    const imageUrl = selectedLayer.processed_url || selectedLayer.source_url;
    if (!imageUrl) {
      alert('No image URL found for this layer');
      return;
    }

    // Store original image for comparison
    const originalUrl = imageUrl;
    const originalWidth = selectedLayer.metadata?.originalWidth || selectedLayer.width;
    const originalHeight = selectedLayer.metadata?.originalHeight || selectedLayer.height;
    const originalDpi = selectedLayer.metadata?.dpiInfo?.dpi;

    setIsUpscaling(true);
    try {
      const useTrial = getFreeTrial('upscale_2x') > 0;
      const { data } = await imaginationApi.upscaleImage({ imageUrl, factor: 2, useTrial });

      // Use processedUrl or fallback to other response keys
      const newUrl = data.processedUrl || data.imageUrl || data.url || data.output;
      const scaleFactor = data.scaleFactor || 2;
      if (newUrl) {
        const newOriginalWidth = originalWidth * scaleFactor;
        const newOriginalHeight = originalHeight * scaleFactor;
        // Recalculate DPI with new original dimensions
        const newDpiInfo = calculateDpi(newOriginalWidth, newOriginalHeight, selectedLayer.width, selectedLayer.height);

        // Update the layer with the upscaled image and larger dimensions
        setLayers(prev => prev.map(l => {
          if (l.id === selectedLayer.id) {
            return {
              ...l,
              processed_url: newUrl,
              // Update original dimensions for DPI recalculation - upscale increases source resolution
              metadata: {
                ...l.metadata,
                originalWidth: newOriginalWidth,
                originalHeight: newOriginalHeight,
                dpiInfo: newDpiInfo,
                upscaled: true,
                upscaleFactor: scaleFactor,
                // Store original for revert
                beforeUpscaleUrl: originalUrl,
                beforeUpscaleWidth: originalWidth,
                beforeUpscaleHeight: originalHeight,
              }
            };
          }
          return l;
        }));
        setSaveStatus('unsaved');

        // Show compare modal
        setCompareModal({
          isOpen: true,
          beforeImage: originalUrl,
          afterImage: newUrl,
          layerId: selectedLayer.id,
          operation: `Upscale ${scaleFactor}x`,
          beforeDimensions: { width: originalWidth, height: originalHeight },
          afterDimensions: { width: newOriginalWidth, height: newOriginalHeight },
          beforeDpi: originalDpi,
          afterDpi: newDpiInfo?.dpi,
        });

        // Refresh free trials if used
        if (useTrial) {
          const { data: pricingData } = await imaginationApi.getPricing();
          setFreeTrials(pricingData?.freeTrials || []);
        }
      }
    } catch (error: any) {
      console.error('Upscale failed:', error);
      const msg = error.response?.data?.error || 'Upscale failed. Please try again.';
      alert(msg);
    } finally {
      setIsUpscaling(false);
    }
  };

  // Handle Enhance for selected layer
  const handleEnhance = async () => {
    if (!sheet || selectedLayerIds.length === 0) return;

    const selectedLayer = layers.find(l => selectedLayerIds.includes(l.id) && (l.layer_type === 'image' || l.layer_type === 'ai_generated'));
    if (!selectedLayer) {
      alert('Please select an image layer');
      return;
    }

    const imageUrl = selectedLayer.processed_url || selectedLayer.source_url;
    if (!imageUrl) {
      alert('No image URL found for this layer');
      return;
    }

    // Store original for comparison
    const originalUrl = imageUrl;
    const originalWidth = selectedLayer.metadata?.originalWidth || selectedLayer.width;
    const originalHeight = selectedLayer.metadata?.originalHeight || selectedLayer.height;

    setIsEnhancing(true);
    try {
      const useTrial = getFreeTrial('enhance') > 0;
      const { data } = await imaginationApi.enhanceImage({ imageUrl, useTrial });

      // Use processedUrl or fallback to other response keys
      const newUrl = data.processedUrl || data.imageUrl || data.url || data.output;
      if (newUrl) {
        // Update the layer with the enhanced image
        setLayers(prev => prev.map(l =>
          l.id === selectedLayer.id
            ? {
              ...l,
              processed_url: newUrl,
              metadata: {
                ...l.metadata,
                enhanced: true,
                // Store original for revert
                beforeEnhanceUrl: originalUrl,
              }
            }
            : l
        ));
        setSaveStatus('unsaved');

        // Show compare modal
        setCompareModal({
          isOpen: true,
          beforeImage: originalUrl,
          afterImage: newUrl,
          layerId: selectedLayer.id,
          operation: 'Enhance',
          beforeDimensions: { width: originalWidth, height: originalHeight },
          afterDimensions: { width: originalWidth, height: originalHeight },
        });

        // Refresh free trials if used
        if (useTrial) {
          const { data: pricingData } = await imaginationApi.getPricing();
          setFreeTrials(pricingData?.freeTrials || []);
        }
      }
    } catch (error: any) {
      console.error('Enhance failed:', error);
      const msg = error.response?.data?.error || 'Enhance failed. Please try again.';
      alert(msg);
    } finally {
      setIsEnhancing(false);
    }
  };

  // Open Reimagine It modal for a selected image layer
  const openReimagineIt = (layerId: string) => {
    setReimagineItLayerId(layerId);
    setShowReimagineItModal(true);
  };

  // Handle accepting reimagined image from Reimagine It
  const handleReimagineItAccept = useCallback((newImageUrl: string) => {
    if (!reimagineItLayerId) return;

    setLayers(prev => prev.map(l => {
      if (l.id === reimagineItLayerId) {
        const originalUrl = l.processed_url || l.source_url;
        return {
          ...l,
          processed_url: newImageUrl,
          metadata: {
            ...l.metadata,
            reimagined: true,
            beforeReimageUrl: originalUrl,
          }
        };
      }
      return l;
    }));
    setSaveStatus('unsaved');
    setShowReimagineItModal(false);
    setReimagineItLayerId(null);
  }, [reimagineItLayerId]);

  // Handle keeping original in Reimagine It (just close modal)
  const handleReimagineItKeepOriginal = useCallback(() => {
    setShowReimagineItModal(false);
    setReimagineItLayerId(null);
  }, []);

  // Get the layer for Reimagine It modal
  const reimagineItLayer = useMemo(() => {
    return reimagineItLayerId ? layers.find(l => l.id === reimagineItLayerId) : null;
  }, [reimagineItLayerId, layers]);

  // Clear selection
  const clearSelection = () => {
    setSelectedLayerIds([]);
  };

  // Update canvas state
  const updateCanvasState = (state: CanvasState) => {
    setCanvasState(state);
    setSaveStatus('unsaved');
  };

  // Save sheet with thumbnail
  const saveSheet = async () => {
    if (!sheet) return;
    setSaveStatus('saving');
    try {
      // Generate canvas state
      const newCanvasState: CanvasState = {
        version: 1,
        timestamp: new Date().toISOString(),
        stage: {
          width: sheet.sheet_width * PIXELS_PER_INCH,
          height: sheet.sheet_height * PIXELS_PER_INCH,
          scale: zoom,
          position: { x: 0, y: 0 },
        },
        layers: layers.map(l => ({
          id: l.id,
          type: l.layer_type,
          attrs: {
            x: l.position_x,
            y: l.position_y,
            width: l.width,
            height: l.height,
            rotation: l.rotation,
            scaleX: l.scale_x,
            scaleY: l.scale_y,
          },
          src: l.processed_url || l.source_url || undefined,
        })),
        gridEnabled,
        snapEnabled,
      };

      // Generate thumbnail from canvas
      let thumbnailBase64: string | undefined;
      const canvas = canvasRef.current?.querySelector('canvas');
      if (canvas) {
        try {
          thumbnailBase64 = canvas.toDataURL('image/png', 0.6);
        } catch (error) {
          console.warn('Could not generate thumbnail:', error);
        }
      }

      // Save project using new endpoint
      await imaginationApi.saveProject({
        sheetId: sheet.id,
        name: sheet.name,
        canvasState: newCanvasState,
        thumbnailBase64,
        layers,
        metadata: {
          layerCount: layers.length,
          lastSaved: new Date().toISOString(),
          printType: sheet.print_type,
        }
      });

      setSaveStatus('saved');
      lastAutosaveRef.current = Date.now();
    } catch (error) {
      console.error('Failed to save:', error);
      setSaveStatus('unsaved');
      alert('Failed to save project. Please try again.');
    }
  };

  // Silent save for autosave (no alerts)
  const saveSheetSilent = async () => {
    if (!sheet) return;
    setSaveStatus('saving');
    try {
      const newCanvasState: CanvasState = {
        version: 1,
        timestamp: new Date().toISOString(),
        stage: {
          width: sheet.sheet_width * PIXELS_PER_INCH,
          height: sheet.sheet_height * PIXELS_PER_INCH,
          scale: zoom,
          position: { x: 0, y: 0 },
        },
        layers: layers.map(l => ({
          id: l.id,
          type: l.layer_type,
          attrs: {
            x: l.position_x,
            y: l.position_y,
            width: l.width,
            height: l.height,
            rotation: l.rotation,
            scaleX: l.scale_x,
            scaleY: l.scale_y,
          },
          src: l.processed_url || l.source_url || undefined,
        })),
        gridEnabled,
        snapEnabled,
      };

      let thumbnailBase64: string | undefined;
      const canvas = canvasRef.current?.querySelector('canvas');
      if (canvas) {
        try {
          thumbnailBase64 = canvas.toDataURL('image/png', 0.6);
        } catch (error) {
          console.warn('Could not generate thumbnail:', error);
        }
      }

      await imaginationApi.saveProject({
        sheetId: sheet.id,
        name: sheet.name,
        canvasState: newCanvasState,
        thumbnailBase64,
        layers,
        metadata: {
          layerCount: layers.length,
          lastSaved: new Date().toISOString(),
          printType: sheet.print_type,
        }
      });

      setSaveStatus('saved');
      lastAutosaveRef.current = Date.now();
    } catch (error) {
      console.error('[Autosave] Failed to save:', error);
      // Don't show alert for silent save - just log and set status
      setSaveStatus('unsaved');
    }
  };

  // Get pricing for a feature
  const getFeaturePrice = (key: string) => {
    const p = pricing.find(p => p.feature_key === key);
    return p?.current_cost || 0;
  };

  const getFreeTrial = (key: string) => {
    const t = freeTrials.find(t => t.feature_key === key);
    return t?.uses_remaining || 0;
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-950 via-purple-950 to-fuchsia-950 flex items-center justify-center relative overflow-hidden">
        {/* Animated background */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/20 rounded-full blur-3xl animate-pulse"></div>
          <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-fuchsia-500/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }}></div>
        </div>

        <div className="relative z-10 text-center">
          {/* Mr. Imagine loading animation */}
          <div className="relative inline-block mb-8">
            <div className="absolute -inset-6 bg-gradient-to-r from-cyan-400 via-violet-500 to-fuchsia-500 rounded-full blur-2xl opacity-50 animate-pulse"></div>
            <img
              src="/mr-imagine/mr-imagine-waving.png"
              alt="Mr. Imagine"
              className="relative w-32 h-32 object-contain animate-bounce"
              style={{ animationDuration: '2s' }}
            />
            {/* Spinning ring */}
            <div className="absolute -inset-4">
              <div className="w-full h-full rounded-full border-4 border-transparent border-t-cyan-400 border-r-violet-400 animate-spin" style={{ animationDuration: '1.5s' }}></div>
            </div>
          </div>

          <h2 className="text-3xl font-bold mb-3">
            <span className="bg-gradient-to-r from-white via-cyan-200 to-white bg-clip-text text-transparent">
              Loading Imagination Station
            </span>
          </h2>
          <p className="text-white/60 flex items-center justify-center gap-2">
            <Sparkles className="w-4 h-4 text-fuchsia-400 animate-pulse" />
            Preparing your creative workspace...
            <Sparkles className="w-4 h-4 text-cyan-400 animate-pulse" style={{ animationDelay: '0.5s' }} />
          </p>
        </div>
      </div>
    );
  }

  // Sheet selector (no sheet loaded)
  if (!sheet) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-950 via-purple-950 to-fuchsia-950 relative overflow-hidden">
        {/* Animated background elements */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {/* Floating gradient orbs */}
          <div className="absolute top-20 left-10 w-96 h-96 bg-gradient-to-br from-cyan-400/30 to-blue-600/20 rounded-full blur-3xl animate-pulse"></div>
          <div className="absolute bottom-20 right-10 w-80 h-80 bg-gradient-to-br from-fuchsia-500/30 to-pink-600/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }}></div>
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-br from-violet-500/20 to-purple-700/10 rounded-full blur-3xl"></div>

          {/* Sparkle particles */}
          <div className="absolute top-1/4 left-1/4 w-2 h-2 bg-white rounded-full animate-ping" style={{ animationDuration: '2s' }}></div>
          <div className="absolute top-1/3 right-1/4 w-1.5 h-1.5 bg-cyan-300 rounded-full animate-ping" style={{ animationDuration: '3s', animationDelay: '0.5s' }}></div>
          <div className="absolute bottom-1/4 left-1/3 w-2 h-2 bg-fuchsia-300 rounded-full animate-ping" style={{ animationDuration: '2.5s', animationDelay: '1s' }}></div>
          <div className="absolute top-2/3 right-1/3 w-1 h-1 bg-yellow-300 rounded-full animate-ping" style={{ animationDuration: '2s', animationDelay: '1.5s' }}></div>

          {/* Grid pattern overlay */}
          <div className="absolute inset-0 opacity-[0.03]" style={{
            backgroundImage: 'linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)',
            backgroundSize: '60px 60px'
          }}></div>
        </div>

        {/* Main content */}
        <div className="relative z-10 max-w-7xl mx-auto px-6 py-12">
          {/* Hero Section with Mr. Imagine */}
          <div className="text-center mb-16 relative">
            {/* Mr. Imagine Hero */}
            <div className="relative inline-block mb-8">
              <div className="absolute -inset-8 bg-gradient-to-r from-cyan-400 via-violet-500 to-fuchsia-500 rounded-full blur-2xl opacity-40 animate-pulse"></div>
              <img
                src="/mr-imagine/mr-imagine-waving.png"
                alt="Mr. Imagine"
                className="relative w-40 h-40 md:w-52 md:h-52 object-contain drop-shadow-2xl animate-bounce"
                style={{ animationDuration: '3s' }}
              />
              {/* Magic sparkles around Mr. Imagine */}
              <Sparkles className="absolute -top-2 -right-2 w-8 h-8 text-yellow-400 animate-spin" style={{ animationDuration: '4s' }} />
              <Sparkles className="absolute -bottom-2 -left-2 w-6 h-6 text-cyan-400 animate-spin" style={{ animationDuration: '3s', animationDirection: 'reverse' }} />
            </div>

            {/* Title with gradient */}
            <div className="inline-flex items-center gap-2 px-5 py-2.5 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full text-white/90 text-sm font-medium mb-6 shadow-xl">
              <Wand2 className="w-4 h-4 text-cyan-400" />
              <span className="bg-gradient-to-r from-cyan-400 to-fuchsia-400 bg-clip-text text-transparent font-semibold">
                AI-Powered Design Studio
              </span>
              <Sparkles className="w-4 h-4 text-fuchsia-400" />
            </div>

            <h1 className="text-5xl md:text-7xl font-black mb-6 tracking-tight">
              <span className="bg-gradient-to-r from-white via-cyan-200 to-white bg-clip-text text-transparent drop-shadow-lg">
                Imagination
              </span>
              <br />
              <span className="bg-gradient-to-r from-cyan-400 via-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
                Station
              </span>
            </h1>

            <p className="text-lg md:text-xl text-white/70 max-w-2xl mx-auto leading-relaxed font-light">
              Create <span className="text-cyan-400 font-medium">professional gang sheets</span> for DTF, UV DTF, and sublimation
              with <span className="text-fuchsia-400 font-medium">Mr. Imagine's AI magic</span> ✨
            </p>

            {/* Feature pills */}
            <div className="flex flex-wrap justify-center gap-3 mt-8">
              {['AI Image Generation', 'Smart Auto-Layout', 'Background Removal', 'HD Upscaling'].map((feature, i) => (
                <div
                  key={feature}
                  className="px-4 py-2 bg-white/5 backdrop-blur-sm border border-white/10 rounded-full text-white/80 text-sm flex items-center gap-2"
                  style={{ animationDelay: `${i * 0.1}s` }}
                >
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                  {feature}
                </div>
              ))}
            </div>
          </div>

          {/* Sheet Type Cards - Glassmorphism Style */}
          {presets && <div className="grid md:grid-cols-3 gap-6 mb-16">
            {(Object.entries(presets) as [PrintType, any][]).map(([type, preset], index) => {
              const gradients = {
                dtf: 'from-violet-500 to-purple-600',
                uv_dtf: 'from-cyan-500 to-blue-600',
                sublimation: 'from-fuchsia-500 to-pink-600'
              };
              const glows = {
                dtf: 'shadow-violet-500/30',
                uv_dtf: 'shadow-cyan-500/30',
                sublimation: 'shadow-fuchsia-500/30'
              };
              const iconBgs = {
                dtf: 'from-violet-400 to-purple-500',
                uv_dtf: 'from-cyan-400 to-blue-500',
                sublimation: 'from-fuchsia-400 to-pink-500'
              };

              return (
                <div
                  key={type}
                  className={`relative group bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-6 transition-all duration-500 hover:bg-white/10 hover:border-white/20 hover:shadow-2xl hover:-translate-y-2 ${glows[type as keyof typeof glows]}`}
                  style={{ animationDelay: `${index * 0.15}s` }}
                >
                  {/* Glow effect on hover */}
                  <div className={`absolute -inset-px bg-gradient-to-r ${gradients[type as keyof typeof gradients]} rounded-3xl opacity-0 group-hover:opacity-20 blur-xl transition-opacity duration-500`}></div>

                  <div className="relative">
                    {/* Icon with gradient background */}
                    <div className={`w-16 h-16 bg-gradient-to-br ${iconBgs[type as keyof typeof iconBgs]} rounded-2xl flex items-center justify-center text-3xl mb-5 shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                      {preset.icon}
                    </div>

                    <h3 className="text-2xl font-bold text-white mb-2 group-hover:text-transparent group-hover:bg-gradient-to-r group-hover:from-white group-hover:to-white/80 group-hover:bg-clip-text transition-all">
                      {preset.name}
                    </h3>
                    <p className="text-white/60 text-sm mb-2">{preset.description}</p>
                    <p className="text-white/40 text-sm mb-6 flex items-center gap-2">
                      <span className="w-2 h-2 bg-emerald-400 rounded-full"></span>
                      Fixed Width: <span className="font-bold text-white/80">{preset.width}"</span>
                    </p>

                    {/* Height options with pricing */}
                    <div className="space-y-2.5">
                      {preset.heights.map((height: number, i: number) => {
                        const sqInches = preset.width * height;
                        const price = Math.round(sqInches * 0.02 * 100) / 100;
                        return (
                          <button
                            key={height}
                            onClick={() => createSheet(type, height)}
                            disabled={isCreating}
                            className={`w-full px-4 py-3.5 bg-white/5 hover:bg-gradient-to-r hover:${gradients[type as keyof typeof gradients]} border border-white/10 hover:border-transparent rounded-xl text-left transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed group/btn hover:shadow-lg hover:scale-[1.02]`}
                            style={{ animationDelay: `${(index * 0.15) + (i * 0.05)}s` }}
                          >
                            <div className="flex items-center justify-between">
                              <div>
                                <span className="font-semibold text-white group-hover/btn:text-white">
                                  {preset.width}" × {height}"
                                </span>
                                <span className="ml-2 text-xs text-white/50 group-hover/btn:text-white/70">
                                  ({sqInches} sq in)
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-emerald-400 group-hover/btn:text-white">
                                  ${price.toFixed(2)}
                                </span>
                                <ArrowRight className="w-4 h-4 text-white/40 group-hover/btn:text-white group-hover/btn:translate-x-1 transition-all" />
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>}

          {/* Pending Image Notice - Enhanced */}
          {pendingImage && (
            <div className="relative mb-10">
              <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500 via-violet-500 to-fuchsia-500 rounded-3xl blur opacity-30"></div>
              <div className="relative bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl p-6">
                <div className="flex items-center gap-5">
                  <div className="w-20 h-20 bg-white/10 rounded-2xl flex items-center justify-center overflow-hidden border border-white/20 shadow-xl">
                    <img
                      src={pendingImage.url}
                      alt="Pending"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-bold text-white text-lg mb-1 flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-yellow-400" />
                      Ready to add: {pendingImage.name}
                    </h3>
                    <p className="text-white/60">
                      Select a sheet size above to start designing with your image
                    </p>
                  </div>
                  <div className="hidden md:flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-cyan-500 to-violet-500 rounded-full text-white text-sm font-medium">
                    <Upload className="w-4 h-4" />
                    Image Ready
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* My Projects - Dark Glass Style */}
          {recentSheets.length > 0 && (
            <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8 mb-10">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-xl flex items-center justify-center">
                    <Layers className="w-5 h-5 text-white" />
                  </div>
                  My Projects
                </h2>
                <button
                  onClick={() => navigate('/imagination-station')}
                  className="text-sm text-cyan-400 hover:text-cyan-300 font-medium flex items-center gap-1 transition-colors"
                >
                  View All
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {recentSheets.slice(0, 6).map((s, i) => {
                  const presetData = presets ? presets[s.print_type as PrintType] : null;
                  const layerCount = s.canvas_state?.layers?.length || 0;
                  return (
                    <Link
                      key={s.id}
                      to={`/imagination-station/${s.id}`}
                      className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden hover:bg-white/10 hover:border-white/20 hover:shadow-xl transition-all duration-300 group hover:-translate-y-1"
                      style={{ animationDelay: `${i * 0.1}s` }}
                    >
                      {/* Thumbnail */}
                      <div className="aspect-video bg-gradient-to-br from-white/5 to-transparent relative overflow-hidden">
                        {s.thumbnail_url ? (
                          <img
                            src={s.thumbnail_url}
                            alt={s.name}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <div className="w-16 h-16 bg-gradient-to-br from-violet-500/30 to-fuchsia-500/30 rounded-2xl flex items-center justify-center text-3xl">
                              {presetData?.icon || '📄'}
                            </div>
                          </div>
                        )}
                        {/* Status badge */}
                        <div className="absolute top-3 right-3">
                          <span className={`px-3 py-1 text-xs font-semibold rounded-full backdrop-blur-sm ${s.status === 'draft'
                            ? 'bg-white/20 text-white'
                            : s.status === 'submitted'
                              ? 'bg-violet-500/80 text-white'
                              : 'bg-emerald-500/80 text-white'
                            }`}>
                            {s.status === 'draft' ? 'Draft' : s.status === 'submitted' ? 'Submitted' : s.status}
                          </span>
                        </div>
                      </div>
                      {/* Project info */}
                      <div className="p-4">
                        <h3 className="font-semibold text-white truncate group-hover:text-cyan-400 transition-colors mb-1">
                          {s.name}
                        </h3>
                        <p className="text-xs text-white/50 mb-2">
                          {s.sheet_width}" × {s.sheet_height}" {presetData?.name || s.print_type}
                        </p>
                        <div className="flex items-center gap-3 text-xs text-white/40">
                          <span className="flex items-center gap-1">
                            <Layers className="w-3 h-3" />
                            {layerCount} layer{layerCount !== 1 ? 's' : ''}
                          </span>
                          <span>•</span>
                          <span>{new Date(s.updated_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {/* ITC Balance - Floating Pill */}
          <div className="text-center">
            <div className="inline-flex items-center gap-4 px-8 py-4 bg-white/10 backdrop-blur-xl border border-white/20 rounded-full shadow-2xl">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 bg-gradient-to-br from-amber-400 to-orange-500 rounded-full flex items-center justify-center shadow-lg">
                  <Coins className="w-5 h-5 text-white" />
                </div>
                <span className="text-white/60 font-medium">Your Balance:</span>
              </div>
              <span className="text-3xl font-black bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent">
                {itcBalance.toLocaleString()} ITC
              </span>
              <Link
                to="/wallet"
                className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-violet-500 hover:from-cyan-400 hover:to-violet-400 text-white text-sm font-semibold rounded-full transition-all duration-300 hover:shadow-lg hover:scale-105 flex items-center gap-1"
              >
                Get More
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>

          {/* Footer tagline */}
          <div className="text-center mt-12 text-white/30 text-sm">
            <p>Powered by <span className="text-cyan-400/60">Mr. Imagine</span> • AI-Driven Print Design</p>
          </div>
        </div>

        {/* Custom CSS for animations */}
        <style>{`
          @keyframes float {
            0%, 100% { transform: translateY(0px); }
            50% { transform: translateY(-20px); }
          }
          .animate-float {
            animation: float 6s ease-in-out infinite;
          }
        `}</style>
      </div >
    );
  }

  // Main Editor View
  const selectedLayers = layers.filter(l => selectedLayerIds.includes(l.id));
  const preset = presets ? presets[sheet.print_type as PrintType] : { name: sheet.print_type };

  return (
    <div className="h-screen flex flex-col bg-[#F5F5F5] overflow-hidden">
      {/* Top Bar */}
      <header className="h-12 bg-white border-b border-stone-200 flex items-center justify-between px-3 shrink-0 shadow-sm">
        <div className="flex items-center gap-3">
          {/* Logo / Home */}
          <Link
            to="/"
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
            title="Back to Home"
          >
            <img src="/itp-logo-v3.png" alt="ITP" className="h-7 w-auto" />
          </Link>
          <div className="w-px h-5 bg-stone-200"></div>

          {/* Quick Nav */}
          <div className="flex items-center gap-1">
            <Link
              to="/catalog"
              className="p-1.5 text-stone-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
              title="Products"
            >
              <ShoppingBag className="w-4 h-4" />
            </Link>
            <Link
              to="/wallet"
              className="p-1.5 text-stone-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
              title="Wallet"
            >
              <Coins className="w-4 h-4" />
            </Link>
          </div>
          <div className="w-px h-5 bg-stone-200"></div>

          {/* Sheet Info */}
          <div className="flex items-center gap-2">
            <span className={`text-lg`}>{preset?.icon}</span>
            <input
              type="text"
              value={sheet.name}
              onChange={(e) => setSheet({ ...sheet, name: e.target.value })}
              className="bg-transparent text-stone-800 font-medium text-sm border-none focus:outline-none focus:ring-0 max-w-[200px]"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Undo/Redo Buttons */}
          <div className="flex items-center gap-1 bg-stone-100 rounded-lg p-1">
            <button
              onClick={handleUndo}
              disabled={historyIndex <= 0}
              className="p-1.5 rounded-md hover:bg-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Undo (Ctrl+Z)"
            >
              <Undo2 className="w-4 h-4 text-stone-600" />
            </button>
            <button
              onClick={handleRedo}
              disabled={historyIndex >= layerHistory.length - 1}
              className="p-1.5 rounded-md hover:bg-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Redo (Ctrl+Shift+Z)"
            >
              <Redo2 className="w-4 h-4 text-stone-600" />
            </button>
          </div>
          <div className="w-px h-5 bg-stone-200"></div>

          {/* Save Status + Button */}
          <div className="flex items-center gap-1.5">
            {saveStatus === 'saved' && <CheckCircle className="w-3.5 h-3.5 text-green-500" />}
            {saveStatus === 'saving' && <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />}
            {saveStatus === 'unsaved' && <Clock className="w-3.5 h-3.5 text-amber-500" />}
            <button
              onClick={saveSheet}
              disabled={saveStatus === 'saved'}
              className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              <Save className="w-3.5 h-3.5" />
              Save
            </button>
          </div>

          <button
            onClick={() => setShowProjectsModal(true)}
            className="px-3 py-1.5 bg-white text-stone-700 border border-stone-200 rounded-lg text-sm font-medium hover:bg-stone-50 transition-colors flex items-center gap-1.5"
            title="My Projects"
          >
            <Layers className="w-3.5 h-3.5" />
            Projects
          </button>

          {/* ITC Balance */}
          <div className="flex items-center gap-1.5 px-2 py-1 bg-purple-50 rounded-lg border border-purple-100">
            <Coins className="w-3.5 h-3.5 text-amber-500" />
            <span className="font-bold text-purple-700 text-sm">{itcBalance}</span>
            <span className="text-purple-500 text-xs">ITC</span>
          </div>

          {/* Profile */}
          <Link
            to="/account/profile"
            className="w-7 h-7 flex items-center justify-center text-stone-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
            title="Profile"
          >
            <User className="w-4 h-4" />
          </Link>

          {/* Export Settings */}
          <button
            onClick={() => setActivePanel('export')}
            className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors ${activePanel === 'export'
              ? 'text-purple-600 bg-purple-100'
              : 'text-stone-500 hover:text-purple-600 hover:bg-purple-50'
              }`}
            title="Export & Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Tools */}
        {leftSidebarVisible && (
          <aside className="w-64 bg-white border-r border-stone-200 flex flex-col shrink-0 relative">
            {/* Hide button */}
            <button
              onClick={() => setLeftSidebarVisible(false)}
              className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center text-stone-400 hover:text-purple-600 hover:bg-purple-50 rounded transition-colors z-10"
              title="Hide panel"
            >
              <PanelLeft className="w-4 h-4" />
            </button>
            {/* Sheet Configuration (Admins Only) */}
            {presets && presets[sheet.print_type as PrintType] && user?.role === 'admin' && (
              <div className="p-4 border-b border-stone-100">
                <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-3">Sheet Size</h3>
                <div className="space-y-3">
                  <div className="flex items-center gap-3 p-2 bg-stone-50 rounded-lg border border-stone-100">
                    <div className="flex items-center justify-center w-8 h-8 rounded bg-white shadow-sm text-lg">
                      {presets[sheet.print_type as PrintType].icon}
                    </div>
                    <div className="flex-1">
                      <div className="text-[10px] text-stone-400 font-medium uppercase tracking-wider">Type</div>
                      <div className="text-sm font-semibold text-stone-700">{presets[sheet.print_type as PrintType].name}</div>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-stone-500 font-medium block mb-1.5 ml-1">Sheet Height</label>
                    <div className="relative">
                      <select
                        value={sheet.sheet_height}
                        onChange={(e) => {
                          const h = parseInt(e.target.value);
                          setSheet(prev => prev ? { ...prev, sheet_height: h } : null);
                          setSaveStatus('unsaved');
                        }}
                        className="w-full pl-3 pr-8 py-2.5 bg-white border border-stone-200 rounded-xl text-sm font-medium text-stone-700 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-shadow appearance-none cursor-pointer hover:border-purple-300"
                        style={{ backgroundImage: 'none' }}
                      >
                        {presets[sheet.print_type as PrintType].heights.map((h: number) => {
                          const width = presets[sheet.print_type as PrintType].width;
                          const price = Math.round(width * h * 0.02 * 100) / 100;
                          return (
                            <option key={h} value={h}>{width}" x {h}" - ${price.toFixed(2)}</option>
                          );
                        })}
                      </select>
                      <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none text-stone-400">
                        <ChevronDown className="w-4 h-4" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Upload & Add Element Buttons */}
            <div className="p-4 border-b border-stone-100 space-y-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing}
                className="w-full px-4 py-3 bg-gradient-to-r from-purple-600 to-purple-700 text-white rounded-xl font-medium flex items-center justify-center gap-2 hover:from-purple-700 hover:to-purple-800 transition-all shadow-lg shadow-purple-200 disabled:opacity-50"
              >
                <Upload className="w-5 h-5" />
                Upload Images
              </button>
              <button
                onClick={() => setShowAddElementPanel(true)}
                disabled={isProcessing}
                className="w-full px-4 py-3 bg-gradient-to-r from-blue-600 to-cyan-600 text-white rounded-xl font-medium flex items-center justify-center gap-2 hover:from-blue-700 hover:to-cyan-700 transition-all shadow-lg shadow-blue-200 disabled:opacity-50"
              >
                <Plus className="w-5 h-5" />
                Add Element
              </button>
            </div>

            {/* AI Tools */}
            <div className="p-4 border-b border-stone-100">
              <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-3">AI Tools</h3>
              <div className="space-y-2">
                <button
                  onClick={() => setActivePanel('ai')}
                  className={`w-full px-4 py-3 rounded-xl text-left transition-all flex items-center gap-3 ${activePanel === 'ai'
                    ? 'bg-purple-100 text-purple-700 border border-purple-200'
                    : 'bg-stone-50 text-stone-700 hover:bg-purple-50 border border-transparent'
                    }`}
                >
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                    <Sparkles className="w-4 h-4 text-white" />
                  </div>
                  <div className="flex-1">
                    <div className="font-medium">Mr. Imagine</div>
                    <div className="text-xs text-stone-500">
                      {getFreeTrial('generate') > 0 ? `${getFreeTrial('generate')} free` : `${getFeaturePrice('generate')} ITC`}
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => setActivePanel('tools')}
                  className={`w-full px-4 py-3 rounded-xl text-left transition-all flex items-center gap-3 ${activePanel === 'tools'
                    ? 'bg-amber-100 text-amber-700 border border-amber-200'
                    : 'bg-stone-50 text-stone-700 hover:bg-amber-50 border border-transparent'
                    }`}
                >
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
                    <Wand2 className="w-4 h-4 text-white" />
                  </div>
                  <div className="flex-1">
                    <div className="font-medium">ITP Enhance</div>
                    <div className="text-xs text-stone-500">BG Remove, Upscale, Enhance</div>
                  </div>
                </button>
              </div>
            </div>

            {/* Layers Panel */}
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="p-4 pb-2 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wider">Layers</h3>
                <span className="text-xs text-stone-400">{layers.length}</span>
              </div>
              <div className="flex-1 overflow-y-auto px-4 pb-4">
                {layers.length === 0 ? (
                  <div className="text-center py-8 text-stone-400">
                    <Layers className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No layers yet</p>
                    <p className="text-xs">Upload images to get started</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {[...layers].reverse().map(layer => {
                      const imageUrl = layer.processed_url || layer.source_url;
                      const isVisible = layer.metadata?.visible !== false;
                      const isLocked = layer.metadata?.locked === true;
                      const layerName = layer.metadata?.name || `Layer ${layer.z_index + 1}`;
                      const dpiInfo = layer.metadata?.dpiInfo as DpiInfo | undefined;
                      const dpiDisplay = dpiInfo ? getDpiQualityDisplay(dpiInfo.quality) : null;

                      return (
                        <div
                          key={layer.id}
                          onClick={() => selectLayer(layer.id)}
                          className={`p-2 rounded-lg cursor-pointer transition-all flex items-center gap-2 ${selectedLayerIds.includes(layer.id)
                            ? 'bg-purple-100 border border-purple-300'
                            : 'hover:bg-stone-100 border border-transparent'
                            }`}
                        >
                          {/* Layer thumbnail */}
                          <div className="w-8 h-8 rounded bg-stone-200 flex items-center justify-center overflow-hidden shrink-0 relative">
                            {(layer.layer_type === 'image' || layer.layer_type === 'ai_generated') && imageUrl ? (
                              <img src={imageUrl} alt="" className="w-full h-full object-cover" />
                            ) : layer.layer_type === 'text' ? (
                              <Type className="w-4 h-4 text-stone-500" />
                            ) : (
                              <Square className="w-4 h-4 text-stone-500" />
                            )}
                            {/* DPI quality indicator badge */}
                            {dpiInfo && (dpiInfo.quality === 'warning' || dpiInfo.quality === 'danger') && (
                              <div className={`absolute -top-1 -right-1 w-3 h-3 rounded-full border border-white ${dpiDisplay?.indicatorColor}`} />
                            )}
                          </div>

                          {/* Layer name */}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-stone-800 truncate">{layerName}</p>
                            {/* DPI warning text */}
                            {dpiInfo && (dpiInfo.quality === 'warning' || dpiInfo.quality === 'danger') && (
                              <p className={`text-xs ${dpiDisplay?.color} truncate`}>
                                {dpiInfo.dpi} DPI - {dpiDisplay?.label}
                              </p>
                            )}
                          </div>

                          {/* Layer controls */}
                          <div className="flex items-center gap-1">
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
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Layer actions */}
              {selectedLayerIds.length > 0 && (
                <div className="p-4 border-t border-stone-100 flex gap-2">
                  <button
                    onClick={duplicateSelectedLayers}
                    className="flex-1 px-3 py-2 bg-stone-100 text-stone-600 rounded-lg text-sm font-medium hover:bg-stone-200 transition-colors flex items-center justify-center gap-1"
                  >
                    <Copy className="w-4 h-4" />
                    Duplicate
                  </button>
                  <button
                    onClick={deleteSelectedLayers}
                    className="flex-1 px-3 py-2 bg-red-50 text-red-600 rounded-lg text-sm font-medium hover:bg-red-100 transition-colors flex items-center justify-center gap-1"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                </div>
              )}
            </div>
          </aside>
        )}

        {/* Show Left Sidebar Button */}
        {!leftSidebarVisible && (
          <button
            onClick={() => setLeftSidebarVisible(true)}
            className="w-8 bg-white border-r border-stone-200 flex items-center justify-center text-stone-400 hover:text-purple-600 hover:bg-purple-50 transition-colors shrink-0"
            title="Show left panel"
          >
            <PanelRight className="w-4 h-4" />
          </button>
        )}

        {/* Canvas Area */}
        <div className="flex-1 relative overflow-hidden bg-stone-100" ref={canvasRef}>
          {/* Konva SheetCanvas Component */}
          <SheetCanvas
            sheet={sheet}
            layers={layers}
            setLayers={setLayers}
            selectedLayerIds={selectedLayerIds}
            selectLayer={selectLayer}
            clearSelection={clearSelection}
            zoom={zoom}
            setZoom={setZoom}
            gridEnabled={gridEnabled}
            snapEnabled={snapEnabled}
            canvasState={canvasState}
            updateCanvasState={updateCanvasState}
            showCutLines={showCutLines}
            mirrorForSublimation={mirrorForSublimation}
            showSafeMargin={showSafeMargin}
          />

          {/* Zoom Controls */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-white px-4 py-2 rounded-full shadow-lg border border-stone-200 z-10">
            <button
              onClick={() => setZoom(z => Math.max(MIN_ZOOM, z - 0.1))}
              className="w-8 h-8 flex items-center justify-center text-stone-600 hover:text-purple-600 hover:bg-purple-50 rounded-full transition-colors"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-sm font-medium text-stone-700 w-14 text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom(z => Math.min(MAX_ZOOM, z + 0.1))}
              className="w-8 h-8 flex items-center justify-center text-stone-600 hover:text-purple-600 hover:bg-purple-50 rounded-full transition-colors"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <div className="w-px h-6 bg-stone-200 mx-2"></div>
            <button
              onClick={() => setGridEnabled(g => !g)}
              className={`px-3 py-1 text-sm rounded-full transition-colors ${gridEnabled ? 'bg-purple-100 text-purple-700' : 'text-stone-500 hover:bg-stone-100'
                }`}
            >
              <Grid3X3 className="w-4 h-4" />
            </button>
            <button
              onClick={() => setSnapEnabled(s => !s)}
              className={`px-3 py-1 text-sm rounded-full transition-colors ${snapEnabled ? 'bg-purple-100 text-purple-700' : 'text-stone-500 hover:bg-stone-100'
                }`}
              title="Toggle Snap"
            >
              <Magnet className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowSafeMargin(s => !s)}
              className={`px-3 py-1 text-sm rounded-full transition-colors ${showSafeMargin ? 'bg-purple-100 text-purple-700' : 'text-stone-500 hover:bg-stone-100'
                }`}
              title="Toggle Safe Margin"
            >
              <Maximize className="w-4 h-4" />
            </button>
            <div className="w-px h-6 bg-stone-200 mx-2"></div>
            <button
              onClick={resetCanvas}
              disabled={layers.length === 0}
              className="px-3 py-1 text-sm rounded-full text-stone-600 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Reset Canvas"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Right Sidebar - Context Panel */}
        {/* Show Right Sidebar Button */}
        {!rightSidebarVisible && (
          <button
            onClick={() => setRightSidebarVisible(true)}
            className="w-8 bg-white border-l border-stone-200 flex items-center justify-center text-stone-400 hover:text-purple-600 hover:bg-purple-50 transition-colors shrink-0"
            title="Show right panel"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
        )}

        {rightSidebarVisible && (
          <aside className="w-80 bg-white border-l border-stone-200 flex flex-col shrink-0 relative">
            {/* Hide button */}
            <button
              onClick={() => setRightSidebarVisible(false)}
              className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center text-stone-400 hover:text-purple-600 hover:bg-purple-50 rounded transition-colors z-10"
              title="Hide panel"
            >
              <PanelRight className="w-4 h-4" />
            </button>
            {/* Panel Header */}
            <div className="p-4 border-b border-stone-100">
              <div className="flex gap-1 bg-stone-100 p-1 rounded-lg">
                {[
                  { id: 'layers', label: 'Properties', icon: Settings },
                  { id: 'ai', label: 'AI', icon: Sparkles },
                  { id: 'tools', label: 'Tools', icon: Wand2 },
                  { id: 'export', label: 'Cart', icon: ShoppingCart },
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActivePanel(tab.id as typeof activePanel)}
                    className={`flex-1 px-3 py-2 text-sm font-medium rounded-md transition-colors flex items-center justify-center gap-1 ${activePanel === tab.id
                      ? 'bg-white text-purple-700 shadow-sm'
                      : 'text-stone-500 hover:text-stone-700'
                      }`}
                  >
                    <tab.icon className="w-4 h-4" />
                  </button>
                ))}
              </div>
            </div>

            {/* Panel Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {/* Properties Panel */}
              {activePanel === 'layers' && (
                <div className="space-y-6">
                  {selectedLayers.length > 0 ? (
                    <>
                      <div>
                        <h3 className="text-sm font-semibold text-stone-800 mb-3">Selected Layer</h3>
                        <p className="text-stone-600">{selectedLayers[0].metadata?.name || `Layer ${selectedLayers[0].z_index + 1}`}</p>
                      </div>

                      {/* DPI Quality Warning */}
                      {(selectedLayers[0].layer_type === 'image' || selectedLayers[0].layer_type === 'ai_generated') && selectedLayers[0].metadata?.dpiInfo && (
                        <div className={`p-4 rounded-xl border ${selectedLayers[0].metadata.dpiInfo.quality === 'danger'
                          ? 'bg-red-50 border-red-300'
                          : selectedLayers[0].metadata.dpiInfo.quality === 'warning'
                            ? 'bg-amber-50 border-amber-300'
                            : 'bg-green-50 border-green-300'
                          }`}>
                          <div className="flex items-start gap-3">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${selectedLayers[0].metadata.dpiInfo.quality === 'danger'
                              ? 'bg-red-100'
                              : selectedLayers[0].metadata.dpiInfo.quality === 'warning'
                                ? 'bg-amber-100'
                                : 'bg-green-100'
                              }`}>
                              <span className="text-lg">{getDpiQualityDisplay(selectedLayers[0].metadata.dpiInfo.quality).icon}</span>
                            </div>
                            <div className="flex-1">
                              <h4 className={`font-semibold text-sm mb-1 ${selectedLayers[0].metadata.dpiInfo.quality === 'danger'
                                ? 'text-red-800'
                                : selectedLayers[0].metadata.dpiInfo.quality === 'warning'
                                  ? 'text-amber-800'
                                  : 'text-green-800'
                                }`}>
                                Print Quality: {getDpiQualityDisplay(selectedLayers[0].metadata.dpiInfo.quality).label}
                              </h4>
                              <p className={`text-xs mb-2 ${selectedLayers[0].metadata.dpiInfo.quality === 'danger'
                                ? 'text-red-700'
                                : selectedLayers[0].metadata.dpiInfo.quality === 'warning'
                                  ? 'text-amber-700'
                                  : 'text-green-700'
                                }`}>
                                {getDpiQualityDisplay(selectedLayers[0].metadata.dpiInfo.quality).description}
                              </p>
                              <div className={`text-xs ${selectedLayers[0].metadata.dpiInfo.quality === 'danger'
                                ? 'text-red-600'
                                : selectedLayers[0].metadata.dpiInfo.quality === 'warning'
                                  ? 'text-amber-600'
                                  : 'text-green-600'
                                }`}>
                                <div className="flex justify-between mb-1">
                                  <span>Current DPI:</span>
                                  <span className="font-bold">{selectedLayers[0].metadata.dpiInfo.dpi}</span>
                                </div>
                                <div className="flex justify-between mb-1">
                                  <span>Original size:</span>
                                  <span>{selectedLayers[0].metadata.dpiInfo.originalWidth} × {selectedLayers[0].metadata.dpiInfo.originalHeight}px</span>
                                </div>
                                <div className="flex justify-between">
                                  <span>Print size:</span>
                                  <span>{selectedLayers[0].metadata.dpiInfo.canvasSizeInches.width}" × {selectedLayers[0].metadata.dpiInfo.canvasSizeInches.height}"</span>
                                </div>
                              </div>
                              {selectedLayers[0].metadata.dpiInfo.quality === 'danger' && (
                                <div className="mt-2 pt-2 border-t border-red-200">
                                  <p className="text-xs text-red-800 font-medium">
                                    Recommendation: Reduce the size or use a higher resolution image
                                  </p>
                                </div>
                              )}
                              {selectedLayers[0].metadata.dpiInfo.quality === 'warning' && (
                                <div className="mt-2 pt-2 border-t border-amber-200">
                                  <p className="text-xs text-amber-800 font-medium">
                                    Tip: For best results, reduce size or consider upscaling
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      <div>
                        <h4 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-3">Position</h4>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs text-stone-500 block mb-1">X (inches)</label>
                            <input
                              type="number"
                              value={selectedLayers[0].position_x.toFixed(2)}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                setLayers(prev => prev.map(l =>
                                  l.id === selectedLayers[0].id ? { ...l, position_x: val } : l
                                ));
                                setSaveStatus('unsaved');
                              }}
                              className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                              step="0.1"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-stone-500 block mb-1">Y (inches)</label>
                            <input
                              type="number"
                              value={selectedLayers[0].position_y.toFixed(2)}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                setLayers(prev => prev.map(l =>
                                  l.id === selectedLayers[0].id ? { ...l, position_y: val } : l
                                ));
                                setSaveStatus('unsaved');
                              }}
                              className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                              step="0.1"
                            />
                          </div>
                        </div>
                      </div>

                      <div>
                        <h4 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-3">Size (inches)</h4>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs text-stone-500 block mb-1">Width</label>
                            <input
                              type="number"
                              value={selectedLayers[0].width.toFixed(2)}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0.1;
                                const currentLayer = selectedLayers[0];
                                setLayers(prev => prev.map(l => {
                                  if (l.id === currentLayer.id) {
                                    const newDpiInfo = recalculateDpi(l, val, l.height);
                                    return {
                                      ...l,
                                      width: val,
                                      metadata: {
                                        ...l.metadata,
                                        dpiInfo: newDpiInfo || l.metadata?.dpiInfo,
                                      }
                                    };
                                  }
                                  return l;
                                }));
                                setSaveStatus('unsaved');
                              }}
                              className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                              step="0.25"
                              min="0.25"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-stone-500 block mb-1">Height</label>
                            <input
                              type="number"
                              value={selectedLayers[0].height.toFixed(2)}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0.1;
                                const currentLayer = selectedLayers[0];
                                setLayers(prev => prev.map(l => {
                                  if (l.id === currentLayer.id) {
                                    const newDpiInfo = recalculateDpi(l, l.width, val);
                                    return {
                                      ...l,
                                      height: val,
                                      metadata: {
                                        ...l.metadata,
                                        dpiInfo: newDpiInfo || l.metadata?.dpiInfo,
                                      }
                                    };
                                  }
                                  return l;
                                }));
                                setSaveStatus('unsaved');
                              }}
                              className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                              step="0.25"
                              min="0.25"
                            />
                          </div>
                        </div>

                        {/* Quick Size Presets for T-Shirts */}
                        <div className="mt-3 pt-3 border-t border-stone-200">
                          <p className="text-xs text-stone-500 mb-2">Quick sizes:</p>
                          <div className="flex flex-wrap gap-1.5">
                            <button
                              onClick={() => {
                                const currentLayer = selectedLayers[0];
                                const aspectRatio = currentLayer.width / currentLayer.height;
                                const newWidth = 11;
                                const newHeight = aspectRatio >= 1 ? newWidth / aspectRatio : newWidth;
                                setLayers(prev => prev.map(l => {
                                  if (l.id === currentLayer.id) {
                                    const newDpiInfo = recalculateDpi(l, newWidth, newHeight);
                                    return { ...l, width: newWidth, height: newHeight, metadata: { ...l.metadata, dpiInfo: newDpiInfo || l.metadata?.dpiInfo } };
                                  }
                                  return l;
                                }));
                                setSaveStatus('unsaved');
                              }}
                              className="px-2 py-1 text-xs bg-purple-100 hover:bg-purple-200 text-purple-700 rounded transition-colors"
                              title="Front chest - Adult L/XL"
                            >
                              11" Front
                            </button>
                            <button
                              onClick={() => {
                                const currentLayer = selectedLayers[0];
                                const aspectRatio = currentLayer.width / currentLayer.height;
                                const newWidth = 10;
                                const newHeight = aspectRatio >= 1 ? newWidth / aspectRatio : newWidth;
                                setLayers(prev => prev.map(l => {
                                  if (l.id === currentLayer.id) {
                                    const newDpiInfo = recalculateDpi(l, newWidth, newHeight);
                                    return { ...l, width: newWidth, height: newHeight, metadata: { ...l.metadata, dpiInfo: newDpiInfo || l.metadata?.dpiInfo } };
                                  }
                                  return l;
                                }));
                                setSaveStatus('unsaved');
                              }}
                              className="px-2 py-1 text-xs bg-purple-100 hover:bg-purple-200 text-purple-700 rounded transition-colors"
                              title="Front chest - Adult M"
                            >
                              10" Front
                            </button>
                            <button
                              onClick={() => {
                                const currentLayer = selectedLayers[0];
                                const aspectRatio = currentLayer.width / currentLayer.height;
                                const newWidth = 3.5;
                                const newHeight = aspectRatio >= 1 ? newWidth / aspectRatio : newWidth;
                                setLayers(prev => prev.map(l => {
                                  if (l.id === currentLayer.id) {
                                    const newDpiInfo = recalculateDpi(l, newWidth, newHeight);
                                    return { ...l, width: newWidth, height: newHeight, metadata: { ...l.metadata, dpiInfo: newDpiInfo || l.metadata?.dpiInfo } };
                                  }
                                  return l;
                                }));
                                setSaveStatus('unsaved');
                              }}
                              className="px-2 py-1 text-xs bg-green-100 hover:bg-green-200 text-green-700 rounded transition-colors"
                              title="Left chest pocket size"
                            >
                              3.5" Pocket
                            </button>
                            <button
                              onClick={() => {
                                const currentLayer = selectedLayers[0];
                                const aspectRatio = currentLayer.width / currentLayer.height;
                                const newWidth = 12;
                                const newHeight = aspectRatio >= 1 ? newWidth / aspectRatio : newWidth;
                                setLayers(prev => prev.map(l => {
                                  if (l.id === currentLayer.id) {
                                    const newDpiInfo = recalculateDpi(l, newWidth, newHeight);
                                    return { ...l, width: newWidth, height: newHeight, metadata: { ...l.metadata, dpiInfo: newDpiInfo || l.metadata?.dpiInfo } };
                                  }
                                  return l;
                                }));
                                setSaveStatus('unsaved');
                              }}
                              className="px-2 py-1 text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 rounded transition-colors"
                              title="Full back print"
                            >
                              12" Back
                            </button>
                            <button
                              onClick={() => {
                                const currentLayer = selectedLayers[0];
                                const aspectRatio = currentLayer.width / currentLayer.height;
                                const newWidth = 4;
                                const newHeight = aspectRatio >= 1 ? newWidth / aspectRatio : newWidth;
                                setLayers(prev => prev.map(l => {
                                  if (l.id === currentLayer.id) {
                                    const newDpiInfo = recalculateDpi(l, newWidth, newHeight);
                                    return { ...l, width: newWidth, height: newHeight, metadata: { ...l.metadata, dpiInfo: newDpiInfo || l.metadata?.dpiInfo } };
                                  }
                                  return l;
                                }));
                                setSaveStatus('unsaved');
                              }}
                              className="px-2 py-1 text-xs bg-orange-100 hover:bg-orange-200 text-orange-700 rounded transition-colors"
                              title="Sleeve print"
                            >
                              4" Sleeve
                            </button>
                          </div>
                        </div>

                        {/* Size Guide Reference */}
                        <details className="mt-3">
                          <summary className="text-xs text-purple-600 cursor-pointer hover:text-purple-800">
                            T-Shirt Size Guide
                          </summary>
                          <div className="mt-2 p-2 bg-stone-50 rounded-lg text-xs text-stone-600 space-y-1">
                            <p><strong>Front Chest (Full):</strong></p>
                            <p className="pl-2">• Youth S-M: 7-8" wide</p>
                            <p className="pl-2">• Youth L-XL: 8-9" wide</p>
                            <p className="pl-2">• Adult S-M: 9-10" wide</p>
                            <p className="pl-2">• Adult L-XL: 10-11" wide</p>
                            <p className="pl-2">• Adult 2XL+: 11-12" wide</p>
                            <p className="mt-2"><strong>Left Chest (Pocket):</strong> 3-4" wide</p>
                            <p><strong>Full Back:</strong> 11-14" wide</p>
                            <p><strong>Sleeve:</strong> 3-4" wide</p>
                            <p className="mt-2 text-purple-600 italic">Tip: Height auto-scales based on aspect ratio</p>
                          </div>
                        </details>
                      </div>

                      <div>
                        <h4 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-3">Transform</h4>
                        <div className="space-y-3">
                          <div>
                            <label className="text-xs text-stone-500 block mb-1">Rotation (degrees)</label>
                            <input
                              type="range"
                              min="0"
                              max="360"
                              value={selectedLayers[0].rotation}
                              onChange={(e) => {
                                const val = parseInt(e.target.value);
                                setLayers(prev => prev.map(l =>
                                  l.id === selectedLayers[0].id ? { ...l, rotation: val } : l
                                ));
                                setSaveStatus('unsaved');
                              }}
                              className="w-full accent-purple-600"
                            />
                            <div className="text-right text-xs text-stone-500">{selectedLayers[0].rotation}°</div>
                          </div>
                          <div>
                            <label className="text-xs text-stone-500 block mb-1">Opacity</label>
                            <input
                              type="range"
                              min="0"
                              max="1"
                              step="0.01"
                              value={selectedLayers[0].metadata?.opacity ?? 1}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                setLayers(prev => prev.map(l =>
                                  l.id === selectedLayers[0].id ? {
                                    ...l,
                                    metadata: { ...l.metadata, opacity: val }
                                  } : l
                                ));
                                setSaveStatus('unsaved');
                              }}
                              className="w-full accent-purple-600"
                            />
                            <div className="text-right text-xs text-stone-500">{Math.round((selectedLayers[0].metadata?.opacity ?? 1) * 100)}%</div>
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-12 text-stone-400">
                      <Settings className="w-10 h-10 mx-auto mb-3 opacity-50" />
                      <p className="font-medium text-stone-500">No layer selected</p>
                      <p className="text-sm">Select a layer to edit its properties</p>
                    </div>
                  )}
                </div>
              )}

              {/* AI Panel */}
              {activePanel === 'ai' && (
                <div className="space-y-6">
                  {/* Mr. Imagine Lightbox Launcher */}
                  <button
                    onClick={() => setShowMrImagineModal(true)}
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
                    <div className="text-left">
                      <div className="font-bold">Open Mr. Imagine Studio</div>
                      <div className="text-xs text-purple-200">
                        DTF-optimized AI image generation
                      </div>
                    </div>
                  </button>

                  {/* Quick Generate (legacy fallback) */}
                  <div className="p-4 bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl border border-purple-100">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                        <Sparkles className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-stone-800">Quick Generate</h3>
                        <p className="text-xs text-stone-500">Simple AI generation</p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <textarea
                        value={aiPrompt}
                        onChange={(e) => setAiPrompt(e.target.value)}
                        placeholder="Describe the image you want to create..."
                        className="w-full px-3 py-2 bg-white border border-purple-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none h-24"
                      />

                      <select
                        value={aiStyle}
                        onChange={(e) => setAiStyle(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-purple-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      >
                        <option value="vibrant">Vibrant & Bold</option>
                        <option value="realistic">Photorealistic</option>
                        <option value="cartoon">Cartoon Style</option>
                        <option value="vintage">Vintage Retro</option>
                        <option value="minimalist">Minimalist</option>
                      </select>

                      <button
                        onClick={handleAiGenerate}
                        disabled={isProcessing || !aiPrompt.trim()}
                        className="w-full px-4 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg font-medium hover:from-purple-700 hover:to-pink-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        {isProcessing ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Generating...
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-4 h-4" />
                            Generate ({getFreeTrial('generate') > 0 ? 'Free' : `${getFeaturePrice('generate')} ITC`})
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Tools Panel */}
              {activePanel === 'tools' && (
                <div className="space-y-4">
                  <div className="p-4 bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl border border-amber-100">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
                        <Wand2 className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-stone-800">ITP Enhance</h3>
                        <p className="text-xs text-stone-500">AI Enhancement Tools</p>
                      </div>
                    </div>

                    {selectedLayers.length > 0 && (selectedLayers[0].layer_type === 'image' || selectedLayers[0].layer_type === 'ai_generated') ? (
                      <div className="space-y-2">
                        <button
                          onClick={handleRemoveBackground}
                          disabled={isRemovingBg || isProcessing}
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

                        <button
                          onClick={handleUpscale}
                          disabled={isUpscaling || isProcessing}
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

                        <button
                          onClick={handleEnhance}
                          disabled={isEnhancing || isProcessing}
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

                        {/* Reimagine It - Add elements with AI */}
                        <button
                          onClick={() => {
                            const selectedImageLayer = selectedLayers.find(l => l.layer_type === 'image' || l.layer_type === 'ai_generated');
                            if (selectedImageLayer) {
                              openReimagineIt(selectedImageLayer.id);
                            }
                          }}
                          disabled={isProcessing}
                          className="w-full px-4 py-3 bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-300 rounded-lg text-left hover:from-purple-100 hover:to-pink-100 transition-colors disabled:opacity-50 flex items-center justify-between"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-400 to-pink-500 flex items-center justify-center">
                              <span className="text-sm">&#10024;</span>
                            </div>
                            <div>
                              <div className="font-medium text-stone-800">Reimagine It</div>
                              <div className="text-xs text-stone-500">Transform with AI ({getFeaturePrice('generate')} ITC)</div>
                            </div>
                          </div>
                          <ArrowRight className="w-4 h-4 text-stone-400" />
                        </button>
                      </div>
                    ) : (
                      <div className="text-center py-6 text-stone-400">
                        <ImageIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">Select an image layer to use enhancement tools</p>
                      </div>
                    )}
                  </div>

                  {/* Auto Layout */}
                  <div className="p-4 bg-stone-50 rounded-xl border border-stone-200">
                    <h4 className="font-semibold text-stone-800 mb-3">Auto Layout</h4>
                    <div className="space-y-2">
                      <button
                        onClick={handleAutoNest}
                        disabled={isProcessing || layers.length === 0}
                        className="w-full px-4 py-3 bg-white border border-stone-200 rounded-lg text-left hover:bg-purple-50 hover:border-purple-200 transition-colors disabled:opacity-50 flex items-center justify-between"
                      >
                        <div className="flex items-center gap-3">
                          <LayoutGrid className="w-5 h-5 text-purple-600" />
                          <div>
                            <div className="font-medium text-stone-800">Auto-Nest</div>
                            <div className="text-xs text-stone-500">{getFeaturePrice('auto_nest')} ITC</div>
                          </div>
                        </div>
                        {isProcessing ? (
                          <Loader2 className="w-4 h-4 text-purple-600 animate-spin" />
                        ) : (
                          <ArrowRight className="w-4 h-4 text-stone-400" />
                        )}
                      </button>

                      <button
                        onClick={handleSmartFill}
                        disabled={isProcessing || layers.length === 0}
                        className="w-full px-4 py-3 bg-white border border-stone-200 rounded-lg text-left hover:bg-purple-50 hover:border-purple-200 transition-colors disabled:opacity-50 flex items-center justify-between"
                      >
                        <div className="flex items-center gap-3">
                          <Copy className="w-5 h-5 text-purple-600" />
                          <div>
                            <div className="font-medium text-stone-800">Smart Fill</div>
                            <div className="text-xs text-stone-500">{getFeaturePrice('smart_fill')} ITC</div>
                          </div>
                        </div>
                        {isProcessing ? (
                          <Loader2 className="w-4 h-4 text-purple-600 animate-spin" />
                        ) : (
                          <ArrowRight className="w-4 h-4 text-stone-400" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Cart Panel (formerly Export) */}
              {activePanel === 'export' && (
                <div className="space-y-6">
                  <div>
                    <h3 className="font-semibold text-stone-800 mb-4">Order Your Imagination Sheet™</h3>

                    <div className="p-4 bg-purple-50 rounded-xl border border-purple-100 mb-4">
                      <div className="flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 text-purple-600 shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm text-purple-800 font-medium">Sheet Summary</p>
                          <p className="text-xs text-purple-600 mt-1">
                            {sheet.sheet_width}" × {sheet.sheet_height}" {preset?.name} sheet with {layers.length} layer{layers.length !== 1 ? 's' : ''}
                          </p>
                          <p className="text-sm text-purple-800 font-bold mt-2">
                            Price: ${calculateSheetPrice(sheet.print_type as PrintType, sheet.sheet_height).toFixed(2)}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* DPI Quality Summary */}
                    {(() => {
                      const dangerCount = layers.filter(l =>
                        (l.layer_type === 'image' || l.layer_type === 'ai_generated') && l.metadata?.dpiInfo?.quality === 'danger'
                      ).length;
                      const warningCount = layers.filter(l =>
                        (l.layer_type === 'image' || l.layer_type === 'ai_generated') && l.metadata?.dpiInfo?.quality === 'warning'
                      ).length;

                      if (dangerCount > 0 || warningCount > 0) {
                        return (
                          <div className={`p-4 rounded-xl border mb-4 ${dangerCount > 0
                            ? 'bg-red-50 border-red-300'
                            : 'bg-amber-50 border-amber-300'
                            }`}>
                            <div className="flex items-start gap-3">
                              <AlertCircle className={`w-5 h-5 shrink-0 mt-0.5 ${dangerCount > 0 ? 'text-red-600' : 'text-amber-600'
                                }`} />
                              <div className="flex-1">
                                <p className={`text-sm font-medium mb-1 ${dangerCount > 0 ? 'text-red-800' : 'text-amber-800'
                                  }`}>
                                  {dangerCount > 0 ? 'Print Quality Issues' : 'Print Quality Warning'}
                                </p>
                                {dangerCount > 0 && (
                                  <p className="text-xs text-red-700 mb-2">
                                    {dangerCount} image{dangerCount !== 1 ? 's' : ''} with critically low DPI (below 100). Cannot add to cart.
                                  </p>
                                )}
                                {warningCount > 0 && (
                                  <p className="text-xs text-amber-700 mb-2">
                                    {warningCount} image{warningCount !== 1 ? 's' : ''} with low DPI (100-150). May appear pixelated.
                                  </p>
                                )}
                                <p className={`text-xs ${dangerCount > 0 ? 'text-red-600' : 'text-amber-600'
                                  }`}>
                                  {dangerCount > 0
                                    ? 'Fix quality issues before ordering'
                                    : 'Consider improving quality before ordering'}
                                </p>
                              </div>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    })()}

                    <button
                      onClick={handleAddToCart}
                      disabled={isProcessing || layers.length === 0}
                      className="w-full px-4 py-4 bg-gradient-to-r from-purple-600 to-purple-700 text-white rounded-xl font-medium hover:from-purple-700 hover:to-purple-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg"
                    >
                      {isProcessing ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          Processing...
                        </>
                      ) : (
                        <>
                          <ShoppingCart className="w-5 h-5" />
                          Add to Cart
                        </>
                      )}
                    </button>
                  </div>

                  <div className="p-4 bg-stone-50 rounded-xl">
                    <h4 className="font-medium text-stone-800 mb-3">Print Options</h4>
                    <div className="space-y-3">
                      {/* Show cutlines toggle only for UV DTF */}
                      {preset?.allowCutlines && (
                        <label className="flex items-center gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={showCutLines}
                            onChange={(e) => setShowCutLines(e.target.checked)}
                            className="w-4 h-4 rounded border-stone-300 text-purple-600 focus:ring-purple-500"
                          />
                          <div className="flex items-center gap-2">
                            <Scissors className="w-4 h-4 text-stone-500" />
                            <span className="text-sm text-stone-600">Include cut lines</span>
                          </div>
                        </label>
                      )}

                      {/* Show mirror toggle only for Sublimation */}
                      {preset?.allowMirror && (
                        <label className="flex items-center gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={mirrorForSublimation}
                            onChange={(e) => setMirrorForSublimation(e.target.checked)}
                            className="w-4 h-4 rounded border-stone-300 text-purple-600 focus:ring-purple-500"
                          />
                          <div className="flex items-center gap-2">
                            <FlipHorizontal className="w-4 h-4 text-stone-500" />
                            <span className="text-sm text-stone-600">Mirror for sublimation</span>
                          </div>
                        </label>
                      )}

                      {/* Show info if no options available */}
                      {!preset?.allowCutlines && !preset?.allowMirror && (
                        <div className="text-sm text-stone-500 italic">
                          No additional print options for {preset?.name}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="p-4 bg-blue-50 rounded-xl border border-blue-100">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm text-blue-800 font-medium">Production Note</p>
                        <p className="text-xs text-blue-600 mt-1">
                          Your design will be saved and processed for printing after checkout. High-resolution print files will be generated by our production system.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* Add Element Panel Modal */}
      {showAddElementPanel && (
        <AddElementPanel
          onAddElement={handleAddElement}
          onClose={() => setShowAddElementPanel(false)}
        />
      )}

      {/* My Projects Modal */}
      {showProjectsModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[80vh] overflow-hidden shadow-2xl">
            <div className="p-6 border-b border-stone-200 flex items-center justify-between">
              <h2 className="text-2xl font-serif font-bold text-stone-900">My Projects</h2>
              <button
                onClick={() => setShowProjectsModal(false)}
                className="w-8 h-8 flex items-center justify-center text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded-lg transition-colors"
              >
                ✕
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[calc(80vh-120px)]">
              {recentSheets.length === 0 ? (
                <div className="text-center py-12">
                  <Layers className="w-16 h-16 mx-auto mb-4 text-stone-300" />
                  <h3 className="text-lg font-medium text-stone-600 mb-2">No projects yet</h3>
                  <p className="text-stone-500">Create a new Imagination Sheet™ to get started!</p>
                  <button
                    onClick={() => {
                      setShowProjectsModal(false);
                      navigate('/imagination-station');
                    }}
                    className="mt-6 px-6 py-3 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 transition-colors"
                  >
                    Create New Project
                  </button>
                </div>
              ) : (
                <div className="grid md:grid-cols-2 gap-4">
                  {recentSheets.map(s => {
                    const preset = presets ? presets[s.print_type as PrintType] : null;
                    const layerCount = s.canvas_state?.layers?.length || 0;
                    const isCurrentProject = s.id === sheet?.id;
                    return (
                      <button
                        key={s.id}
                        onClick={() => {
                          if (!isCurrentProject) {
                            if (saveStatus === 'unsaved') {
                              const confirmSwitch = window.confirm(
                                'You have unsaved changes. Do you want to save before switching projects?'
                              );
                              if (confirmSwitch) {
                                saveSheet().then(() => {
                                  navigate(`/imagination-station/${s.id}`);
                                  setShowProjectsModal(false);
                                });
                                return;
                              }
                            }
                            navigate(`/imagination-station/${s.id}`);
                            setShowProjectsModal(false);
                          }
                        }}
                        className={`text-left border rounded-xl overflow-hidden hover:border-purple-300 hover:shadow-md transition-all duration-200 ${isCurrentProject ? 'border-purple-500 ring-2 ring-purple-200' : 'border-stone-200'
                          }`}
                      >
                        <div className="aspect-video bg-stone-100 relative overflow-hidden">
                          {s.thumbnail_url ? (
                            <img src={s.thumbnail_url} alt={s.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <div className={`w-16 h-16 ${preset?.bgColor || 'bg-stone-100'} rounded-xl flex items-center justify-center text-3xl`}>
                                {preset?.icon || '📄'}
                              </div>
                            </div>
                          )}
                          <div className="absolute top-2 right-2">
                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${s.status === 'draft' ? 'bg-stone-800/80 text-white' : s.status === 'submitted' ? 'bg-purple-600/80 text-white' : 'bg-green-600/80 text-white'
                              }`}>
                              {s.status === 'draft' ? 'Draft' : s.status === 'submitted' ? 'Submitted' : s.status}
                            </span>
                          </div>
                          {isCurrentProject && (
                            <div className="absolute top-2 left-2">
                              <span className="px-2 py-1 text-xs font-medium rounded-full bg-purple-600 text-white">Current</span>
                            </div>
                          )}
                        </div>
                        <div className="p-4">
                          <h3 className="font-medium text-stone-800 truncate mb-1">{s.name}</h3>
                          <p className="text-xs text-stone-500 mb-2">
                            {s.sheet_width}" × {s.sheet_height}" {preset?.name || s.print_type}
                          </p>
                          <div className="flex items-center gap-3 text-xs text-stone-400">
                            <span className="flex items-center gap-1">
                              <Layers className="w-3 h-3" />
                              {layerCount} layer{layerCount !== 1 ? 's' : ''}
                            </span>
                            <span>•</span>
                            <span>{new Date(s.updated_at).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="p-6 border-t border-stone-200 flex items-center justify-between">
              <button
                onClick={() => {
                  setShowProjectsModal(false);
                  navigate('/imagination-station');
                }}
                className="px-4 py-2 text-purple-600 hover:text-purple-700 font-medium"
              >
                Create New Project
              </button>
              <button
                onClick={() => setShowProjectsModal(false)}
                className="px-6 py-2 bg-stone-100 text-stone-700 rounded-lg font-medium hover:bg-stone-200 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image Compare Modal */}
      {compareModal && (
        <ImageCompareModal
          isOpen={compareModal.isOpen}
          onClose={() => setCompareModal(null)}
          beforeImage={compareModal.beforeImage}
          afterImage={compareModal.afterImage}
          beforeLabel="Before"
          afterLabel="After"
          title={`${compareModal.operation} Results`}
          metadata={{
            beforeDimensions: compareModal.beforeDimensions,
            afterDimensions: compareModal.afterDimensions,
            beforeDpi: compareModal.beforeDpi,
            afterDpi: compareModal.afterDpi,
            operation: compareModal.operation,
          }}
          onAccept={() => {
            // Changes are already applied, just close the modal
            setCompareModal(null);
          }}
          onRevert={() => {
            // Revert the layer to its original state
            const layer = layers.find(l => l.id === compareModal.layerId);
            if (layer) {
              const beforeUrl = compareModal.beforeImage;
              setLayers(prev => prev.map(l => {
                if (l.id === compareModal.layerId) {
                  // Restore original dimensions if this was an upscale
                  const originalWidth = l.metadata?.beforeUpscaleWidth || l.metadata?.originalWidth;
                  const originalHeight = l.metadata?.beforeUpscaleHeight || l.metadata?.originalHeight;
                  const newDpiInfo = originalWidth && originalHeight
                    ? calculateDpi(originalWidth, originalHeight, l.width, l.height)
                    : l.metadata?.dpiInfo;

                  return {
                    ...l,
                    processed_url: beforeUrl !== l.source_url ? beforeUrl : null,
                    metadata: {
                      ...l.metadata,
                      originalWidth,
                      originalHeight,
                      dpiInfo: newDpiInfo,
                      upscaled: false,
                      enhanced: false,
                      upscaleFactor: undefined,
                      beforeUpscaleUrl: undefined,
                      beforeUpscaleWidth: undefined,
                      beforeUpscaleHeight: undefined,
                      beforeEnhanceUrl: undefined,
                    }
                  };
                }
                return l;
              }));
              setSaveStatus('unsaved');
            }
            setCompareModal(null);
          }}
        />
      )}

      {/* Mr. Imagine Modal */}
      <MrImagineModal
        isOpen={showMrImagineModal}
        onClose={() => setShowMrImagineModal(false)}
        pricing={{
          autoNest: getFeaturePrice('auto_nest'),
          smartFill: getFeaturePrice('smart_fill'),
          aiGeneration: getFeaturePrice('generate'),
          removeBackground: getFeaturePrice('bg_remove'),
          upscale2x: getFeaturePrice('upscale_2x'),
          upscale4x: getFeaturePrice('upscale_4x'),
          enhance: getFeaturePrice('enhance'),
        }}
        freeTrials={{
          aiGeneration: getFreeTrial('generate'),
          removeBackground: getFreeTrial('bg_remove'),
          upscale: getFreeTrial('upscale_2x'),
          enhance: getFreeTrial('enhance'),
        }}
        itcBalance={itcBalance}
        onImageGenerated={handleMrImagineImageGenerated}
      />

      {/* Reimagine It Modal - Transform existing images */}
      {reimagineItLayer && (
        <ReimagineItModal
          isOpen={showReimagineItModal}
          onClose={() => {
            setShowReimagineItModal(false);
            setReimagineItLayerId(null);
          }}
          imageUrl={reimagineItLayer.processed_url || reimagineItLayer.source_url || ''}
          layerName={reimagineItLayer.metadata?.name || 'Selected Image'}
          onAcceptReimaged={handleReimagineItAccept}
          onKeepOriginal={handleReimagineItKeepOriginal}
        />
      )}
    </div>
  );
};

// Wrap with ErrorBoundary for stability
const ImaginationStationWithErrorBoundary: React.FC = () => (
  <ErrorBoundary>
    <ImaginationStation />
  </ErrorBoundary>
);

export default ImaginationStationWithErrorBoundary;
