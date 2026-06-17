// backend/services/imagination-ai.ts

import Replicate from 'replicate';
import { transparentFraction, detectSolidBg, keyOutSolidBackground } from './bg-key.js';
import { createClient } from '@supabase/supabase-js';
import { pricingService } from './imagination-pricing.js';
import { AI_STYLES } from '../config/imagination-presets.js';
import { removeBackgroundWithRemoveBg } from './removebg.js';
import * as gcsStorage from './gcs-storage.js';
import { uploadImageFromBase64, uploadImageFromBuffer } from './google-cloud-storage.js';
import { pickFanOutModels, runImageFlowMultiGenerate } from './image-flow/worker-helpers.js';
import { brandFor } from './image-flow/models.js';
import { runOpenAIImage } from './image-flow/providers/openai-image.js';

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN!
});

/**
 * Extract a URL string from various Replicate SDK output formats.
 * The SDK may return: string, URL object (with .href), FileOutput (with .url() method),
 * array of any of these, or even a ReadableStream that somehow resolves to a URL object.
 */
function extractUrlString(output: unknown): string {
  // Handle array - take first element
  if (Array.isArray(output) && output.length > 0) {
    return extractUrlString(output[0]);
  }

  // Handle null/undefined
  if (output == null) {
    return '';
  }

  // Handle string directly
  if (typeof output === 'string') {
    return output;
  }

  // Handle object types
  if (typeof output === 'object') {
    const obj = output as Record<string, unknown>;

    // Check for URL object (has .href property)
    if (typeof obj.href === 'string') {
      return obj.href;
    }

    // Check for FileOutput with .url() method
    if (typeof obj.url === 'function') {
      const urlResult = obj.url();
      // url() might return a URL object or string
      if (typeof urlResult === 'string') {
        return urlResult;
      }
      if (urlResult && typeof urlResult === 'object' && typeof (urlResult as any).href === 'string') {
        return (urlResult as any).href;
      }
      return String(urlResult);
    }

    // Check for .url property (might be string or URL object)
    if (obj.url) {
      if (typeof obj.url === 'string') {
        return obj.url;
      }
      if (typeof obj.url === 'object' && typeof (obj.url as any).href === 'string') {
        return (obj.url as any).href;
      }
    }

    // Check for .uri property
    if (typeof obj.uri === 'string') {
      return obj.uri;
    }

    // Check for .output property
    if (obj.output) {
      return extractUrlString(obj.output);
    }
  }

  // Fallback to String conversion
  const str = String(output);
  // If String() returned "[object Object]" or similar, it's not useful
  if (str.startsWith('[object ')) {
    console.warn('[extractUrlString] Could not extract URL from output:', output);
    return '';
  }
  return str;
}

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Helper to persist temporary Replicate URLs to GCS.
 * Returns the permanent GCS URL, or the original URL if persistence fails.
 */
async function persistToGCS(url: string, userId: string, folder: 'mockups' | 'designs' | 'uploads' | 'temp' | 'thumbnails' | 'avatars' | 'covers' | 'ai-generated' | 'upscaled' | 'enhanced' | 'reimagined' | 'bg-removed'): Promise<string> {
  // Skip if not a temporary Replicate URL
  const isTemporaryUrl = url.includes('replicate.delivery') ||
                         url.includes('replicate.com') ||
                         url.includes('pbxt.replicate.delivery');

  if (!isTemporaryUrl) {
    return url;
  }

  try {
    console.log(`[imagination-ai] 🔄 Persisting temp URL to GCS (${folder})...`);
    const uploadResult = await gcsStorage.uploadFromUrl(url, {
      userId,
      folder,
      filename: `${folder}-${Date.now()}-${Math.random().toString(36).substring(7)}.png`
    });
    console.log(`[imagination-ai] ✅ Persisted to GCS: ${uploadResult.publicUrl.substring(0, 80)}...`);
    return uploadResult.publicUrl;
  } catch (error: any) {
    console.error(`[imagination-ai] ⚠️ Failed to persist to GCS:`, error.message);
    // Return original URL as fallback - better than nothing
    return url;
  }
}

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

export interface GenerateImagesMultiParams {
  userId: string;
  prompt: string;
  style?: string;
  itcBalance: number;
  count: number;
  /**
   * Background for the generated art. Solid shirt colors (black/white/grey/color)
   * tell the models to fill the frame with that color — which matches the
   * garment AND produces far cleaner results than forcing transparency (most
   * models can't do real alpha and produce artifacts or fail). 'transparent'
   * keeps the legacy cut-out behavior. Defaults to 'transparent' for callers
   * that don't pass it.
   */
  background?: 'black' | 'white' | 'grey' | 'gray' | 'color' | 'transparent';
  /** 'premium' uses GPT Image 2 (top quality + reliable text) at a premium rate. */
  tier?: 'standard' | 'premium';
}

/** Background instruction injected into the generation prompt. */
function backgroundClause(background?: string): string {
  switch ((background || 'transparent').toLowerCase()) {
    case 'black':
      return 'MANDATORY: a SOLID BLACK background that completely fills the entire frame edge-to-edge (it matches a black shirt). No transparency, no white edges, no checkerboard pattern.';
    case 'white':
      return 'MANDATORY: a SOLID WHITE background that completely fills the entire frame edge-to-edge (it matches a white shirt). No transparency, no checkerboard pattern.';
    case 'grey':
    case 'gray':
      return 'MANDATORY: a SOLID HEATHER-GREY background that completely fills the entire frame edge-to-edge (it matches a grey shirt). No transparency, no checkerboard pattern.';
    case 'color':
      return 'MANDATORY: a single SOLID color background that fills the entire frame edge-to-edge and complements the artwork. No transparency, no checkerboard pattern.';
    case 'transparent':
    default:
      return 'MANDATORY: transparent background, PNG with alpha channel.';
  }
}

export interface MultiImageResult {
  url: string;
  modelId: string;
  modelLabel: string;
  /** The model-specific prompt that actually produced this image. */
  prompt?: string;
}

export interface GenerateImagesMultiResult {
  images: MultiImageResult[];
  cost: number;
  perImageCost: number;
  freeTrialUsed: boolean;
  failures: { modelId: string; error: string }[];
}

export class ImaginationAIService {

  async generateImage(params: GenerateImageParams) {
    const { userId, sheetId, prompt, style, itcBalance } = params;
    const isStandalone = sheetId === 'standalone';

    // Check cost
    const costCheck = await pricingService.checkCost(userId, 'generate', itcBalance);
    if (!costCheck.canProceed) {
      throw new Error(costCheck.reason || 'Cannot proceed with generation');
    }

    // Check if prompt is already DTF-formatted (from MrImagineModal)
    // If it contains DTF critical requirements, use as-is
    // Otherwise, apply the legacy style enhancement
    //
    // NOTE: This endpoint is prompt-type-agnostic (DTF, sublimation, gang-sheet
    // all share the same code path). Transparent background is ALWAYS required
    // for printable graphics, so we append the hint unconditionally — even on
    // the DTF-formatted branch — as defense-in-depth in case upstream prompt
    // building ever drops it.
    let enhancedPrompt: string;
    if (prompt.includes('CRITICAL REQUIREMENTS') || prompt.includes('DO NOT include any t-shirt')) {
      // DTF-formatted prompt from frontend - use as-is, but still enforce transparency
      console.log('[imagination-ai] Using DTF-formatted prompt from frontend');
      enhancedPrompt = `${prompt}\n\nMANDATORY: transparent background, PNG with alpha channel.`;
    } else {
      // Legacy prompt - add style suffix
      const styleConfig = AI_STYLES.find(s => s.key === style) || AI_STYLES[0];
      enhancedPrompt = `${prompt}, ${styleConfig.prompt_suffix}, transparent background, PNG`;
    }

    try {
      // Deduct cost first (will refund on failure)
      if (costCheck.cost > 0) {
        await pricingService.deductITC(userId, costCheck.cost, 'generate');
      } else if (costCheck.useFreeTrial) {
        await pricingService.consumeFreeTrial(userId, 'generate');
      }

      // Call Replicate Flux 1.1 Pro Ultra — current default across the platform
      // (matches user-products.ts:608). Higher resolution and stronger artistic
      // detail than Recraft V4; same model the admin product flow already uses
      // so customer + admin output stays visually consistent.
      console.log('[imagination-ai] generateImage using Flux 1.1 Pro Ultra');
      const output = await replicate.run(
        "black-forest-labs/flux-1.1-pro-ultra" as `${string}/${string}`,
        {
          input: {
            prompt: enhancedPrompt,
            aspect_ratio: "1:1",
            output_format: "png",
          }
        }
      );

      // Handle various output types from Replicate SDK
      // The SDK may return: string, URL object, FileOutput with .url() method, array, or ReadableStream
      let imageUrl: string = extractUrlString(output);
      console.log('[imagination-ai] generateImage imageUrl:', imageUrl);

      // CRITICAL: Persist to GCS to prevent Replicate URL expiration
      imageUrl = await persistToGCS(imageUrl, userId, 'ai-generated');

      if (!imageUrl) {
        throw new Error('Image processing completed but no output URL was produced. You were not charged.');
      }

      // For standalone operations, return the URL without persisting
      if (isStandalone) {
        return {
          layer: { source_url: imageUrl, processed_url: imageUrl },
          cost: costCheck.cost,
          freeTrialUsed: costCheck.useFreeTrial
        };
      }

      // Create layer record for sheet-based operations
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
          z_index: Math.floor(Date.now() / 1000),
          metadata: { prompt, style, model: 'black-forest-labs/flux-1.1-pro-ultra' }
        })
        .select()
        .single();

      if (error) throw error;

      // Update sheet ITC spent — read current value first, then write the
      // incremented number.  We intentionally do NOT use a non-existent
      // increment_itc_spent RPC; a simple read-then-write is safe here because
      // the column is for auditing only, not a financial balance.
      const { data: sheetRow } = await supabase
        .from('imagination_sheets')
        .select('itc_spent')
        .eq('id', sheetId)
        .single();
      await supabase
        .from('imagination_sheets')
        .update({ itc_spent: (sheetRow?.itc_spent ?? 0) + costCheck.cost })
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
    const isStandalone = layerId === 'standalone';

    // Fetch the source once — reused for the transparency check, solid-bg
    // detection, and the local color-key knockout.
    let sourceBuffer: Buffer | null = null;
    try {
      const resp = await fetch(imageUrl);
      if (resp.ok) sourceBuffer = Buffer.from(await resp.arrayBuffer());
    } catch { /* leave null → fall through to the URL-based AI path */ }

    // Already-transparent design → nothing to remove; skip (and don't charge).
    const transFrac = sourceBuffer ? await transparentFraction(sourceBuffer) : 0;
    if (transFrac > 0.2) {
      console.log(`[imagination-ai] removeBackground skipped — already ${Math.round(transFrac * 100)}% transparent`);
      return {
        layer: { processed_url: imageUrl, source_url: imageUrl },
        cost: 0,
        freeTrialUsed: false,
        alreadyTransparent: true,
      };
    }

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

      let processedUrl: string | undefined;

      // Solid black/white background → COLOR-KEY knockout. Removes ALL of the
      // black (or white) field with a soft anti-aliased edge — which is what
      // these DTF designs want. AI segmentation (below) leaves a dark halo and
      // misses the inner field, so we only use it for complex/photo backgrounds.
      const solidBg = sourceBuffer ? await detectSolidBg(sourceBuffer) : null;
      if (sourceBuffer && solidBg) {
        console.log(`[imagination-ai] removeBackground via color-key (${solidBg} background)`);
        const keyed = await keyOutSolidBackground(sourceBuffer, solidBg);
        const filename = `bg-removed-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.png`;
        const up = await uploadImageFromBuffer(keyed, `users/${userId}/bg-removed/${filename}`, 'image/png');
        processedUrl = up.publicUrl;
      } else {
        // Complex / photographic background → AI subject segmentation.
        console.log('[imagination-ai] removeBackground via Replicate 851-labs/background-remover');
        const replicateOutput = await replicate.run(
          // Pinned version — version-less form 404s for this community model.
          '851-labs/background-remover:a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc' as `${string}/${string}:${string}`,
          {
            input: { image: imageUrl, format: 'png', background_type: 'rgba' },
          }
        );
        const url = extractUrlString(replicateOutput);
        if (!url) {
          throw new Error('Background remover returned no image URL');
        }
        processedUrl = await persistToGCS(url, userId, 'bg-removed');
      }

      if (!processedUrl) {
        throw new Error('Image processing completed but no output URL was produced. You were not charged.');
      }

      console.log('[imagination-ai] removeBackground processedUrl:', processedUrl.substring(0, 100) + '...');

      // For standalone operations, return the URL without persisting
      if (isStandalone) {
        return {
          layer: { processed_url: processedUrl, source_url: imageUrl },
          cost: costCheck.cost,
          freeTrialUsed: costCheck.useFreeTrial
        };
      }

      // Update layer for sheet-based operations
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
    const isStandalone = layerId === 'standalone';

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

      console.log('[imagination-ai] upscaleImage input:', imageUrl.substring(0, 100) + '...', 'scale:', scaleFactor);

      // Recraft Crisp Upscale — top-rated for graphic design / illustration content (2026 benchmarks).
      // Cheaper + faster than real-esrgan, better text preservation.
      console.log('[imagination-ai] upscaleImage using Recraft Crisp Upscale');
      const output = await replicate.run(
        "recraft-ai/recraft-crisp-upscale" as `${string}/${string}`,
        {
          input: {
            image: imageUrl,
          }
        }
      );

      console.log('[imagination-ai] upscaleImage output:', output);
      console.log('[imagination-ai] upscaleImage output type:', typeof output);

      // Handle various output types from Replicate SDK
      let processedUrl: string = extractUrlString(output);
      console.log('[imagination-ai] upscaleImage processedUrl:', processedUrl);

      // CRITICAL: Persist to GCS to prevent Replicate URL expiration
      processedUrl = await persistToGCS(processedUrl, userId, 'upscaled');

      if (!processedUrl) {
        throw new Error('Image processing completed but no output URL was produced. You were not charged.');
      }

      // For standalone operations, return the URL without persisting
      if (isStandalone) {
        return {
          layer: { processed_url: processedUrl, source_url: imageUrl },
          cost: costCheck.cost,
          freeTrialUsed: costCheck.useFreeTrial
        };
      }

      // Update layer for sheet-based operations
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
    const isStandalone = layerId === 'standalone';

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

      console.log('[imagination-ai] enhanceImage using Recraft Crisp Upscale, input:', imageUrl.substring(0, 100) + '...');

      // Use Recraft Crisp Upscale for better quality enhancement
      const output = await replicate.run(
        "recraft-ai/recraft-crisp-upscale" as `${string}/${string}`,
        {
          input: {
            image: imageUrl
          }
        }
      );

      console.log('[imagination-ai] enhanceImage output:', output);
      console.log('[imagination-ai] enhanceImage output type:', typeof output);

      // Handle various output types from Replicate SDK
      let processedUrl: string = extractUrlString(output);
      console.log('[imagination-ai] enhanceImage processedUrl:', processedUrl);

      // CRITICAL: Persist to GCS to prevent Replicate URL expiration
      processedUrl = await persistToGCS(processedUrl, userId, 'enhanced');

      if (!processedUrl) {
        throw new Error('Image processing completed but no output URL was produced. You were not charged.');
      }

      // For standalone operations, return the URL without persisting
      if (isStandalone) {
        return {
          layer: { processed_url: processedUrl, source_url: imageUrl },
          cost: costCheck.cost,
          freeTrialUsed: costCheck.useFreeTrial
        };
      }

      // Update layer for sheet-based operations
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

  /**
   * Reimagine an existing image with a prompt (Reimagine It feature)
   * Uses Google Nano-Banana for image-to-image generation
   */
  async reimagineImage(params: ProcessImageParams & { prompt: string; strength?: number; tier?: 'standard' | 'premium' }) {
    const { userId, sheetId, layerId, imageUrl, itcBalance, prompt, strength = 0.75 } = params;
    const tier = params.tier === 'premium' ? 'premium' : 'standard';
    const isStandalone = layerId === 'standalone';

    // Tiered reimagine pricing — look up from imagination_pricing table first;
    // fall back to hardcoded values (1 / 50) if the rows haven't been seeded yet
    // so nothing breaks without the migration.
    const FALLBACK_COST_STANDARD = 1;
    const FALLBACK_COST_PREMIUM = 50;

    let cost: number;
    const featureKey = tier === 'premium' ? 'reimagine_premium' : 'reimagine_standard';
    try {
      const pricingRow = await pricingService.getPricing(featureKey);
      if (pricingRow) {
        cost = pricingRow.current_cost;
      } else {
        // Table not seeded — use hardcoded fallbacks
        cost = tier === 'premium' ? FALLBACK_COST_PREMIUM : FALLBACK_COST_STANDARD;
      }
    } catch {
      // Any error fetching pricing — use hardcoded fallbacks
      cost = tier === 'premium' ? FALLBACK_COST_PREMIUM : FALLBACK_COST_STANDARD;
    }

    const balance = itcBalance ?? 0;
    if (balance < cost) {
      throw new Error(`Insufficient ITC for ${tier} reimagine (need ${cost} ITC, have ${balance}).`);
    }

    try {
      await pricingService.deductITC(userId, cost, `reimagine_${tier}`);

      // If client passed a data URL (uploaded from browser), upload to GCS first so
      // Replicate can fetch it. Replicate's API has request-size limits that data URLs
      // can blow past for larger images.
      let inputUrl = imageUrl;
      if (inputUrl.startsWith('data:')) {
        console.log('[imagination-ai] reimagineImage uploading data URL to GCS...');
        const uploaded = await uploadImageFromBase64(
          inputUrl,
          `users/${userId}/uploads/reference-${Date.now()}.png`
        );
        inputUrl = uploaded.publicUrl;
        console.log('[imagination-ai] reimagineImage uploaded reference to:', inputUrl.substring(0, 100) + '...');
      }

      console.log(`[imagination-ai] reimagineImage tier=${tier} input:`, inputUrl.substring(0, 100) + '...', 'prompt:', prompt.substring(0, 50));

      // Branch on tier. Standard uses Google Nano-Banana (image_input array,
      // match aspect to input). Premium uses openai/gpt-image-2 which expects
      // input_images and produces edits with much better composition / detail.
      const output = tier === 'premium'
        ? await replicate.run(
            'openai/gpt-image-2' as `${string}/${string}`,
            {
              input: {
                prompt,
                input_images: [inputUrl],
                aspect_ratio: '1:1',
                quality: 'high',
                output_format: 'png',
                background: 'auto',
              },
            }
          )
        : await replicate.run(
            'google/nano-banana' as `${string}/${string}`,
            {
              input: {
                prompt,
                image_input: [inputUrl],
                aspect_ratio: 'match_input_image',
                output_format: 'png',
              },
            }
          );

      console.log('[imagination-ai] reimagineImage output:', output);

      // Handle various output types from Replicate SDK
      let processedUrl: string = extractUrlString(output);
      console.log('[imagination-ai] reimagineImage processedUrl:', processedUrl);

      // CRITICAL: Persist to GCS to prevent Replicate URL expiration
      processedUrl = await persistToGCS(processedUrl, userId, 'reimagined');

      if (!processedUrl) {
        throw new Error('Image processing completed but no output URL was produced. You were not charged.');
      }

      // For standalone operations, return the URL without persisting
      if (isStandalone) {
        return {
          layer: { processed_url: processedUrl, source_url: imageUrl },
          cost,
          freeTrialUsed: false,
          tier,
        };
      }

      // Update layer for sheet-based operations
      const { data: layer, error } = await supabase
        .from('imagination_layers')
        .update({ processed_url: processedUrl, metadata: { reimagined: true, reimaginePrompt: prompt, tier } })
        .eq('id', layerId)
        .select()
        .single();

      if (error) throw error;

      return { layer, cost, freeTrialUsed: false, tier };

    } catch (error: any) {
      // Refund the actual amount we deducted for this tier (1 or 50 ITC)
      // so the user isn't charged for a failed run.
      await pricingService.refundITC(userId, cost, `reimagine_${tier}_failed`);
      throw error;
    }
  }

  /**
   * Generate 1–4 images in parallel, each from a different top model, using
   * the platform's current model registry and fan-out model selector.
   * Charges ITC up-front and refunds for any failed slots.
   */
  async generateImagesMulti(params: GenerateImagesMultiParams): Promise<GenerateImagesMultiResult> {
    const { userId, prompt, style, itcBalance } = params;
    const tier = params.tier === 'premium' ? 'premium' : 'standard';
    const background = params.background || 'transparent';
    // Clamp count to 1–4
    const count = Math.min(4, Math.max(1, Math.floor(params.count)));

    // Premium uses GPT Image 2 (best quality, reliable, handles text/backgrounds)
    // at a flat premium rate with NO free trial. Standard uses the fan-out roster
    // at the table price with the free-trial/promo logic.
    const PREMIUM_PER_IMAGE = 50; // 50 ITC = $0.50 per premium image

    let perImage: number;
    let firstImageCost: number;
    let useFreeTrial = false;
    if (tier === 'premium') {
      perImage = PREMIUM_PER_IMAGE;
      firstImageCost = PREMIUM_PER_IMAGE;
    } else {
      const pricingRow = await pricingService.getPricing('generate');
      perImage = pricingRow ? pricingRow.current_cost : 0;
      // checkCost handles free-trial and promo for the FIRST image
      const costCheck = await pricingService.checkCost(userId, 'generate', itcBalance);
      if (!costCheck.canProceed) {
        throw new Error(costCheck.reason || 'Cannot proceed with generation');
      }
      firstImageCost = costCheck.cost; // 0 if trial/promo
      useFreeTrial = costCheck.useFreeTrial;
    }

    // First image cost is firstImageCost; remaining images cost perImage each
    const additionalCost = perImage * (count - 1);
    const totalCharge = firstImageCost + additionalCost;

    // Validate user can afford full batch
    if (itcBalance < totalCharge) {
      throw new Error(`Not enough ITC: need ${totalCharge}, have ${itcBalance}`);
    }

    // Deduct ITC up-front (one call for the total)
    if (totalCharge > 0) {
      await pricingService.deductITC(userId, totalCharge, 'generate');
    } else if (useFreeTrial) {
      await pricingService.consumeFreeTrial(userId, 'generate');
    }

    // Build final prompt. Wall art (metal prints/posters) wants full-bleed.
    // Everything else gets the chosen background — a solid shirt color by
    // default for the studio (clean, matches the garment, and avoids the
    // transparent-alpha artifacts that make most models fail), or transparent
    // for legacy cut-out callers.
    const isWallArt = style === 'metal-art' || style === 'poster' || style === 'wall-art';
    const bgClause = backgroundClause(background);
    // Per-model prompt tailoring runs for the standard fan-out so each engine
    // gets its OWN dialect-optimized prompt (Mr. Imagine "trained" on each
    // model via its promptCraft playbook). Premium (GPT Image 2) and wall art
    // use the prompt as-is. The hard background rule is appended AFTER tailoring
    // (passed as backgroundClause, not baked into the prompt) so the enhancer
    // can never drop or rewrite it.
    const skipEnhance = tier === 'premium' || isWallArt;
    // Metal / wall art is a flagship surface — render it ONLY on gpt-image-2 with
    // a gallery-grade, full-bleed finishing wrap so it comes back stunning.
    const promptForGen = isWallArt
      ? `${prompt}\n\nMuseum-quality fine-art piece for a printed metal wall panel: full-bleed composition filling the entire frame edge-to-edge, ultra-high detail and clarity, rich vivid saturated color, dramatic lighting with strong depth and contrast, striking and gallery-worthy. No text, no watermark, no signature, no border.`
      : prompt;

    const images: MultiImageResult[] = [];
    const failures: { modelId: string; error: string }[] = [];

    // gpt-image-2 (OpenAI-direct) for BOTH the premium tier AND all wall/metal
    // art. Wall art keeps the standard price (computed above) — only tier
    // 'premium' pays the premium rate; the model choice is independent of price.
    const useOpenAIDirect = tier === 'premium' || isWallArt;

    if (useOpenAIDirect) {
      // Wall art → full-bleed gallery prompt + opaque (a complete image, never
      // alpha-cut). Premium DTF → solid shirt-color background prompt.
      const genPrompt = isWallArt ? promptForGen : `${prompt}\n\n${bgClause}`;
      const bg: 'opaque' | 'transparent' = isWallArt
        ? 'opaque'
        : (background === 'transparent' ? 'transparent' : 'opaque');
      const settled = await Promise.allSettled(
        Array.from({ length: count }, () =>
          runOpenAIImage({ prompt: genPrompt, userId, background: bg, quality: 'high' })
        )
      );
      settled.forEach((s) => {
        if (s.status === 'fulfilled' && s.value.url) {
          images.push({ url: s.value.url, modelId: s.value.modelId, modelLabel: brandFor('openai/gpt-image-2'), prompt: genPrompt });
        } else {
          const err = s.status === 'rejected' ? (s.reason instanceof Error ? s.reason.message : String(s.reason)) : 'no image returned';
          failures.push({ modelId: 'openai/gpt-image-2', error: err });
        }
      });
    } else {
      // STANDARD → fan-out roster on Replicate, each model dialect-tailored.
      const modelIds = pickFanOutModels(prompt, style).slice(0, count);
      const multiResults = await runImageFlowMultiGenerate({
        prompt: promptForGen,
        modelIds,
        imageStyle: style,
        skipEnhance,
        backgroundClause: isWallArt ? undefined : bgClause,
      });

      // Persist succeeded results to GCS
      await Promise.all(
        multiResults.map(async (r) => {
          if (r.status === 'failed' || !r.url) {
            failures.push({ modelId: r.modelId, error: r.error || 'Generation failed' });
            return;
          }
          const persistedUrl = await persistToGCS(r.url, userId, 'ai-generated');
          if (!persistedUrl) {
            failures.push({ modelId: r.modelId, error: 'GCS persistence returned empty URL' });
            return;
          }
          // Brand the customer-facing label — never expose the underlying vendor/model.
          images.push({ url: persistedUrl, modelId: r.modelId, modelLabel: brandFor(r.modelId), prompt: r.tailoredPrompt || promptForGen });
        })
      );
    }

    const succeededCount = images.length;
    const failedCount = failures.length;

    // Compute refund for failed slots:
    // total charged − (succeeded × perImage), clamped to [0, totalCharge]
    const refundAmount = Math.min(totalCharge, Math.max(0, totalCharge - succeededCount * perImage));

    if (succeededCount === 0) {
      // Refund everything and throw — user was not charged
      if (totalCharge > 0) {
        await pricingService.refundITC(userId, totalCharge, 'generate_multi_all_failed');
      } else if (useFreeTrial) {
        // Free-trial consume already happened; nothing to refund, but there's
        // nothing to show — throw with a clear message.
      }
      throw new Error('All image generations failed. You were not charged.');
    }

    if (failedCount > 0 && refundAmount > 0) {
      await pricingService.refundITC(userId, refundAmount, 'generate_multi_partial_refund');
    }

    const netCost = totalCharge - refundAmount;

    return {
      images,
      cost: netCost,
      perImageCost: perImage,
      freeTrialUsed: useFreeTrial,
      failures,
    };
  }
}

export const aiService = new ImaginationAIService();
