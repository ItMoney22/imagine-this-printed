-- Print-materials inventory: filament spools (AMS feeds ≤4 at once) and paint
-- bottles (paint-it-yourself kits), one table keyed by kind.
-- David 2026-08-19: full-color toy prints need a spot to inventory available
-- filament, and each purchase should tell the floor which ≤4 colors to load;
-- paint kits must ship the right paints for the customer's specific toy.
-- `hex` is the matching key: the toy's extracted palette is matched to the
-- nearest in-stock hex per kind (see backend/services/print-palette.ts).

CREATE TABLE IF NOT EXISTS public.print_materials (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('filament', 'paint')),
  brand TEXT NOT NULL,
  material TEXT NOT NULL, -- filament: PLA/PETG/…; paint: acrylic/…
  color_name TEXT NOT NULL,
  hex TEXT NOT NULL CHECK (hex ~* '^#[0-9a-f]{6}$'),
  qty_on_hand INTEGER NOT NULL DEFAULT 0, -- spools or bottles
  reorder_threshold INTEGER NOT NULL DEFAULT 1,
  cost_per_unit NUMERIC(10,2),
  grams_per_unit NUMERIC(10,2), -- filament: grams per spool; paint: ml per bottle
  supplier TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (kind, brand, material, color_name)
);

CREATE INDEX IF NOT EXISTS print_materials_kind_active_idx
  ON public.print_materials (kind, is_active);

-- Service-role only (backend + worker); no client-side policies — same posture
-- as blank_inventory.
ALTER TABLE public.print_materials ENABLE ROW LEVEL SECURITY;
