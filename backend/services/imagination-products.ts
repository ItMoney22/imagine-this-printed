
import { createClient } from '@supabase/supabase-js';
import { SHEET_PRESETS } from '../config/imagination-presets';

// Define types locally since we can't fully rely on generated Prisma types yet
export interface ImaginationProduct {
    id: string;
    printType: string;
    displayName: string;
    description: string | null;
    width: number;
    minDpi: number;
    rules: any;
    sizes?: ImaginationProductSize[];
}

export interface ImaginationProductSize {
    id: string;
    productId: string;
    height: number;
    priceUsd: number;
    priceItc: number;
    enabled: boolean;
}

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export class ImaginationProductService {

    /**
     * Get all products with their configured sizes
     */
    async getAllProducts(): Promise<ImaginationProduct[]> {
        const { data, error } = await supabase
            .from('imagination_products')
            .select(`
        *,
        sizes:imagination_product_sizes(*)
      `)
            .order('print_type');

        if (error) {
            console.error('Error fetching imagination products:', error);
            // Fallback to config if DB is empty or error (e.g. migration not run)
            return this.getFallbackConfig();
        }

        if (!data || data.length === 0) {
            return this.getFallbackConfig();
        }

        // Map DB casing to camelCase if needed (Supabase returns snake_case by default for raw queries, 
        // but if using Prisma over postgres it might be different. 
        // Since we are using Supabase client here which uses PostgREST, it returns snake_case columns
        // properly mapped if we query them right, but let's be safe).
        // Actually Supabase client returns what is in the DB.
        // My schema mapped definitions: @map("print_type")
        // So logic should handle CamelCase conversion if needed, OR I just use the response as is.
        // Let's standardise on camelCase for the frontend.

        return data.map((p: any) => ({
            id: p.id,
            printType: p.print_type,
            displayName: p.display_name,
            description: p.description,
            width: p.width,
            minDpi: p.min_dpi,
            rules: p.rules,
            sizes: (p.sizes || []).map((s: any) => ({
                id: s.id,
                productId: s.product_id,
                height: s.height,
                priceUsd: s.price_usd,
                priceItc: s.price_itc,
                enabled: s.enabled
            })).sort((a: any, b: any) => a.height - b.height)
        }));
    }

    /**
     * Get a specific product by print type
     */
    async getProductByType(printType: string): Promise<ImaginationProduct | null> {
        const { data, error } = await supabase
            .from('imagination_products')
            .select(`
        *,
        sizes:imagination_product_sizes(*)
      `)
            .eq('print_type', printType)
            .single();

        if (error || !data) {
            const fallback = (await this.getFallbackConfig()).find(p => p.printType === printType);
            return fallback || null;
        }

        return {
            id: data.id,
            printType: data.print_type,
            displayName: data.display_name,
            description: data.description,
            width: data.width,
            minDpi: data.min_dpi,
            rules: data.rules,
            sizes: (data.sizes || []).map((s: any) => ({
                id: s.id,
                productId: s.product_id,
                height: s.height,
                priceUsd: s.price_usd,
                priceItc: s.price_itc,
                enabled: s.enabled
            })).sort((a: any, b: any) => a.height - b.height)
        };
    }

    /**
     * Update a product configuration
     */
    async updateProduct(id: string, updates: Partial<ImaginationProduct>): Promise<void> {
        const dbUpdates: any = {};
        if (updates.displayName) dbUpdates.display_name = updates.displayName;
        if (updates.description) dbUpdates.description = updates.description;
        if (updates.minDpi) dbUpdates.min_dpi = updates.minDpi;
        if (updates.rules) dbUpdates.rules = updates.rules;

        // Width changes usually not allowed as they break presets, but if admin insists...
        // The user asked to "change the sheet size", usually meaning height, but width control is good too.
        if (updates.width) dbUpdates.width = updates.width;

        const { error } = await supabase
            .from('imagination_products')
            .update(dbUpdates)
            .eq('id', id);

        if (error) throw new Error(`Failed to update product: ${error.message}`);
    }

    /**
     * Add or Update a size for a product
     */
    async upsertSize(sizeData: Omit<ImaginationProductSize, 'id'> & { id?: string }): Promise<void> {
        const dbData = {
            product_id: sizeData.productId,
            height: sizeData.height,
            price_usd: sizeData.priceUsd,
            price_itc: sizeData.priceItc,
            enabled: sizeData.enabled ?? true
        };

        const { error } = await supabase
            .from('imagination_product_sizes')
            .upsert(dbData, { onConflict: 'product_id,height' });

        if (error) throw new Error(`Failed to upsert size: ${error.message}`);
    }

    /**
     * Delete a size
     */
    async deleteSize(productId: string, height: number): Promise<void> {
        const { error } = await supabase
            .from('imagination_product_sizes')
            .delete()
            .eq('product_id', productId)
            .eq('height', height);

        if (error) throw new Error(`Failed to delete size: ${error.message}`);
    }

    // --- Private Helpers ---

    private async getFallbackConfig(): Promise<ImaginationProduct[]> {
        // Generate config from local file if DB is unavailable
        const presets = Object.entries(SHEET_PRESETS).map(([key, preset]) => {
            const pricePerSqInch = 0.02; // Hardcoded fallback

            const sizes = preset.heights.map(h => ({
                id: `fallback-${key}-${h}`,
                productId: `fallback-${key}`,
                height: h,
                priceUsd: Math.round(preset.width * h * pricePerSqInch * 100) / 100,
                priceItc: Math.round(preset.width * h * pricePerSqInch * 100) / 100, // Same for fallback
                enabled: true
            }));

            return {
                id: `fallback-${key}`,
                printType: key,
                displayName: preset.displayName,
                description: preset.description,
                width: preset.width,
                minDpi: preset.rules.minDPI,
                rules: preset.rules,
                sizes
            };
        });

        return presets;
    }

    /**
     * Initialize DB from config (Seed function)
     * This can be called by an admin 'Reset/Init' button
     */
    async seedFromConfig(): Promise<void> {
        const products = await this.getFallbackConfig();

        for (const p of products) {
            // 1. Upsert Product
            const { data: prodData, error: prodError } = await supabase
                .from('imagination_products')
                .upsert({
                    print_type: p.printType,
                    display_name: p.displayName,
                    description: p.description,
                    width: p.width,
                    min_dpi: p.minDpi,
                    rules: p.rules
                }, { onConflict: 'print_type' })
                .select()
                .single();

            if (prodError) {
                console.error(`Failed to seed product ${p.printType}:`, prodError);
                continue;
            }

            // 2. Upsert Sizes
            if (p.sizes) {
                for (const s of p.sizes) {
                    await supabase
                        .from('imagination_product_sizes')
                        .upsert({
                            product_id: prodData.id,
                            height: s.height,
                            price_usd: s.priceUsd,
                            price_itc: s.priceItc,
                            enabled: s.enabled
                        }, { onConflict: 'product_id,height' });
                }
            }
        }
    }
}

export const imaginationProducts = new ImaginationProductService();
