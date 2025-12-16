// backend/services/imagination-ai.ts

import Replicate from 'replicate';
import { createClient } from '@supabase/supabase-js';
import { pricingService } from './imagination-pricing';
import { AI_STYLES } from '../config/imagination-presets';
import { removeBackgroundWithRemoveBg } from './removebg';

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
    const isStandalone = sheetId === 'standalone';

    // Check cost
    const costCheck = await pricingService.checkCost(userId, 'generate', itcBalance);
    if (!costCheck.canProceed) {
      throw new Error(costCheck.reason || 'Cannot proceed with generation');
    }

    // Check if prompt is already DTF-formatted (from MrImagineModal)
    // If it contains DTF critical requirements, use as-is
    // Otherwise, apply the legacy style enhancement
    let enhancedPrompt: string;
    if (prompt.includes('CRITICAL REQUIREMENTS') || prompt.includes('DO NOT include any t-shirt')) {
      // DTF-formatted prompt from frontend - use as-is
      console.log('[imagination-ai] Using DTF-formatted prompt from frontend');
      enhancedPrompt = prompt;
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

      // Handle various output types from Replicate SDK
      // The SDK may return: string, URL object, FileOutput with .url() method, array, or ReadableStream
      let imageUrl: string = extractUrlString(output);
      console.log('[imagination-ai] generateImage imageUrl:', imageUrl);

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
    const isStandalone = layerId === 'standalone';

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

      console.log('[imagination-ai] removeBackground using Remove.bg API, input:', imageUrl.substring(0, 100) + '...');

      // Use Remove.bg API for better quality background removal
      const processedUrl = await removeBackgroundWithRemoveBg(imageUrl);

      console.log('[imagination-ai] removeBackground processedUrl (data URL):', processedUrl.substring(0, 50) + '...');

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

      console.log('[imagination-ai] upscaleImage output:', output);
      console.log('[imagination-ai] upscaleImage output type:', typeof output);

      // Handle various output types from Replicate SDK
      let processedUrl: string = extractUrlString(output);
      console.log('[imagination-ai] upscaleImage processedUrl:', processedUrl);

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
  async reimagineImage(params: ProcessImageParams & { prompt: string; strength?: number }) {
    const { userId, sheetId, layerId, imageUrl, itcBalance, prompt, strength = 0.75 } = params;
    const isStandalone = layerId === 'standalone';

    // Use the same pricing as generate for reimagine
    const costCheck = await pricingService.checkCost(userId, 'generate', itcBalance);
    if (!costCheck.canProceed) {
      throw new Error(costCheck.reason || 'Cannot proceed');
    }

    try {
      if (costCheck.cost > 0) {
        await pricingService.deductITC(userId, costCheck.cost, 'reimagine');
      } else if (costCheck.useFreeTrial) {
        await pricingService.consumeFreeTrial(userId, 'generate');
      }

      console.log('[imagination-ai] reimagineImage using Nano-Banana, input:', imageUrl.substring(0, 100) + '...', 'prompt:', prompt.substring(0, 50));

      // Use Google Nano-Banana for image-to-image generation
      const output = await replicate.run(
        "google/nano-banana" as `${string}/${string}`,
        {
          input: {
            prompt: prompt,
            image_input: [imageUrl],
            aspect_ratio: "match_input_image",
            output_format: "png"
          }
        }
      );

      console.log('[imagination-ai] reimagineImage output:', output);

      // Handle various output types from Replicate SDK
      let processedUrl: string = extractUrlString(output);
      console.log('[imagination-ai] reimagineImage processedUrl:', processedUrl);

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
        .update({ processed_url: processedUrl, metadata: { reimagined: true, reimaginePrompt: prompt } })
        .eq('id', layerId)
        .select()
        .single();

      if (error) throw error;

      return { layer, cost: costCheck.cost, freeTrialUsed: costCheck.useFreeTrial };

    } catch (error: any) {
      if (costCheck.cost > 0) {
        await pricingService.refundITC(userId, costCheck.cost, 'reimagine_failed');
      }
      throw error;
    }
  }
}

export const aiService = new ImaginationAIService();
