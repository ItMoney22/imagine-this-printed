# Imagination Station Stability Features - Quick Integration Guide

## 🚀 In 5 Minutes

### Step 1: Add Imports (Top of ImaginationStation.tsx)

```typescript
import toast, { Toaster } from 'react-hot-toast';
import { useUndoRedo } from '../hooks/useUndoRedo';
import { Undo2, Redo2 } from 'lucide-react'; // Add to existing import
```

### Step 2: Replace Layers State (Line ~123)

```typescript
// REMOVE:
const [layers, setLayers] = useState<ImaginationLayer[]>([]);

// ADD:
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
```

### Step 3: Add Autosave (After loadInitialData effect, ~line 212)

```typescript
// Autosave - saves every 30 seconds
useEffect(() => {
  if (!sheet || !id) return;

  const autosaveKey = `imagination-station-autosave-${id}`;

  // localStorage save (debounced)
  const saveToLocalStorage = () => {
    try {
      localStorage.setItem(autosaveKey, JSON.stringify({
        sheetId: id,
        layers,
        canvasState,
        zoom,
        gridEnabled,
        snapEnabled,
        timestamp: new Date().toISOString(),
      }));
    } catch (e) {
      console.error('Autosave failed:', e);
    }
  };

  const debounceTimer = setTimeout(saveToLocalStorage, 1000);

  // Backend save every 30s
  const autosaveInterval = setInterval(async () => {
    if (saveStatus === 'unsaved') {
      try {
        setSaveStatus('saving');
        await saveSheet();
        toast.success('Auto-saved', { icon: '💾', duration: 2000 });
        setSaveStatus('saved');
      } catch (error) {
        setSaveStatus('unsaved');
        saveToLocalStorage(); // Fallback
      }
    }
  }, 30000);

  return () => {
    clearInterval(autosaveInterval);
    clearTimeout(debounceTimer);
  };
}, [sheet, id, layers, canvasState, zoom, gridEnabled, snapEnabled, saveStatus]);

// Auto-restore on mount
useEffect(() => {
  if (!id) return;

  const autosaveKey = `imagination-station-autosave-${id}`;
  const autosaveData = localStorage.getItem(autosaveKey);

  if (autosaveData) {
    try {
      const parsed = JSON.parse(autosaveData);
      if (parsed.sheetId === id && parsed.layers && parsed.timestamp) {
        const age = Date.now() - new Date(parsed.timestamp).getTime();
        if (age < 3600000) { // 1 hour
          const minutesAgo = Math.round(age / 60000);
          toast.info(`Restored work from ${minutesAgo} min ago`, {
            icon: '🔄',
            duration: 4000,
          });
          setLayers(parsed.layers);
          if (parsed.canvasState) setCanvasState(parsed.canvasState);
          if (typeof parsed.zoom === 'number') setZoom(parsed.zoom);
          if (typeof parsed.gridEnabled === 'boolean') setGridEnabled(parsed.gridEnabled);
          if (typeof parsed.snapEnabled === 'boolean') setSnapEnabled(parsed.snapEnabled);
        }
      }
    } catch (e) {
      console.error('Failed to load autosave:', e);
    }
  }
}, [id]);
```

### Step 4: Add Toaster Component (Line ~841, top of return)

```typescript
return (
  <div className="h-screen flex flex-col bg-[#F5F5F5] overflow-hidden">
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
          iconTheme: { primary: '#9333ea', secondary: '#fff' },
        },
        error: {
          iconTheme: { primary: '#ef4444', secondary: '#fff' },
          duration: 5000,
        },
      }}
    />

    {/* Rest of your component */}
```

### Step 5: Add Undo/Redo Buttons (Line ~1143, in zoom controls)

```typescript
<div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-white px-4 py-2 rounded-full shadow-lg border border-stone-200 z-10">
  {/* Undo/Redo */}
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
  <button onClick={() => setZoom(z => Math.max(MIN_ZOOM, z - 0.1))}>
    <ZoomOut className="w-4 h-4" />
  </button>
  {/* ... */}
</div>
```

### Step 6: Add Toast Notifications (Quick Examples)

```typescript
// In handleFileUpload (line ~303):
toast.success(`Uploaded ${Array.from(files).length} image${Array.from(files).length > 1 ? 's' : ''}`, { icon: '📸' });

// In deleteSelectedLayers (line ~354):
toast.success(`Deleted ${selectedLayerIds.length} layer${selectedLayerIds.length > 1 ? 's' : ''}`, { icon: '🗑️' });

// In duplicateSelectedLayers (line ~374):
toast.success(`Duplicated ${selectedLayerIds.length} layer${selectedLayerIds.length > 1 ? 's' : ''}`, { icon: '📋' });

// In handleAutoNest (line ~542):
const toastId = toast.loading('Optimizing layout...', { icon: '⚙️' });
// ... then after success:
toast.success('Layout optimized!', { id: toastId, icon: '✨' });

// In saveSheet (line ~686):
toast.success('Saved successfully', { icon: '✅', duration: 2000 });

// In handleAddToCart (line ~526):
toast.success(`Gang sheet added to cart! Price: $${price.toFixed(2)}`, { icon: '🛒', duration: 3000 });
```

## ✅ Done!

You now have:
- 🔄 Autosave every 30 seconds
- ⏮️ Undo/Redo with Ctrl+Z / Ctrl+Shift+Z
- 🔔 Toast notifications for all actions
- 🛡️ Error boundary (already in App.tsx)
- 💾 Auto-restore on page refresh

## 🧪 Quick Test

1. Upload an image → See toast
2. Press Ctrl+Z → Image disappears
3. Press Ctrl+Shift+Z → Image reappears
4. Wait 30 seconds → See "Auto-saved" toast
5. Refresh page → See "Restored work" toast

## 📚 Full Documentation

- **Complete guide**: `IMAGINATION_STATION_STABILITY_PATCHES.md`
- **All code snippets**: `IMAGINATION_STATION_CODE_ADDITIONS.tsx`
- **Summary**: `STABILITY_FEATURES_SUMMARY.md`

## 🎯 Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+Z (Cmd+Z) | Undo |
| Ctrl+Shift+Z (Cmd+Shift+Z) | Redo |
| Ctrl+Y (Cmd+Y) | Redo (alt) |
| Auto | Save every 30s |

---

**Questions?** Check the full documentation files for detailed explanations!
