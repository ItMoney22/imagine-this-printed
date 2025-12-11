// src/pages/ImaginationStation.tsx

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/SupabaseAuthContext';
import { imaginationApi } from '../lib/api';
import type {
  ImaginationSheet,
  ImaginationLayer,
  CanvasState,
  PrintType,
  ImaginationPricing,
  FreeTrialStatus,
  Sheet,
  Layer,
  Pricing,
  FreeTrials,
  AutoLayoutPricing,
  dbSheetToSheet,
  dbLayerToLayer,
} from '../types';

// Components
import SheetCanvas from '../components/imagination/SheetCanvas';
import LeftSidebar from '../components/imagination/LeftSidebar';
import RightSidebar from '../components/imagination/RightSidebar';
import SaveStatus from '../components/imagination/SaveStatus';

type SaveStatusType = 'saved' | 'saving' | 'unsaved' | 'offline' | 'error';

// Helper to convert DB sheet to component sheet
const toComponentSheet = (dbSheet: ImaginationSheet): Sheet => ({
  id: dbSheet.id,
  printType: dbSheet.print_type,
  width: dbSheet.sheet_width,
  height: dbSheet.sheet_height,
  unit: 'inch',
  name: dbSheet.name,
  status: dbSheet.status,
});

// Helper to convert DB layer to component layer
const toComponentLayer = (dbLayer: ImaginationLayer): Layer => ({
  id: dbLayer.id,
  type: dbLayer.layer_type,
  name: dbLayer.metadata?.name || `Layer ${dbLayer.z_index + 1}`,
  visible: dbLayer.metadata?.visible !== false,
  locked: dbLayer.metadata?.locked || false,
  x: dbLayer.position_x,
  y: dbLayer.position_y,
  width: dbLayer.width,
  height: dbLayer.height,
  rotation: dbLayer.rotation,
  opacity: dbLayer.metadata?.opacity ?? 1,
  src: dbLayer.processed_url || dbLayer.source_url || undefined,
  imageUrl: dbLayer.processed_url || dbLayer.source_url || undefined,
  text: dbLayer.metadata?.text,
  dpi: dbLayer.metadata?.dpi,
  zIndex: dbLayer.z_index,
});

const ImaginationStation: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const itcBalance = user?.wallet?.itcBalance || 0;

  // DB Sheet state
  const [dbSheet, setDbSheet] = useState<ImaginationSheet | null>(null);
  const [dbLayers, setDbLayers] = useState<ImaginationLayer[]>([]);
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]);

  // Component-friendly sheet/layers (derived)
  const sheet: Sheet | null = useMemo(() => dbSheet ? toComponentSheet(dbSheet) : null, [dbSheet]);
  const layers: Layer[] = useMemo(() => dbLayers.map(toComponentLayer), [dbLayers]);
  const setLayers = useCallback((newLayers: Layer[] | ((prev: Layer[]) => Layer[])) => {
    // Convert Layer[] back to ImaginationLayer[] for storage
    // For now just update the dbLayers minimally
    const resolvedLayers = typeof newLayers === 'function' ? newLayers(layers) : newLayers;
    setDbLayers(prevDbLayers => {
      return resolvedLayers.map((layer, idx) => {
        const existing = prevDbLayers.find(d => d.id === layer.id);
        if (existing) {
          return {
            ...existing,
            position_x: layer.x,
            position_y: layer.y,
            width: layer.width,
            height: layer.height,
            rotation: layer.rotation,
            z_index: idx,
            metadata: {
              ...existing.metadata,
              name: layer.name,
              visible: layer.visible,
              locked: layer.locked,
              opacity: layer.opacity,
              text: layer.text,
              dpi: layer.dpi,
            },
          };
        }
        // New layer - create minimal DB representation
        return {
          id: layer.id,
          sheet_id: dbSheet?.id || '',
          layer_type: layer.type,
          source_url: layer.src || layer.imageUrl || null,
          processed_url: layer.src || layer.imageUrl || null,
          position_x: layer.x,
          position_y: layer.y,
          width: layer.width,
          height: layer.height,
          rotation: layer.rotation,
          scale_x: 1,
          scale_y: 1,
          z_index: idx,
          metadata: {
            name: layer.name,
            visible: layer.visible,
            locked: layer.locked,
            opacity: layer.opacity,
            text: layer.text,
            dpi: layer.dpi,
          },
          created_at: new Date().toISOString(),
        };
      });
    });
  }, [layers, dbSheet?.id]);

  // Canvas state
  const [canvasState, setCanvasState] = useState<CanvasState | null>(null);
  const [zoom, setZoom] = useState(1);
  const [gridEnabled, setGridEnabled] = useState(true);
  const [snapEnabled, setSnapEnabled] = useState(true);

  // History for undo/redo
  const [history, setHistory] = useState<{ past: CanvasState[]; future: CanvasState[] }>({ past: [], future: [] });

  // Save status
  const [saveStatus, setSaveStatus] = useState<SaveStatusType>('saved');
  const [lastSaved, setLastSaved] = useState<Date | undefined>(undefined);

  // Pricing
  const [pricingData, setPricingData] = useState<ImaginationPricing[]>([]);
  const [freeTrialsData, setFreeTrialsData] = useState<FreeTrialStatus[]>([]);

  // Convert pricing to component-friendly format
  const pricing: Pricing = useMemo(() => ({
    basePrice: 0,
    perSquareInch: 0,
    setupFee: 0,
  }), []);

  const freeTrials: FreeTrials = useMemo(() => ({
    aiGeneration: freeTrialsData.find(t => t.feature_key === 'generate')?.uses_remaining || 0,
    removeBackground: freeTrialsData.find(t => t.feature_key === 'bg_remove')?.uses_remaining || 0,
    upscale: freeTrialsData.find(t => t.feature_key === 'upscale_2x')?.uses_remaining || 0,
    enhance: freeTrialsData.find(t => t.feature_key === 'enhance')?.uses_remaining || 0,
  }), [freeTrialsData]);

  const autoLayoutPricing: AutoLayoutPricing = useMemo(() => ({
    autoNest: pricingData.find(p => p.feature_key === 'auto_nest')?.current_cost || 2,
    smartFill: pricingData.find(p => p.feature_key === 'smart_fill')?.current_cost || 3,
    aiGeneration: pricingData.find(p => p.feature_key === 'generate')?.current_cost || 15,
    removeBackground: pricingData.find(p => p.feature_key === 'bg_remove')?.current_cost || 5,
    upscale2x: pricingData.find(p => p.feature_key === 'upscale_2x')?.current_cost || 5,
    upscale4x: pricingData.find(p => p.feature_key === 'upscale_4x')?.current_cost || 10,
    enhance: pricingData.find(p => p.feature_key === 'enhance')?.current_cost || 5,
  }), [pricingData]);

  // Loading states
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);

  // Load sheet data
  useEffect(() => {
    if (id) {
      loadSheet(id);
    } else {
      setIsLoading(false);
    }
    loadPricing();
  }, [id]);

  const loadSheet = async (sheetId: string) => {
    try {
      setIsLoading(true);
      const { data } = await imaginationApi.getSheet(sheetId);
      setDbSheet(data);
      setDbLayers(data.layers || []);
      setCanvasState(data.canvas_state);
      setGridEnabled(data.canvas_state?.gridEnabled ?? true);
      setSnapEnabled(data.canvas_state?.snapEnabled ?? true);
    } catch (error) {
      console.error('Failed to load sheet:', error);
      navigate('/imagination-station');
    } finally {
      setIsLoading(false);
    }
  };

  const loadPricing = async () => {
    try {
      const { data } = await imaginationApi.getPricing();
      setPricingData(data.pricing || data || []);
      // Try to load trials separately
      try {
        const { data: trialsData } = await imaginationApi.getTrials();
        setFreeTrialsData(trialsData || []);
      } catch {
        setFreeTrialsData([]);
      }
    } catch (error) {
      console.error('Failed to load pricing:', error);
    }
  };

  // Create new sheet
  const createSheet = async (printType: PrintType, height: number, name?: string) => {
    try {
      setIsProcessing(true);
      const { data } = await imaginationApi.createSheet({
        name: name || 'Untitled Sheet',
        print_type: printType,
        sheet_height: height
      });
      navigate(`/imagination-station/${data.id}`);
    } catch (error) {
      console.error('Failed to create sheet:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  // Save canvas state
  const saveCanvasState = useCallback(async (state: CanvasState) => {
    if (!sheet?.id) return;

    setSaveStatus('saving');
    try {
      // Save to localStorage first (instant)
      localStorage.setItem(`itp-imagination-sheet-${sheet.id}`, JSON.stringify({
        ...state,
        timestamp: new Date().toISOString()
      }));

      // Save to database
      await imaginationApi.updateSheet(sheet.id, { canvas_state: state });

      setSaveStatus('saved');
      setLastSaved(new Date());
    } catch (error) {
      console.error('Failed to save:', error);
      setSaveStatus('error');
    }
  }, [sheet?.id]);

  // Auto-save effect
  useEffect(() => {
    if (!canvasState || !sheet?.id) return;

    const localTimer = setTimeout(() => {
      localStorage.setItem(`itp-imagination-sheet-${sheet.id}`, JSON.stringify({
        ...canvasState,
        timestamp: new Date().toISOString()
      }));
    }, 10000); // 10 seconds

    const cloudTimer = setTimeout(() => {
      saveCanvasState(canvasState);
    }, 60000); // 60 seconds

    return () => {
      clearTimeout(localTimer);
      clearTimeout(cloudTimer);
    };
  }, [canvasState, sheet?.id, saveCanvasState]);

  // Undo/Redo
  const undo = useCallback(() => {
    if (history.past.length === 0) return;

    const previous = history.past[history.past.length - 1];
    const newPast = history.past.slice(0, -1);

    setHistory({
      past: newPast,
      future: canvasState ? [canvasState, ...history.future] : history.future
    });
    setCanvasState(previous);
    setSaveStatus('unsaved');
  }, [history, canvasState]);

  const redo = useCallback(() => {
    if (history.future.length === 0) return;

    const next = history.future[0];
    const newFuture = history.future.slice(1);

    setHistory({
      past: canvasState ? [...history.past, canvasState] : history.past,
      future: newFuture
    });
    setCanvasState(next);
    setSaveStatus('unsaved');
  }, [history, canvasState]);

  // Update canvas with history
  const updateCanvasState = useCallback((newState: CanvasState) => {
    if (canvasState) {
      setHistory(prev => ({
        past: [...prev.past.slice(-49), canvasState], // Keep last 50
        future: []
      }));
    }
    setCanvasState(newState);
    setSaveStatus('unsaved');
  }, [canvasState]);

  // Layer selection
  const selectLayer = useCallback((layerId: string, multi = false) => {
    if (multi) {
      setSelectedLayerIds(prev =>
        prev.includes(layerId)
          ? prev.filter(id => id !== layerId)
          : [...prev, layerId]
      );
    } else {
      setSelectedLayerIds([layerId]);
    }
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedLayerIds([]);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'z':
            e.preventDefault();
            if (e.shiftKey) {
              redo();
            } else {
              undo();
            }
            break;
          case 'y':
            e.preventDefault();
            redo();
            break;
          case 's':
            e.preventDefault();
            if (canvasState) saveCanvasState(canvasState);
            break;
          case 'a':
            e.preventDefault();
            setSelectedLayerIds(layers.map(l => l.id));
            break;
        }
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedLayerIds.length > 0) {
          // Delete selected layers
          setLayers(prev => prev.filter(l => !selectedLayerIds.includes(l.id)));
          setSelectedLayerIds([]);
          setSaveStatus('unsaved');
        }
      }

      if (e.key === 'Escape') {
        clearSelection();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, canvasState, saveCanvasState, layers, selectedLayerIds, clearSelection]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-bg">
        <div className="text-center">
          <div className="animate-spin w-12 h-12 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-muted">Loading Imagination Station...</p>
        </div>
      </div>
    );
  }

  // Show sheet selector if no sheet loaded
  if (!sheet) {
    return (
      <div className="min-h-screen bg-bg p-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-display font-bold text-text mb-8">Imagination Station</h1>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* DTF */}
            <button
              onClick={() => createSheet('dtf', 48)}
              disabled={isProcessing}
              className="bg-card border border-primary/30 rounded-xl p-6 hover:border-primary transition-colors text-left disabled:opacity-50"
            >
              <h3 className="text-xl font-bold text-text mb-2">DTF</h3>
              <p className="text-muted text-sm mb-4">Direct-to-Film transfers. 22.5" width.</p>
              <span className="text-primary text-sm">Create Sheet →</span>
            </button>

            {/* UV DTF */}
            <button
              onClick={() => createSheet('uv_dtf', 24)}
              disabled={isProcessing}
              className="bg-card border border-secondary/30 rounded-xl p-6 hover:border-secondary transition-colors text-left disabled:opacity-50"
            >
              <h3 className="text-xl font-bold text-text mb-2">UV DTF</h3>
              <p className="text-muted text-sm mb-4">Stickers & hard surfaces. 16" width.</p>
              <span className="text-secondary text-sm">Create Sheet →</span>
            </button>

            {/* Sublimation */}
            <button
              onClick={() => createSheet('sublimation', 48)}
              disabled={isProcessing}
              className="bg-card border border-accent/30 rounded-xl p-6 hover:border-accent transition-colors text-left disabled:opacity-50"
            >
              <h3 className="text-xl font-bold text-text mb-2">Sublimation</h3>
              <p className="text-muted text-sm mb-4">Polyester & coated items. 22" width.</p>
              <span className="text-accent text-sm">Create Sheet →</span>
            </button>
          </div>

          {/* Recent Sheets */}
          <div className="mt-12">
            <h2 className="text-xl font-bold text-text mb-4">Recent Sheets</h2>
            <p className="text-muted">Your recent sheets will appear here.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-bg overflow-hidden">
      {/* Header */}
      <header className="h-14 bg-card border-b border-primary/20 flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/imagination-station')}
            className="text-muted hover:text-text transition-colors"
          >
            ← Back
          </button>
          <input
            type="text"
            value={sheet?.name || 'Untitled'}
            onChange={(e) => dbSheet && setDbSheet({ ...dbSheet, name: e.target.value })}
            onBlur={() => sheet && imaginationApi.updateSheet(sheet.id, { name: sheet.name })}
            className="bg-transparent text-text font-medium border-b border-transparent hover:border-primary/50 focus:border-primary focus:outline-none px-1"
          />
        </div>

        <div className="flex items-center gap-4">
          <SaveStatus status={saveStatus} lastSaved={lastSaved} />
          <div className="text-sm">
            <span className="text-muted">ITC:</span>
            <span className="text-primary font-bold ml-1">{itcBalance || 0}</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - uses component types */}
        {sheet && (
          <LeftSidebar
            sheet={sheet}
            layers={layers}
            setLayers={setLayers}
            pricing={pricing}
            freeTrials={freeTrials}
            itcBalance={itcBalance || 0}
            isProcessing={isProcessing}
            setIsProcessing={setIsProcessing}
            onLayerAdded={(layer) => {
              setLayers(prev => [...prev, layer]);
              setSaveStatus('unsaved');
            }}
          />
        )}

        {/* Canvas - uses DB types */}
        <div className="flex-1 relative">
          {dbSheet && (
            <SheetCanvas
              sheet={dbSheet}
              layers={dbLayers}
              setLayers={setDbLayers}
              selectedLayerIds={selectedLayerIds}
              selectLayer={selectLayer}
              clearSelection={clearSelection}
              zoom={zoom}
              setZoom={setZoom}
              gridEnabled={gridEnabled}
              snapEnabled={snapEnabled}
              canvasState={canvasState}
              updateCanvasState={updateCanvasState}
            />
          )}

          {/* Zoom Controls */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-card/90 backdrop-blur px-4 py-2 rounded-full border border-primary/20">
            <button
              onClick={() => setZoom(z => Math.max(0.25, z - 0.25))}
              className="w-8 h-8 flex items-center justify-center text-text hover:text-primary"
            >
              −
            </button>
            <span className="text-sm text-muted w-16 text-center">{Math.round(zoom * 100)}%</span>
            <button
              onClick={() => setZoom(z => Math.min(4, z + 0.25))}
              className="w-8 h-8 flex items-center justify-center text-text hover:text-primary"
            >
              +
            </button>
            <div className="w-px h-6 bg-primary/20 mx-2" />
            <button
              onClick={() => setGridEnabled(g => !g)}
              className={`px-3 py-1 text-xs rounded ${gridEnabled ? 'bg-primary text-white' : 'text-muted'}`}
            >
              Grid
            </button>
            <button
              onClick={() => setSnapEnabled(s => !s)}
              className={`px-3 py-1 text-xs rounded ${snapEnabled ? 'bg-primary text-white' : 'text-muted'}`}
            >
              Snap
            </button>
          </div>
        </div>

        {/* Right Sidebar - uses component types */}
        {sheet && (
          <RightSidebar
            sheet={sheet}
            layers={layers}
            setLayers={setLayers}
            selectedLayerIds={selectedLayerIds}
            pricing={autoLayoutPricing}
            freeTrials={freeTrials}
            itcBalance={itcBalance || 0}
            isProcessing={isProcessing}
            setIsProcessing={setIsProcessing}
          />
        )}
      </div>
    </div>
  );
};

export default ImaginationStation;
