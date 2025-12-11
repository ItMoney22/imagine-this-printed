# Imagination Station - Design Specification

**Version:** 1.0
**Date:** December 11, 2025
**Status:** Approved for Implementation

---

## 1. Overview

**Imagination Station** is ITP's next-generation design builder that replaces traditional "gang sheet" tools with an AI-powered creative workspace. Users can generate art, upload designs, arrange them intelligently, and export print-ready sheets across multiple print technologies.

### 1.1 Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope | Phase 1 MVP | Full canvas + AI tools + ITC + admin |
| Architecture | New standalone page | Gang sheets have different UX than product designer |
| AI Provider | Replicate only | Already integrated, covers all needs |
| ITC Pricing | Blueprint costs + admin configurable | Flexible, supports free trials |
| File Storage | Hybrid (Supabase + GCS) | User data in Supabase, exports to GCS |
| Auto-Save | Hybrid (localStorage + DB) | Fast local + durable cloud |
| Admin | Tab in existing AdminDashboard | Centralized admin experience |

### 1.2 Supported Print Types

- **DTF (Direct-to-Film)** - 22.5" width sheets
- **UV DTF (Stickers)** - 16" width sheets
- **Sublimation** - 22" width sheets

---

## 2. Architecture

### 2.1 Technology Stack

- **Frontend:** React + TypeScript + Konva.js canvas
- **Backend:** Express.js API routes under `/api/imagination-station/*`
- **AI Provider:** Replicate (Flux for generation, Real-ESRGAN for upscale, rembg for BG removal)
- **Storage:** Supabase Storage (uploads) + GCS buckets (exports)
- **Database:** Supabase PostgreSQL
- **Currency:** ITC integration

### 2.2 File Structure

```
backend/
├── config/
│   └── imagination-presets.ts          # Sheet sizes, print rules
├── routes/
│   └── imagination-station.ts          # All API endpoints
├── services/
│   └── imagination-service.ts          # Business logic, AI calls
└── utils/
    └── auto-layout.ts                  # Bin-packing algorithm

src/
├── pages/
│   └── ImaginationStation.tsx          # Main page
├── components/
│   └── imagination/
│       ├── SheetCanvas.tsx             # Konva canvas
│       ├── LeftSidebar.tsx             # Print type, size, upload
│       ├── RightSidebar.tsx            # Object settings, export
│       ├── LayersPanel.tsx             # Layer management
│       ├── MrImaginePanel.tsx          # AI generation
│       ├── NanoBananaTools.tsx         # Image tools
│       ├── AutoLayoutControls.tsx      # Nesting, smart fill
│       ├── ExportPanel.tsx             # Export options
│       ├── SheetPresets.tsx            # Size selector
│       └── SaveStatus.tsx              # Auto-save indicator
├── hooks/
│   └── useImaginationStation.ts        # State management hook
└── utils/
    └── imagination-helpers.ts          # Canvas utilities

supabase/
└── migrations/
    └── xxx_imagination_station.sql     # New tables
```

---

## 3. Database Schema

### 3.1 New Tables

```sql
-- imagination_sheets: Stores user's sheet projects
CREATE TABLE imagination_sheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  name VARCHAR(255) DEFAULT 'Untitled Sheet',
  print_type VARCHAR(20) CHECK (print_type IN ('dtf', 'uv_dtf', 'sublimation')),
  sheet_width DECIMAL NOT NULL,
  sheet_height DECIMAL NOT NULL,
  canvas_state JSONB,
  thumbnail_url TEXT,
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'printed')),
  itc_spent INTEGER DEFAULT 0,
  admin_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- imagination_layers: Individual elements on a sheet
CREATE TABLE imagination_layers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id UUID REFERENCES imagination_sheets(id) ON DELETE CASCADE,
  layer_type VARCHAR(20) CHECK (layer_type IN ('image', 'ai_generated', 'text')),
  source_url TEXT,
  processed_url TEXT,
  position_x DECIMAL DEFAULT 0,
  position_y DECIMAL DEFAULT 0,
  width DECIMAL,
  height DECIMAL,
  rotation DECIMAL DEFAULT 0,
  scale_x DECIMAL DEFAULT 1,
  scale_y DECIMAL DEFAULT 1,
  z_index INTEGER DEFAULT 0,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- imagination_pricing: Admin-adjustable ITC costs
CREATE TABLE imagination_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_key VARCHAR(50) UNIQUE NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  base_cost INTEGER NOT NULL,
  current_cost INTEGER NOT NULL,
  is_free_trial BOOLEAN DEFAULT FALSE,
  free_trial_uses INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- imagination_free_trials: Track user's free trial usage
CREATE TABLE imagination_free_trials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  feature_key VARCHAR(50) NOT NULL,
  uses_remaining INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, feature_key)
);

-- Indexes
CREATE INDEX idx_imagination_sheets_user ON imagination_sheets(user_id);
CREATE INDEX idx_imagination_sheets_status ON imagination_sheets(status);
CREATE INDEX idx_imagination_layers_sheet ON imagination_layers(sheet_id);

-- RLS Policies
ALTER TABLE imagination_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE imagination_layers ENABLE ROW LEVEL SECURITY;
ALTER TABLE imagination_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE imagination_free_trials ENABLE ROW LEVEL SECURITY;

-- Users can only see their own sheets
CREATE POLICY "Users can view own sheets" ON imagination_sheets
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sheets" ON imagination_sheets
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sheets" ON imagination_sheets
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own sheets" ON imagination_sheets
  FOR DELETE USING (auth.uid() = user_id);

-- Layers follow sheet ownership
CREATE POLICY "Users can manage own layers" ON imagination_layers
  FOR ALL USING (
    sheet_id IN (SELECT id FROM imagination_sheets WHERE user_id = auth.uid())
  );

-- Pricing is readable by all, writable by admins
CREATE POLICY "Anyone can read pricing" ON imagination_pricing
  FOR SELECT USING (true);

-- Free trials belong to users
CREATE POLICY "Users can view own trials" ON imagination_free_trials
  FOR SELECT USING (auth.uid() = user_id);
```

### 3.2 Default Pricing Data

```sql
INSERT INTO imagination_pricing (feature_key, display_name, base_cost, current_cost, is_free_trial, free_trial_uses) VALUES
  ('bg_remove', 'Background Removal', 5, 5, true, 3),
  ('upscale_2x', 'Upscale 2x', 5, 5, true, 2),
  ('upscale_4x', 'Upscale 4x', 10, 10, true, 1),
  ('enhance', 'Enhance Image', 5, 5, true, 2),
  ('generate', 'Mr. Imagine Generation', 15, 15, true, 2),
  ('auto_nest', 'Auto-Nest Layout', 2, 2, true, 5),
  ('smart_fill', 'Smart Fill', 3, 3, true, 3),
  ('export', 'Export Sheet', 0, 0, false, 0);
```

---

## 4. API Endpoints

### 4.1 Sheet Management

```
POST   /api/imagination-station/sheets
       Create new sheet project
       Body: { name, print_type, sheet_width, sheet_height }
       Returns: sheet object

GET    /api/imagination-station/sheets
       List user's sheets
       Query: ?status=draft|submitted|...

GET    /api/imagination-station/sheets/:id
       Get single sheet with layers

PUT    /api/imagination-station/sheets/:id
       Update sheet (auto-save canvas state)
       Body: { canvas_state, name, ... }

DELETE /api/imagination-station/sheets/:id
       Delete sheet and associated layers/files
```

### 4.2 Layer Operations

```
POST   /api/imagination-station/sheets/:id/upload
       Upload image to sheet
       Multipart form data
       Stores in Supabase, creates layer record

POST   /api/imagination-station/sheets/:id/generate
       Mr. Imagine AI generation
       Body: { prompt, style }
       Deducts ITC, calls Replicate
       Returns: new layer with generated image

POST   /api/imagination-station/sheets/:id/remove-bg
       Background removal
       Body: { layer_id }
       Deducts ITC, processes via Replicate

POST   /api/imagination-station/sheets/:id/upscale
       Image upscaling
       Body: { layer_id, scale_factor }
       Deducts ITC based on scale

POST   /api/imagination-station/sheets/:id/enhance
       Image enhancement
       Body: { layer_id }
       Deducts ITC
```

### 4.3 Layout Automation

```
POST   /api/imagination-station/sheets/:id/auto-layout
       Run auto-nesting algorithm
       Deducts ITC
       Returns: updated layer positions

POST   /api/imagination-station/sheets/:id/smart-fill
       Fill sheet with duplicates
       Body: { layer_id }
       Deducts ITC
```

### 4.4 Export & Production

```
POST   /api/imagination-station/sheets/:id/export
       Generate print-ready file
       Body: { format: 'png' | 'pdf', dpi: 300, include_cutlines?, mirror? }
       Exports to GCS bucket
       Returns: download URL

POST   /api/imagination-station/sheets/:id/submit
       Submit sheet for production
       Changes status to 'submitted'
       Creates order record
```

### 4.5 Pricing & Trials

```
GET    /api/imagination-station/pricing
       Returns current pricing + user's free trial status

PUT    /api/admin/imagination-station/pricing/:feature_key
       Admin: Update cost or free trial settings
       Body: { current_cost, is_free_trial, free_trial_uses }

POST   /api/admin/imagination-station/pricing/promo
       Admin: Set all features free for X hours
       Body: { duration_hours }
```

### 4.6 Admin Endpoints

```
GET    /api/admin/imagination-station/sheets
       List all sheets with filters
       Query: ?status=&print_type=&user_id=&date_from=&date_to=

PUT    /api/admin/imagination-station/sheets/:id/status
       Update sheet status
       Body: { status, admin_notes }

GET    /api/admin/imagination-station/analytics
       Usage statistics
```

---

## 5. Frontend Components

### 5.1 Page Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  Header: "Imagination Station" + ITC Balance + Save Status      │
├────────────┬────────────────────────────────┬───────────────────┤
│            │                                │                   │
│  LEFT      │        CANVAS (CENTER)         │      RIGHT        │
│  SIDEBAR   │                                │      SIDEBAR      │
│            │   ┌────────────────────────┐   │                   │
│ Print Type │   │                        │   │  Object Settings  │
│ Sheet Size │   │    Interactive Sheet   │   │  - Position X/Y   │
│ ────────── │   │    (Konva Stage)       │   │  - Width/Height   │
│ Upload     │   │                        │   │  - Rotation       │
│ ────────── │   │    [design] [design]   │   │  - Scale          │
│ AI Tools   │   │    [design]            │   │  ─────────────    │
│ • Mr.      │   │                        │   │  Spacing Tools    │
│   Imagine  │   └────────────────────────┘   │  • Align H/V      │
│ • Nano     │                                │  • Distribute     │
│   Banana   │   Zoom: [−][100%][+] Grid: [✓] │  • Magic Spacing  │
│ ────────── │                                │  ─────────────    │
│ Layers     │                                │  Auto Layout      │
│ Panel      │                                │  • Auto-Nest      │
│            │                                │  • Smart Fill     │
│ ITC: 150   │                                │  ─────────────    │
│ [Add ITC]  │                                │  Export           │
│            │                                │  [PNG] [PDF]      │
└────────────┴────────────────────────────────┴───────────────────┘
```

### 5.2 Component Responsibilities

| Component | File | Responsibility |
|-----------|------|---------------|
| ImaginationStation | `pages/ImaginationStation.tsx` | Main page, state orchestration |
| SheetCanvas | `components/imagination/SheetCanvas.tsx` | Konva Stage, drag-drop, selection, transform |
| LeftSidebar | `components/imagination/LeftSidebar.tsx` | Print type, sheet size, upload |
| RightSidebar | `components/imagination/RightSidebar.tsx` | Object settings, spacing, export |
| LayersPanel | `components/imagination/LayersPanel.tsx` | Layer list, reorder, visibility, delete |
| MrImaginePanel | `components/imagination/MrImaginePanel.tsx` | Prompt input, style selector, generate |
| NanoBananaTools | `components/imagination/NanoBananaTools.tsx` | BG remove, upscale, enhance, DPI check |
| AutoLayoutControls | `components/imagination/AutoLayoutControls.tsx` | Auto-nest, smart fill buttons |
| ExportPanel | `components/imagination/ExportPanel.tsx` | Format selection, pre-flight, export |
| SheetPresets | `components/imagination/SheetPresets.tsx` | Print type + size selector |
| SaveStatus | `components/imagination/SaveStatus.tsx` | Auto-save indicator |
| ITCBalance | `components/imagination/ITCBalance.tsx` | Balance display, add ITC button |

### 5.3 State Management Hook

```typescript
// src/hooks/useImaginationStation.ts
interface ImaginationState {
  sheet: Sheet | null;
  layers: Layer[];
  selectedLayerIds: string[];
  printType: 'dtf' | 'uv_dtf' | 'sublimation';
  sheetSize: { width: number; height: number };
  canvasState: CanvasState;
  history: { past: CanvasState[]; future: CanvasState[] };
  saveStatus: 'saved' | 'saving' | 'unsaved' | 'offline' | 'error';
  pricing: PricingConfig[];
  freeTrials: FreeTrialStatus[];
}

interface ImaginationActions {
  createSheet: (config: SheetConfig) => Promise<void>;
  loadSheet: (id: string) => Promise<void>;
  saveSheet: () => Promise<void>;
  uploadImage: (file: File) => Promise<void>;
  generateImage: (prompt: string, style: string) => Promise<void>;
  removeBackground: (layerId: string) => Promise<void>;
  upscaleImage: (layerId: string, scale: number) => Promise<void>;
  autoLayout: () => Promise<void>;
  smartFill: (layerId: string) => Promise<void>;
  exportSheet: (format: string, options: ExportOptions) => Promise<string>;
  submitSheet: () => Promise<void>;
  undo: () => void;
  redo: () => void;
  selectLayer: (id: string, multi?: boolean) => void;
  updateLayer: (id: string, attrs: Partial<Layer>) => void;
  deleteLayer: (id: string) => void;
  duplicateLayer: (id: string) => void;
  reorderLayers: (fromIndex: number, toIndex: number) => void;
}
```

---

## 6. Canvas Features

### 6.1 Core Interactions

| Feature | Description | Keyboard Shortcut |
|---------|-------------|-------------------|
| Drag & Drop | Move elements freely | - |
| Resize | Corner/edge handles | - |
| Rotate | Rotation handle, snap to 0/90/180/270 | - |
| Duplicate | Copy with 10px offset | Ctrl+D |
| Delete | Remove element | Delete |
| Multi-select | Select multiple | Shift+Click |
| Group | Group elements | Ctrl+G |
| Ungroup | Ungroup elements | Ctrl+Shift+G |
| Undo | Undo last action | Ctrl+Z |
| Redo | Redo action | Ctrl+Shift+Z |
| Zoom In | Increase zoom | Ctrl++ |
| Zoom Out | Decrease zoom | Ctrl+- |
| Pan | Move canvas view | Space+Drag |
| Select All | Select all elements | Ctrl+A |

### 6.2 Canvas Settings

- **Grid:** Toggle snap-to-grid (0.25" increments)
- **Rulers:** Inch-based rulers on top and left
- **Zoom Range:** 25% - 400%
- **History Stack:** 50 undo/redo steps

### 6.3 Auto-Layout Algorithms

**Auto-Nest (2 ITC):**
- Bottom-Left Fill bin-packing algorithm
- Rotates elements 90° if better fit
- 0.25" margin from edges
- 0.25" gap between elements

**Smart Fill (3 ITC):**
- Calculates copies that fit in remaining space
- Grid pattern with 0.25" gaps
- Preview before confirming

**Magic Spacing (Free):**
- Evenly distributes selected elements
- Horizontal or vertical alignment

---

## 7. Sheet Presets & Print Rules

### 7.1 Configuration

```typescript
// backend/config/imagination-presets.ts
export const SHEET_PRESETS = {
  dtf: {
    width: 22.5,
    heights: [24, 36, 48, 53, 60, 72, 84, 96, 108, 120, 132, 144, 168, 192, 216, 240],
    rules: {
      mirror: false,
      whiteInk: true,
      minDPI: 300
    }
  },
  uv_dtf: {
    width: 16,
    heights: [12, 24, 36, 48, 60, 72, 84, 96, 108, 120],
    rules: {
      mirror: false,
      whiteInk: true,
      cutlineOption: true,
      minDPI: 300
    }
  },
  sublimation: {
    width: 22,
    heights: [24, 36, 48, 60, 72, 84, 96, 120],
    rules: {
      mirror: true,
      whiteInk: false,
      minDPI: 300
    }
  }
};
```

### 7.2 Print Type Warnings

| Print Type | Warning Condition | Message |
|------------|-------------------|---------|
| All | DPI < 300 | "Low resolution - may appear blurry" |
| All | Element outside bounds | "Element extends beyond sheet" |
| Sublimation | White/light colors | "No white ink - light colors won't print" |
| UV DTF | Export | "Include cutlines?" prompt |

---

## 8. AI Tools Integration

### 8.1 Mr. Imagine Panel

- Text prompt input (max 500 chars)
- Style selector: Realistic, Cartoon, Vintage, Minimalist, Vaporwave
- Generate button with ITC cost display
- Recent generations gallery (last 6)
- Loading state during generation (~10-30 sec)
- Error handling with ITC refund

### 8.2 Nano Banana Tools

- **Background Removal** - Remove background from selected image
- **Upscale 2x** - Double resolution
- **Upscale 4x** - Quadruple resolution
- **Enhance** - Improve image quality

### 8.3 DPI Checker

- Real-time DPI calculation based on print size
- Color-coded status: Green (300+), Yellow (200-299), Red (<200)
- Pre-export warning for low-DPI elements

### 8.4 ITC Flow

1. User clicks action button
2. Check ITC balance (or free trial availability)
3. If insufficient: show "Add ITC" modal
4. If sufficient: call API
5. Backend deducts ITC, logs transaction
6. On success: update canvas, decrement free trial if used
7. On failure: refund ITC, show error

---

## 9. Export & Production

### 9.1 Pre-flight Checks

- All elements >= 300 DPI
- No elements outside bounds
- Print type rules validated
- Overlapping elements warning (non-blocking)

### 9.2 Export Options

- **Format:** PNG (300 DPI) or PDF (Print-Ready)
- **Cutlines:** Optional for UV DTF
- **Mirror:** Optional for Sublimation

### 9.3 File Naming

```
ITP_[DATE]_[USER_ID]_[PRINT_TYPE]_[SIZE].[ext]
ITP_20251211_abc123_DTF_22.5x48.png
```

### 9.4 Storage

- **Working files:** `supabase://uploads/imagination-station/{user_id}/`
- **Final exports:** `gcs://itp-exports/sheets/{user_id}/{sheet_id}/`

### 9.5 Submit to Production

1. User clicks "Submit to Production"
2. Confirmation modal with pricing
3. Create order in `orders` table
4. Link sheet via `imagination_sheets.id`
5. Update status to 'submitted'
6. Redirect to checkout or add to cart

---

## 10. Auto-Save System

### 10.1 Hybrid Approach

- **localStorage:** Save every 10 seconds (instant backup)
- **Supabase DB:** Sync every 60 seconds (cloud persist)
- **Manual save:** Always available

### 10.2 Conflict Resolution

On page load:
1. Check localStorage timestamp
2. Check DB timestamp
3. Load whichever is newer
4. Prompt if conflict: "Local or cloud version?"

### 10.3 Save Status Indicator

| State | Icon | Description |
|-------|------|-------------|
| Saved | Green dot | All changes persisted |
| Saving... | Yellow dot | Sync in progress |
| Unsaved | Orange dot | Local only |
| Offline | Gray dot | localStorage only |
| Error | Red dot | Click to retry |

### 10.4 Canvas State Schema

```typescript
interface CanvasState {
  version: number;
  timestamp: string;
  stage: {
    width: number;
    height: number;
    scale: number;
    position: { x: number; y: number };
  };
  layers: Array<{
    id: string;
    type: 'image' | 'ai_generated' | 'text';
    attrs: KonvaNodeAttrs;
    src?: string;
    text?: string;
  }>;
  gridEnabled: boolean;
  snapEnabled: boolean;
}
```

---

## 11. Admin Dashboard

### 11.1 New Tab: Imagination Station

Located in existing AdminDashboard with sub-tabs:
- **Submitted Sheets** - Manage production queue
- **Pricing Config** - Adjust ITC costs and free trials
- **Analytics** - Usage statistics

### 11.2 Sheet Management Table

Columns: Thumbnail, User, Type, Size, Status, Actions

Filters: Print Type, Status, Date Range, Search

### 11.3 Admin Actions

| Action | Description |
|--------|-------------|
| View | Open sheet preview modal |
| Approve | Mark ready for production |
| Reject | Flag with reason, notify user |
| Download | Download print-ready file |
| Mark Printed | Update status |
| Edit Notes | Add internal notes |
| Delete | Remove sheet |

### 11.4 Pricing Config Panel

- Adjust ITC cost per feature
- Enable/disable free trials
- Set free trial usage limits
- "Make All Free" promo button
- Reset to defaults

---

## 12. Implementation Phases

### Phase 1: Foundation (Database + Basic API)
- Create database migrations
- Set up API routes structure
- Implement sheet CRUD operations
- Configure storage buckets

### Phase 2: Canvas Core
- Build ImaginationStation page shell
- Implement SheetCanvas with Konva
- Add basic interactions (drag, resize, rotate)
- Layer management

### Phase 3: UI Components
- Left sidebar (print type, size, upload)
- Right sidebar (object settings, spacing)
- Layers panel
- Save status indicator

### Phase 4: AI Integration
- Mr. Imagine generation panel
- Nano Banana tools (BG remove, upscale, enhance)
- ITC deduction flow
- Free trial system

### Phase 5: Automation & Export
- Auto-layout algorithm
- Smart fill
- Export functionality (PNG/PDF)
- GCS integration

### Phase 6: Admin & Polish
- Admin dashboard tab
- Pricing configuration
- Analytics
- Testing and bug fixes

---

## 13. Dependencies

### 13.1 NPM Packages (Already Installed)

- `react-konva` - Canvas rendering
- `konva` - Canvas engine
- `axios` - API calls
- `@supabase/supabase-js` - Database
- `stripe` - Payments

### 13.2 New Dependencies (If Needed)

- `bin-pack` or custom - Auto-layout algorithm
- `file-saver` - Client-side downloads
- `jspdf` - PDF generation (if client-side)

### 13.3 External Services

- **Replicate API** - AI image generation/processing
- **Google Cloud Storage** - Export file storage
- **Supabase Storage** - User uploads

---

## 14. Success Metrics

- Users can create and export gang sheets
- AI tools work reliably with ITC deduction
- Auto-layout saves users time
- Admin can manage production queue
- < 3 second canvas interactions
- < 30 second AI generations
- Zero data loss with auto-save

---

*Document created: December 11, 2025*
*Ready for implementation*
