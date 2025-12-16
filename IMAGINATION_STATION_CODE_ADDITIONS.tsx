/**
 * IMAGINATION STATION STABILITY ENHANCEMENTS
 * Copy these code snippets into ImaginationStation.tsx
 */

// ============================================
// 1. ADD THESE IMPORTS AT THE TOP
// ============================================

import toast, { Toaster } from 'react-hot-toast';
import { useUndoRedo } from '../hooks/useUndoRedo';
import { ImaginationErrorBoundary } from '../components/imagination';
import { Undo2, Redo2 } from 'lucide-react'; // Add to existing lucide-react import

// ============================================
// 2. REPLACE THE LAYERS STATE (around line 123)
// ============================================

// OLD CODE TO REMOVE:
// const [layers, setLayers] = useState<ImaginationLayer[]>([]);

// NEW CODE TO ADD:
const {
  state: layers,
  setState: setLayers,
  undo: undoLayers,
  redo: redoLayers,
  canUndo,
  canRedo,
} = useUndoRedo<ImaginationLayer[]>([], {
  maxHistorySize: 50,
  onStateChange: () => setSaveStatus('unsaved'),
});

// ============================================
// 3. ADD AUTOSAVE EFFECTS (after loadInitialData effect, around line 212)
// ============================================

// Autosave to localStorage and backend every 30 seconds
useEffect(() => {
  if (!sheet || !id) return;

  const autosaveKey = `imagination-station-autosave-${id}`;

  // Save to localStorage (immediate, debounced)
  const saveToLocalStorage = () => {
    try {
      const autosaveData = {
        sheetId: id,
        layers,
        canvasState,
        zoom,
        gridEnabled,
        snapEnabled,
        timestamp: new Date().toISOString(),
      };
      localStorage.setItem(autosaveKey, JSON.stringify(autosaveData));
    } catch (e) {
      console.error('Failed to autosave to localStorage:', e);
    }
  };

  // Debounce localStorage saves
  const debounceTimer = setTimeout(saveToLocalStorage, 1000);

  // Save to backend every 30 seconds
  const autosaveInterval = setInterval(async () => {
    if (saveStatus === 'unsaved') {
      try {
        setSaveStatus('saving');
        await saveSheet();
        toast.success('Auto-saved', {
          icon: '💾',
          duration: 2000,
        });
        setSaveStatus('saved');
      } catch (error) {
        console.error('Autosave failed:', error);
        setSaveStatus('unsaved');
        // Fallback to localStorage
        saveToLocalStorage();
      }
    }
  }, 30000); // 30 seconds

  return () => {
    clearInterval(autosaveInterval);
    clearTimeout(debounceTimer);
  };
}, [sheet, id, layers, canvasState, zoom, gridEnabled, snapEnabled, saveStatus]);

// Load autosave on mount
useEffect(() => {
  if (!id) return;

  const autosaveKey = `imagination-station-autosave-${id}`;
  const autosaveData = localStorage.getItem(autosaveKey);

  if (autosaveData) {
    try {
      const parsed = JSON.parse(autosaveData);
      if (parsed.sheetId === id && parsed.layers && parsed.timestamp) {
        const age = Date.now() - new Date(parsed.timestamp).getTime();
        const hourInMs = 60 * 60 * 1000;

        // Only restore if less than 1 hour old
        if (age < hourInMs) {
          const minutesAgo = Math.round(age / 60000);
          toast.info(`Restored auto-saved work from ${minutesAgo} minute${minutesAgo !== 1 ? 's' : ''} ago`, {
            icon: '🔄',
            duration: 4000,
          });
          setLayers(parsed.layers);
          if (parsed.canvasState) {
            setCanvasState(parsed.canvasState);
          }
          if (typeof parsed.zoom === 'number') {
            setZoom(parsed.zoom);
          }
          if (typeof parsed.gridEnabled === 'boolean') {
            setGridEnabled(parsed.gridEnabled);
          }
          if (typeof parsed.snapEnabled === 'boolean') {
            setSnapEnabled(parsed.snapEnabled);
          }
        } else {
          // Remove old autosave
          localStorage.removeItem(autosaveKey);
        }
      }
    } catch (e) {
      console.error('Failed to load autosave:', e);
    }
  }
}, [id]);

// ============================================
// 4. ADD TOAST NOTIFICATIONS TO EXISTING FUNCTIONS
// ============================================

// In handleFileUpload - add after line 303 (after setIsProcessing(false)):
toast.success(`Uploaded ${Array.from(files).length} image${Array.from(files).length > 1 ? 's' : ''}`, {
  icon: '📸',
});

// In toggleLayerVisibility - add at the end:
toast.info(`Layer ${layer.metadata?.visible ? 'hidden' : 'shown'}`, {
  duration: 1500,
});

// In toggleLayerLock - add at the end:
toast.info(`Layer ${layer.metadata?.locked ? 'unlocked' : 'locked'}`, {
  duration: 1500,
});

// In deleteSelectedLayers - add before setSaveStatus:
toast.success(`Deleted ${selectedLayerIds.length} layer${selectedLayerIds.length > 1 ? 's' : ''}`, {
  icon: '🗑️',
});

// In duplicateSelectedLayers - add before setSaveStatus:
toast.success(`Duplicated ${selectedLayerIds.length} layer${selectedLayerIds.length > 1 ? 's' : ''}`, {
  icon: '📋',
});

// In resetCanvas - add after confirmed = true:
toast.success('Canvas reset', {
  icon: '🔄',
});

// In handleAutoNest - add at start of try block:
const toastId = toast.loading('Optimizing layout...', {
  icon: '⚙️',
});

// In handleAutoNest - replace the alert success with:
toast.success('Layout optimized!', {
  id: toastId,
  icon: '✨',
});

// In handleAutoNest - in catch block, replace alert with:
toast.error('Auto-Nest optimization failed', {
  id: toastId,
  icon: '❌',
});

// In handleSmartFill - add at start of try block:
const toastId = toast.loading('Filling empty space...', {
  icon: '⚙️',
});

// In handleSmartFill - after success:
toast.success(`Added ${newLayers.length} duplicate${newLayers.length !== 1 ? 's' : ''}`, {
  id: toastId,
  icon: '🎯',
});

// In handleSmartFill - in catch block:
toast.error('Smart Fill optimization failed', {
  id: toastId,
  icon: '❌',
});

// In saveSheet - replace setSaveStatus('saved') with:
setSaveStatus('saved');
toast.success('Saved successfully', {
  icon: '✅',
  duration: 2000,
});

// In saveSheet catch block - add:
toast.error('Failed to save', {
  icon: '❌',
});

// In handleAddToCart - replace the final alert with:
toast.success(`Gang sheet added to cart! Price: $${price.toFixed(2)}`, {
  icon: '🛒',
  duration: 3000,
});

// In handleAddToCart catch block - replace alert with:
toast.error('Failed to add sheet to cart', {
  icon: '❌',
});

// In createSheet catch block - replace alert with:
toast.error(`Failed to create sheet: ${errorMsg}`, {
  icon: '❌',
  duration: 5000,
});

// ============================================
// 5. ADD TOASTER COMPONENT TO JSX
// ============================================

// Add at the very start of the main return statement (around line 841):
return (
  <div className="h-screen flex flex-col bg-[#F5F5F5] overflow-hidden">
    {/* Toast Notifications */}
    <Toaster
      position="bottom-right"
      toastOptions={{
        duration: 3000,
        style: {
          background: '#fff',
          color: '#1c1917',
          border: '1px solid #e7e5e4',
          borderRadius: '12px',
          padding: '12px 16px',
          boxShadow: '0 10px 25px rgba(0, 0, 0, 0.1)',
        },
        success: {
          iconTheme: {
            primary: '#9333ea',
            secondary: '#fff',
          },
        },
        error: {
          iconTheme: {
            primary: '#ef4444',
            secondary: '#fff',
          },
          duration: 5000,
        },
        loading: {
          iconTheme: {
            primary: '#3b82f6',
            secondary: '#fff',
          },
        },
      }}
    />

    {/* Rest of existing JSX */}
    <header className="h-14 bg-white border-b border-stone-200...">
      ...
    </header>
    ...
  </div>
);

// ============================================
// 6. ADD UNDO/REDO BUTTONS TO TOOLBAR
// ============================================

// In the zoom controls div (around line 1143), ADD BEFORE the zoom buttons:

<div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-white px-4 py-2 rounded-full shadow-lg border border-stone-200 z-10">
  {/* Undo/Redo Buttons */}
  <button
    onClick={undoLayers}
    disabled={!canUndo}
    className="w-8 h-8 flex items-center justify-center text-stone-600 hover:text-purple-600 hover:bg-purple-50 rounded-full transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
    title="Undo (Ctrl+Z)"
  >
    <Undo2 className="w-4 h-4" />
  </button>
  <button
    onClick={redoLayers}
    disabled={!canRedo}
    className="w-8 h-8 flex items-center justify-center text-stone-600 hover:text-purple-600 hover:bg-purple-50 rounded-full transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
    title="Redo (Ctrl+Shift+Z)"
  >
    <Redo2 className="w-4 h-4" />
  </button>

  <div className="w-px h-6 bg-stone-200 mx-2"></div>

  {/* Existing zoom controls below */}
  <button
    onClick={() => setZoom(z => Math.max(MIN_ZOOM, z - 0.1))}
    className="w-8 h-8 flex items-center justify-center text-stone-600 hover:text-purple-600 hover:bg-purple-50 rounded-full transition-colors"
  >
    <ZoomOut className="w-4 h-4" />
  </button>
  {/* ... rest of zoom controls */}
</div>

// ============================================
// 7. WRAP IN ERROR BOUNDARY (App.tsx)
// ============================================

// In src/App.tsx, update the route:

import { ImaginationErrorBoundary } from './components/imagination';

// Then wrap the route:
<Route
  path="/imagination-station/:id?"
  element={
    <ImaginationErrorBoundary>
      <ImaginationStation />
    </ImaginationErrorBoundary>
  }
/>

/**
 * SUMMARY OF CHANGES:
 *
 * ✅ Autosave every 30 seconds (localStorage + backend)
 * ✅ Undo/Redo with keyboard shortcuts (Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y)
 * ✅ Toast notifications for all actions
 * ✅ Error boundary with crash recovery
 * ✅ Auto-restore work from last session
 * ✅ Visual feedback for all operations
 *
 * All features work automatically - no configuration needed!
 */
