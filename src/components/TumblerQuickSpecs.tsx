import React from 'react'
import { Ruler, Car, Droplets, ShieldCheck } from 'lucide-react'
import {
  type TumblerSpec,
  resolveTumblerSpecs,
  normalizeTumblerSizeKey,
} from '../lib/tumbler-sizing'
import type { Product } from '../types'

export interface TumblerQuickSpecsProps {
  product: Pick<Product, 'name' | 'category' | 'metadata' | 'sizes'>
  selectedSize?: string | null
  onOpenSizeGuide: () => void
}

/**
 * Tumbler Quick Specifications & Fit Panel
 *
 * Renders directly on tumbler product pages to provide immediate
 * at-a-glance capacity, dimension, and cup-holder fit data.
 */
export const TumblerQuickSpecs: React.FC<TumblerQuickSpecsProps> = ({
  product,
  selectedSize,
  onOpenSizeGuide,
}) => {
  const resolved = resolveTumblerSpecs(product)
  const sizeKey = normalizeTumblerSizeKey(selectedSize)
  const activeSpec: TumblerSpec =
    (sizeKey && resolved.allSizes.find(s => s.id === sizeKey)) ||
    resolved.applicableSizes[0] ||
    resolved.defaultSpec

  return (
    <div className="rounded-xl border card-border bg-card/60 p-4 sm:p-5 text-text space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-primary/15 text-primary">
            Tumbler Specs
          </span>
          <span className="text-xs text-muted font-medium">
            {activeSpec.name}
          </span>
        </div>

        <button
          type="button"
          onClick={onOpenSizeGuide}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:text-primary-dark transition-colors hover:underline"
        >
          <Ruler className="w-3.5 h-3.5" />
          <span>Full Size Guide →</span>
        </button>
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div className="p-2.5 rounded-lg bg-bg border border-border/60">
          <dt className="text-muted font-medium">Capacity</dt>
          <dd className="text-text font-bold text-sm mt-0.5">
            {activeSpec.volumeOz} fl oz <span className="text-[11px] font-normal text-muted">({activeSpec.volumeMl} ml)</span>
          </dd>
        </div>

        <div className="p-2.5 rounded-lg bg-bg border border-border/60">
          <dt className="text-muted font-medium">Height</dt>
          <dd className="text-text font-bold text-sm mt-0.5">
            {activeSpec.dimensions.heightInches}" <span className="text-[11px] font-normal text-muted">({activeSpec.dimensions.heightCm} cm)</span>
          </dd>
        </div>

        <div className="p-2.5 rounded-lg bg-bg border border-border/60">
          <dt className="text-muted font-medium">Base Diameter</dt>
          <dd className="text-text font-bold text-sm mt-0.5">
            {activeSpec.dimensions.baseDiameterInches}" <span className="text-[11px] font-normal text-muted">({activeSpec.dimensions.baseDiameterCm} cm)</span>
          </dd>
        </div>

        <div className="p-2.5 rounded-lg bg-bg border border-border/60">
          <dt className="text-muted font-medium">Cup-Holder Fit</dt>
          <dd className="text-emerald-600 font-bold text-sm mt-0.5 flex items-center gap-1">
            <Car className="w-3.5 h-3.5 shrink-0" />
            <span>{activeSpec.cupHolderFit.rating}</span>
          </dd>
        </div>
      </dl>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-muted pt-1">
        <div className="flex items-center gap-2">
          <Droplets className="w-3.5 h-3.5 text-primary shrink-0" />
          <span>Cold 24h · Hot 12h · Double-Wall Vacuum</span>
        </div>
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-3.5 h-3.5 text-primary shrink-0" />
          <span>18/8 Food-Grade Stainless Steel · BPA-Free</span>
        </div>
      </div>
    </div>
  )
}

export default TumblerQuickSpecs
