// src/pages/ImaginationStation.tsx
// Imagination Station - Imagination Sheet Builder with Editorial Design

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate, Link, useSearchParams, useLocation } from 'react-router-dom';
import { useAuth } from '../context/SupabaseAuthContext';
import { useCart } from '../context/CartContext';
import { useToast } from '../hooks/useToast';
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
import { SheetCanvas, AddElementPanel, ImageCompareModal, MrImagineModal, ReimagineItModal, ITPEnhanceModal, MakeProductModal } from '../components/imagination';
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
  ChevronDown,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Copy,
  Type,
  Square,
  LayoutGrid,
  Save,
  Clock,
  CheckCircle,
  AlertCircle,
  Loader2,
  ArrowRight,
  PanelLeft,
  PanelRight,
  User,
  Scissors,
  FlipHorizontal,
  Maximize,
  RefreshCw,
  ShoppingBag,
  Undo2,
  Redo2,
  Expand,
  X,
  Download,
  ChevronLeft
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

const DTF_PRINT_SIZE_OPTIONS = [
  { label: 'Pocket 4"', width: 4 },
  { label: 'Youth 7"', width: 7 },
  { label: 'Small 8"', width: 8 },
  { label: 'Medium 9"', width: 9 },
  { label: 'Large 10"', width: 10 },
  { label: 'XL 11"', width: 11 },
  { label: 'XXL 12"', width: 12 },
  { label: 'XXXL 13"', width: 13 },
];

// Studio design type for the gallery (separate from sheet layers)
interface StudioDesign {
  id: string;
  name: string;
  url: string;
  originalUrl: string;
  history: string[];
  createdAt: string;
  meta?: Record<string, any>;
}

interface MrImagineDesignMetadata {
  printWidthInches?: number;
  printSizeLabel?: string;
  source?: string;
}

const ImaginationStation: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { addToCart } = useCart();
  const toast = useToast();

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
  const [activePanel, setActivePanel] = useState<'design' | 'order'>('design');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  // Sidebars start closed on mobile so the canvas is visible first
  const [leftSidebarVisible, setLeftSidebarVisible] = useState(
    () => typeof window === 'undefined' || window.innerWidth >= 768
  );
  const [rightSidebarVisible, setRightSidebarVisible] = useState(
    () => typeof window === 'undefined' || window.innerWidth >= 768
  );
  const [showProjectsModal, setShowProjectsModal] = useState(false);
  const [showMrImagineModal, setShowMrImagineModal] = useState(false);
  const [showMakeProductModal, setShowMakeProductModal] = useState(false);
  const [showReimagineItModal, setShowReimagineItModal] = useState(false);
  const [showITPEnhanceModal, setShowITPEnhanceModal] = useState(false);
  const [reimagineItLayerId, setReimagineItLayerId] = useState<string | null>(null);

  // Canvas features state
  const [showCutLines, setShowCutLines] = useState(false);
  const [mirrorForSublimation, setMirrorForSublimation] = useState(false);
  const [showSafeMargin, setShowSafeMargin] = useState(false);

  // Loading states
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [presets, setPresets] = useState<any>(null); // State for dynamic presets

  // Pricing
  const [pricing, setPricing] = useState<ImaginationPricing[]>([]);
  const [freeTrials, setFreeTrials] = useState<FreeTrialStatus[]>([]);

  const [showAddElementPanel, setShowAddElementPanel] = useState(false);

  // Studio designs (separate from sheet layers)
  const [designs, setDesigns] = useState<StudioDesign[]>([]);
  const [activeDesignId, setActiveDesignId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [reimagineDesignId, setReimagineDesignId] = useState<string | null>(null);

  // Processing states for individual tools
  const [isRemovingBg, setIsRemovingBg] = useState(false);
  const [isUpscaling, setIsUpscaling] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [isHalftoning, setIsHalftoning] = useState(false);

  // Compare modal state for before/after comparison.
  // `revert` is an exact snapshot of the layer fields taken BEFORE the operation,
  // so Revert restores the true prior state (processed_url may legitimately be null).
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
    revert: {
      processedUrl: string | null;
      metadata: Record<string, any> | null;
    };
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

  // Fit the whole sheet into the visible canvas area
  const fitSheetToView = useCallback(() => {
    if (!sheet) return;
    const cw = canvasRef.current?.offsetWidth || 800;
    const ch = canvasRef.current?.offsetHeight || 600;
    const margin = 48;
    const fit = Math.min(
      (cw - margin * 2) / (sheet.sheet_width * PIXELS_PER_INCH),
      (ch - margin * 2) / (sheet.sheet_height * PIXELS_PER_INCH)
    );
    setZoom(Math.max(MIN_ZOOM, Math.min(fit, MAX_ZOOM)));
  }, [sheet]);

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

  // When a layer gets selected, surface its properties (Design tab)
  useEffect(() => {
    if (selectedLayerIds.length > 0) {
      setActivePanel('design');
    }
  }, [selectedLayerIds]);

  // Load data on mount
  useEffect(() => {
    loadInitialData();
  }, [id]);

  // Store pending image from URL params (to add after sheet is created)
  const [pendingImage, setPendingImage] = useState<{ url: string; name: string } | null>(null);

  // Check for URL parameters or navigation state on mount - store for later if no sheet exists
  useEffect(() => {
    // First check URL params
    const addImageUrl = searchParams.get('addImage');
    const productName = searchParams.get('productName');

    if (addImageUrl && !hasProcessedUrlImage.current) {
      setPendingImage({ url: addImageUrl, name: productName || 'Product Image' });
      // Clear the URL params
      setSearchParams({});
      return;
    }

    // Then check navigation state (from CreateDesignModal)
    const state = location.state as { preloadImage?: string; designConcept?: string } | null;
    if (state?.preloadImage && !hasProcessedUrlImage.current) {
      setPendingImage({ url: state.preloadImage, name: state.designConcept || 'Voice Design' });
      // Clear the navigation state
      navigate(location.pathname, { replace: true });
    }
  }, [searchParams, setSearchParams, location.state, location.pathname, navigate]);

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

        // Calculate layer dimensions in INCHES (max 6 inches, never larger than the sheet, maintaining aspect ratio)
        const maxSizeInches = Math.max(0.5, Math.min(6, sheet.sheet_width - 0.5, sheet.sheet_height - 0.5));
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
        const dpiInfo = calculateDpi(originalWidth, originalHeight, widthInches * PIXELS_PER_INCH, heightInches * PIXELS_PER_INCH);

        // Center the image on the sheet
        const centerX = (sheet.sheet_width - widthInches) / 2;
        const centerY = (sheet.sheet_height - heightInches) / 2;

        // Create new layer
        const newLayer: ImaginationLayer = {
          id: `layer-${Date.now()}`,
          sheet_id: sheet.id,
          layer_type: 'image' as LayerType,
          source_url: addImageUrl,
          processed_url: null,
          position_x: Math.max(0, centerX),
          position_y: Math.max(0, centerY),
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
        fitSheetToView();
      };
      img.onerror = () => {
        console.error('Failed to load product image:', addImageUrl);
      };
      img.src = addImageUrl;
    };

    addPendingImageToSheet();
  }, [sheet, pendingImage, fitSheetToView]);

  const loadInitialData = async () => {
    setIsLoading(true);
    let merged: any = null;
    try {
      // Pricing and presets are independent GETs — fire them in parallel
      // (allSettled so one failing doesn't block the other).
      const [pricingRes, presetRes] = await Promise.allSettled([
        imaginationApi.getPricing(),
        imaginationApi.getPresets(),
      ]);

      // Pricing + free trials (combined endpoint) → { pricing: [...], freeTrials: [...] }
      if (pricingRes.status === 'fulfilled') {
        const pricingData = pricingRes.value?.data;
        setPricing(pricingData?.pricing || []);
        setFreeTrials(pricingData?.freeTrials || []);
      } else {
        console.log('Pricing not available:', pricingRes.reason);
      }

      // Presets → merge API data with UI config
      if (presetRes.status === 'fulfilled') {
        const presetData = presetRes.value?.data;
        if (presetData) {
          merged = {};
          Object.keys(presetData).forEach(key => {
            merged[key] = {
              ...presetData[key],
              ...(PRESET_UI_CONFIG[key] || {}),
              name: presetData[key].displayName, // Map displayName to name for compatibility
              allowMirror: presetData[key].rules?.mirror,
              allowCutlines: presetData[key].rules?.cutlineOption,
              // API returns heights directly as array of numbers (not sizes array of objects)
              heights: presetData[key].heights || []
            };
          });
          setPresets(merged);
        }
      } else {
        console.error('Failed to load presets:', presetRes.reason);
      }

      // Load specific sheet if ID provided
      if (id) {
        const { data: sheetData } = await imaginationApi.getSheet(id);
        setSheet(sheetData);
        // Load layers directly - they're already in ImaginationLayer format
        if (sheetData.layers) {
          setLayers(sheetData.layers);
          // Returning to a sheet that already has work → open the Imagination
          // Sheet drawer so the user sees it (otherwise it looks "empty").
          if (sheetData.layers.length > 0) setSheetOpen(true);
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
        // STUDIO-FIRST: never gate on the sheet-type picker. Open the most
        // recent sheet, or auto-create a sensible default, so the user lands
        // straight in the imagine studio and can generate/reimagine right away.
        // The picker is still reachable via "New sheet"/Projects — it's just no
        // longer a wall in front of "I just want to imagine an image".
        try {
          const { data: sheetsData } = await imaginationApi.getSheets();
          setRecentSheets(sheetsData || []);
          if (sheetsData && sheetsData.length > 0) {
            navigate(`/imagination-station/${sheetsData[0].id}`, { replace: true });
            return; // remount loads it via the id branch above
          }
          // No sheets yet → auto-create a default so the studio + drawer are ready.
          if (merged) {
            const keys = Object.keys(merged);
            const defaultType = (keys.includes('dtf') ? 'dtf' : keys[0]) as PrintType;
            const p = defaultType ? merged[defaultType] : null;
            if (p) {
              const defaultHeight = (Array.isArray(p.heights) && p.heights[0]) || 12;
              const { data } = await imaginationApi.createSheet({
                name: `${p.name} Sheet`,
                print_type: defaultType,
                sheet_height: defaultHeight,
              });
              navigate(`/imagination-station/${data.id}`, { replace: true });
              return;
            }
          }
          // Fallback: presets unavailable → leave sheet null so the picker shows.
        } catch (e) {
          console.log('Could not load/auto-create sheet — falling back to picker');
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
        toast.info('One moment', 'Sheet options are still loading — try again in a second.');
        setIsCreating(false);
        return;
      }
      const preset = presets[printType];
      const { data } = await imaginationApi.createSheet({
        name: `${preset.name} Sheet - ${preset.width}" x ${height}"`,
        print_type: printType,
        sheet_height: height
      });
      navigate(`/imagination-station/${data.id}`);
    } catch (error: any) {
      console.error('Failed to create sheet:', error);
      const errorMsg = error.response?.data?.error || error.message || 'Unknown error';
      toast.error('Failed to create sheet', errorMsg);
    } finally {
      setIsCreating(false);
    }
  };

  // Handle file upload
    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (!sheet) {
      toast.error("Sign in required", "Please sign in to upload your own designs.");
      return;
    }

    setIsProcessing(true);
    try {
      for (const file of Array.from(files)) {
        try {
          // 1. Actually upload to the server first
          const { data: uploadedLayer } = await imaginationApi.uploadImage(sheet.id, file);

          // 2. Load the image to get dimensions for DPI and initial sizing
          await new Promise<void>((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
              const originalWidth = img.width;
              const originalHeight = img.height;

              const maxSizeInches = Math.max(0.5, Math.min(6, sheet.sheet_width - 0.5, sheet.sheet_height - 0.5));
              const aspectRatio = originalWidth / originalHeight;
              let widthInches: number;
              let heightInches: number;

              if (aspectRatio >= 1) {
                widthInches = maxSizeInches;
                heightInches = maxSizeInches / aspectRatio;
              } else {
                heightInches = maxSizeInches;
                widthInches = maxSizeInches * aspectRatio;
              }

              const dpiInfo = calculateDpi(originalWidth, originalHeight, widthInches * PIXELS_PER_INCH, heightInches * PIXELS_PER_INCH);

              const centerX = (sheet.sheet_width - widthInches) / 2;
              const centerY = (sheet.sheet_height - heightInches) / 2;

              setLayers(prev => {
                const newLayer: ImaginationLayer = {
                  ...uploadedLayer,
                  position_x: Math.max(0, centerX),
                  position_y: Math.max(0, centerY),
                  width: widthInches,
                  height: heightInches,
                  z_index: prev.length,
                  metadata: {
                    ...uploadedLayer.metadata,
                    dpiInfo,
                    originalWidth,
                    originalHeight,
                    name: file.name.replace(/\.[^/.]+$/, ''),
                  }
                };

                setSelectedLayerIds([newLayer.id]);
                return [...prev, newLayer];
              });

              setSaveStatus('unsaved');
              resolve();
            };
            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = uploadedLayer.source_url;
          });
        } catch (fileError) {
          console.error(`Failed to upload file ${file.name}:`, fileError);
          toast.error('Upload failed', `Failed to upload ${file.name}. Please try again.`);
        }
      }
      // Fit the whole board in view after all uploads
      fitSheetToView();
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }

  };

  // calculateDpi expects the print size in PIXELS â€” layer width/height are stored in INCHES
  const calcDpiInches = (originalPxW: number, originalPxH: number, widthInches: number, heightInches: number): DpiInfo =>
    calculateDpi(originalPxW, originalPxH, widthInches * PIXELS_PER_INCH, heightInches * PIXELS_PER_INCH);

  // Recalculate DPI when layer size changes
  const recalculateDpi = (layer: ImaginationLayer, newWidth?: number, newHeight?: number): DpiInfo | undefined => {
    const originalWidth = layer.metadata?.originalWidth;
    const originalHeight = layer.metadata?.originalHeight;

    if (!originalWidth || !originalHeight) return undefined;

    const w = newWidth ?? layer.width;
    const h = newHeight ?? layer.height;

    return calcDpiInches(originalWidth, originalHeight, w, h);
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

    // AddElementPanel emits PIXEL units â€” convert everything to inches for storage
    // (width/height were previously stored raw, producing 200-inch shapes)
    const widthInches = element.width / PIXELS_PER_INCH;
    const heightInches = Math.max(element.height / PIXELS_PER_INCH, element.type === 'shape' && element.height === 0 ? 0 : 0.25);

    const newLayer: ImaginationLayer = {
      id: element.id,
      sheet_id: sheet.id,
      layer_type: element.type,
      source_url: element.src || null,
      processed_url: null,
      position_x: Math.max(0, (sheet.sheet_width - widthInches) / 2),
      position_y: Math.max(0, (sheet.sheet_height - heightInches) / 2),
      width: widthInches,
      height: heightInches,
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

  // Handle image generated from MrImagineModal â€” pushes to studio gallery
  const handleMrImagineImageGenerated = useCallback(async (imageUrl: string, metadata?: MrImagineDesignMetadata) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const newDesign: StudioDesign = {
        id: `design-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: 'Mr. Imagine Design',
        url: imageUrl,
        originalUrl: imageUrl,
        history: [imageUrl],
        createdAt: new Date().toISOString(),
        meta: {
          ...metadata,
          originalWidth: img.naturalWidth,
          originalHeight: img.naturalHeight,
          source: metadata?.source || 'mr-imagine',
        },
      };
      setDesigns(prev => [...prev, newDesign]);
      setActiveDesignId(newDesign.id);
      toast.success('Design added', 'Your AI design is ready in the gallery');
    };
    img.onerror = () => {
      const newDesign: StudioDesign = {
        id: `design-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: 'Mr. Imagine Design',
        url: imageUrl,
        originalUrl: imageUrl,
        history: [imageUrl],
        createdAt: new Date().toISOString(),
        meta: {
          ...metadata,
          source: metadata?.source || 'mr-imagine',
        },
      };
      setDesigns(prev => [...prev, newDesign]);
      setActiveDesignId(newDesign.id);
      toast.success('Design added', 'Your AI design is ready in the gallery');
    };
    img.src = imageUrl;
  }, [toast]);

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
      toast.warning('Sheet is empty', 'Add some designs to your sheet before ordering.');
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
      toast.error(
        `${dangerLayers.length} design${dangerLayers.length !== 1 ? 's' : ''} too low quality to print`,
        `${layerNames} — shrink them, upload a higher-resolution version, or use the Upscale tool.`,
        8000
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
      // First, save the current sheet state â€” if this fails we abort the add-to-cart
      await persistSheet();

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
        description: `${preset.name} Imagination Sheet - ${sheet.sheet_width}" x ${sheet.sheet_height}" with ${layers.length} design${layers.length !== 1 ? 's' : ''}`,
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
      toast.success('Added to cart', `Imagination Sheet - $${price.toFixed(2)}`);
      navigate('/cart');
    } catch (error) {
      console.error('Failed to add to cart:', error);
      toast.error('Failed to add to cart', 'Please try again');
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
        const placedCount = data.positions.length;
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
        const efficiencyNote = typeof data.efficiency === 'number'
          ? ` - ${Math.round(data.efficiency)}% of sheet used`
          : '';
        toast.success('Auto-Nest complete', `Arranged ${placedCount} design${placedCount !== 1 ? 's' : ''}${efficiencyNote}`);
      }
    } catch (error: any) {
      console.error('Auto-Nest failed:', error);
      toast.error('Auto-Nest failed', error.response?.data?.error || 'Please try again.');
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
        toast.success('Smart Fill complete', `Added ${newLayers.length} cop${newLayers.length !== 1 ? 'ies' : 'y'} to fill empty space`);
      }
    } catch (error: any) {
      console.error('Smart Fill failed:', error);
      toast.error('Smart Fill failed', error.response?.data?.error || 'Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle Remove Background for selected layer
  const handleRemoveBackground = async () => {
    if (!sheet || selectedLayerIds.length === 0) return;

    const selectedLayer = layers.find(l => selectedLayerIds.includes(l.id) && (l.layer_type === 'image' || l.layer_type === 'ai_generated'));
    if (!selectedLayer) {
      toast.warning('Select an image first', 'Click an image layer in your design to continue.');
      return;
    }

    const imageUrl = selectedLayer.processed_url || selectedLayer.source_url;
    if (!imageUrl) {
      toast.error('Image not loaded', 'This layer has no source image. Try re-uploading.');
      return;
    }

    // Snapshot for exact revert
    const revertSnapshot = {
      processedUrl: selectedLayer.processed_url ?? null,
      metadata: selectedLayer.metadata ? { ...selectedLayer.metadata } : null,
    };

    setIsRemovingBg(true);
    try {
      const useTrial = getFreeTrial('bg_remove') > 0;
      const { data } = await imaginationApi.removeBackground({ imageUrl, useTrial });

      // Already-transparent designs are skipped server-side (no charge, no
      // destructive re-cut) — just let the user know there was nothing to remove.
      if (data.alreadyTransparent) {
        toast.info('Already transparent', 'This image has no background to remove — you were not charged.');
        return;
      }

      // Use processedUrl or fallback to other response keys
      const newUrl = data.processedUrl || data.imageUrl || data.url || data.output;
      if (newUrl) {
        // Update the layer with the processed image
        setLayers(prev => prev.map(l =>
          l.id === selectedLayer.id
            ? { ...l, processed_url: newUrl, metadata: { ...l.metadata, backgroundRemoved: true } }
            : l
        ));
        setSaveStatus('unsaved');

        // Show before/after compare so the user can verify and revert
        setCompareModal({
          isOpen: true,
          beforeImage: imageUrl,
          afterImage: newUrl,
          layerId: selectedLayer.id,
          operation: 'Remove Background',
          revert: revertSnapshot,
        });

        // Refresh free trials if used
        if (useTrial) {
          const { data: pricingData } = await imaginationApi.getPricing();
          setFreeTrials(pricingData?.freeTrials || []);
        }
      } else {
        toast.error('Remove background failed', 'No image was returned. You were not charged.');
      }
    } catch (error: any) {
      console.error('Remove Background failed:', error);
      const msg = error.response?.data?.error || 'Please try again.';
      toast.error('Remove background failed', msg);
    } finally {
      setIsRemovingBg(false);
    }
  };

  // Handle Upscale for selected layer
  const handleUpscale = async () => {
    if (!sheet || selectedLayerIds.length === 0) return;

    const selectedLayer = layers.find(l => selectedLayerIds.includes(l.id) && (l.layer_type === 'image' || l.layer_type === 'ai_generated'));
    if (!selectedLayer) {
      toast.warning('Select an image first', 'Click an image layer in your design to continue.');
      return;
    }

    const imageUrl = selectedLayer.processed_url || selectedLayer.source_url;
    if (!imageUrl) {
      toast.error('Image not loaded', 'This layer has no source image. Try re-uploading.');
      return;
    }

    // Store original image for comparison
    const originalUrl = imageUrl;
    const originalWidth = selectedLayer.metadata?.originalWidth || selectedLayer.width;
    const originalHeight = selectedLayer.metadata?.originalHeight || selectedLayer.height;
    const originalDpi = selectedLayer.metadata?.dpiInfo?.dpi;

    // Snapshot for exact revert
    const revertSnapshot = {
      processedUrl: selectedLayer.processed_url ?? null,
      metadata: selectedLayer.metadata ? { ...selectedLayer.metadata } : null,
    };

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
        // Recalculate DPI with new original dimensions (print size stays the same, in inches)
        const newDpiInfo = calcDpiInches(newOriginalWidth, newOriginalHeight, selectedLayer.width, selectedLayer.height);

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
          revert: revertSnapshot,
        });

        // Refresh free trials if used
        if (useTrial) {
          const { data: pricingData } = await imaginationApi.getPricing();
          setFreeTrials(pricingData?.freeTrials || []);
        }
      } else {
        toast.error('Upscale failed', 'No image was returned. You were not charged.');
      }
    } catch (error: any) {
      console.error('Upscale failed:', error);
      const msg = error.response?.data?.error || 'Please try again.';
      toast.error('Upscale failed', msg);
    } finally {
      setIsUpscaling(false);
    }
  };

  // Handle Enhance for selected layer
  const handleEnhance = async () => {
    if (!sheet || selectedLayerIds.length === 0) return;

    const selectedLayer = layers.find(l => selectedLayerIds.includes(l.id) && (l.layer_type === 'image' || l.layer_type === 'ai_generated'));
    if (!selectedLayer) {
      toast.warning('Select an image first', 'Click an image layer in your design to continue.');
      return;
    }

    const imageUrl = selectedLayer.processed_url || selectedLayer.source_url;
    if (!imageUrl) {
      toast.error('Image not loaded', 'This layer has no source image. Try re-uploading.');
      return;
    }

    // Store original for comparison
    const originalUrl = imageUrl;
    const originalWidth = selectedLayer.metadata?.originalWidth || selectedLayer.width;
    const originalHeight = selectedLayer.metadata?.originalHeight || selectedLayer.height;

    // Snapshot for exact revert
    const revertSnapshot = {
      processedUrl: selectedLayer.processed_url ?? null,
      metadata: selectedLayer.metadata ? { ...selectedLayer.metadata } : null,
    };

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
          revert: revertSnapshot,
        });

        // Refresh free trials if used
        if (useTrial) {
          const { data: pricingData } = await imaginationApi.getPricing();
          setFreeTrials(pricingData?.freeTrials || []);
        }
      } else {
        toast.error('Enhance failed', 'No image was returned. You were not charged.');
      }
    } catch (error: any) {
      console.error('Enhance failed:', error);
      const msg = error.response?.data?.error || 'Please try again.';
      toast.error('Enhance failed', msg);
    } finally {
      setIsEnhancing(false);
    }
  };

  // Open Reimagine It modal for a selected image layer
  const openReimagineIt = (layerId: string) => {
    setReimagineItLayerId(layerId);
    setShowReimagineItModal(true);
  };

  // Handle accepting reimagined image â€” works for both designs and layers
  const handleReimagineItAccept = useCallback((newImageUrl: string) => {
    if (reimagineDesignId) {
      setDesigns(prev => prev.map(d =>
        d.id === reimagineDesignId ? { ...d, url: newImageUrl, history: [...d.history, newImageUrl] } : d
      ));
      setShowReimagineItModal(false);
      setReimagineDesignId(null);
    } else if (reimagineItLayerId) {
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
    }
  }, [reimagineDesignId, reimagineItLayerId]);

  // Handle keeping original in Reimagine It (just close modal)
  const handleReimagineItKeepOriginal = useCallback(() => {
    setShowReimagineItModal(false);
    setReimagineItLayerId(null);
    setReimagineDesignId(null);
  }, []);

  // Get the layer/design for Reimagine It modal â€” handles both designs and layers
  const reimagineItLayer = useMemo(() => {
    if (reimagineDesignId) {
      const design = designs.find(d => d.id === reimagineDesignId);
      if (!design) return null;
      return {
        id: design.id,
        processed_url: null,
        source_url: design.url,
        metadata: { name: design.name }
      } as unknown as ImaginationLayer;
    }
    return reimagineItLayerId ? layers.find(l => l.id === reimagineItLayerId) : null;
  }, [reimagineDesignId, reimagineItLayerId, layers, designs]);

  // Open Reimagine It modal for a design
  const openReimagineItForDesign = (designId: string) => {
    setReimagineDesignId(designId);
    setReimagineItLayerId(null);
    setShowReimagineItModal(true);
  };

  // Remove a design from the gallery
  const removeDesign = (id: string) => {
    setDesigns(prev => {
      const remaining = prev.filter(d => d.id !== id);
      if (activeDesignId === id) {
        setActiveDesignId(remaining.length > 0 ? remaining[remaining.length - 1].id : null);
      }
      return remaining;
    });
  };

  // Send a studio design to the Imagination Sheet
  const sendDesignToSheet = (design: StudioDesign) => {
    if (!sheet) return;
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const aspectRatio = img.naturalWidth / img.naturalHeight;
      const availableWidth = Math.max(0.5, sheet.sheet_width - 0.5);
      const availableHeight = Math.max(0.5, sheet.sheet_height - 0.5);
      const selectedPrintWidth = Number(design.meta?.printWidthInches);
      let widthInches: number;
      let heightInches: number;

      if (Number.isFinite(selectedPrintWidth) && selectedPrintWidth > 0) {
        widthInches = Math.max(0.5, Math.min(selectedPrintWidth, availableWidth));
        heightInches = widthInches / aspectRatio;
        if (heightInches > availableHeight) {
          heightInches = availableHeight;
          widthInches = heightInches * aspectRatio;
        }
      } else {
        const maxSizeInches = Math.max(0.5, Math.min(6, availableWidth, availableHeight));
        widthInches = aspectRatio >= 1 ? maxSizeInches : maxSizeInches * aspectRatio;
        heightInches = aspectRatio >= 1 ? maxSizeInches / aspectRatio : maxSizeInches;
      }

      const dpiInfo = calculateDpi(img.naturalWidth, img.naturalHeight, widthInches * PIXELS_PER_INCH, heightInches * PIXELS_PER_INCH);
      const newLayer: ImaginationLayer = {
        id: `layer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        sheet_id: sheet.id,
        layer_type: 'ai_generated',
        source_url: design.url,
        processed_url: null,
        position_x: (sheet.sheet_width - widthInches) / 2,
        position_y: (sheet.sheet_height - heightInches) / 2,
        width: widthInches,
        height: heightInches,
        rotation: 0,
        scale_x: 1,
        scale_y: 1,
        z_index: layers.length,
        metadata: {
          name: design.name,
          visible: true,
          locked: false,
          opacity: 1,
          dpiInfo,
          originalWidth: img.naturalWidth,
          originalHeight: img.naturalHeight,
          printWidthInches: design.meta?.printWidthInches,
          printSizeLabel: design.meta?.printSizeLabel,
        },
        created_at: new Date().toISOString(),
      };
      setLayers(prev => [...prev, newLayer]);
      setSelectedLayerIds([newLayer.id]);
      setSaveStatus('unsaved');
      setSheetOpen(true);
    };
    img.onerror = () => {
      const selectedPrintWidth = Number(design.meta?.printWidthInches);
      const fallbackSize = Number.isFinite(selectedPrintWidth) && selectedPrintWidth > 0
        ? Math.max(0.5, Math.min(selectedPrintWidth, sheet.sheet_width - 0.5, sheet.sheet_height - 0.5))
        : 4;
      const newLayer: ImaginationLayer = {
        id: `layer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        sheet_id: sheet.id,
        layer_type: 'ai_generated',
        source_url: design.url,
        processed_url: null,
        position_x: (sheet.sheet_width - fallbackSize) / 2,
        position_y: (sheet.sheet_height - fallbackSize) / 2,
        width: fallbackSize,
        height: fallbackSize,
        rotation: 0,
        scale_x: 1,
        scale_y: 1,
        z_index: layers.length,
        metadata: {
          name: design.name,
          visible: true,
          locked: false,
          opacity: 1,
          printWidthInches: design.meta?.printWidthInches,
          printSizeLabel: design.meta?.printSizeLabel,
        },
        created_at: new Date().toISOString(),
      };
      setLayers(prev => [...prev, newLayer]);
      setSheetOpen(true);
    };
    img.src = design.url;
  };

  // Upload file to designs gallery (not directly to sheet)
  const handleFileUploadToDesigns = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIsProcessing(true);
    try {
      for (const file of Array.from(files)) {
        const localUrl = URL.createObjectURL(file);
        let finalUrl = localUrl;
        if (sheet) {
          try {
            const { data: uploadedLayer } = await imaginationApi.uploadImage(sheet.id, file);
            finalUrl = uploadedLayer.source_url;
          } catch {
            // keep localUrl
          }
        }
        // eslint-disable-next-line no-loop-func
        const img = new window.Image();
        img.onload = () => {
          const newDesign: StudioDesign = {
            id: `design-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: file.name.replace(/\.[^/.]+$/, ''),
            url: finalUrl,
            originalUrl: finalUrl,
            history: [finalUrl],
            createdAt: new Date().toISOString(),
            meta: { originalWidth: img.naturalWidth, originalHeight: img.naturalHeight },
          };
          setDesigns(prev => [...prev, newDesign]);
          setActiveDesignId(newDesign.id);
        };
        img.src = finalUrl;
      }
      toast.success('Upload complete', `${files.length} image${files.length !== 1 ? 's' : ''} added to your designs`);
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Design-level tools (operate on activeDesign, not sheet layers)
  const handleDesignRemoveBg = async () => {
    const activeDesign = designs.find(d => d.id === activeDesignId) ?? null;
    if (!activeDesign) { toast.warning('Select a design first', 'Click a design in your gallery.'); return; }
    const imageUrl = activeDesign.url;
    const revertSnapshot = { processedUrl: activeDesign.url, metadata: null as Record<string, any> | null };
    setIsRemovingBg(true);
    try {
      const useTrial = getFreeTrial('bg_remove') > 0;
      const { data } = await imaginationApi.removeBackground({ imageUrl, useTrial });
      if (data.alreadyTransparent) {
        toast.info('Already transparent', 'This design has no background to remove — you were not charged.');
        return;
      }
      const newUrl = data.processedUrl || data.imageUrl || data.url || data.output;
      if (newUrl) {
        setDesigns(prev => prev.map(d => d.id === activeDesign.id ? { ...d, url: newUrl, history: [...d.history, newUrl] } : d));
        setCompareModal({ isOpen: true, beforeImage: imageUrl, afterImage: newUrl, layerId: activeDesign.id, operation: 'Remove Background', revert: revertSnapshot });
        if (useTrial) { const { data: pd } = await imaginationApi.getPricing(); setFreeTrials(pd?.freeTrials || []); }
      } else { toast.error('Remove background failed', 'No image returned.'); }
    } catch (err: any) { toast.error('Remove background failed', err.response?.data?.error || 'Please try again.'); }
    finally { setIsRemovingBg(false); }
  };

  const handleDesignUpscale = async () => {
    const activeDesign = designs.find(d => d.id === activeDesignId) ?? null;
    if (!activeDesign) { toast.warning('Select a design first', 'Click a design in your gallery.'); return; }
    const imageUrl = activeDesign.url;
    const revertSnapshot = { processedUrl: activeDesign.url, metadata: null as Record<string, any> | null };
    setIsUpscaling(true);
    try {
      const useTrial = getFreeTrial('upscale_2x') > 0;
      const { data } = await imaginationApi.upscaleImage({ imageUrl, factor: 2, useTrial });
      const newUrl = data.processedUrl || data.imageUrl || data.url || data.output;
      if (newUrl) {
        setDesigns(prev => prev.map(d => d.id === activeDesign.id ? { ...d, url: newUrl, history: [...d.history, newUrl] } : d));
        setCompareModal({ isOpen: true, beforeImage: imageUrl, afterImage: newUrl, layerId: activeDesign.id, operation: 'Upscale 2x', revert: revertSnapshot });
        if (useTrial) { const { data: pd } = await imaginationApi.getPricing(); setFreeTrials(pd?.freeTrials || []); }
      } else { toast.error('Upscale failed', 'No image returned.'); }
    } catch (err: any) { toast.error('Upscale failed', err.response?.data?.error || 'Please try again.'); }
    finally { setIsUpscaling(false); }
  };

  const handleDesignEnhance = async () => {
    const activeDesign = designs.find(d => d.id === activeDesignId) ?? null;
    if (!activeDesign) { toast.warning('Select a design first', 'Click a design in your gallery.'); return; }
    const imageUrl = activeDesign.url;
    const revertSnapshot = { processedUrl: activeDesign.url, metadata: null as Record<string, any> | null };
    setIsEnhancing(true);
    try {
      const useTrial = getFreeTrial('enhance') > 0;
      const { data } = await imaginationApi.enhanceImage({ imageUrl, useTrial });
      const newUrl = data.processedUrl || data.imageUrl || data.url || data.output;
      if (newUrl) {
        setDesigns(prev => prev.map(d => d.id === activeDesign.id ? { ...d, url: newUrl, history: [...d.history, newUrl] } : d));
        setCompareModal({ isOpen: true, beforeImage: imageUrl, afterImage: newUrl, layerId: activeDesign.id, operation: 'Enhance', revert: revertSnapshot });
        if (useTrial) { const { data: pd } = await imaginationApi.getPricing(); setFreeTrials(pd?.freeTrials || []); }
      } else { toast.error('Enhance failed', 'No image returned.'); }
    } catch (err: any) { toast.error('Enhance failed', err.response?.data?.error || 'Please try again.'); }
    finally { setIsEnhancing(false); }
  };

  const handleDesignHalftone = async () => {
    const activeDesign = designs.find(d => d.id === activeDesignId) ?? null;
    if (!activeDesign) { toast.warning('Select a design first', 'Click a design in your gallery.'); return; }
    const imageUrl = activeDesign.url;
    const revertSnapshot = { processedUrl: activeDesign.url, metadata: null as Record<string, any> | null };
    setIsHalftoning(true);
    try {
      const { data } = await imaginationApi.halftoneImage({ imageUrl });
      const newUrl = data.processedUrl || data.imageUrl || data.url || data.output;
      if (newUrl) {
        setDesigns(prev => prev.map(d => d.id === activeDesign.id ? { ...d, url: newUrl, history: [...d.history, newUrl] } : d));
        setCompareModal({ isOpen: true, beforeImage: imageUrl, afterImage: newUrl, layerId: activeDesign.id, operation: 'Halftone', revert: revertSnapshot });
      } else { toast.error('Halftone failed', 'No image returned.'); }
    } catch (err: any) { toast.error('Halftone failed', err.response?.data?.error || 'Please try again.'); }
    finally { setIsHalftoning(false); }
  };

  // Clear selection
  const clearSelection = () => {
    setSelectedLayerIds([]);
  };

  // Update canvas state
  const updateCanvasState = (state: CanvasState) => {
    setCanvasState(state);
    setSaveStatus('unsaved');
  };

  // Persist the project (canvas state + thumbnail). Silent mode is used by autosave.
  const persistSheet = async (opts: { silent?: boolean } = {}) => {
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
      if (!opts.silent) {
        toast.error('Save failed', 'Could not save your project. Please try again.');
      }
      throw error;
    }
  };

  const saveSheet = async () => {
    try {
      await persistSheet();
    } catch {
      // error already surfaced via toast
    }
  };

  const saveSheetSilent = () => persistSheet({ silent: true });

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
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-12">
          {/* Hero Section with Mr. Imagine */}
          <div className="text-center mb-8 sm:mb-16 relative">
            {/* Mr. Imagine Hero */}
            <div className="relative inline-block mb-4 sm:mb-8">
              <div className="absolute -inset-4 sm:-inset-8 bg-gradient-to-r from-cyan-400 via-violet-500 to-fuchsia-500 rounded-full blur-2xl opacity-40 animate-pulse"></div>
              <img
                src="/mr-imagine/mr-imagine-waving.png"
                alt="Mr. Imagine"
                className="relative w-24 h-24 sm:w-40 sm:h-40 md:w-52 md:h-52 object-contain drop-shadow-2xl animate-bounce"
                style={{ animationDuration: '3s' }}
              />
              {/* Magic sparkles around Mr. Imagine */}
              <Sparkles className="absolute -top-1 -right-1 sm:-top-2 sm:-right-2 w-5 h-5 sm:w-8 sm:h-8 text-yellow-400 animate-spin" style={{ animationDuration: '4s' }} />
              <Sparkles className="absolute -bottom-1 -left-1 sm:-bottom-2 sm:-left-2 w-4 h-4 sm:w-6 sm:h-6 text-cyan-400 animate-spin" style={{ animationDuration: '3s', animationDirection: 'reverse' }} />
            </div>

            {/* Title with gradient */}
            <div className="inline-flex items-center gap-1.5 sm:gap-2 px-3 sm:px-5 py-1.5 sm:py-2.5 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full text-white/90 text-xs sm:text-sm font-medium mb-4 sm:mb-6 shadow-xl">
              <Wand2 className="w-3 h-3 sm:w-4 sm:h-4 text-cyan-400" />
              <span className="bg-gradient-to-r from-cyan-400 to-fuchsia-400 bg-clip-text text-transparent font-semibold">
                AI-Powered Design Studio
              </span>
              <Sparkles className="w-3 h-3 sm:w-4 sm:h-4 text-fuchsia-400" />
            </div>

            <h1 className="text-3xl sm:text-5xl md:text-7xl font-black mb-4 sm:mb-6 tracking-tight">
              <span className="bg-gradient-to-r from-white via-cyan-200 to-white bg-clip-text text-transparent drop-shadow-lg">
                Imagination
              </span>
              <br />
              <span className="bg-gradient-to-r from-cyan-400 via-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
                Station
              </span>
            </h1>

            <p className="text-sm sm:text-lg md:text-xl text-white/70 max-w-2xl mx-auto leading-relaxed font-light px-4 sm:px-0">
              Create <span className="text-cyan-400 font-medium">professional imagination sheets</span> for DTF, UV DTF, and sublimation
              with <span className="text-fuchsia-400 font-medium">Mr. Imagine's AI magic</span>
            </p>

            {/* Feature pills - Horizontal scroll on mobile */}
            <div className="flex flex-wrap justify-center gap-2 sm:gap-3 mt-4 sm:mt-8 px-2 sm:px-0">
              {['AI Image Generation', 'Smart Auto-Layout', 'Background Removal', 'HD Upscaling'].map((feature, i) => (
                <div
                  key={feature}
                  className="px-2.5 sm:px-4 py-1.5 sm:py-2 bg-white/5 backdrop-blur-sm border border-white/10 rounded-full text-white/80 text-xs sm:text-sm flex items-center gap-1.5 sm:gap-2"
                  style={{ animationDelay: `${i * 0.1}s` }}
                >
                  <CheckCircle className="w-3 h-3 sm:w-4 sm:h-4 text-emerald-400" />
                  {feature}
                </div>
              ))}
            </div>
          </div>

          {/* Sheet Type Cards - Glassmorphism Style */}
          {presets && <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6 mb-8 sm:mb-16">
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
                  className={`relative group bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl sm:rounded-3xl p-4 sm:p-6 transition-all duration-500 hover:bg-white/10 hover:border-white/20 hover:shadow-2xl hover:-translate-y-2 ${glows[type as keyof typeof glows]}`}
                  style={{ animationDelay: `${index * 0.15}s` }}
                >
                  {/* Glow effect on hover */}
                  <div className={`absolute -inset-px bg-gradient-to-r ${gradients[type as keyof typeof gradients]} rounded-2xl sm:rounded-3xl opacity-0 group-hover:opacity-20 blur-xl transition-opacity duration-500`}></div>

                  <div className="relative">
                    {/* Icon with gradient background */}
                    <div className={`w-12 h-12 sm:w-16 sm:h-16 bg-gradient-to-br ${iconBgs[type as keyof typeof iconBgs]} rounded-xl sm:rounded-2xl flex items-center justify-center text-2xl sm:text-3xl mb-3 sm:mb-5 shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                      {preset.icon}
                    </div>

                    <h3 className="text-xl sm:text-2xl font-bold text-white mb-1 sm:mb-2 group-hover:text-transparent group-hover:bg-gradient-to-r group-hover:from-white group-hover:to-white/80 group-hover:bg-clip-text transition-all">
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
                                  {preset.width}" x {height}"
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
                          {s.sheet_width}" x {s.sheet_height}" {presetData?.name || s.print_type}
                        </p>
                        <div className="flex items-center gap-3 text-xs text-white/40">
                          <span className="flex items-center gap-1">
                            <Layers className="w-3 h-3" />
                            {layerCount} layer{layerCount !== 1 ? 's' : ''}
                          </span>
                          <span>-</span>
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
                <div className="w-10 h-10 bg-gradient-to-br from-amber-400/20 to-orange-500/20 rounded-full flex items-center justify-center shadow-lg p-1.5">
                  <img src="/itc-coin.png" alt="ITC" className="w-full h-full object-contain" />
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
            <p>Powered by <span className="text-cyan-400/60">Mr. Imagine</span> - AI-Driven Print Design</p>
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
  const hasSelectedImage = selectedLayers.some(l => l.layer_type === 'image' || l.layer_type === 'ai_generated');
  const sheetPrice = calculateSheetPrice(sheet.print_type as PrintType, sheet.sheet_height);
  const preset = presets ? presets[sheet.print_type as PrintType] : { name: sheet.print_type };
  const activeDesign = designs.find(d => d.id === activeDesignId) ?? null;

  // Resize the selected layer to a preset width (height follows aspect ratio)
  const applyQuickSize = (newWidth: number, printSizeLabel?: string) => {
    const currentLayer = selectedLayers[0];
    if (!currentLayer) return;
    const aspectRatio = currentLayer.width / currentLayer.height;
    if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) return;
    const newHeight = newWidth / aspectRatio;
    setLayers(prev => prev.map(l => {
      if (l.id === currentLayer.id) {
        const newDpiInfo = recalculateDpi(l, newWidth, newHeight);
        return {
          ...l,
          width: newWidth,
          height: newHeight,
          metadata: {
            ...l.metadata,
            dpiInfo: newDpiInfo || l.metadata?.dpiInfo,
            printWidthInches: newWidth,
            printSizeLabel,
          },
        };
      }
      return l;
    }));
    setSaveStatus('unsaved');
  };

  return (
    <div className="h-screen flex flex-col bg-bg text-text overflow-hidden">

      {/* HEADER */}
      <header className="h-12 bg-card border-b border-text/10 flex items-center justify-between px-2 sm:px-3 shrink-0 shadow-sm">
        <div className="flex items-center gap-1.5 sm:gap-3 min-w-0">
          <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity shrink-0" title="Back to Home">
            <img src="/itp-logo-v3.png" alt="ITP" className="h-6 sm:h-7 w-auto" />
          </Link>
          <div className="hidden sm:block w-px h-5 bg-text/10" />
          <div className="hidden sm:flex items-center gap-1">
            <Link to="/catalog" className="p-1.5 text-muted hover:text-primary hover:bg-primary/10 rounded-lg transition-colors" title="Products">
              <ShoppingBag className="w-4 h-4" />
            </Link>
            <Link to="/wallet" className="p-1.5 text-muted hover:text-primary hover:bg-primary/10 rounded-lg transition-colors" title="Wallet">
              <img src="/itc-coin.png" alt="ITC" className="w-4 h-4 object-contain" />
            </Link>
          </div>
          <div className="hidden sm:block w-px h-5 bg-text/10" />
          <div className="flex items-center gap-1 sm:gap-2 min-w-0">
            <span className="text-base sm:text-lg shrink-0">{preset?.icon}</span>
            <input
              type="text"
              value={sheet.name}
              onChange={(e) => { setSheet({ ...sheet, name: e.target.value }); setSaveStatus('unsaved'); }}
              className="bg-transparent text-text font-medium text-xs sm:text-sm border-none focus:outline-none focus:ring-0 max-w-[80px] sm:max-w-[160px]"
              title="Project name"
            />
          </div>
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          <div className="flex items-center gap-0.5 sm:gap-1 bg-bg rounded-lg p-0.5 sm:p-1">
            <button onClick={handleUndo} disabled={historyIndex <= 0} className="p-1 sm:p-1.5 rounded-md hover:bg-card transition-colors disabled:opacity-30" title="Undo (Ctrl+Z)">
              <Undo2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-muted" />
            </button>
            <button onClick={handleRedo} disabled={historyIndex >= layerHistory.length - 1} className="p-1 sm:p-1.5 rounded-md hover:bg-card transition-colors disabled:opacity-30" title="Redo">
              <Redo2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-muted" />
            </button>
          </div>
          <div className="hidden sm:block w-px h-5 bg-text/10" />
          <div className="flex items-center gap-1 sm:gap-1.5">
            {saveStatus === 'saved' && <CheckCircle className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-green-500" />}
            {saveStatus === 'saving' && <Loader2 className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-blue-500 animate-spin" />}
            {saveStatus === 'unsaved' && <Clock className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-amber-500" />}
            <button onClick={saveSheet} disabled={saveStatus === 'saved'} className="px-2 sm:px-3 py-1 sm:py-1.5 bg-primary text-white rounded-lg text-xs sm:text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-1">
              <Save className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              <span className="hidden sm:inline">Save</span>
            </button>
          </div>
          <button onClick={() => setShowProjectsModal(true)} className="hidden sm:flex px-3 py-1.5 bg-card text-text border border-text/10 rounded-lg text-sm font-medium hover:bg-primary/5 transition-colors items-center gap-1.5" title="My Projects">
            <Layers className="w-3.5 h-3.5" />
            Projects
          </button>
          <Link to="/wallet" className="hidden sm:flex items-center gap-1.5 px-2 py-1 bg-primary/10 rounded-lg border border-primary/20 hover:bg-primary/20 transition-colors" title="ITC balance">
            <img src="/itc-coin.png" alt="ITC" className="w-3.5 h-3.5 object-contain" />
            <span className="font-bold text-primary text-sm">{itcBalance}</span>
            <span className="text-primary/70 text-xs">ITC</span>
          </Link>
          <Link to="/account/profile" className="hidden sm:flex w-7 h-7 items-center justify-center text-muted hover:text-primary hover:bg-primary/10 rounded-lg transition-colors" title="Profile">
            <User className="w-4 h-4" />
          </Link>
          <button
            onClick={() => setSheetOpen(o => !o)}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold border transition-colors ${
              sheetOpen ? 'bg-primary text-white border-primary' : 'bg-card text-text border-text/20 hover:border-primary/50 hover:text-primary'
            }`}
            title="Toggle Imagination Sheet"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Imagination Sheet</span>
            {layers.length > 0 && (
              <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-xs font-bold px-1 ${sheetOpen ? 'bg-white text-primary' : 'bg-primary text-white'}`}>
                {layers.length}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* MAIN CONTENT */}
      <div className="flex-1 flex overflow-hidden">

        {/* LEFT TOOLS RAIL */}
        <aside className="w-14 md:w-52 bg-card border-r border-text/10 flex flex-col shrink-0 overflow-y-auto">

          {/* Create section */}
          <div className="p-2 md:p-3 border-b border-text/10">
            <p className="hidden md:block text-xs font-semibold text-muted uppercase tracking-wider mb-2">Create</p>
            <button
              onClick={() => setShowMrImagineModal(true)}
              className="w-full mb-1.5 flex flex-col md:flex-row items-center md:items-center gap-1 md:gap-3 px-2 md:px-3 py-2 md:py-2.5 bg-gradient-to-r from-fuchsia-600 to-pink-600 text-white rounded-xl font-medium hover:from-fuchsia-700 hover:to-pink-700 transition-all shadow-sm"
              title="Generate AI image"
            >
              <Sparkles className="w-5 h-5 shrink-0" />
              <div className="hidden md:flex flex-col items-start">
                <span className="text-sm font-semibold leading-tight">Imagine</span>
                <span className="text-[10px] text-white/70">
                  {getFreeTrial('generate') > 0 ? `${getFreeTrial('generate')} free` : `${getFeaturePrice('generate')} ITC`}
                </span>
              </div>
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleFileUploadToDesigns} className="hidden" />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
              className="w-full mb-1.5 flex flex-col md:flex-row items-center gap-1 md:gap-3 px-2 md:px-3 py-2 md:py-2.5 bg-gradient-to-r from-purple-600 to-purple-700 text-white rounded-xl font-medium hover:from-purple-700 hover:to-purple-800 transition-all shadow-sm disabled:opacity-50"
              title="Upload images"
            >
              <Upload className="w-5 h-5 shrink-0" />
              <span className="hidden md:block text-sm font-semibold">Upload</span>
            </button>
          </div>

          {/* Edit Design section */}
          <div className="p-2 md:p-3 border-b border-text/10">
            <p className="hidden md:block text-xs font-semibold text-muted uppercase tracking-wider mb-2">Edit Design</p>
            <button
              onClick={() => { if (activeDesign) openReimagineItForDesign(activeDesign.id); else toast.warning('Select a design first', 'Click a design in your gallery.'); }}
              className="w-full mb-1.5 flex flex-col md:flex-row items-center gap-1 md:gap-3 px-2 md:px-3 py-2 md:py-2.5 rounded-xl text-left transition-all bg-bg text-text hover:bg-primary/5 border border-transparent hover:border-primary/30"
              title="Reimagine active design"
            >
              <div className="w-7 h-7 md:w-8 md:h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shrink-0">
                <RefreshCw className="w-3.5 h-3.5 md:w-4 md:h-4 text-white" />
              </div>
              <div className="hidden md:flex flex-col">
                <span className="font-medium text-sm">Reimagine</span>
                <span className="text-xs text-muted">{getFeaturePrice('reimagine_standard') || 1} ITC</span>
              </div>
            </button>
            <button
              onClick={handleDesignEnhance}
              disabled={isEnhancing || !activeDesignId}
              className="w-full mb-1.5 flex flex-col md:flex-row items-center gap-1 md:gap-3 px-2 md:px-3 py-2 md:py-2.5 rounded-xl text-left transition-all bg-bg text-text hover:bg-primary/5 border border-transparent hover:border-primary/30 disabled:opacity-50"
              title="Enhance active design"
            >
              <div className="w-7 h-7 md:w-8 md:h-8 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shrink-0">
                {isEnhancing ? <Loader2 className="w-3.5 h-3.5 md:w-4 md:h-4 text-white animate-spin" /> : <Wand2 className="w-3.5 h-3.5 md:w-4 md:h-4 text-white" />}
              </div>
              <div className="hidden md:flex flex-col">
                <span className="font-medium text-sm">Enhance</span>
                <span className="text-xs text-muted">{getFreeTrial('enhance') > 0 ? `${getFreeTrial('enhance')} free` : `${getFeaturePrice('enhance')} ITC`}</span>
              </div>
            </button>
            <button
              onClick={handleDesignRemoveBg}
              disabled={isRemovingBg || !activeDesignId}
              className="w-full mb-1.5 flex flex-col md:flex-row items-center gap-1 md:gap-3 px-2 md:px-3 py-2 md:py-2.5 rounded-xl text-left transition-all bg-bg text-text hover:bg-primary/5 border border-transparent hover:border-primary/30 disabled:opacity-50"
              title="Remove background from active design"
            >
              <div className="w-7 h-7 md:w-8 md:h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shrink-0">
                {isRemovingBg ? <Loader2 className="w-3.5 h-3.5 md:w-4 md:h-4 text-white animate-spin" /> : <Scissors className="w-3.5 h-3.5 md:w-4 md:h-4 text-white" />}
              </div>
              <div className="hidden md:flex flex-col">
                <span className="font-medium text-sm">Remove BG</span>
                <span className="text-xs text-muted">{getFreeTrial('bg_remove') > 0 ? `${getFreeTrial('bg_remove')} free` : `${getFeaturePrice('bg_remove')} ITC`}</span>
              </div>
            </button>
            <button
              onClick={handleDesignUpscale}
              disabled={isUpscaling || !activeDesignId}
              className="w-full flex flex-col md:flex-row items-center gap-1 md:gap-3 px-2 md:px-3 py-2 md:py-2.5 rounded-xl text-left transition-all bg-bg text-text hover:bg-primary/5 border border-transparent hover:border-primary/30 disabled:opacity-50"
              title="Upscale active design"
            >
              <div className="w-7 h-7 md:w-8 md:h-8 rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center shrink-0">
                {isUpscaling ? <Loader2 className="w-3.5 h-3.5 md:w-4 md:h-4 text-white animate-spin" /> : <ZoomIn className="w-3.5 h-3.5 md:w-4 md:h-4 text-white" />}
              </div>
              <div className="hidden md:flex flex-col">
                <span className="font-medium text-sm">Upscale 2x</span>
                <span className="text-xs text-muted">{getFreeTrial('upscale_2x') > 0 ? `${getFreeTrial('upscale_2x')} free` : `${getFeaturePrice('upscale_2x')} ITC`}</span>
              </div>
            </button>
            <button
              onClick={handleDesignHalftone}
              disabled={isHalftoning || !activeDesignId}
              className="w-full flex flex-col md:flex-row items-center gap-1 md:gap-3 px-2 md:px-3 py-2 md:py-2.5 rounded-xl text-left transition-all bg-bg text-text hover:bg-primary/5 border border-transparent hover:border-primary/30 disabled:opacity-50"
              title="Apply a DTF halftone dot-screen to the active design"
            >
              <div className="w-7 h-7 md:w-8 md:h-8 rounded-lg bg-gradient-to-br from-rose-500 to-fuchsia-600 flex items-center justify-center shrink-0">
                {isHalftoning ? <Loader2 className="w-3.5 h-3.5 md:w-4 md:h-4 text-white animate-spin" /> : <Grid3X3 className="w-3.5 h-3.5 md:w-4 md:h-4 text-white" />}
              </div>
              <div className="hidden md:flex flex-col">
                <span className="font-medium text-sm">Halftone</span>
                <span className="text-xs text-muted">DTF dot-screen · free</span>
              </div>
            </button>
          </div>

          {/* Sheet Tools - only shown when sheet has layers */}
          {layers.length > 0 && (
            <div className="p-2 md:p-3 border-b border-text/10">
              <p className="hidden md:block text-xs font-semibold text-muted uppercase tracking-wider mb-2">Sheet Tools</p>
              <button
                onClick={handleAutoNest}
                disabled={isProcessing || layers.length === 0}
                className="w-full mb-1.5 flex flex-col md:flex-row items-center gap-1 md:gap-3 px-2 md:px-3 py-2 rounded-xl text-left transition-all bg-bg text-text hover:bg-primary/5 border border-transparent hover:border-primary/30 disabled:opacity-50"
                title="Auto-Nest: optimize layout"
              >
                <div className="w-7 h-7 md:w-8 md:h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shrink-0">
                  {isProcessing ? <Loader2 className="w-3.5 h-3.5 text-white animate-spin" /> : <LayoutGrid className="w-3.5 h-3.5 text-white" />}
                </div>
                <div className="hidden md:flex flex-col">
                  <span className="font-medium text-sm">Auto-Nest</span>
                  <span className="text-xs text-muted">{getFeaturePrice('auto_nest')} ITC</span>
                </div>
              </button>
              <button
                onClick={handleSmartFill}
                disabled={isProcessing || layers.length === 0}
                className="w-full flex flex-col md:flex-row items-center gap-1 md:gap-3 px-2 md:px-3 py-2 rounded-xl text-left transition-all bg-bg text-text hover:bg-primary/5 border border-transparent hover:border-primary/30 disabled:opacity-50"
                title="Smart Fill: fill empty space"
              >
                <div className="w-7 h-7 md:w-8 md:h-8 rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center shrink-0">
                  <Copy className="w-3.5 h-3.5 text-white" />
                </div>
                <div className="hidden md:flex flex-col">
                  <span className="font-medium text-sm">Smart Fill</span>
                  <span className="text-xs text-muted">{getFeaturePrice('smart_fill')} ITC</span>
                </div>
              </button>
            </div>
          )}

          {/* Text & Shapes */}
          <div className="p-2 md:p-3">
            <button
              onClick={() => setShowAddElementPanel(true)}
              disabled={isProcessing}
              className="w-full flex flex-col md:flex-row items-center gap-1 md:gap-3 px-2 md:px-3 py-2 md:py-2.5 bg-gradient-to-r from-blue-600 to-cyan-600 text-white rounded-xl font-medium hover:from-blue-700 hover:to-cyan-700 transition-all shadow-sm disabled:opacity-50"
              title="Add text or shapes to sheet"
            >
              <Plus className="w-5 h-5 shrink-0" />
              <span className="hidden md:block text-sm font-semibold">Text & Shapes</span>
            </button>
          </div>
        </aside>

        {/* CENTER - Studio area */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">

          {/* Active Design Preview */}
          <div className="flex-1 relative bg-bg flex items-center justify-center overflow-hidden p-4">
            {activeDesign ? (
              <div className="flex flex-col items-center gap-4 max-w-2xl w-full h-full">
                <div className="flex-1 flex items-center justify-center w-full">
                  <img
                    src={activeDesign.url}
                    alt={activeDesign.name}
                    className="max-w-full max-h-full object-contain rounded-xl shadow-lg"
                  />
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2 pb-1">
                  <button
                    onClick={() => openReimagineItForDesign(activeDesign.id)}
                    className="flex items-center gap-1.5 px-3 py-2 bg-card border border-text/10 rounded-lg text-sm font-medium text-text hover:border-primary/40 hover:text-primary transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Reimagine
                  </button>
                  <button
                    onClick={handleDesignEnhance}
                    disabled={isEnhancing}
                    className="flex items-center gap-1.5 px-3 py-2 bg-card border border-text/10 rounded-lg text-sm font-medium text-text hover:border-primary/40 hover:text-primary transition-colors disabled:opacity-50"
                  >
                    {isEnhancing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                    Enhance
                  </button>
                  <button
                    onClick={handleDesignRemoveBg}
                    disabled={isRemovingBg}
                    className="flex items-center gap-1.5 px-3 py-2 bg-card border border-text/10 rounded-lg text-sm font-medium text-text hover:border-primary/40 hover:text-primary transition-colors disabled:opacity-50"
                  >
                    {isRemovingBg ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scissors className="w-4 h-4" />}
                    Remove BG
                  </button>
                  <button
                    onClick={handleDesignUpscale}
                    disabled={isUpscaling}
                    className="flex items-center gap-1.5 px-3 py-2 bg-card border border-text/10 rounded-lg text-sm font-medium text-text hover:border-primary/40 hover:text-primary transition-colors disabled:opacity-50"
                  >
                    {isUpscaling ? <Loader2 className="w-4 h-4 animate-spin" /> : <ZoomIn className="w-4 h-4" />}
                    Upscale
                  </button>
                  <button
                    onClick={handleDesignHalftone}
                    disabled={isHalftoning}
                    className="flex items-center gap-1.5 px-3 py-2 bg-card border border-text/10 rounded-lg text-sm font-medium text-text hover:border-primary/40 hover:text-primary transition-colors disabled:opacity-50"
                    title="DTF halftone dot-screen"
                  >
                    {isHalftoning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Grid3X3 className="w-4 h-4" />}
                    Halftone
                  </button>
                  <a
                    href={activeDesign.url}
                    download={`${activeDesign.name}.png`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-2 bg-card border border-text/10 rounded-lg text-sm font-medium text-text hover:border-primary/40 hover:text-primary transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    Download
                  </a>
                  <button
                    onClick={() => sendDesignToSheet(activeDesign)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-purple-600 to-purple-700 text-white rounded-lg text-sm font-semibold hover:from-purple-700 hover:to-purple-800 transition-all shadow-sm"
                  >
                    <LayoutGrid className="w-4 h-4" />
                    Send to Imagination Sheet
                  </button>
                  <button
                    onClick={() => setShowMakeProductModal(true)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-fuchsia-600 to-pink-600 text-white rounded-lg text-sm font-semibold hover:from-fuchsia-700 hover:to-pink-700 transition-all shadow-sm"
                    title="Put this design on a shirt, metal print, or 3D toy"
                  >
                    <ShoppingBag className="w-4 h-4" />
                    Make a Product
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center max-w-sm">
                <div className="w-20 h-20 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Sparkles className="w-10 h-10 text-primary/60" />
                </div>
                <h3 className="text-lg font-bold text-text mb-2">Imagine your first design</h3>
                <p className="text-sm text-muted mb-6">
                  Generate AI art, upload your own artwork, or reimagine something new. Your designs stay here until you send them to the Imagination Sheet.
                </p>
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => setShowMrImagineModal(true)}
                    className="px-5 py-2.5 bg-gradient-to-r from-fuchsia-600 to-pink-600 text-white rounded-xl font-semibold hover:from-fuchsia-700 hover:to-pink-700 transition-all flex items-center justify-center gap-2"
                  >
                    <Sparkles className="w-4 h-4" />
                    Generate with Mr. Imagine
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="px-5 py-2.5 bg-gradient-to-r from-purple-600 to-purple-700 text-white rounded-xl font-semibold hover:from-purple-700 hover:to-purple-800 transition-all flex items-center justify-center gap-2"
                  >
                    <Upload className="w-4 h-4" />
                    Upload Images
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* My Designs Gallery Strip */}
          {designs.length > 0 && (
            <div className="h-28 border-t border-text/10 bg-card flex-shrink-0">
              <div className="h-full flex items-center gap-2 px-3 overflow-x-auto">
                <span className="text-xs font-semibold text-muted uppercase tracking-wider whitespace-nowrap shrink-0 hidden md:block">My Designs</span>
                {designs.map(design => (
                  <div
                    key={design.id}
                    onClick={() => setActiveDesignId(design.id)}
                    className={`relative shrink-0 w-20 h-20 rounded-lg overflow-hidden cursor-pointer border-2 transition-all group ${
                      design.id === activeDesignId ? 'border-primary shadow-md' : 'border-transparent hover:border-primary/40'
                    }`}
                  >
                    <img src={design.url} alt={design.name} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-1 gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); sendDesignToSheet(design); }}
                        className="flex-1 flex items-center justify-center bg-primary/90 rounded text-white p-1"
                        title="Send to Imagination Sheet"
                      >
                        <LayoutGrid className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeDesign(design.id); }}
                        className="flex items-center justify-center bg-red-500/90 rounded text-white p-1"
                        title="Remove design"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT DRAWER - Imagination Sheet */}
        {sheetOpen && (
          <>
            <div className="md:hidden fixed inset-0 bg-black/50 z-30" onClick={() => setSheetOpen(false)} />
            <aside className="w-72 sm:w-80 lg:w-96 bg-card border-l border-text/10 flex flex-col shrink-0 absolute md:relative right-0 z-40 h-full md:h-auto shadow-xl md:shadow-none">

              {/* Drawer header */}
              <div className="h-10 px-3 border-b border-text/10 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <LayoutGrid className="w-4 h-4 text-primary" />
                  <span className="font-semibold text-text text-sm">Imagination Sheet</span>
                  {layers.length > 0 && (
                    <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] bg-primary text-white rounded-full text-xs font-bold px-1">
                      {layers.length}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setSheetOpen(false)}
                  className="w-6 h-6 flex items-center justify-center text-muted hover:text-primary hover:bg-primary/10 rounded transition-colors"
                  title="Close Imagination Sheet"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* SheetCanvas area */}
              <div className="flex-1 relative overflow-hidden bg-bg min-h-0" ref={canvasRef}>
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

                {layers.length === 0 && !isProcessing && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 p-4">
                    <div className="pointer-events-auto text-center">
                      <LayoutGrid className="w-10 h-10 text-muted/40 mx-auto mb-2" />
                      <p className="text-sm text-muted font-medium">Imagination Sheet is empty</p>
                      <p className="text-xs text-muted/70 mt-1">Send a design here to start building your sheet</p>
                    </div>
                  </div>
                )}

                {/* Zoom controls */}
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-card px-2 py-1.5 rounded-full shadow border border-text/10 z-10">
                  <button onClick={() => setZoom(z => Math.max(MIN_ZOOM, z - 0.1))} className="w-6 h-6 flex items-center justify-center text-muted hover:text-primary rounded-full transition-colors">
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-xs font-medium text-text w-10 text-center">{Math.round(zoom * 100)}%</span>
                  <button onClick={() => setZoom(z => Math.min(MAX_ZOOM, z + 0.1))} className="w-6 h-6 flex items-center justify-center text-muted hover:text-primary rounded-full transition-colors">
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                  <div className="w-px h-4 bg-text/10 mx-0.5" />
                  <button onClick={() => setGridEnabled(g => !g)} className={`px-1.5 py-0.5 text-xs rounded-full transition-colors ${gridEnabled ? 'bg-primary/15 text-primary' : 'text-muted hover:bg-text/5'}`} title="Grid">
                    <Grid3X3 className="w-3 h-3" />
                  </button>
                  <button onClick={() => setSnapEnabled(s => !s)} className={`px-1.5 py-0.5 text-xs rounded-full transition-colors ${snapEnabled ? 'bg-primary/15 text-primary' : 'text-muted hover:bg-text/5'}`} title="Snap">
                    <Magnet className="w-3 h-3" />
                  </button>
                  <button onClick={() => setShowSafeMargin(s => !s)} className={`px-1.5 py-0.5 text-xs rounded-full transition-colors ${showSafeMargin ? 'bg-primary/15 text-primary' : 'text-muted hover:bg-text/5'}`} title="Safe Margin">
                    <Maximize className="w-3 h-3" />
                  </button>
                  <button onClick={fitSheetToView} className="w-6 h-6 flex items-center justify-center text-muted hover:text-primary rounded-full transition-colors" title="Fit to view">
                    <Expand className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={resetCanvas} disabled={layers.length === 0} className="px-1.5 py-0.5 text-xs rounded-full text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50" title="Reset">
                    <RefreshCw className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* Sheet panel - tabs: Layers + Order */}
              <div className="border-t border-text/10 flex flex-col" style={{ maxHeight: '300px' }}>
                <div className="px-3 pt-2 pb-0 flex gap-1 bg-card">
                  {[
                    { id: 'design', label: 'Layers', icon: Layers },
                    { id: 'order', label: 'Order', icon: ShoppingCart },
                  ].map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setActivePanel(tab.id as typeof activePanel)}
                      className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1 ${
                        activePanel === tab.id ? 'bg-bg text-primary shadow-sm' : 'text-muted hover:text-text'
                      }`}
                    >
                      <tab.icon className="w-3.5 h-3.5" />
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="flex-1 overflow-y-auto p-3">
                  {/* Layers tab */}
                  {activePanel === 'design' && (
                    <div>
                      {selectedLayers.length > 0 ? (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-semibold text-text truncate">{selectedLayers[0].metadata?.name || `Layer ${selectedLayers[0].z_index + 1}`}</p>
                            <button onClick={deleteSelectedLayers} className="p-1 text-red-500 hover:bg-red-500/10 rounded" title="Delete layer">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {(selectedLayers[0].layer_type === 'image' || selectedLayers[0].layer_type === 'ai_generated') && selectedLayers[0].metadata?.dpiInfo && selectedLayers[0].metadata.dpiInfo.quality !== 'good' && (
                            <div className={`p-2 rounded-lg border text-xs ${selectedLayers[0].metadata.dpiInfo.quality === 'danger' ? 'bg-red-500/10 border-red-500/40 text-red-500' : 'bg-amber-500/10 border-amber-500/40 text-amber-600'}`}>
                              Print quality: {getDpiQualityDisplay(selectedLayers[0].metadata.dpiInfo.quality).label} ({selectedLayers[0].metadata.dpiInfo.dpi} DPI)
                            </div>
                          )}

                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-xs text-muted block mb-1">X (in)</label>
                              <input type="number" value={selectedLayers[0].position_x.toFixed(2)} onChange={(e) => { const val = parseFloat(e.target.value); setLayers(prev => prev.map(l => l.id === selectedLayers[0].id ? { ...l, position_x: val } : l)); setSaveStatus('unsaved'); }} className="w-full px-2 py-1.5 bg-bg border border-text/10 rounded text-xs text-text" step="0.1" />
                            </div>
                            <div>
                              <label className="text-xs text-muted block mb-1">Y (in)</label>
                              <input type="number" value={selectedLayers[0].position_y.toFixed(2)} onChange={(e) => { const val = parseFloat(e.target.value); setLayers(prev => prev.map(l => l.id === selectedLayers[0].id ? { ...l, position_y: val } : l)); setSaveStatus('unsaved'); }} className="w-full px-2 py-1.5 bg-bg border border-text/10 rounded text-xs text-text" step="0.1" />
                            </div>
                            <div>
                              <label className="text-xs text-muted block mb-1">W (in)</label>
                              <input type="number" value={selectedLayers[0].width.toFixed(2)} onChange={(e) => { const val = parseFloat(e.target.value) || 0.1; const cur = selectedLayers[0]; setLayers(prev => prev.map(l => { if (l.id === cur.id) { const newDpi = recalculateDpi(l, val, l.height); return { ...l, width: val, metadata: { ...l.metadata, dpiInfo: newDpi || l.metadata?.dpiInfo } }; } return l; })); setSaveStatus('unsaved'); }} className="w-full px-2 py-1.5 bg-bg border border-text/10 rounded text-xs text-text" step="0.25" min="0.25" />
                            </div>
                            <div>
                              <label className="text-xs text-muted block mb-1">H (in)</label>
                              <input type="number" value={selectedLayers[0].height.toFixed(2)} onChange={(e) => { const val = parseFloat(e.target.value) || 0.1; const cur = selectedLayers[0]; setLayers(prev => prev.map(l => { if (l.id === cur.id) { const newDpi = recalculateDpi(l, l.width, val); return { ...l, height: val, metadata: { ...l.metadata, dpiInfo: newDpi || l.metadata?.dpiInfo } }; } return l; })); setSaveStatus('unsaved'); }} className="w-full px-2 py-1.5 bg-bg border border-text/10 rounded text-xs text-text" step="0.25" min="0.25" />
                            </div>
                          </div>

                          <div>
                            <label className="text-xs text-muted block mb-1">Rotation: {selectedLayers[0].rotation}&deg;</label>
                            <input type="range" min="0" max="360" value={selectedLayers[0].rotation} onChange={(e) => { setLayers(prev => prev.map(l => l.id === selectedLayers[0].id ? { ...l, rotation: parseInt(e.target.value) } : l)); setSaveStatus('unsaved'); }} className="w-full accent-primary" />
                          </div>

                          <div>
                            <p className="text-xs text-muted mb-1">Quick sizes:</p>
                            <div className="flex flex-wrap gap-1">
                              {DTF_PRINT_SIZE_OPTIONS.map(qs => (
                                <button key={qs.label} onClick={() => applyQuickSize(qs.width, qs.label)} className="px-1.5 py-0.5 text-xs bg-primary/10 hover:bg-primary/20 text-primary rounded transition-colors">{qs.label}</button>
                              ))}
                            </div>
                          </div>

                          <div className="flex gap-2">
                            <button onClick={duplicateSelectedLayers} className="flex-1 px-2 py-1.5 bg-bg text-text rounded text-xs font-medium hover:bg-text/10 transition-colors flex items-center justify-center gap-1">
                              <Copy className="w-3 h-3" /> Dup
                            </button>
                            <button onClick={() => { setLayers(prev => prev.filter(l => !selectedLayerIds.includes(l.id))); setSelectedLayerIds([]); setSaveStatus('unsaved'); }} className="flex-1 px-2 py-1.5 bg-red-500/10 text-red-500 rounded text-xs font-medium hover:bg-red-500/20 flex items-center justify-center gap-1">
                              <Trash2 className="w-3 h-3" /> Delete
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          {layers.length === 0 ? (
                            <div className="text-center py-4 text-muted/60">
                              <Layers className="w-7 h-7 mx-auto mb-2 opacity-50" />
                              <p className="text-xs">No layers yet</p>
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
                                  <div key={layer.id} onClick={() => selectLayer(layer.id)} className={`p-2 rounded-lg cursor-pointer transition-all flex items-center gap-2 ${selectedLayerIds.includes(layer.id) ? 'bg-primary/15 border border-primary/40' : 'hover:bg-text/5 border border-transparent'}`}>
                                    <div className="w-7 h-7 rounded bg-bg flex items-center justify-center overflow-hidden shrink-0 relative">
                                      {(layer.layer_type === 'image' || layer.layer_type === 'ai_generated') && imageUrl ? (
                                        <img src={imageUrl} alt="" className="w-full h-full object-cover" />
                                      ) : layer.layer_type === 'text' ? (
                                        <Type className="w-3 h-3 text-muted" />
                                      ) : (
                                        <Square className="w-3 h-3 text-muted" />
                                      )}
                                      {dpiInfo && (dpiInfo.quality === 'warning' || dpiInfo.quality === 'danger') && (
                                        <div className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-card ${dpiDisplay?.indicatorColor}`} />
                                      )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-xs font-medium text-text truncate">{layerName}</p>
                                      {dpiInfo && (dpiInfo.quality === 'warning' || dpiInfo.quality === 'danger') && (
                                        <p className={`text-xs ${dpiDisplay?.color} truncate`}>{dpiInfo.dpi} DPI</p>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-0.5">
                                      <button onClick={(e) => { e.stopPropagation(); toggleLayerVisibility(layer.id); }} className="p-0.5 text-muted/70 hover:text-text">
                                        {isVisible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                                      </button>
                                      <button onClick={(e) => { e.stopPropagation(); toggleLayerLock(layer.id); }} className="p-0.5 text-muted/70 hover:text-text">
                                        {isLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Order tab */}
                  {activePanel === 'order' && (
                    <div className="space-y-3">
                      <div className="p-3 bg-primary/10 rounded-xl border border-primary/20">
                        <div className="space-y-1.5 text-xs">
                          <div className="flex justify-between">
                            <span className="text-muted">Sheet</span>
                            <span className="font-medium text-text">{sheet.sheet_width}&quot; x {sheet.sheet_height}&quot; {preset?.name}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted">Designs on sheet</span>
                            <span className="font-medium text-text">{layers.length}</span>
                          </div>
                          <div className="flex justify-between pt-1 border-t border-primary/20">
                            <span className="text-muted">Total</span>
                            <span className="font-bold text-primary">${sheetPrice.toFixed(2)}</span>
                          </div>
                        </div>
                      </div>

                      {(() => {
                        const dangerCount = layers.filter(l => (l.layer_type === 'image' || l.layer_type === 'ai_generated') && l.metadata?.dpiInfo?.quality === 'danger').length;
                        const warningCount = layers.filter(l => (l.layer_type === 'image' || l.layer_type === 'ai_generated') && l.metadata?.dpiInfo?.quality === 'warning').length;
                        if (dangerCount > 0 || warningCount > 0) {
                          return (
                            <div className={`p-2 rounded-xl border text-xs ${dangerCount > 0 ? 'bg-red-500/10 border-red-500/40' : 'bg-amber-500/10 border-amber-500/40'}`}>
                              <div className="flex items-start gap-2">
                                <AlertCircle className={`w-4 h-4 shrink-0 mt-0.5 ${dangerCount > 0 ? 'text-red-500' : 'text-amber-500'}`} />
                                <div>
                                  <p className={`font-medium mb-0.5 ${dangerCount > 0 ? 'text-red-500' : 'text-amber-500'}`}>
                                    {dangerCount > 0 ? `${dangerCount} critical DPI issue${dangerCount !== 1 ? 's' : ''}` : `${warningCount} DPI warning${warningCount !== 1 ? 's' : ''}`}
                                  </p>
                                  <p className={dangerCount > 0 ? 'text-red-500/80' : 'text-amber-500/80'}>
                                    {dangerCount > 0 ? 'Shrink or upscale affected designs before ordering.' : 'May appear pixelated. Consider upscaling.'}
                                  </p>
                                </div>
                              </div>
                            </div>
                          );
                        }
                        return (
                          <div className="p-2 bg-green-500/10 rounded-xl border border-green-500/30 flex items-center gap-2">
                            <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                            <p className="text-xs text-green-500 font-medium">
                              {layers.length > 0 ? 'All designs meet print quality standards' : 'Add designs to check quality'}
                            </p>
                          </div>
                        );
                      })()}

                      <div className="p-3 bg-bg rounded-xl border border-text/10 space-y-2">
                        <h4 className="text-xs font-medium text-text">Print Options</h4>
                        {preset?.allowCutlines && (
                          <label className="flex items-center gap-2 cursor-pointer text-xs">
                            <input type="checkbox" checked={showCutLines} onChange={(e) => setShowCutLines(e.target.checked)} className="w-3.5 h-3.5 rounded border-text/20 text-primary focus:ring-primary" />
                            <Scissors className="w-3.5 h-3.5 text-muted" />
                            <span className="text-text">Include cut lines</span>
                          </label>
                        )}
                        {preset?.allowMirror && (
                          <label className="flex items-center gap-2 cursor-pointer text-xs">
                            <input type="checkbox" checked={mirrorForSublimation} onChange={(e) => setMirrorForSublimation(e.target.checked)} className="w-3.5 h-3.5 rounded border-text/20 text-primary focus:ring-primary" />
                            <FlipHorizontal className="w-3.5 h-3.5 text-muted" />
                            <span className="text-text">Mirror for sublimation</span>
                          </label>
                        )}
                        {!preset?.allowCutlines && !preset?.allowMirror && (
                          <p className="text-xs text-muted italic">No additional print options for {preset?.name}</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Checkout footer */}
                <div className="p-3 border-t border-text/10 bg-card shrink-0">
                  <button
                    onClick={handleAddToCart}
                    disabled={isProcessing || layers.length === 0}
                    className="w-full px-4 py-2.5 bg-gradient-to-r from-purple-600 to-purple-700 text-white rounded-xl font-semibold hover:from-purple-700 hover:to-purple-800 transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm"
                  >
                    {isProcessing ? <><Loader2 className="w-4 h-4 animate-spin" />Processing...</> : <><ShoppingCart className="w-4 h-4" />Add to Cart &mdash; ${sheetPrice.toFixed(2)}</>}
                  </button>
                </div>
              </div>
            </aside>
          </>
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
          <div className="bg-card text-text rounded-2xl max-w-4xl w-full max-h-[80vh] overflow-hidden shadow-2xl">
            <div className="p-6 border-b border-text/10 flex items-center justify-between">
              <h2 className="text-2xl font-serif font-bold text-text">My Projects</h2>
              <button onClick={() => setShowProjectsModal(false)} className="w-8 h-8 flex items-center justify-center text-muted hover:text-text hover:bg-primary/10 rounded-lg transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[calc(80vh-120px)]">
              {recentSheets.length === 0 ? (
                <div className="text-center py-12">
                  <Layers className="w-16 h-16 mx-auto mb-4 text-muted/50" />
                  <h3 className="text-lg font-medium text-text mb-2">No projects yet</h3>
                  <p className="text-muted">Create a new Imagination Sheet to get started!</p>
                  <button onClick={() => { setShowProjectsModal(false); navigate('/imagination-station'); }} className="mt-6 px-6 py-3 bg-primary text-white rounded-lg font-medium hover:opacity-90 transition-opacity">
                    Create New Project
                  </button>
                </div>
              ) : (
                <div className="grid md:grid-cols-2 gap-4">
                  {recentSheets.map(s => {
                    const presetData = presets ? presets[s.print_type as PrintType] : null;
                    const layerCount = s.canvas_state?.layers?.length || 0;
                    const isCurrentProject = s.id === sheet?.id;
                    return (
                      <button
                        key={s.id}
                        onClick={() => {
                          if (!isCurrentProject) {
                            if (saveStatus === 'unsaved') {
                              const confirmSwitch = window.confirm('You have unsaved changes. Do you want to save before switching projects?');
                              if (confirmSwitch) { saveSheet().then(() => { navigate(`/imagination-station/${s.id}`); setShowProjectsModal(false); }); return; }
                            }
                            navigate(`/imagination-station/${s.id}`);
                            setShowProjectsModal(false);
                          }
                        }}
                        className={`text-left border rounded-xl overflow-hidden hover:border-primary/50 hover:shadow-md transition-all duration-200 ${isCurrentProject ? 'border-primary ring-2 ring-primary/30' : 'border-text/10'}`}
                      >
                        <div className="aspect-video bg-bg relative overflow-hidden">
                          {s.thumbnail_url ? (
                            <img src={s.thumbnail_url} alt={s.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <div className="w-16 h-16 bg-primary/10 rounded-xl flex items-center justify-center text-3xl">{presetData?.icon || '📄'}</div>
                            </div>
                          )}
                          <div className="absolute top-2 right-2">
                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${s.status === 'draft' ? 'bg-black/60 text-white' : s.status === 'submitted' ? 'bg-purple-600/80 text-white' : 'bg-green-600/80 text-white'}`}>
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
                          <h3 className="font-medium text-text truncate mb-1">{s.name}</h3>
                          <p className="text-xs text-muted mb-2">{s.sheet_width}&quot; x {s.sheet_height}&quot; {presetData?.name || s.print_type}</p>
                          <div className="flex items-center gap-3 text-xs text-muted/70">
                            <span className="flex items-center gap-1"><Layers className="w-3 h-3" />{layerCount} layer{layerCount !== 1 ? 's' : ''}</span>
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
            <div className="p-6 border-t border-text/10 flex items-center justify-between">
              <button onClick={() => { setShowProjectsModal(false); navigate('/imagination-station'); }} className="px-4 py-2 text-primary hover:opacity-80 font-medium">
                Create New Project
              </button>
              <button onClick={() => setShowProjectsModal(false)} className="px-6 py-2 bg-primary/10 text-text rounded-lg font-medium hover:bg-primary/20 transition-colors">
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
          onAccept={() => setCompareModal(null)}
          onRevert={() => {
            if (compareModal.layerId.startsWith('design-')) {
              setDesigns(prev => prev.map(d =>
                d.id === compareModal.layerId
                  ? { ...d, url: compareModal.revert.processedUrl || d.originalUrl }
                  : d
              ));
            } else {
              setLayers(prev => prev.map(l =>
                l.id === compareModal.layerId
                  ? { ...l, processed_url: compareModal.revert.processedUrl, metadata: compareModal.revert.metadata }
                  : l
              ));
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
        onBalanceUpdate={setWalletBalance}
      />

      {/* Make a Product Modal */}
      <MakeProductModal
        isOpen={showMakeProductModal}
        onClose={() => setShowMakeProductModal(false)}
        designUrl={activeDesign?.url ?? null}
        itcBalance={itcBalance}
        onBalanceUpdate={setWalletBalance}
      />

      {/* Reimagine It Modal */}
      {reimagineItLayer && (
        <ReimagineItModal
          isOpen={showReimagineItModal}
          onClose={() => {
            setShowReimagineItModal(false);
            setReimagineItLayerId(null);
            setReimagineDesignId(null);
          }}
          imageUrl={reimagineItLayer.processed_url || reimagineItLayer.source_url || ''}
          layerName={reimagineItLayer.metadata?.name || 'Selected Image'}
          onAcceptReimaged={handleReimagineItAccept}
          onKeepOriginal={handleReimagineItKeepOriginal}
          standardCost={getFeaturePrice('reimagine_standard') || 1}
          premiumCost={getFeaturePrice('reimagine_premium') || 50}
        />
      )}

      {/* ITP Enhance Modal */}
      <ITPEnhanceModal
        isOpen={showITPEnhanceModal}
        onClose={() => setShowITPEnhanceModal(false)}
        selectedLayer={selectedLayers.length > 0 ? selectedLayers[0] : null}
        itcBalance={itcBalance}
        getFreeTrial={getFreeTrial}
        getFeaturePrice={getFeaturePrice}
        onRemoveBackground={handleRemoveBackground}
        onUpscale={handleUpscale}
        onEnhance={handleEnhance}
        onReimagine={() => {
          const selectedImageLayer = selectedLayers.find(l => l.layer_type === 'image' || l.layer_type === 'ai_generated');
          if (selectedImageLayer) {
            setShowITPEnhanceModal(false);
            openReimagineIt(selectedImageLayer.id);
          }
        }}
        isRemovingBg={isRemovingBg}
        isUpscaling={isUpscaling}
        isEnhancing={isEnhancing}
        isProcessing={isProcessing}
      />
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





