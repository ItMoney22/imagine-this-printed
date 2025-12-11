# Imagination Station Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an AI-powered gang sheet builder with canvas editing, AI generation, ITC integration, and admin management.

**Architecture:** New standalone page using Konva.js canvas, Express.js backend APIs, Replicate for AI, hybrid storage (Supabase + GCS), admin tab in existing dashboard.

**Tech Stack:** React, TypeScript, Konva.js, Express.js, Supabase, Replicate API, Google Cloud Storage

---

## Phase 1: Database & API Foundation

### Task 1.1: Create Database Migration

**Files:**
- Create: `supabase/migrations/20251211_imagination_station.sql`

**Step 1: Write the migration file**

```sql
-- Imagination Station Tables
-- Migration: 20251211_imagination_station.sql

-- imagination_sheets: Stores user's sheet projects
CREATE TABLE IF NOT EXISTS imagination_sheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
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
CREATE TABLE IF NOT EXISTS imagination_layers (
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
CREATE TABLE IF NOT EXISTS imagination_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_key VARCHAR(50) UNIQUE NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  base_cost INTEGER NOT NULL,
  current_cost INTEGER NOT NULL,
  is_free_trial BOOLEAN DEFAULT FALSE,
  free_trial_uses INTEGER DEFAULT 0,
  promo_end_time TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- imagination_free_trials: Track user's free trial usage
CREATE TABLE IF NOT EXISTS imagination_free_trials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  feature_key VARCHAR(50) NOT NULL,
  uses_remaining INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, feature_key)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_imagination_sheets_user ON imagination_sheets(user_id);
CREATE INDEX IF NOT EXISTS idx_imagination_sheets_status ON imagination_sheets(status);
CREATE INDEX IF NOT EXISTS idx_imagination_layers_sheet ON imagination_layers(sheet_id);
CREATE INDEX IF NOT EXISTS idx_imagination_free_trials_user ON imagination_free_trials(user_id);

-- Enable RLS
ALTER TABLE imagination_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE imagination_layers ENABLE ROW LEVEL SECURITY;
ALTER TABLE imagination_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE imagination_free_trials ENABLE ROW LEVEL SECURITY;

-- RLS Policies for imagination_sheets
CREATE POLICY "Users can view own sheets" ON imagination_sheets
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sheets" ON imagination_sheets
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sheets" ON imagination_sheets
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own draft sheets" ON imagination_sheets
  FOR DELETE USING (auth.uid() = user_id AND status = 'draft');

-- RLS Policies for imagination_layers
CREATE POLICY "Users can manage own layers" ON imagination_layers
  FOR ALL USING (
    sheet_id IN (SELECT id FROM imagination_sheets WHERE user_id = auth.uid())
  );

-- RLS Policies for imagination_pricing (public read)
CREATE POLICY "Anyone can read pricing" ON imagination_pricing
  FOR SELECT USING (true);

-- RLS Policies for imagination_free_trials
CREATE POLICY "Users can view own trials" ON imagination_free_trials
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own trials" ON imagination_free_trials
  FOR UPDATE USING (auth.uid() = user_id);

-- Insert default pricing
INSERT INTO imagination_pricing (feature_key, display_name, base_cost, current_cost, is_free_trial, free_trial_uses) VALUES
  ('bg_remove', 'Background Removal', 5, 5, true, 3),
  ('upscale_2x', 'Upscale 2x', 5, 5, true, 2),
  ('upscale_4x', 'Upscale 4x', 10, 10, true, 1),
  ('enhance', 'Enhance Image', 5, 5, true, 2),
  ('generate', 'Mr. Imagine Generation', 15, 15, true, 2),
  ('auto_nest', 'Auto-Nest Layout', 2, 2, true, 5),
  ('smart_fill', 'Smart Fill', 3, 3, true, 3),
  ('export', 'Export Sheet', 0, 0, false, 0)
ON CONFLICT (feature_key) DO NOTHING;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_imagination_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for imagination_sheets
DROP TRIGGER IF EXISTS imagination_sheets_updated_at ON imagination_sheets;
CREATE TRIGGER imagination_sheets_updated_at
  BEFORE UPDATE ON imagination_sheets
  FOR EACH ROW
  EXECUTE FUNCTION update_imagination_updated_at();

-- Trigger for imagination_pricing
DROP TRIGGER IF EXISTS imagination_pricing_updated_at ON imagination_pricing;
CREATE TRIGGER imagination_pricing_updated_at
  BEFORE UPDATE ON imagination_pricing
  FOR EACH ROW
  EXECUTE FUNCTION update_imagination_updated_at();
```

**Step 2: Apply migration via Supabase MCP**

Run the migration using the Supabase MCP `apply_migration` tool.

**Step 3: Verify tables created**

Run SQL query to verify: `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'imagination%';`

---

### Task 1.2: Create Sheet Presets Configuration

**Files:**
- Create: `backend/config/imagination-presets.ts`

**Step 1: Create the presets file**

```typescript
// backend/config/imagination-presets.ts

export interface PrintTypeRules {
  mirror: boolean;
  whiteInk: boolean;
  cutlineOption?: boolean;
  minDPI: number;
}

export interface PrintTypePreset {
  width: number;
  heights: number[];
  rules: PrintTypeRules;
  displayName: string;
  description: string;
}

export type PrintType = 'dtf' | 'uv_dtf' | 'sublimation';

export const SHEET_PRESETS: Record<PrintType, PrintTypePreset> = {
  dtf: {
    width: 22.5,
    heights: [24, 36, 48, 53, 60, 72, 84, 96, 108, 120, 132, 144, 168, 192, 216, 240],
    rules: {
      mirror: false,
      whiteInk: true,
      minDPI: 300
    },
    displayName: 'DTF (Direct-to-Film)',
    description: '22.5" width, any color, no mirroring required'
  },
  uv_dtf: {
    width: 16,
    heights: [12, 24, 36, 48, 60, 72, 84, 96, 108, 120],
    rules: {
      mirror: false,
      whiteInk: true,
      cutlineOption: true,
      minDPI: 300
    },
    displayName: 'UV DTF (Stickers)',
    description: '16" width, hard surface transfers, optional cutlines'
  },
  sublimation: {
    width: 22,
    heights: [24, 36, 48, 60, 72, 84, 96, 120],
    rules: {
      mirror: true,
      whiteInk: false,
      minDPI: 300
    },
    displayName: 'Sublimation',
    description: '22" width, no white ink, mirroring often required'
  }
};

export const DEFAULT_PRINT_TYPE: PrintType = 'dtf';
export const DEFAULT_SHEET_HEIGHT = 48;

export const CANVAS_SETTINGS = {
  marginInches: 0.25,
  gapInches: 0.25,
  gridSizeInches: 0.25,
  maxZoom: 4,
  minZoom: 0.25,
  defaultZoom: 1,
  historyLimit: 50,
  autoSaveLocalMs: 10000,  // 10 seconds
  autoSaveCloudMs: 60000,  // 60 seconds
};

export const AI_STYLES = [
  { key: 'realistic', label: 'Realistic', prompt_suffix: 'photorealistic, high detail, professional photography' },
  { key: 'cartoon', label: 'Cartoon', prompt_suffix: 'cartoon style, vibrant colors, bold outlines' },
  { key: 'vintage', label: 'Vintage', prompt_suffix: 'vintage style, retro, aged paper texture, nostalgic' },
  { key: 'minimalist', label: 'Minimalist', prompt_suffix: 'minimalist design, clean lines, simple shapes' },
  { key: 'vaporwave', label: 'Vaporwave', prompt_suffix: 'vaporwave aesthetic, neon colors, 80s retro futurism' },
];

export function getSheetPrice(printType: PrintType, height: number): number {
  // Base pricing logic - can be expanded
  const sqInches = SHEET_PRESETS[printType].width * height;
  const pricePerSqInch = 0.02; // $0.02 per square inch base
  return Math.round(sqInches * pricePerSqInch * 100) / 100;
}

export function validateSheetSize(printType: PrintType, height: number): boolean {
  return SHEET_PRESETS[printType].heights.includes(height);
}
```

**Step 2: Commit**

```bash
git add backend/config/imagination-presets.ts
git commit -m "feat(imagination): add sheet presets configuration"
```

---

### Task 1.3: Create ITC Pricing Service

**Files:**
- Create: `backend/services/imagination-pricing.ts`

**Step 1: Create the pricing service**

```typescript
// backend/services/imagination-pricing.ts

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface PricingConfig {
  feature_key: string;
  display_name: string;
  base_cost: number;
  current_cost: number;
  is_free_trial: boolean;
  free_trial_uses: number;
  promo_end_time: string | null;
}

export interface FreeTrialStatus {
  feature_key: string;
  uses_remaining: number;
}

export interface CostCheckResult {
  canProceed: boolean;
  cost: number;
  useFreeTrial: boolean;
  freeTrialRemaining: number;
  reason?: string;
}

export class ImaginationPricingService {

  async getAllPricing(): Promise<PricingConfig[]> {
    const { data, error } = await supabase
      .from('imagination_pricing')
      .select('*')
      .order('feature_key');

    if (error) throw new Error(`Failed to fetch pricing: ${error.message}`);
    return data || [];
  }

  async getPricing(featureKey: string): Promise<PricingConfig | null> {
    const { data, error } = await supabase
      .from('imagination_pricing')
      .select('*')
      .eq('feature_key', featureKey)
      .single();

    if (error) return null;
    return data;
  }

  async getUserFreeTrials(userId: string): Promise<FreeTrialStatus[]> {
    const { data, error } = await supabase
      .from('imagination_free_trials')
      .select('feature_key, uses_remaining')
      .eq('user_id', userId);

    if (error) return [];
    return data || [];
  }

  async getFreeTrial(userId: string, featureKey: string): Promise<FreeTrialStatus | null> {
    const { data, error } = await supabase
      .from('imagination_free_trials')
      .select('feature_key, uses_remaining')
      .eq('user_id', userId)
      .eq('feature_key', featureKey)
      .single();

    if (error) return null;
    return data;
  }

  async initializeFreeTrial(userId: string, featureKey: string): Promise<FreeTrialStatus> {
    const pricing = await this.getPricing(featureKey);
    if (!pricing || !pricing.is_free_trial) {
      throw new Error('Feature does not support free trial');
    }

    const { data, error } = await supabase
      .from('imagination_free_trials')
      .upsert({
        user_id: userId,
        feature_key: featureKey,
        uses_remaining: pricing.free_trial_uses
      }, { onConflict: 'user_id,feature_key' })
      .select()
      .single();

    if (error) throw new Error(`Failed to initialize free trial: ${error.message}`);
    return { feature_key: data.feature_key, uses_remaining: data.uses_remaining };
  }

  async checkCost(userId: string, featureKey: string, itcBalance: number): Promise<CostCheckResult> {
    const pricing = await this.getPricing(featureKey);
    if (!pricing) {
      return { canProceed: false, cost: 0, useFreeTrial: false, freeTrialRemaining: 0, reason: 'Feature not found' };
    }

    // Check if promo is active (cost is 0)
    const isPromoActive = pricing.promo_end_time && new Date(pricing.promo_end_time) > new Date();
    if (isPromoActive || pricing.current_cost === 0) {
      return { canProceed: true, cost: 0, useFreeTrial: false, freeTrialRemaining: 0 };
    }

    // Check free trial
    if (pricing.is_free_trial) {
      let freeTrial = await this.getFreeTrial(userId, featureKey);

      // Initialize if doesn't exist
      if (!freeTrial) {
        freeTrial = await this.initializeFreeTrial(userId, featureKey);
      }

      if (freeTrial.uses_remaining > 0) {
        return {
          canProceed: true,
          cost: 0,
          useFreeTrial: true,
          freeTrialRemaining: freeTrial.uses_remaining - 1
        };
      }
    }

    // Check ITC balance
    if (itcBalance >= pricing.current_cost) {
      return {
        canProceed: true,
        cost: pricing.current_cost,
        useFreeTrial: false,
        freeTrialRemaining: 0
      };
    }

    return {
      canProceed: false,
      cost: pricing.current_cost,
      useFreeTrial: false,
      freeTrialRemaining: 0,
      reason: `Insufficient ITC balance. Need ${pricing.current_cost} ITC.`
    };
  }

  async consumeFreeTrial(userId: string, featureKey: string): Promise<void> {
    const { error } = await supabase
      .from('imagination_free_trials')
      .update({ uses_remaining: supabase.rpc('decrement', { x: 1 }) })
      .eq('user_id', userId)
      .eq('feature_key', featureKey)
      .gt('uses_remaining', 0);

    // Use raw SQL for atomic decrement
    await supabase.rpc('decrement_free_trial', {
      p_user_id: userId,
      p_feature_key: featureKey
    });
  }

  async deductITC(userId: string, amount: number, reason: string): Promise<void> {
    // Get current balance
    const { data: wallet, error: walletError } = await supabase
      .from('user_wallets')
      .select('itc_balance')
      .eq('user_id', userId)
      .single();

    if (walletError || !wallet) {
      throw new Error('Wallet not found');
    }

    if (wallet.itc_balance < amount) {
      throw new Error('Insufficient ITC balance');
    }

    // Deduct balance
    const newBalance = wallet.itc_balance - amount;
    const { error: updateError } = await supabase
      .from('user_wallets')
      .update({ itc_balance: newBalance })
      .eq('user_id', userId);

    if (updateError) {
      throw new Error(`Failed to deduct ITC: ${updateError.message}`);
    }

    // Log transaction
    await supabase.from('itc_transactions').insert({
      user_id: userId,
      type: 'debit',
      amount: -amount,
      balance_after: newBalance,
      reason: `imagination_station:${reason}`,
      status: 'completed'
    });
  }

  async refundITC(userId: string, amount: number, reason: string): Promise<void> {
    const { data: wallet } = await supabase
      .from('user_wallets')
      .select('itc_balance')
      .eq('user_id', userId)
      .single();

    const newBalance = (wallet?.itc_balance || 0) + amount;

    await supabase
      .from('user_wallets')
      .update({ itc_balance: newBalance })
      .eq('user_id', userId);

    await supabase.from('itc_transactions').insert({
      user_id: userId,
      type: 'credit',
      amount: amount,
      balance_after: newBalance,
      reason: `imagination_station_refund:${reason}`,
      status: 'completed'
    });
  }

  // Admin methods
  async updatePricing(featureKey: string, updates: Partial<PricingConfig>): Promise<PricingConfig> {
    const { data, error } = await supabase
      .from('imagination_pricing')
      .update(updates)
      .eq('feature_key', featureKey)
      .select()
      .single();

    if (error) throw new Error(`Failed to update pricing: ${error.message}`);
    return data;
  }

  async setPromo(durationHours: number): Promise<void> {
    const promoEndTime = new Date(Date.now() + durationHours * 60 * 60 * 1000);

    await supabase
      .from('imagination_pricing')
      .update({
        current_cost: 0,
        promo_end_time: promoEndTime.toISOString()
      })
      .neq('feature_key', 'placeholder');
  }

  async resetToDefaults(): Promise<void> {
    const { data: pricing } = await supabase
      .from('imagination_pricing')
      .select('feature_key, base_cost');

    if (pricing) {
      for (const p of pricing) {
        await supabase
          .from('imagination_pricing')
          .update({ current_cost: p.base_cost, promo_end_time: null })
          .eq('feature_key', p.feature_key);
      }
    }
  }
}

export const pricingService = new ImaginationPricingService();
```

**Step 2: Add helper SQL function for atomic decrement**

Add to migration or run separately:

```sql
CREATE OR REPLACE FUNCTION decrement_free_trial(p_user_id UUID, p_feature_key VARCHAR)
RETURNS VOID AS $$
BEGIN
  UPDATE imagination_free_trials
  SET uses_remaining = uses_remaining - 1
  WHERE user_id = p_user_id
    AND feature_key = p_feature_key
    AND uses_remaining > 0;
END;
$$ LANGUAGE plpgsql;
```

**Step 3: Commit**

```bash
git add backend/services/imagination-pricing.ts
git commit -m "feat(imagination): add ITC pricing service with free trial support"
```

---

### Task 1.4: Create Imagination Station API Routes

**Files:**
- Create: `backend/routes/imagination-station.ts`

**Step 1: Create the routes file**

```typescript
// backend/routes/imagination-station.ts

import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { SHEET_PRESETS, validateSheetSize, PrintType } from '../config/imagination-presets';
import { pricingService } from '../services/imagination-pricing';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB limit

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Middleware to extract user from auth header
const requireAuth = async (req: Request, res: Response, next: Function) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  (req as any).user = user;
  next();
};

// Get sheet presets configuration
router.get('/presets', (req: Request, res: Response) => {
  res.json(SHEET_PRESETS);
});

// Get pricing with user's free trial status
router.get('/pricing', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const pricing = await pricingService.getAllPricing();
    const freeTrials = await pricingService.getUserFreeTrials(user.id);

    res.json({ pricing, freeTrials });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create new sheet
router.post('/sheets', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { name, print_type, sheet_height } = req.body;

    if (!print_type || !SHEET_PRESETS[print_type as PrintType]) {
      return res.status(400).json({ error: 'Invalid print type' });
    }

    const preset = SHEET_PRESETS[print_type as PrintType];
    const height = sheet_height || 48;

    if (!validateSheetSize(print_type as PrintType, height)) {
      return res.status(400).json({ error: 'Invalid sheet height for this print type' });
    }

    const { data, error } = await supabase
      .from('imagination_sheets')
      .insert({
        user_id: user.id,
        name: name || 'Untitled Sheet',
        print_type,
        sheet_width: preset.width,
        sheet_height: height,
        canvas_state: { version: 1, layers: [], gridEnabled: true, snapEnabled: true },
        status: 'draft'
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// List user's sheets
router.get('/sheets', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { status } = req.query;

    let query = supabase
      .from('imagination_sheets')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get single sheet with layers
router.get('/sheets/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;

    const { data: sheet, error: sheetError } = await supabase
      .from('imagination_sheets')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (sheetError || !sheet) {
      return res.status(404).json({ error: 'Sheet not found' });
    }

    const { data: layers } = await supabase
      .from('imagination_layers')
      .select('*')
      .eq('sheet_id', id)
      .order('z_index');

    res.json({ ...sheet, layers: layers || [] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update sheet (auto-save)
router.put('/sheets/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    const { name, canvas_state, thumbnail_url } = req.body;

    const updates: any = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = name;
    if (canvas_state !== undefined) updates.canvas_state = canvas_state;
    if (thumbnail_url !== undefined) updates.thumbnail_url = thumbnail_url;

    const { data, error } = await supabase
      .from('imagination_sheets')
      .update(updates)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete sheet
router.delete('/sheets/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;

    // Only allow deleting drafts
    const { data: sheet } = await supabase
      .from('imagination_sheets')
      .select('status')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (!sheet) {
      return res.status(404).json({ error: 'Sheet not found' });
    }

    if (sheet.status !== 'draft') {
      return res.status(400).json({ error: 'Can only delete draft sheets' });
    }

    await supabase.from('imagination_sheets').delete().eq('id', id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Upload image to sheet
router.post('/sheets/:id/upload', requireAuth, upload.single('image'), async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Verify sheet ownership
    const { data: sheet } = await supabase
      .from('imagination_sheets')
      .select('id')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (!sheet) {
      return res.status(404).json({ error: 'Sheet not found' });
    }

    // Upload to Supabase Storage
    const fileName = `${uuidv4()}-${file.originalname}`;
    const filePath = `imagination-station/${user.id}/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('uploads')
      .upload(filePath, file.buffer, {
        contentType: file.mimetype
      });

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage
      .from('uploads')
      .getPublicUrl(filePath);

    // Create layer record
    const { data: layer, error: layerError } = await supabase
      .from('imagination_layers')
      .insert({
        sheet_id: id,
        layer_type: 'image',
        source_url: publicUrl,
        position_x: 0,
        position_y: 0,
        width: 100, // Will be updated by frontend with actual dimensions
        height: 100,
        z_index: Date.now(),
        metadata: { originalName: file.originalname, mimeType: file.mimetype }
      })
      .select()
      .single();

    if (layerError) throw layerError;
    res.status(201).json(layer);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Submit sheet for production
router.post('/sheets/:id/submit', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;

    const { data: sheet, error } = await supabase
      .from('imagination_sheets')
      .update({ status: 'submitted' })
      .eq('id', id)
      .eq('user_id', user.id)
      .eq('status', 'draft')
      .select()
      .single();

    if (error || !sheet) {
      return res.status(400).json({ error: 'Cannot submit sheet' });
    }

    res.json(sheet);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
```

**Step 2: Register routes in main server**

Add to `backend/index.ts`:

```typescript
import imaginationStationRoutes from './routes/imagination-station';

// Add with other routes
app.use('/api/imagination-station', imaginationStationRoutes);
```

**Step 3: Commit**

```bash
git add backend/routes/imagination-station.ts backend/index.ts
git commit -m "feat(imagination): add core API routes for sheets"
```

---

### Task 1.5: Create AI Operations Service

**Files:**
- Create: `backend/services/imagination-ai.ts`

**Step 1: Create the AI service**

```typescript
// backend/services/imagination-ai.ts

import Replicate from 'replicate';
import { createClient } from '@supabase/supabase-js';
import { pricingService } from './imagination-pricing';
import { AI_STYLES } from '../config/imagination-presets';

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN!
});

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface GenerateImageParams {
  userId: string;
  sheetId: string;
  prompt: string;
  style: string;
  itcBalance: number;
}

export interface ProcessImageParams {
  userId: string;
  sheetId: string;
  layerId: string;
  imageUrl: string;
  itcBalance: number;
}

export class ImaginationAIService {

  async generateImage(params: GenerateImageParams) {
    const { userId, sheetId, prompt, style, itcBalance } = params;

    // Check cost
    const costCheck = await pricingService.checkCost(userId, 'generate', itcBalance);
    if (!costCheck.canProceed) {
      throw new Error(costCheck.reason || 'Cannot proceed with generation');
    }

    // Get style suffix
    const styleConfig = AI_STYLES.find(s => s.key === style) || AI_STYLES[0];
    const enhancedPrompt = `${prompt}, ${styleConfig.prompt_suffix}, transparent background, PNG`;

    try {
      // Deduct cost first (will refund on failure)
      if (costCheck.cost > 0) {
        await pricingService.deductITC(userId, costCheck.cost, 'generate');
      } else if (costCheck.useFreeTrial) {
        await pricingService.consumeFreeTrial(userId, 'generate');
      }

      // Call Replicate Flux model
      const output = await replicate.run(
        "black-forest-labs/flux-1.1-pro" as `${string}/${string}`,
        {
          input: {
            prompt: enhancedPrompt,
            aspect_ratio: "1:1",
            output_format: "png",
            output_quality: 100,
            safety_tolerance: 2,
            prompt_upsampling: true
          }
        }
      );

      const imageUrl = Array.isArray(output) ? output[0] : output;

      // Create layer record
      const { data: layer, error } = await supabase
        .from('imagination_layers')
        .insert({
          sheet_id: sheetId,
          layer_type: 'ai_generated',
          source_url: imageUrl,
          position_x: 0,
          position_y: 0,
          width: 100,
          height: 100,
          z_index: Date.now(),
          metadata: { prompt, style, model: 'flux-1.1-pro' }
        })
        .select()
        .single();

      if (error) throw error;

      // Update sheet ITC spent
      await supabase
        .from('imagination_sheets')
        .update({ itc_spent: supabase.rpc('increment_itc_spent', { amount: costCheck.cost }) })
        .eq('id', sheetId);

      return { layer, cost: costCheck.cost, freeTrialUsed: costCheck.useFreeTrial };

    } catch (error: any) {
      // Refund on failure
      if (costCheck.cost > 0) {
        await pricingService.refundITC(userId, costCheck.cost, 'generate_failed');
      }
      throw error;
    }
  }

  async removeBackground(params: ProcessImageParams) {
    const { userId, sheetId, layerId, imageUrl, itcBalance } = params;

    const costCheck = await pricingService.checkCost(userId, 'bg_remove', itcBalance);
    if (!costCheck.canProceed) {
      throw new Error(costCheck.reason || 'Cannot proceed');
    }

    try {
      if (costCheck.cost > 0) {
        await pricingService.deductITC(userId, costCheck.cost, 'bg_remove');
      } else if (costCheck.useFreeTrial) {
        await pricingService.consumeFreeTrial(userId, 'bg_remove');
      }

      const output = await replicate.run(
        "lucataco/remove-bg:95fcc2a26d3899cd6c2691c900465aaeff466285a65c14638cc5f36f34befaf1" as `${string}/${string}`,
        {
          input: {
            image: imageUrl
          }
        }
      );

      const processedUrl = Array.isArray(output) ? output[0] : output;

      // Update layer
      const { data: layer, error } = await supabase
        .from('imagination_layers')
        .update({ processed_url: processedUrl })
        .eq('id', layerId)
        .select()
        .single();

      if (error) throw error;

      return { layer, cost: costCheck.cost, freeTrialUsed: costCheck.useFreeTrial };

    } catch (error: any) {
      if (costCheck.cost > 0) {
        await pricingService.refundITC(userId, costCheck.cost, 'bg_remove_failed');
      }
      throw error;
    }
  }

  async upscaleImage(params: ProcessImageParams & { scaleFactor: number }) {
    const { userId, sheetId, layerId, imageUrl, itcBalance, scaleFactor } = params;

    const featureKey = scaleFactor >= 4 ? 'upscale_4x' : 'upscale_2x';
    const costCheck = await pricingService.checkCost(userId, featureKey, itcBalance);

    if (!costCheck.canProceed) {
      throw new Error(costCheck.reason || 'Cannot proceed');
    }

    try {
      if (costCheck.cost > 0) {
        await pricingService.deductITC(userId, costCheck.cost, featureKey);
      } else if (costCheck.useFreeTrial) {
        await pricingService.consumeFreeTrial(userId, featureKey);
      }

      const output = await replicate.run(
        "nightmareai/real-esrgan:f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa" as `${string}/${string}`,
        {
          input: {
            image: imageUrl,
            scale: scaleFactor,
            face_enhance: false
          }
        }
      );

      const processedUrl = Array.isArray(output) ? output[0] : output;

      const { data: layer, error } = await supabase
        .from('imagination_layers')
        .update({ processed_url: processedUrl })
        .eq('id', layerId)
        .select()
        .single();

      if (error) throw error;

      return { layer, cost: costCheck.cost, freeTrialUsed: costCheck.useFreeTrial };

    } catch (error: any) {
      if (costCheck.cost > 0) {
        await pricingService.refundITC(userId, costCheck.cost, `${featureKey}_failed`);
      }
      throw error;
    }
  }

  async enhanceImage(params: ProcessImageParams) {
    const { userId, sheetId, layerId, imageUrl, itcBalance } = params;

    const costCheck = await pricingService.checkCost(userId, 'enhance', itcBalance);
    if (!costCheck.canProceed) {
      throw new Error(costCheck.reason || 'Cannot proceed');
    }

    try {
      if (costCheck.cost > 0) {
        await pricingService.deductITC(userId, costCheck.cost, 'enhance');
      } else if (costCheck.useFreeTrial) {
        await pricingService.consumeFreeTrial(userId, 'enhance');
      }

      // Use Real-ESRGAN with face enhance for general enhancement
      const output = await replicate.run(
        "nightmareai/real-esrgan:f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa" as `${string}/${string}`,
        {
          input: {
            image: imageUrl,
            scale: 2,
            face_enhance: true
          }
        }
      );

      const processedUrl = Array.isArray(output) ? output[0] : output;

      const { data: layer, error } = await supabase
        .from('imagination_layers')
        .update({ processed_url: processedUrl })
        .eq('id', layerId)
        .select()
        .single();

      if (error) throw error;

      return { layer, cost: costCheck.cost, freeTrialUsed: costCheck.useFreeTrial };

    } catch (error: any) {
      if (costCheck.cost > 0) {
        await pricingService.refundITC(userId, costCheck.cost, 'enhance_failed');
      }
      throw error;
    }
  }
}

export const aiService = new ImaginationAIService();
```

**Step 2: Commit**

```bash
git add backend/services/imagination-ai.ts
git commit -m "feat(imagination): add AI operations service with Replicate integration"
```

---

### Task 1.6: Add AI Routes to API

**Files:**
- Modify: `backend/routes/imagination-station.ts`

**Step 1: Add AI endpoint handlers**

Add these routes to the existing imagination-station.ts file:

```typescript
// Add import at top
import { aiService } from '../services/imagination-ai';

// Add these routes after the existing routes

// Generate image with Mr. Imagine
router.post('/sheets/:id/generate', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    const { prompt, style } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Verify sheet ownership
    const { data: sheet } = await supabase
      .from('imagination_sheets')
      .select('id')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (!sheet) {
      return res.status(404).json({ error: 'Sheet not found' });
    }

    // Get user's ITC balance
    const { data: wallet } = await supabase
      .from('user_wallets')
      .select('itc_balance')
      .eq('user_id', user.id)
      .single();

    const result = await aiService.generateImage({
      userId: user.id,
      sheetId: id,
      prompt,
      style: style || 'realistic',
      itcBalance: wallet?.itc_balance || 0
    });

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Remove background
router.post('/sheets/:id/remove-bg', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    const { layer_id } = req.body;

    if (!layer_id) {
      return res.status(400).json({ error: 'layer_id is required' });
    }

    // Get layer
    const { data: layer } = await supabase
      .from('imagination_layers')
      .select('*, imagination_sheets!inner(user_id)')
      .eq('id', layer_id)
      .eq('sheet_id', id)
      .single();

    if (!layer || (layer as any).imagination_sheets.user_id !== user.id) {
      return res.status(404).json({ error: 'Layer not found' });
    }

    const { data: wallet } = await supabase
      .from('user_wallets')
      .select('itc_balance')
      .eq('user_id', user.id)
      .single();

    const imageUrl = layer.processed_url || layer.source_url;
    const result = await aiService.removeBackground({
      userId: user.id,
      sheetId: id,
      layerId: layer_id,
      imageUrl,
      itcBalance: wallet?.itc_balance || 0
    });

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Upscale image
router.post('/sheets/:id/upscale', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    const { layer_id, scale_factor } = req.body;

    if (!layer_id) {
      return res.status(400).json({ error: 'layer_id is required' });
    }

    const scaleFactor = scale_factor || 2;
    if (![2, 4].includes(scaleFactor)) {
      return res.status(400).json({ error: 'scale_factor must be 2 or 4' });
    }

    const { data: layer } = await supabase
      .from('imagination_layers')
      .select('*, imagination_sheets!inner(user_id)')
      .eq('id', layer_id)
      .eq('sheet_id', id)
      .single();

    if (!layer || (layer as any).imagination_sheets.user_id !== user.id) {
      return res.status(404).json({ error: 'Layer not found' });
    }

    const { data: wallet } = await supabase
      .from('user_wallets')
      .select('itc_balance')
      .eq('user_id', user.id)
      .single();

    const imageUrl = layer.processed_url || layer.source_url;
    const result = await aiService.upscaleImage({
      userId: user.id,
      sheetId: id,
      layerId: layer_id,
      imageUrl,
      itcBalance: wallet?.itc_balance || 0,
      scaleFactor
    });

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Enhance image
router.post('/sheets/:id/enhance', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    const { layer_id } = req.body;

    if (!layer_id) {
      return res.status(400).json({ error: 'layer_id is required' });
    }

    const { data: layer } = await supabase
      .from('imagination_layers')
      .select('*, imagination_sheets!inner(user_id)')
      .eq('id', layer_id)
      .eq('sheet_id', id)
      .single();

    if (!layer || (layer as any).imagination_sheets.user_id !== user.id) {
      return res.status(404).json({ error: 'Layer not found' });
    }

    const { data: wallet } = await supabase
      .from('user_wallets')
      .select('itc_balance')
      .eq('user_id', user.id)
      .single();

    const imageUrl = layer.processed_url || layer.source_url;
    const result = await aiService.enhanceImage({
      userId: user.id,
      sheetId: id,
      layerId: layer_id,
      imageUrl,
      itcBalance: wallet?.itc_balance || 0
    });

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
```

**Step 2: Commit**

```bash
git add backend/routes/imagination-station.ts
git commit -m "feat(imagination): add AI operation endpoints (generate, remove-bg, upscale, enhance)"
```

---

## End of Phase 1

Phase 1 establishes the complete backend foundation:
- Database tables with RLS
- Sheet presets configuration
- ITC pricing service with free trials
- Core API routes for sheet CRUD
- AI operations service with Replicate
- AI endpoints integrated

**Next:** Phase 2 - Canvas Core (Frontend)

---

## Phase 2: Canvas Core (Frontend)

### Task 2.1: Create TypeScript Types

**Files:**
- Modify: `src/types/index.ts`

**Step 1: Add Imagination Station types**

```typescript
// Add to src/types/index.ts

// Imagination Station Types
export type PrintType = 'dtf' | 'uv_dtf' | 'sublimation';
export type SheetStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'printed';
export type LayerType = 'image' | 'ai_generated' | 'text';

export interface ImaginationSheet {
  id: string;
  user_id: string;
  name: string;
  print_type: PrintType;
  sheet_width: number;
  sheet_height: number;
  canvas_state: CanvasState | null;
  thumbnail_url: string | null;
  status: SheetStatus;
  itc_spent: number;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
  layers?: ImaginationLayer[];
}

export interface ImaginationLayer {
  id: string;
  sheet_id: string;
  layer_type: LayerType;
  source_url: string | null;
  processed_url: string | null;
  position_x: number;
  position_y: number;
  width: number;
  height: number;
  rotation: number;
  scale_x: number;
  scale_y: number;
  z_index: number;
  metadata: Record<string, any> | null;
  created_at: string;
}

export interface CanvasState {
  version: number;
  timestamp?: string;
  stage: {
    width: number;
    height: number;
    scale: number;
    position: { x: number; y: number };
  };
  layers: CanvasLayerState[];
  gridEnabled: boolean;
  snapEnabled: boolean;
}

export interface CanvasLayerState {
  id: string;
  type: LayerType;
  attrs: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    scaleX: number;
    scaleY: number;
  };
  src?: string;
  text?: string;
}

export interface ImaginationPricing {
  feature_key: string;
  display_name: string;
  base_cost: number;
  current_cost: number;
  is_free_trial: boolean;
  free_trial_uses: number;
  promo_end_time: string | null;
}

export interface FreeTrialStatus {
  feature_key: string;
  uses_remaining: number;
}

export interface PrintTypePreset {
  width: number;
  heights: number[];
  rules: {
    mirror: boolean;
    whiteInk: boolean;
    cutlineOption?: boolean;
    minDPI: number;
  };
  displayName: string;
  description: string;
}

export interface AIStyle {
  key: string;
  label: string;
  prompt_suffix: string;
}
```

**Step 2: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(imagination): add TypeScript types for Imagination Station"
```

---

### Task 2.2: Create API Client Functions

**Files:**
- Modify: `src/lib/api.ts`

**Step 1: Add Imagination Station API functions**

```typescript
// Add to src/lib/api.ts

// Imagination Station API
export const imaginationApi = {
  // Presets & Pricing
  getPresets: () => api.get('/imagination-station/presets'),
  getPricing: () => api.get('/imagination-station/pricing'),

  // Sheet CRUD
  createSheet: (data: { name?: string; print_type: string; sheet_height: number }) =>
    api.post('/imagination-station/sheets', data),

  getSheets: (status?: string) =>
    api.get('/imagination-station/sheets', { params: { status } }),

  getSheet: (id: string) =>
    api.get(`/imagination-station/sheets/${id}`),

  updateSheet: (id: string, data: { name?: string; canvas_state?: any; thumbnail_url?: string }) =>
    api.put(`/imagination-station/sheets/${id}`, data),

  deleteSheet: (id: string) =>
    api.delete(`/imagination-station/sheets/${id}`),

  // Layer operations
  uploadImage: (sheetId: string, file: File) => {
    const formData = new FormData();
    formData.append('image', file);
    return api.post(`/imagination-station/sheets/${sheetId}/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },

  // AI operations
  generateImage: (sheetId: string, prompt: string, style: string) =>
    api.post(`/imagination-station/sheets/${sheetId}/generate`, { prompt, style }),

  removeBackground: (sheetId: string, layerId: string) =>
    api.post(`/imagination-station/sheets/${sheetId}/remove-bg`, { layer_id: layerId }),

  upscaleImage: (sheetId: string, layerId: string, scaleFactor: number) =>
    api.post(`/imagination-station/sheets/${sheetId}/upscale`, { layer_id: layerId, scale_factor: scaleFactor }),

  enhanceImage: (sheetId: string, layerId: string) =>
    api.post(`/imagination-station/sheets/${sheetId}/enhance`, { layer_id: layerId }),

  // Layout operations
  autoLayout: (sheetId: string) =>
    api.post(`/imagination-station/sheets/${sheetId}/auto-layout`),

  smartFill: (sheetId: string, layerId: string) =>
    api.post(`/imagination-station/sheets/${sheetId}/smart-fill`, { layer_id: layerId }),

  // Export & Submit
  exportSheet: (sheetId: string, format: 'png' | 'pdf', options?: { include_cutlines?: boolean; mirror?: boolean }) =>
    api.post(`/imagination-station/sheets/${sheetId}/export`, { format, ...options }),

  submitSheet: (sheetId: string) =>
    api.post(`/imagination-station/sheets/${sheetId}/submit`),
};
```

**Step 2: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat(imagination): add API client functions"
```

---

### Task 2.3: Create Main Imagination Station Page Shell

**Files:**
- Create: `src/pages/ImaginationStation.tsx`

**Step 1: Create the page component**

```typescript
// src/pages/ImaginationStation.tsx

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/SupabaseAuthContext';
import { imaginationApi } from '@/lib/api';
import {
  ImaginationSheet,
  ImaginationLayer,
  CanvasState,
  PrintType,
  ImaginationPricing,
  FreeTrialStatus
} from '@/types';

// Components (to be created)
import SheetCanvas from '@/components/imagination/SheetCanvas';
import LeftSidebar from '@/components/imagination/LeftSidebar';
import RightSidebar from '@/components/imagination/RightSidebar';
import SaveStatus from '@/components/imagination/SaveStatus';

type SaveStatusType = 'saved' | 'saving' | 'unsaved' | 'offline' | 'error';

const ImaginationStation: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, itcBalance } = useAuth();

  // Sheet state
  const [sheet, setSheet] = useState<ImaginationSheet | null>(null);
  const [layers, setLayers] = useState<ImaginationLayer[]>([]);
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]);

  // Canvas state
  const [canvasState, setCanvasState] = useState<CanvasState | null>(null);
  const [zoom, setZoom] = useState(1);
  const [gridEnabled, setGridEnabled] = useState(true);
  const [snapEnabled, setSnapEnabled] = useState(true);

  // History for undo/redo
  const [history, setHistory] = useState<{ past: CanvasState[]; future: CanvasState[] }>({ past: [], future: [] });

  // Save status
  const [saveStatus, setSaveStatus] = useState<SaveStatusType>('saved');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  // Pricing
  const [pricing, setPricing] = useState<ImaginationPricing[]>([]);
  const [freeTrials, setFreeTrials] = useState<FreeTrialStatus[]>([]);

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
      setSheet(data);
      setLayers(data.layers || []);
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
      setPricing(data.pricing || []);
      setFreeTrials(data.freeTrials || []);
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
              className="bg-card border border-primary/30 rounded-xl p-6 hover:border-primary transition-colors text-left"
            >
              <h3 className="text-xl font-bold text-text mb-2">DTF</h3>
              <p className="text-muted text-sm mb-4">Direct-to-Film transfers. 22.5" width.</p>
              <span className="text-primary text-sm">Create Sheet →</span>
            </button>

            {/* UV DTF */}
            <button
              onClick={() => createSheet('uv_dtf', 24)}
              className="bg-card border border-secondary/30 rounded-xl p-6 hover:border-secondary transition-colors text-left"
            >
              <h3 className="text-xl font-bold text-text mb-2">UV DTF</h3>
              <p className="text-muted text-sm mb-4">Stickers & hard surfaces. 16" width.</p>
              <span className="text-secondary text-sm">Create Sheet →</span>
            </button>

            {/* Sublimation */}
            <button
              onClick={() => createSheet('sublimation', 48)}
              className="bg-card border border-accent/30 rounded-xl p-6 hover:border-accent transition-colors text-left"
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
            value={sheet.name}
            onChange={(e) => setSheet({ ...sheet, name: e.target.value })}
            onBlur={() => imaginationApi.updateSheet(sheet.id, { name: sheet.name })}
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
        {/* Left Sidebar */}
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

        {/* Canvas */}
        <div className="flex-1 relative">
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
          />

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

        {/* Right Sidebar */}
        <RightSidebar
          sheet={sheet}
          layers={layers}
          setLayers={setLayers}
          selectedLayerIds={selectedLayerIds}
          pricing={pricing}
          freeTrials={freeTrials}
          itcBalance={itcBalance || 0}
          isProcessing={isProcessing}
          setIsProcessing={setIsProcessing}
        />
      </div>
    </div>
  );
};

export default ImaginationStation;
```

**Step 2: Add route to App.tsx**

```typescript
// Add to src/App.tsx
import ImaginationStation from '@/pages/ImaginationStation';

// Add routes
<Route path="/imagination-station" element={<ProtectedRoute><ImaginationStation /></ProtectedRoute>} />
<Route path="/imagination-station/:id" element={<ProtectedRoute><ImaginationStation /></ProtectedRoute>} />
```

**Step 3: Commit**

```bash
git add src/pages/ImaginationStation.tsx src/App.tsx
git commit -m "feat(imagination): add main page shell with state management"
```

---

### Task 2.4: Create SheetCanvas Component

**Files:**
- Create: `src/components/imagination/SheetCanvas.tsx`

**Step 1: Create the canvas component**

```typescript
// src/components/imagination/SheetCanvas.tsx

import React, { useRef, useEffect, useCallback } from 'react';
import { Stage, Layer, Rect, Image, Transformer, Line } from 'react-konva';
import Konva from 'konva';
import useImage from 'use-image';
import { ImaginationSheet, ImaginationLayer, CanvasState } from '@/types';

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
```

**Step 2: Install use-image if not present**

```bash
npm install use-image
```

**Step 3: Commit**

```bash
git add src/components/imagination/SheetCanvas.tsx package.json
git commit -m "feat(imagination): add Konva canvas component with zoom, grid, and layer rendering"
```

---

## End of Phase 2

Phase 2 establishes the frontend canvas foundation:
- TypeScript types
- API client functions
- Main page with state management
- Konva canvas with layers, zoom, grid

**Next:** Phase 3 - UI Components (Sidebars, Panels)

---

## Phase 3-6: Continue in Separate Implementation Sessions

Due to the size of this feature, Phases 3-6 will be implemented using the subagent-driven approach. Each phase focuses on:

- **Phase 3:** Left Sidebar, Right Sidebar, Layers Panel
- **Phase 4:** Mr. Imagine Panel, Nano Banana Tools, ITC Flow
- **Phase 5:** Auto-Layout Algorithm, Smart Fill, Export to GCS
- **Phase 6:** Admin Dashboard Tab, Pricing Config, Analytics

---

## Execution

**Plan complete and saved to `docs/plans/2025-12-11-imagination-station-implementation.md`**

**Recommended approach: Parallel Agents**

Launch multiple agents to work on independent workstreams simultaneously:

1. **Agent 1 (Backend):** Phase 1 - Database migration, API routes, services
2. **Agent 2 (Frontend Core):** Phase 2 - Types, API client, main page, canvas
3. **Agent 3 (Frontend UI):** Phase 3 - Sidebars and panels (after Phase 2 scaffolding)
4. **Agent 4 (AI Integration):** Phase 4 - AI panels and ITC flow
5. **Agent 5 (Export/Admin):** Phase 5-6 - Export, GCS, admin dashboard
