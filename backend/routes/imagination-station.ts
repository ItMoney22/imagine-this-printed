// backend/routes/imagination-station.ts

import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { SHEET_PRESETS, validateSheetSize, PrintType } from '../config/imagination-presets';
import { pricingService } from '../services/imagination-pricing';
import { aiService } from '../services/imagination-ai';
import { layoutService } from '../services/imagination-layout';
import gcsStorage from '../services/gcs-storage';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB limit

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Middleware to extract user from auth header
const requireAuth = async (req: Request, res: Response, next: Function): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const token = authHeader.split(' ')[1];
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    res.status(401).json({ error: 'Invalid token' });
    return;
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
router.post('/sheets', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user;
    const { name, print_type, sheet_height } = req.body;

    if (!print_type || !SHEET_PRESETS[print_type as PrintType]) {
      res.status(400).json({ error: 'Invalid print type' });
      return;
    }

    const preset = SHEET_PRESETS[print_type as PrintType];
    const height = sheet_height || 48;

    if (!validateSheetSize(print_type as PrintType, height)) {
      res.status(400).json({ error: 'Invalid sheet height for this print type' });
      return;
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
router.get('/sheets/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
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
      res.status(404).json({ error: 'Sheet not found' });
      return;
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
router.delete('/sheets/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
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
      res.status(404).json({ error: 'Sheet not found' });
      return;
    }

    if (sheet.status !== 'draft') {
      res.status(400).json({ error: 'Can only delete draft sheets' });
      return;
    }

    await supabase.from('imagination_sheets').delete().eq('id', id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Upload image to sheet
router.post('/sheets/:id/upload', requireAuth, upload.single('image'), async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    // Verify sheet ownership
    const { data: sheet } = await supabase
      .from('imagination_sheets')
      .select('id')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (!sheet) {
      res.status(404).json({ error: 'Sheet not found' });
      return;
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
router.post('/sheets/:id/submit', requireAuth, async (req: Request, res: Response): Promise<void> => {
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
      res.status(400).json({ error: 'Cannot submit sheet' });
      return;
    }

    res.json(sheet);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Project Management Endpoints (alias for sheets with enhanced functionality)

// Save project - Save sheet with canvas state, layers, and thumbnail
router.post('/projects/save', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user;
    const { sheetId, name, canvasState, thumbnailBase64, layers, metadata } = req.body;

    if (!sheetId) {
      res.status(400).json({ error: 'sheetId is required' });
      return;
    }

    // Verify sheet ownership
    const { data: sheet } = await supabase
      .from('imagination_sheets')
      .select('id, user_id, print_type, sheet_width, sheet_height')
      .eq('id', sheetId)
      .eq('user_id', user.id)
      .single();

    if (!sheet) {
      res.status(404).json({ error: 'Sheet not found' });
      return;
    }

    // Handle thumbnail upload if provided
    let thumbnailUrl = null;
    if (thumbnailBase64) {
      try {
        // Upload to Google Cloud Storage
        const fileName = `${sheetId}-thumb-${Date.now()}.png`;
        const uploadResult = await gcsStorage.uploadFromDataUrl(thumbnailBase64, {
          userId: user.id,
          folder: 'thumbnails',
          filename: fileName,
          metadata: {
            sheetId,
            type: 'imagination-station-thumbnail'
          }
        });
        thumbnailUrl = uploadResult.publicUrl;
        console.log('[imagination-station] Thumbnail uploaded to GCS:', thumbnailUrl);
      } catch (error) {
        console.error('Error uploading thumbnail to GCS:', error);
        // Continue without thumbnail if it fails
      }
    }

    // Update sheet with canvas state and thumbnail
    const updates: any = {
      updated_at: new Date().toISOString()
    };

    if (name) updates.name = name;
    if (canvasState) updates.canvas_state = canvasState;
    if (thumbnailUrl) updates.thumbnail_url = thumbnailUrl;
    if (metadata) updates.admin_notes = JSON.stringify(metadata);

    const { data: updatedSheet, error: updateError } = await supabase
      .from('imagination_sheets')
      .update(updates)
      .eq('id', sheetId)
      .eq('user_id', user.id)
      .select()
      .single();

    if (updateError) throw updateError;

    // Optionally save layers if provided (for future persistence)
    // For now, layers are stored in canvas_state
    // In the future, we could persist individual layers to imagination_layers table

    res.json({
      success: true,
      project: updatedSheet,
      message: 'Project saved successfully'
    });
  } catch (error: any) {
    console.error('Save project error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Load project - Get sheet with full canvas state
router.get('/projects/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user;
    const { id } = req.params;

    const { data: sheet, error } = await supabase
      .from('imagination_sheets')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (error || !sheet) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Optionally load layers from imagination_layers table if they exist
    const { data: layers } = await supabase
      .from('imagination_layers')
      .select('*')
      .eq('sheet_id', id)
      .order('z_index');

    res.json({
      ...sheet,
      layers: layers || []
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// List user's projects
router.get('/projects', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { status, limit } = req.query;

    let query = supabase
      .from('imagination_sheets')
      .select('id, name, print_type, sheet_width, sheet_height, thumbnail_url, status, created_at, updated_at, canvas_state')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    if (limit) {
      query = query.limit(parseInt(limit as string));
    }

    const { data, error } = await query;

    if (error) throw error;

    // Add layer count to each project
    const projectsWithMeta = await Promise.all((data || []).map(async (project) => {
      const layerCount = project.canvas_state?.layers?.length || 0;
      return {
        ...project,
        layerCount,
        lastModified: project.updated_at
      };
    }));

    res.json(projectsWithMeta);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// AI Operations

// Generate image with Mr. Imagine (standalone, no sheet required)
router.post('/ai/generate', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user;
    const { prompt, style, useTrial } = req.body;

    if (!prompt) {
      res.status(400).json({ error: 'Prompt is required' });
      return;
    }

    // Get user's ITC balance
    const { data: wallet } = await supabase
      .from('user_wallets')
      .select('itc_balance')
      .eq('user_id', user.id)
      .single();

    // For standalone generation, we'll create a temporary sheet or just return the URL
    // Let's just generate and return the image URL without persisting to a sheet
    const result = await aiService.generateImage({
      userId: user.id,
      sheetId: 'standalone', // Mark as standalone generation
      prompt,
      style: style || 'realistic',
      itcBalance: wallet?.itc_balance || 0
    });

    // Extract the image URL from the result
    const imageUrl = result.layer?.source_url || result.layer?.processed_url;

    res.json({
      imageUrl,
      url: imageUrl,
      output: imageUrl,
      cost: result.cost,
      freeTrialUsed: result.freeTrialUsed
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Generate image with Mr. Imagine (sheet-based, legacy)
router.post('/sheets/:id/generate', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    const { prompt, style } = req.body;

    if (!prompt) {
      res.status(400).json({ error: 'Prompt is required' });
      return;
    }

    // Verify sheet ownership
    const { data: sheet } = await supabase
      .from('imagination_sheets')
      .select('id')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (!sheet) {
      res.status(404).json({ error: 'Sheet not found' });
      return;
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

// Remove background (standalone, no sheet/layer required)
router.post('/ai/remove-bg', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user;
    const { imageUrl, useTrial } = req.body;

    if (!imageUrl) {
      res.status(400).json({ error: 'imageUrl is required' });
      return;
    }

    const { data: wallet } = await supabase
      .from('user_wallets')
      .select('itc_balance')
      .eq('user_id', user.id)
      .single();

    const result = await aiService.removeBackground({
      userId: user.id,
      sheetId: 'standalone',
      layerId: 'standalone',
      imageUrl,
      itcBalance: wallet?.itc_balance || 0
    });

    // Return the processed image URL - include processedUrl for frontend compatibility
    const processedUrl = result.layer?.processed_url || imageUrl;

    res.json({
      processedUrl,
      imageUrl: processedUrl,
      url: processedUrl,
      output: processedUrl,
      originalUrl: imageUrl,
      cost: result.cost,
      freeTrialUsed: result.freeTrialUsed
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Remove background (sheet-based, legacy)
router.post('/sheets/:id/remove-bg', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    const { layer_id } = req.body;

    if (!layer_id) {
      res.status(400).json({ error: 'layer_id is required' });
      return;
    }

    // Get layer
    const { data: layer } = await supabase
      .from('imagination_layers')
      .select('*, imagination_sheets!inner(user_id)')
      .eq('id', layer_id)
      .eq('sheet_id', id)
      .single();

    if (!layer || (layer as any).imagination_sheets.user_id !== user.id) {
      res.status(404).json({ error: 'Layer not found' });
      return;
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

// Upscale image (standalone, no sheet/layer required)
router.post('/ai/upscale', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user;
    const { imageUrl, factor, useTrial } = req.body;

    if (!imageUrl) {
      res.status(400).json({ error: 'imageUrl is required' });
      return;
    }

    const scaleFactor = factor || 2;
    if (![2, 4].includes(scaleFactor)) {
      res.status(400).json({ error: 'factor must be 2 or 4' });
      return;
    }

    const { data: wallet } = await supabase
      .from('user_wallets')
      .select('itc_balance')
      .eq('user_id', user.id)
      .single();

    const result = await aiService.upscaleImage({
      userId: user.id,
      sheetId: 'standalone',
      layerId: 'standalone',
      imageUrl,
      itcBalance: wallet?.itc_balance || 0,
      scaleFactor
    });

    // Return the processed image URL - include processedUrl for frontend compatibility
    // Also include scaleFactor for dimension recalculation on frontend
    const processedUrl = result.layer?.processed_url || imageUrl;

    res.json({
      processedUrl,
      imageUrl: processedUrl,
      url: processedUrl,
      output: processedUrl,
      originalUrl: imageUrl,
      scaleFactor,
      cost: result.cost,
      freeTrialUsed: result.freeTrialUsed
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Upscale image (sheet-based, legacy)
router.post('/sheets/:id/upscale', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    const { layer_id, scale_factor } = req.body;

    if (!layer_id) {
      res.status(400).json({ error: 'layer_id is required' });
      return;
    }

    const scaleFactor = scale_factor || 2;
    if (![2, 4].includes(scaleFactor)) {
      res.status(400).json({ error: 'scale_factor must be 2 or 4' });
      return;
    }

    const { data: layer } = await supabase
      .from('imagination_layers')
      .select('*, imagination_sheets!inner(user_id)')
      .eq('id', layer_id)
      .eq('sheet_id', id)
      .single();

    if (!layer || (layer as any).imagination_sheets.user_id !== user.id) {
      res.status(404).json({ error: 'Layer not found' });
      return;
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

// Enhance image (standalone, no sheet/layer required)
router.post('/ai/enhance', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user;
    const { imageUrl, useTrial } = req.body;

    if (!imageUrl) {
      res.status(400).json({ error: 'imageUrl is required' });
      return;
    }

    const { data: wallet } = await supabase
      .from('user_wallets')
      .select('itc_balance')
      .eq('user_id', user.id)
      .single();

    const result = await aiService.enhanceImage({
      userId: user.id,
      sheetId: 'standalone',
      layerId: 'standalone',
      imageUrl,
      itcBalance: wallet?.itc_balance || 0
    });

    // Return the processed image URL - include processedUrl for frontend compatibility
    const processedUrl = result.layer?.processed_url || imageUrl;

    res.json({
      processedUrl,
      imageUrl: processedUrl,
      url: processedUrl,
      output: processedUrl,
      originalUrl: imageUrl,
      cost: result.cost,
      freeTrialUsed: result.freeTrialUsed
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Enhance image (sheet-based, legacy)
router.post('/sheets/:id/enhance', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    const { layer_id } = req.body;

    if (!layer_id) {
      res.status(400).json({ error: 'layer_id is required' });
      return;
    }

    const { data: layer } = await supabase
      .from('imagination_layers')
      .select('*, imagination_sheets!inner(user_id)')
      .eq('id', layer_id)
      .eq('sheet_id', id)
      .single();

    if (!layer || (layer as any).imagination_sheets.user_id !== user.id) {
      res.status(404).json({ error: 'Layer not found' });
      return;
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

// Layout Operations

// Auto-Nest - Optimize layer positions with grid-based packing
router.post('/layout/auto-nest', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user;
    const { sheetWidth, sheetHeight, layers, padding } = req.body;

    if (!sheetWidth || !sheetHeight || !Array.isArray(layers)) {
      res.status(400).json({ error: 'sheetWidth, sheetHeight, and layers array are required' });
      return;
    }

    if (layers.length === 0) {
      res.status(400).json({ error: 'At least one layer is required' });
      return;
    }

    // Validate layer data
    for (const layer of layers) {
      if (!layer.id || typeof layer.width !== 'number' || typeof layer.height !== 'number') {
        res.status(400).json({ error: 'Each layer must have id, width, and height' });
        return;
      }
    }

    // Get user's ITC balance
    const { data: wallet } = await supabase
      .from('user_wallets')
      .select('itc_balance')
      .eq('user_id', user.id)
      .single();

    const itcBalance = wallet?.itc_balance || 0;

    // Perform auto-nest with pricing
    const result = await layoutService.autoNestWithPricing(
      user.id,
      'sheet-id', // We don't need sheet ID for this operation
      sheetWidth,
      sheetHeight,
      layers,
      padding || 0.125,
      itcBalance
    );

    // Deduct ITC if charged
    if (result.itcCharged > 0) {
      await supabase
        .from('user_wallets')
        .update({ itc_balance: itcBalance - result.itcCharged })
        .eq('user_id', user.id);

      // Log transaction
      await supabase.from('wallet_transactions').insert({
        user_id: user.id,
        transaction_type: 'spend',
        amount: result.itcCharged,
        description: 'Auto-Nest layout optimization',
        metadata: { feature: 'auto_nest', layerCount: layers.length }
      });
    }

    res.json({
      positions: result.positions,
      efficiency: result.efficiency,
      wastedSpace: result.wastedSpace,
      itcCharged: result.itcCharged
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Smart Fill - Fill empty space with duplicates
router.post('/layout/smart-fill', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user;
    const { sheetWidth, sheetHeight, layers, padding } = req.body;

    if (!sheetWidth || !sheetHeight || !Array.isArray(layers)) {
      res.status(400).json({ error: 'sheetWidth, sheetHeight, and layers array are required' });
      return;
    }

    if (layers.length === 0) {
      res.status(400).json({ error: 'At least one layer is required' });
      return;
    }

    // Validate layer data
    for (const layer of layers) {
      if (!layer.id || typeof layer.width !== 'number' || typeof layer.height !== 'number') {
        res.status(400).json({ error: 'Each layer must have id, width, and height' });
        return;
      }
    }

    // Get user's ITC balance
    const { data: wallet } = await supabase
      .from('user_wallets')
      .select('itc_balance')
      .eq('user_id', user.id)
      .single();

    const itcBalance = wallet?.itc_balance || 0;

    // Perform smart fill with pricing
    const result = await layoutService.smartFillWithPricing(
      user.id,
      'sheet-id',
      sheetWidth,
      sheetHeight,
      layers,
      padding || 0.125,
      itcBalance
    );

    // Deduct ITC if charged
    if (result.itcCharged > 0) {
      await supabase
        .from('user_wallets')
        .update({ itc_balance: itcBalance - result.itcCharged })
        .eq('user_id', user.id);

      // Log transaction
      await supabase.from('wallet_transactions').insert({
        user_id: user.id,
        transaction_type: 'spend',
        amount: result.itcCharged,
        description: 'Smart Fill layout optimization',
        metadata: { feature: 'smart_fill', duplicatesAdded: result.totalAdded }
      });
    }

    res.json({
      duplicates: result.duplicates,
      coverage: result.coverage,
      totalAdded: result.totalAdded,
      itcCharged: result.itcCharged
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Reimagine Image (Nano Banana) - Add elements to existing images using AI
router.post('/ai/reimagine', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user;
    const { imageUrl, prompt, useTrial } = req.body;

    if (!imageUrl) {
      res.status(400).json({ error: 'imageUrl is required' });
      return;
    }

    if (!prompt) {
      res.status(400).json({ error: 'prompt is required' });
      return;
    }

    // Get user's ITC balance
    const { data: wallet } = await supabase
      .from('user_wallets')
      .select('itc_balance')
      .eq('user_id', user.id)
      .single();

    const result = await aiService.reimagineImage({
      userId: user.id,
      sheetId: 'standalone',
      layerId: 'standalone',
      imageUrl,
      itcBalance: wallet?.itc_balance || 0,
      prompt
    });

    // Return with processedUrl key for frontend consistency
    res.json({
      processedUrl: result.layer.processed_url,
      originalUrl: imageUrl,
      cost: result.cost,
      freeTrialUsed: result.freeTrialUsed
    });
  } catch (error: any) {
    console.error('[imagination-station] reimagine error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
