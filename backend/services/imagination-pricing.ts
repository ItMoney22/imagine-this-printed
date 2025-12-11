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
