# Imagination Station Stability Features - Implementation Guide

This document describes the stability features added to Imagination Station.

## Features Added

### 1. Toast Notifications (`react-hot-toast`)
- Installed via `npm install react-hot-toast`
- Shows success/error/info messages for all actions
- Auto-dismisses after 3-5 seconds

### 2. Autosave (30-second interval)
- Automatically saves work to localStorage every 30 seconds
- Saves to backend when online
- Shows "Auto-saved" notification

### 3. Undo/Redo Stack
- Custom hook created: `src/hooks/useUndoRedo.ts`
- Keyboard shortcuts:
  - Ctrl+Z / Cmd+Z: Undo
  - Ctrl+Shift+Z / Cmd+Shift+Z: Redo
  - Ctrl+Y / Cmd+Y: Redo (alternative)
- Tracks up to 50 states in history
- UI buttons in toolbar

### 4. Error Boundary
- Created: `src/components/imagination/ImaginationErrorBoundary.tsx`
- Catches crashes and preserves autosaved data
- Shows recovery options
- Beautiful error UI matching design system

## Files Created

1. `src/hooks/useUndoRedo.ts` - Undo/redo hook with keyboard shortcuts
2. `src/components/imagination/ImaginationErrorBoundary.tsx` - Error boundary component
3. `src/pages/ImaginationStationEnhanced.tsx` - Enhanced wrapper component

## Integration Steps

### Step 1: Add imports to ImaginationStation.tsx

```typescript
import toast, { Toaster } from 'react-hot-toast';
import { useUndoRedo } from '../hooks/useUndoRedo';
import { Undo2, Redo2 } from 'lucide-react';
```

### Step 2: Replace layers state with undo/redo hook

Replace this:
```typescript
const [layers, setLayers] = useState<ImaginationLayer[]>([]);
```

With this:
```typescript
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

### Step 3: Add autosave effect

Add this useEffect after the loadInitialData effect:

```typescript
// Autosave effect - saves every 30 seconds
useEffect(() => {
  if (!sheet || !id) return;

  const autosaveKey = `imagination-station-autosave`;

  // Save to localStorage immediately on changes
  const saveToLocalStorage = () => {
    try {
      const autosaveData = {
        sheetId: id,
        layers,
        canvasState,
        timestamp: new Date().toISOString(),
      };
      localStorage.setItem(autosaveKey, JSON.stringify(autosaveData));
    } catch (e) {
      console.error('Failed to autosave to localStorage:', e);
    }
  };

  // Save to backend every 30 seconds
  const autosaveInterval = setInterval(async () => {
    if (saveStatus === 'unsaved') {
      try {
        await saveSheet();
        toast.success('Auto-saved', {
          icon: '💾',
          duration: 2000,
        });
      } catch (error) {
        // Silent fail, will try again in 30s
        saveToLocalStorage(); // Fallback to localStorage
      }
    }
  }, 30000); // 30 seconds

  // Save to localStorage on every change (debounced)
  const debounceTimer = setTimeout(saveToLocalStorage, 1000);

  return () => {
    clearInterval(autosaveInterval);
    clearTimeout(debounceTimer);
  };
}, [sheet, id, layers, canvasState, saveStatus]);

// Load autosave on mount
useEffect(() => {
  if (!id) return;

  const autosaveKey = `imagination-station-autosave`;
  const autosaveData = localStorage.getItem(autosaveKey);

  if (autosaveData) {
    try {
      const parsed = JSON.parse(autosaveData);
      if (parsed.sheetId === id && parsed.layers && parsed.timestamp) {
        const age = Date.now() - new Date(parsed.timestamp).getTime();
        const hourInMs = 60 * 60 * 1000;

        // Only restore if less than 1 hour old
        if (age < hourInMs) {
          toast.info('Restored auto-saved work', {
            icon: '🔄',
          });
          setLayers(parsed.layers);
          if (parsed.canvasState) {
            setCanvasState(parsed.canvasState);
          }
        }
      }
    } catch (e) {
      console.error('Failed to load autosave:', e);
    }
  }
}, [id]);
```

### Step 4: Add toast notifications to all actions

Add toast notifications to existing functions:

```typescript
// In handleFileUpload:
toast.success(`Uploaded ${files.length} image${files.length > 1 ? 's' : ''}`, {
  icon: '📸',
});

// In deleteSelectedLayers:
toast.success(`Deleted ${selectedLayerIds.length} layer${selectedLayerIds.length > 1 ? 's' : ''}`, {
  icon: '🗑️',
});

// In duplicateSelectedLayers:
toast.success(`Duplicated ${selectedLayerIds.length} layer${selectedLayerIds.length > 1 ? 's' : ''}`, {
  icon: '📋',
});

// In handleAutoNest:
toast.loading('Optimizing layout...', { id: 'auto-nest' });
// ... then after success:
toast.success('Layout optimized!', { id: 'auto-nest', icon: '✨' });

// In handleSmartFill:
toast.loading('Filling empty space...', { id: 'smart-fill' });
// ... then after success:
toast.success(`Added ${newLayers.length} duplicates`, { id: 'smart-fill', icon: '🎯' });

// In saveSheet:
// Remove the setSaveStatus('saved') and add:
toast.success('Saved successfully', { icon: '✅', duration: 2000 });
setSaveStatus('saved');

// On save error:
toast.error('Failed to save', { icon: '❌' });
```

### Step 5: Add Toaster component to JSX

Add at the top level of the component return:

```typescript
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
      }}
    />

    {/* Rest of the component */}
    ...
  </div>
);
```

### Step 6: Add undo/redo buttons to toolbar

Add to the zoom controls section (around line 1143):

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

  {/* Existing zoom controls */}
  <button onClick={() => setZoom(z => Math.max(MIN_ZOOM, z - 0.1))}>
    ...
  </button>
  ...
</div>
```

### Step 7: Wrap in Error Boundary in App.tsx

Update the route in `src/App.tsx`:

```typescript
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
```

## Testing Checklist

- [ ] Autosave shows toast every 30 seconds
- [ ] Undo/Redo buttons work correctly
- [ ] Ctrl+Z undoes last action
- [ ] Ctrl+Shift+Z redoes last action
- [ ] Toast notifications appear for all actions
- [ ] Error boundary catches and displays errors gracefully
- [ ] Autosaved data is recovered on page reload
- [ ] localStorage cleanup works properly

## Usage

All features are automatic:
- Autosave runs in background
- Undo/Redo via keyboard or toolbar buttons
- Toasts appear automatically for actions
- Error boundary activates on crashes

No configuration needed!
