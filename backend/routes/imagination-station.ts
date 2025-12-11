// backend/routes/imagination-station.ts

import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { SHEET_PRESETS, validateSheetSize, PrintType } from '../config/imagination-presets';
import { pricingService } from '../services/imagination-pricing';
import { aiService } from '../services/imagination-ai';

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

// AI Operations

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

export default router;
