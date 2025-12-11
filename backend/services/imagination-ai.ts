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
