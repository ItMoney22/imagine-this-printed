// backend/routes/imagination-station.ts

import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { PrintType } from '../config/imagination-presets.js';
import { imaginationProducts } from '../services/imagination-products.js';
import { pricingService } from '../services/imagination-pricing.js';
import { aiService } from '../services/imagination-ai.js';
import { brainstormDesign, randomDesignIdea } from '../services/imagine-brain.js';
import { applyHalftone } from '../services/halftone.js';
import { detectSolidBg } from '../services/bg-key.js';
import { editOpenAIImage } from '../services/image-flow/providers/openai-image.js';
import { layoutService } from '../services/imagination-layout.js';
import gcsStorage from '../services/gcs-storage.js';
import { uploadImageFromBase64, uploadImageFromBuffer } from '../services/google-cloud-storage.js'

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
router.get('/presets', async (req: Request, res: Response) => {
  try {
    // getAllProducts falls back to static config on DB error, but wrap in its
    // own try/catch as defence-in-depth in case the table doesn't exist at all
    // and the service throws unexpectedly.
    let products;
    try {
      products = await imaginationProducts.getAllProducts();
    } catch (dbErr: unknown) {
      console.warn('[imagination-station] /presets DB query failed, using static config:', dbErr instanceof Error ? dbErr.message : String(dbErr));
      const { SHEET_PRESETS } = await import('../config/imagination-presets.js');
      const staticMap: any = {};
      for (const [key, preset] of Object.entries(SHEET_PRESETS)) {
        staticMap[key] = {
          width: preset.width,
          heights: preset.heights,
          rules: preset.rules,
          displayName: preset.displayName,
          description: preset.description
        };
      }
      res.json(staticMap);
      return;
    }

    // Legacy frontend expects { dtf: {...}, uv_dtf: {...} } map.
    const presetsMap: any = {};
    for (const p of products) {
      presetsMap[p.printType] = {
        width: p.width,
        heights: p.sizes?.filter(s => s.enabled).map(s => s.height) || [],
        rules: p.rules,
        displayName: p.displayName,
        description: p.description
      };
    }

    res.json(presetsMap);
  } catch (error: unknown) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// Get pricing with user's free trial status
router.get('/pricing', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const pricing = await pricingService.getAllPricing();
    const freeTrials = await pricingService.getUserFreeTrials(user.id);

    res.json({ pricing, freeTrials });
  } catch (error: any) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// Create new sheet
router.post('/sheets', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user;
    const { name, print_type, sheet_height } = req.body;

    const product = await imaginationProducts.getProductByType(print_type as string);
    if (!product) {
      res.status(400).json({ error: 'Invalid print type' });
      return;
    }

    const height = sheet_height || 48;
    const isValidSize = product.sizes?.some(s => s.height === height && s.enabled);

    if (!isValidSize) {
      res.status(400).json({ error: 'Invalid sheet height for this print type' });
      return;
    }

    const { data, error } = await supabase
      .from('imagination_sheets')
      .insert({
        user_id: user.id,
        name: name || 'Untitled Sheet',
        print_type,
        sheet_width: product.width,
        sheet_height: height,
        canvas_state: { version: 1, layers: [], gridEnabled: true, snapEnabled: true },
        status: 'draft'
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error: any) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
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
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
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
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
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
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
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
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
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

    // Upload to GCS
    const fileName = `${uuidv4()}-${file.originalname}`;
    const filePath = `imagination-station/${user.id}/${fileName}`;
    const result = await uploadImageFromBuffer(file.buffer, filePath, file.mimetype);
    const publicUrl = result.publicUrl;

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
        z_index: Math.floor(Date.now() / 1000),
        metadata: { originalName: file.originalname, mimeType: file.mimetype }
      })
      .select()
      .single();

    if (layerError) throw layerError;
    res.status(201).json(layer);
  } catch (error: any) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
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
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
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
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
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
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
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
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// AI Operations

// Generate image with Mr. Imagine (standalone, no sheet required)
// Supports generating 1–4 images in parallel across the top models.
router.post('/ai/generate', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user;
    const { prompt, style, useTrial, count: rawCount, background, tier } = req.body;

    if (!prompt) {
      res.status(400).json({ error: 'Prompt is required' });
      return;
    }

    // Parse and clamp count: default 1, integer, clamped 1–4
    const count = Math.min(4, Math.max(1, parseInt(rawCount, 10) || 1));

    // Get user's ITC balance
    const { data: wallet } = await supabase
      .from('user_wallets')
      .select('itc_balance')
      .eq('user_id', user.id)
      .single();

    const result = await aiService.generateImagesMulti({
      userId: user.id,
      prompt,
      style: style || 'realistic',
      itcBalance: wallet?.itc_balance || 0,
      count,
      background,
      tier: tier === 'premium' ? 'premium' : 'standard',
    });

    if (!result.images || result.images.length === 0) {
      res.status(502).json({ error: 'Image generation completed but no output URLs were produced. You were not charged.' });
      return;
    }

    // Legacy aliases so existing single-image callers keep working
    const primaryUrl = result.images[0]?.url;

    // Re-fetch the post-charge balance so the client can update the displayed
    // ITC immediately (the deduction happens server-side inside generateImagesMulti).
    const { data: postWallet } = await supabase
      .from('user_wallets')
      .select('itc_balance')
      .eq('user_id', user.id)
      .single();

    res.json({
      images: result.images,
      cost: result.cost,
      perImageCost: result.perImageCost,
      freeTrialUsed: result.freeTrialUsed,
      failures: result.failures,
      newBalance: postWallet?.itc_balance ?? null,
      // Legacy aliases
      imageUrl: primaryUrl,
      url: primaryUrl,
      output: primaryUrl,
      processedUrl: primaryUrl,
    });
  } catch (error: any) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
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

    // Normalize response shape so any caller gets consistent URL aliases
    const genUrl = result.layer?.source_url || result.layer?.processed_url || '';
    res.json({
      ...result,
      imageUrl: genUrl,
      url: genUrl,
      output: genUrl,
      processedUrl: genUrl,
    });
  } catch (error: any) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// Mr. Imagine "studio brain" — one conversational turn. Powers the voice
// assistant (transcribe -> brainstorm -> synthesize) and any text chat. Returns
// a short spoken reply + the working image-generation prompt.
router.post('/ai/brainstorm', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { messages, mode } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'messages array is required' });
      return;
    }
    const result = await brainstormDesign(messages, mode === 'wall-art' ? 'wall-art' : 'dtf');
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// Fresh, on-trend "surprise me" design idea. Rotates trend lenses so it stops
// repeating; the frontend falls back to a local list if this errors.
router.get('/ai/random-idea', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const seed = typeof req.query.seed === 'string' ? req.query.seed : undefined;
    const idea = await randomDesignIdea(seed);
    res.json({ idea });
  } catch (error: any) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// DTF halftone — convert a design into the dot-screen "breathing" DTF look.
// Same engine as the admin product builder (services/halftone.ts), exposed to
// any signed-in user for the Imagination Station. Local Sharp transform, no API
// cost, so it's free (no ITC charge).
router.post('/ai/halftone', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user;
    const { imageUrl, frequency, angle, shape, invertDark } = req.body;
    if (!imageUrl) {
      res.status(400).json({ error: 'imageUrl is required' });
      return;
    }
    const resp = await fetch(imageUrl);
    if (!resp.ok) {
      res.status(502).json({ error: `Could not fetch the design image (${resp.status})` });
      return;
    }
    const inputBuffer = Buffer.from(await resp.arrayBuffer());

    // Halftone knocks out DARK areas by default (black background → transparent).
    // For a WHITE-background design we must invert so the WHITE is knocked out
    // instead (otherwise it keeps the white field and eats the artwork). Auto-
    // detect from the border unless the caller passed invertDark explicitly.
    let invert = invertDark;
    if (invert === undefined) {
      const solidBg = await detectSolidBg(inputBuffer);
      invert = solidBg === 'white';
    }
    const result = await applyHalftone(inputBuffer, { frequency, angle, shape, invertDark: invert });

    const filename = `halftone-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.png`;
    const gcsPath = `users/${user.id}/designs/${filename}`;
    const { publicUrl } = await uploadImageFromBuffer(result.buffer, gcsPath, 'image/png');

    res.json({
      processedUrl: publicUrl,
      imageUrl: publicUrl,
      url: publicUrl,
      output: publicUrl,
      originalUrl: imageUrl,
      metadata: result.metadata,
    });
  } catch (error: any) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// Room mockup — place a finished metal-art piece on the wall of a real room
// (the location the user told Mr. Imagine) via gpt-image-2 edit. Replaces the
// flat CSS scene previews with a stunning, photoreal "see it in your space" shot.
router.post('/ai/room-mockup', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user;
    const { imageUrl, location, size } = req.body;
    if (!imageUrl) {
      res.status(400).json({ error: 'imageUrl is required' });
      return;
    }
    const place = (typeof location === 'string' && location.trim()) ? location.trim() : 'a stylish modern living room';
    // Real product sizes are SMALL — show the print at true-to-life scale so the
    // mockup reflects what the customer actually receives (not a giant mural).
    const sizeDesc = size === '4x6'
      ? 'a SMALL 4 by 6 inch framed metal print — roughly the size of a postcard or a small desk photo frame'
      : 'a MODEST 8 by 11 inch framed metal print — about the size of a standard sheet of paper';
    const prompt = `Photorealistic interior photograph: the provided artwork printed as ${sizeDesc}, hanging on the wall of ${place}. CRITICAL SCALE: show it at realistic, true-to-life size relative to the furniture and wall — it is a small-to-medium print, NOT an oversized mural or giant panel; a real 8x11 inch frame is smaller than a typical window. Style it tastefully with realistic lighting, perspective, and a little furniture/decor context. CRITICAL: keep the artwork itself EXACTLY as provided — do not alter, crop, recolor, redraw, or add any text to it; it must read as the same image, just shown framed on the wall at its true size. Magazine-quality interior design photography.`;
    const filename = `room-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.png`;
    const r = await editOpenAIImage({
      sourceUrl: imageUrl,
      prompt,
      userId: user.id,
      quality: 'medium',
      objectPath: `users/${user.id}/room-mockups/${filename}`,
    });
    res.json({ url: r.url, processedUrl: r.url, location: place });
  } catch (error: any) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
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
    const processedUrl = result.layer?.processed_url;

    if (!processedUrl) {
      res.status(502).json({ error: 'Image processing completed but no output URL was produced. You were not charged.' });
      return;
    }

    res.json({
      processedUrl,
      imageUrl: processedUrl,
      url: processedUrl,
      output: processedUrl,
      originalUrl: imageUrl,
      cost: result.cost,
      freeTrialUsed: result.freeTrialUsed,
      alreadyTransparent: (result as any).alreadyTransparent === true
    });
  } catch (error: any) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
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

    // Normalize response shape so any caller gets consistent URL aliases
    const bgUrl = result.layer?.processed_url || result.layer?.source_url || '';
    res.json({
      ...result,
      processedUrl: bgUrl,
      imageUrl: bgUrl,
      url: bgUrl,
      output: bgUrl,
    });
  } catch (error: any) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
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
    const processedUrl = result.layer?.processed_url;

    if (!processedUrl) {
      res.status(502).json({ error: 'Image processing completed but no output URL was produced. You were not charged.' });
      return;
    }

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
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
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

    // Normalize response shape so any caller gets consistent URL aliases
    const upUrl = result.layer?.processed_url || result.layer?.source_url || '';
    res.json({
      ...result,
      processedUrl: upUrl,
      imageUrl: upUrl,
      url: upUrl,
      output: upUrl,
    });
  } catch (error: any) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
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
    const processedUrl = result.layer?.processed_url;

    if (!processedUrl) {
      res.status(502).json({ error: 'Image processing completed but no output URL was produced. You were not charged.' });
      return;
    }

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
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
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

    // Normalize response shape so any caller gets consistent URL aliases
    const enhUrl = result.layer?.processed_url || result.layer?.source_url || '';
    res.json({
      ...result,
      processedUrl: enhUrl,
      imageUrl: enhUrl,
      url: enhUrl,
      output: enhUrl,
    });
  } catch (error: any) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
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

    // Deduct ITC if charged — use optimistic conditional update to guard against
    // concurrent balance changes (race condition between read and write).
    if (result.itcCharged > 0) {
      const charged = result.itcCharged;
      const applyDeduction = async (balance: number): Promise<boolean> => {
        const { data: updated } = await supabase
          .from('user_wallets')
          .update({ itc_balance: balance - charged })
          .eq('user_id', user.id)
          .eq('itc_balance', balance)  // optimistic lock
          .select('itc_balance');
        return Array.isArray(updated) && updated.length > 0;
      };

      let success = await applyDeduction(itcBalance);
      if (!success) {
        // Balance changed concurrently — re-fetch once and retry
        const { data: freshWallet } = await supabase
          .from('user_wallets')
          .select('itc_balance')
          .eq('user_id', user.id)
          .single();
        const freshBalance = freshWallet?.itc_balance ?? 0;
        if (freshBalance < charged) {
          res.status(409).json({ error: 'ITC balance changed concurrently — insufficient funds. Please retry.' });
          return;
        }
        success = await applyDeduction(freshBalance);
        if (!success) {
          res.status(409).json({ error: 'ITC balance is being modified concurrently. Please retry in a moment.' });
          return;
        }
      }

      // Log transaction. wallet_transactions live schema has NO `metadata`
      // column (transaction_type/amount/balance_after/reference_type/description)
      // — the old insert with metadata silently failed.
      const { error: wtErr } = await supabase.from('wallet_transactions').insert({
        user_id: user.id,
        transaction_type: 'spend',
        amount: result.itcCharged,
        reference_type: 'imagination_auto_nest',
        description: `Auto-Nest layout optimization (${layers.length} layers)`
      });
      if (wtErr) console.error('[imagination/auto-nest] wallet_transactions insert failed:', wtErr.message);
    }

    res.json({
      positions: result.positions,
      efficiency: result.efficiency,
      wastedSpace: result.wastedSpace,
      itcCharged: result.itcCharged
    });
  } catch (error: any) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
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

    // Deduct ITC if charged — use optimistic conditional update to guard against
    // concurrent balance changes (race condition between read and write).
    if (result.itcCharged > 0) {
      const charged = result.itcCharged;
      const applyDeduction = async (balance: number): Promise<boolean> => {
        const { data: updated } = await supabase
          .from('user_wallets')
          .update({ itc_balance: balance - charged })
          .eq('user_id', user.id)
          .eq('itc_balance', balance)  // optimistic lock
          .select('itc_balance');
        return Array.isArray(updated) && updated.length > 0;
      };

      let success = await applyDeduction(itcBalance);
      if (!success) {
        // Balance changed concurrently — re-fetch once and retry
        const { data: freshWallet } = await supabase
          .from('user_wallets')
          .select('itc_balance')
          .eq('user_id', user.id)
          .single();
        const freshBalance = freshWallet?.itc_balance ?? 0;
        if (freshBalance < charged) {
          res.status(409).json({ error: 'ITC balance changed concurrently — insufficient funds. Please retry.' });
          return;
        }
        success = await applyDeduction(freshBalance);
        if (!success) {
          res.status(409).json({ error: 'ITC balance is being modified concurrently. Please retry in a moment.' });
          return;
        }
      }

      // Log transaction (wallet_transactions has no metadata column — see auto-nest note)
      const { error: wtErr } = await supabase.from('wallet_transactions').insert({
        user_id: user.id,
        transaction_type: 'spend',
        amount: result.itcCharged,
        reference_type: 'imagination_smart_fill',
        description: `Smart Fill layout optimization (+${result.totalAdded} copies)`
      });
      if (wtErr) console.error('[imagination/smart-fill] wallet_transactions insert failed:', wtErr.message);
    }

    res.json({
      duplicates: result.duplicates,
      coverage: result.coverage,
      totalAdded: result.totalAdded,
      itcCharged: result.itcCharged
    });
  } catch (error: any) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// Reimagine Image — tiered:
//   * standard (1 ITC)  → google/nano-banana (fast, cheap)
//   * premium  (50 ITC) → openai/gpt-image-2 (high fidelity, multi-ref)
// Tier comes from req.body.tier and defaults to 'standard'. Validated server-
// side; clients can't unilaterally request the cheap tier and run premium.
router.post('/ai/reimagine', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user;
    const { imageUrl, prompt, tier: rawTier } = req.body;
    const tier: 'standard' | 'premium' = rawTier === 'premium' ? 'premium' : 'standard';

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
      prompt,
      tier,
    });

    // Return all common keys for frontend compatibility
    const url = result.layer.processed_url;

    if (!url) {
      res.status(502).json({ error: 'Image processing completed but no output URL was produced. You were not charged.' });
      return;
    }

    res.json({
      processedUrl: url,
      imageUrl: url,
      url: url,
      output: url,
      originalUrl: imageUrl,
      cost: result.cost,
      tier: result.tier,
      freeTrialUsed: result.freeTrialUsed
    });
  } catch (error: any) {
    console.error('[imagination-station] reimagine error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

/**
 * POST /api/imagination-station/ai/use-upload
 * User uploaded an image and wants to use it AS the design (no AI transformation).
 * Just uploads the data URL to GCS and returns a public URL ready for submission.
 */
router.post('/ai/use-upload', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user;
    const { dataUrl } = req.body;

    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
      res.status(400).json({ error: 'dataUrl (data:image/...) is required' });
      return;
    }

    const uploaded = await uploadImageFromBase64(
      dataUrl,
      `users/${user.id}/uploads/own-design-${Date.now()}.png`
    );

    console.log('[imagination-station] use-upload saved:', uploaded.publicUrl.substring(0, 100) + '...');

    res.json({
      url: uploaded.publicUrl,
      imageUrl: uploaded.publicUrl,
      output: uploaded.publicUrl,
      processedUrl: uploaded.publicUrl,
    });
  } catch (error: any) {
    console.error('[imagination-station] use-upload error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// ===========================================
// DESIGN SUBMISSION FROM CREATE DESIGN MODAL
// ===========================================

/**
 * POST /api/imagination-station/designs/submit
 * Submit a design created in CreateDesignModal for admin approval
 * This is a simpler flow than the full Imagination Station sheet workflow
 */
router.post('/designs/submit', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user;
    const {
      name,
      design_concept,
      preview_url,
      style,
      category,
      // Optional extras from the Imagination Station "Make a Product" flow.
      mockup_url,
      product_template,
      model_description,
      source,
      // Role-tagged design assets (stored on metadata.assets): the clean art is
      // the display hero; halftone + DTF are paid digital deliverables that must
      // never show as a public thumbnail. clean_url defaults to preview_url.
      clean_url,
      halftone_url,
      dtf_url
    } = req.body;

    if (!preview_url) {
      res.status(400).json({ error: 'Preview URL is required' });
      return;
    }

    console.log('[imagination-station] 📤 Design submission from:', user.email, 'concept:', design_concept?.substring(0, 50));

    // CRITICAL: Upload image to GCS to prevent expiration
    // Replicate delivery URLs expire after ~1 hour, so we must persist to GCS
    let permanentImageUrl = preview_url;

    // Check if URL is a temporary Replicate URL that needs to be persisted
    const isTemporaryUrl = preview_url.includes('replicate.delivery') ||
                          preview_url.includes('replicate.com') ||
                          preview_url.includes('pbxt.replicate.delivery');

    if (isTemporaryUrl) {
      try {
        console.log('[imagination-station] 🔄 Persisting temporary image to GCS...');
        const uploadResult = await gcsStorage.uploadFromUrl(preview_url, {
          userId: user.id,
          folder: 'designs',
          filename: `design-${Date.now()}-${Math.random().toString(36).substring(7)}.png`
        });
        permanentImageUrl = uploadResult.publicUrl;
        console.log('[imagination-station] ✅ Image persisted to GCS:', permanentImageUrl);
      } catch (uploadError: any) {
        console.error('[imagination-station] ⚠️ Failed to persist image to GCS:', uploadError.message);
        // Continue with original URL as fallback (better than failing completely)
        // But log a warning - this image may expire
        console.warn('[imagination-station] ⚠️ Using temporary URL - image may expire!');
      }
    }

    // Get user profile for email
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('email, username, display_name')
      .eq('id', user.id)
      .single();

    // Generate a SOLID, design-specific title + description so the product is
    // store-ready the moment it's approved. Prefer VISION (describe the actual
    // design) — works even when the concept is vague/missing (uploads, or a
    // generic "Custom shirt design"); fall back to the text normalizer, then
    // to plain defaults.
    let productName = name || 'My Custom Design';
    let productDescription = design_concept || 'Created with AI design tools';
    let productTags: string[] = [];

    try {
      const { describeDesignForProduct } = await import('../services/ai-product.js');
      const copy = await describeDesignForProduct(permanentImageUrl, design_concept || name);
      productName = copy.title;
      productDescription = copy.description;
      productTags = copy.tags;
      console.log('[imagination-station] 👁️ Vision product copy:', productName);
    } catch (visionErr) {
      console.warn('[imagination-station] ⚠️ vision copy failed, trying text normalizer:', visionErr instanceof Error ? visionErr.message : String(visionErr));
      try {
        const { normalizeProduct } = await import('../services/ai-product.js');
        const normalized = await normalizeProduct({
          prompt: design_concept || name || 'Custom design',
          priceTarget: 2500, // $25 default
          imageStyle: style || 'semi-realistic',
        });
        productName = normalized.title;
        productDescription = normalized.description;
      } catch (gptError) {
        console.error('[imagination-station] ⚠️ All copy generation failed, using defaults:', gptError);
      }
    }

    // Create a draft product entry with pending_approval status
    const { data: design, error } = await supabase
      .from('products')
      .insert({
        name: productName,
        description: productDescription,
        slug: `design-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        price: 25, // $25 default - stored as dollars, admin can adjust
        images: [permanentImageUrl], // Use permanent GCS URL
        status: 'pending_approval',
        category_id: null, // Will be set during approval
        metadata: {
          design_concept,
          style,
          category,
          // Carried from "Make a Product": which product the user wants, the
          // AI mockup preview, and the model description. The admin sees these
          // at approval time and pro mockups are generated post-approval.
          product_template: product_template || category || null,
          mockup_url: mockup_url || null,
          model_description: model_description || null,
          ai_tags: productTags,
          source: source || 'create_design_modal',
          submitted_at: new Date().toISOString(),
          user_submitted: true,
          creator_id: user.id,
          original_prompt: design_concept,
          creator_royalty_percent: 15,
          original_replicate_url: isTemporaryUrl ? preview_url : undefined, // Keep original for reference
          // Role-tagged assets: clean art is the display hero; halftone + DTF
          // are gated digital deliverables (never shown as a public thumbnail).
          assets: {
            clean: clean_url || permanentImageUrl,
            ...(mockup_url ? { mockups: [mockup_url] } : {}),
            ...(halftone_url ? { halftone: halftone_url } : {}),
            ...(dtf_url ? { dtf: dtf_url } : {})
          }
        },
        created_by_user_id: user.id,
        is_user_generated: true
      })
      .select()
      .single();

    if (error) {
      console.error('[imagination-station] ❌ Failed to create design:', error);
      res.status(500).json({ error: 'Failed to save design' });
      return;
    }

    console.log('[imagination-station] ✅ Design created:', design.id);

    // Send confirmation email
    try {
      const { sendDesignSubmittedEmail } = await import('../utils/email.js');
      const userEmail = profile?.email || user.email;
      if (userEmail) {
        await sendDesignSubmittedEmail(
          userEmail,
          design.id,
          design_concept || name || 'My Custom Design',
          preview_url
        );
        console.log('[imagination-station] 📧 Confirmation email sent to:', userEmail);
      }
    } catch (emailError) {
      console.error('[imagination-station] ⚠️ Failed to send email (non-blocking):', emailError);
      // Don't fail the submission if email fails
    }

    res.status(201).json({
      id: design.id,
      name: design.name,
      status: 'pending_approval',
      preview_url: permanentImageUrl, // Return the permanent GCS URL
      message: 'Design submitted for approval! You\'ll receive an email when it\'s reviewed.'
    });

  } catch (error: any) {
    console.error('[imagination-station] ❌ Design submission error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;



