import React, { useState, useEffect, useRef } from 'react'
import {
  Ruler,
  X,
  Car,
  Check,
  ShieldCheck,
  Sparkles,
  Droplets,
  Layers,
  Info,
  Maximize2
} from 'lucide-react'
import {
  type TumblerSpec,
  type TumblerMeasurementUnit,
  resolveTumblerSpecs,
  normalizeTumblerSizeKey,
} from '../lib/tumbler-sizing'
import type { Product } from '../types'

export interface TumblerSizeGuideModalProps {
  isOpen: boolean
  onClose: () => void
  product?: Pick<Product, 'name' | 'category' | 'metadata' | 'sizes'> | null
  currentSelectedSize?: string | null
  onSelectSize?: (size: string) => void
}

/**
 * Reusable Size & Fit Guide Modal for Tumbler Drinkware Products.
 *
 * Provides shoppers with:
 *  - Clear height, diameter, and liquid capacity measurements
 *  - Imperial (inches / oz) and Metric (cm / ml) unit toggling
 *  - Interactive silhouette diagrams with labeled dimension callouts
 *  - Standard vehicle cup-holder compatibility ratings
 *  - Side-by-side comparison matrix across all tumbler sizes
 *  - Care, thermal performance, and materials breakdown
 */
export const TumblerSizeGuideModal: React.FC<TumblerSizeGuideModalProps> = ({
  isOpen,
  onClose,
  product,
  currentSelectedSize,
  onSelectSize,
}) => {
  const [unit, setUnit] = useState<TumblerMeasurementUnit>('imperial')
  const [activeTab, setActiveTab] = useState<'diagram' | 'table' | 'care'>('diagram')
  const modalRef = useRef<HTMLDivElement>(null)

  const resolved = resolveTumblerSpecs(product)
  const initialKey = normalizeTumblerSizeKey(currentSelectedSize) || resolved.defaultSpec.id
  const [activeSizeId, setActiveSizeId] = useState<string>(initialKey)

  // Sync active size if currentSelectedSize changes externally
  useEffect(() => {
    const key = normalizeTumblerSizeKey(currentSelectedSize)
    if (key) setActiveSizeId(key)
  }, [currentSelectedSize])

  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = 'unset'
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  const activeSpec: TumblerSpec =
    resolved.allSizes.find(s => s.id === activeSizeId) || resolved.defaultSpec

  const handleSelectCurrent = () => {
    if (onSelectSize) {
      onSelectSize(activeSpec.shortLabel)
      onClose()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 md:p-6 bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tumbler-size-guide-title"
    >
      <div
        ref={modalRef}
        className="relative w-full max-w-4xl max-h-[92vh] flex flex-col bg-card rounded-2xl shadow-soft-xl border card-border overflow-hidden text-text"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/80 bg-bg/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
              <Ruler className="w-5 h-5" />
            </div>
            <div>
              <h2 id="tumbler-size-guide-title" className="text-lg sm:text-xl font-bold text-text">
                Tumbler Size & Fit Guide
              </h2>
              <p className="text-xs text-muted">
                {product?.name ? `${product.name} · ` : ''}Dimensions, liquid volume & cup-holder fit
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Unit Toggle */}
            <div className="inline-flex p-0.5 rounded-lg border card-border bg-bg/80 text-xs">
              <button
                type="button"
                onClick={() => setUnit('imperial')}
                className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                  unit === 'imperial'
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-muted hover:text-text'
                }`}
                aria-label="Switch to Imperial units (inches and ounces)"
              >
                In / Oz
              </button>
              <button
                type="button"
                onClick={() => setUnit('metric')}
                className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                  unit === 'metric'
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-muted hover:text-text'
                }`}
                aria-label="Switch to Metric units (centimeters and milliliters)"
              >
                Cm / Ml
              </button>
            </div>

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-lg border card-border flex items-center justify-center text-muted hover:text-text hover:bg-bg transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
              aria-label="Close size guide"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-border/80 px-5 bg-card text-sm">
          <button
            type="button"
            onClick={() => setActiveTab('diagram')}
            className={`py-3 px-4 font-semibold border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === 'diagram'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted hover:text-text'
            }`}
          >
            <Maximize2 className="w-4 h-4" />
            <span>Interactive Diagram</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('table')}
            className={`py-3 px-4 font-semibold border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === 'table'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted hover:text-text'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>All Sizes Comparison</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('care')}
            className={`py-3 px-4 font-semibold border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === 'care'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted hover:text-text'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>Fit & Care Tips</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
          {activeTab === 'diagram' && (
            <div className="space-y-6">
              {/* Size Selector Strip */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted">
                    Select Tumbler Model
                  </label>
                  {resolved.hasCustomMetadata && (
                    <span className="text-[11px] text-primary flex items-center gap-1 font-medium">
                      <Sparkles className="w-3 h-3" />
                      Custom listing attributes applied
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {resolved.allSizes.map((spec) => {
                    const isSelected = spec.id === activeSpec.id
                    const isApplicable = resolved.applicableSizes.some(s => s.id === spec.id)
                    return (
                      <button
                        key={spec.id}
                        type="button"
                        onClick={() => setActiveSizeId(spec.id)}
                        className={`text-left p-3 rounded-xl border-2 transition-all relative ${
                          isSelected
                            ? 'border-primary bg-primary/10 ring-2 ring-primary/30'
                            : 'border-border/80 hover:border-primary/50 bg-card hover:bg-primary/5'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-sm text-text">{spec.shortLabel}</span>
                          {spec.isDefault && (
                            <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-primary/20 text-primary">
                              Popular
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted truncate mt-0.5">{spec.name}</p>
                        <p className="text-[11px] text-text font-medium mt-1">
                          {unit === 'imperial'
                            ? `${spec.volumeOz} fl oz · ${spec.dimensions.heightInches}" H`
                            : `${spec.volumeMl} ml · ${spec.dimensions.heightCm} cm H`}
                        </p>
                        {isApplicable && (
                          <span className="inline-block mt-1 text-[10px] font-semibold text-emerald-600">
                            Available on listing
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Main Visual Diagram & Spec Card Grid */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
                {/* SVG Silhouette Visualizer */}
                <div className="md:col-span-5 flex flex-col items-center justify-center p-6 rounded-2xl bg-bg border border-border/80 relative">
                  <div className="text-center mb-2">
                    <span className="text-xs font-bold uppercase tracking-wide text-primary">
                      {activeSpec.name}
                    </span>
                  </div>

                  <div className="relative w-48 h-64 flex items-center justify-center">
                    {/* SVG Graphic Representation */}
                    <svg
                      viewBox="0 0 160 220"
                      className="w-full h-full drop-shadow-md"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      {/* Top Lid */}
                      <rect x="40" y="24" width="80" height="12" rx="4" className="fill-slate-300 stroke-slate-500" strokeWidth="1.5" />
                      {/* Straw */}
                      {activeSpec.lidAndStraw.strawIncluded && (
                        <rect x="85" y="6" width="6" height="30" rx="3" className="fill-primary/60 stroke-primary" strokeWidth="1" />
                      )}
                      {/* Tumbler Body */}
                      {activeSpec.id === '30oz' ? (
                        // Tapered 30oz profile
                        <path
                          d="M44 36 L116 36 L108 135 L98 200 L62 200 L52 135 Z"
                          className="fill-card stroke-slate-400"
                          strokeWidth="2"
                        />
                      ) : activeSpec.id === '12oz' ? (
                        // Curved wine profile
                        <path
                          d="M48 36 L112 36 C124 80 124 140 102 195 L58 195 C36 140 36 80 48 36 Z"
                          className="fill-card stroke-slate-400"
                          strokeWidth="2"
                        />
                      ) : activeSpec.id === '40oz' ? (
                        // 40oz Handle profile
                        <>
                          <path
                            d="M44 36 L116 36 L114 135 L98 145 L98 200 L62 200 L62 145 L46 135 Z"
                            className="fill-card stroke-slate-400"
                            strokeWidth="2"
                          />
                          {/* Handle */}
                          <path
                            d="M115 55 C138 55 138 125 115 125"
                            className="stroke-slate-500 fill-none"
                            strokeWidth="6"
                            strokeLinecap="round"
                          />
                        </>
                      ) : (
                        // Standard straight skinny 20oz
                        <path
                          d="M46 36 L114 36 L110 200 L50 200 Z"
                          className="fill-card stroke-slate-400"
                          strokeWidth="2"
                        />
                      )}

                      {/* Graphic wrap area indicator */}
                      <rect
                        x="52"
                        y="55"
                        width="56"
                        height="90"
                        rx="4"
                        className="fill-primary/10 stroke-primary/30 stroke-dasharray-2"
                        strokeDasharray="3 3"
                      />
                      <text x="80" y="105" textAnchor="middle" className="fill-primary font-bold text-[10px]">
                        Print Area
                      </text>

                      {/* Height dimension bar */}
                      <line x1="20" y1="26" x2="20" y2="200" className="stroke-primary" strokeWidth="1.5" />
                      <line x1="16" y1="26" x2="24" y2="26" className="stroke-primary" strokeWidth="1.5" />
                      <line x1="16" y1="200" x2="24" y2="200" className="stroke-primary" strokeWidth="1.5" />
                    </svg>

                    {/* Height label callout */}
                    <div className="absolute -left-3 top-1/2 -translate-y-1/2 bg-card border card-border px-1.5 py-0.5 rounded text-[10px] font-bold text-primary shadow-sm -rotate-90">
                      {unit === 'imperial'
                        ? `${activeSpec.dimensions.heightInches}"`
                        : `${activeSpec.dimensions.heightCm} cm`}
                    </div>

                    {/* Top Diameter Callout */}
                    <div className="absolute -top-1 left-1/2 -translate-x-1/2 bg-card border card-border px-2 py-0.5 rounded text-[10px] font-semibold text-text shadow-sm">
                      Top: {unit === 'imperial'
                        ? `${activeSpec.dimensions.topDiameterInches}"`
                        : `${activeSpec.dimensions.topDiameterCm} cm`}
                    </div>

                    {/* Base Diameter Callout */}
                    <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-card border card-border px-2 py-0.5 rounded text-[10px] font-semibold text-text shadow-sm">
                      Base: {unit === 'imperial'
                        ? `${activeSpec.dimensions.baseDiameterInches}"`
                        : `${activeSpec.dimensions.baseDiameterCm} cm`}
                    </div>
                  </div>

                  {/* Cup-holder Fit Badge */}
                  <div className="mt-4 flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold">
                    <Car className="w-3.5 h-3.5 shrink-0" />
                    <span>{activeSpec.cupHolderFit.rating} Cup-Holder Fit</span>
                  </div>
                </div>

                {/* Detailed Spec Sheet */}
                <div className="md:col-span-7 space-y-4">
                  <div>
                    <h3 className="text-xl font-bold text-text">{activeSpec.name}</h3>
                    <p className="text-xs text-muted mt-1 leading-relaxed">{activeSpec.bestFor}</p>
                  </div>

                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm p-4 rounded-xl border card-border bg-card/60">
                    <div>
                      <dt className="text-xs text-muted font-medium">Liquid Volume</dt>
                      <dd className="text-text font-bold text-base mt-0.5">
                        {unit === 'imperial'
                          ? `${activeSpec.volumeOz} fl oz`
                          : `${activeSpec.volumeMl} ml`}
                      </dd>
                    </div>

                    <div>
                      <dt className="text-xs text-muted font-medium">Height</dt>
                      <dd className="text-text font-bold text-base mt-0.5">
                        {unit === 'imperial'
                          ? `${activeSpec.dimensions.heightInches} inches`
                          : `${activeSpec.dimensions.heightCm} cm`}
                      </dd>
                    </div>

                    <div>
                      <dt className="text-xs text-muted font-medium">Top Diameter</dt>
                      <dd className="text-text font-medium mt-0.5">
                        {unit === 'imperial'
                          ? `${activeSpec.dimensions.topDiameterInches} in`
                          : `${activeSpec.dimensions.topDiameterCm} cm`}
                      </dd>
                    </div>

                    <div>
                      <dt className="text-xs text-muted font-medium">Base Diameter</dt>
                      <dd className="text-text font-medium mt-0.5">
                        {unit === 'imperial'
                          ? `${activeSpec.dimensions.baseDiameterInches} in`
                          : `${activeSpec.dimensions.baseDiameterCm} cm`}
                      </dd>
                    </div>

                    <div>
                      <dt className="text-xs text-muted font-medium">Circumference</dt>
                      <dd className="text-text font-medium mt-0.5">
                        {unit === 'imperial'
                          ? `${activeSpec.dimensions.circumferenceInches} in`
                          : `${activeSpec.dimensions.circumferenceCm} cm`}
                      </dd>
                    </div>

                    <div>
                      <dt className="text-xs text-muted font-medium">Empty Weight</dt>
                      <dd className="text-text font-medium mt-0.5">
                        {unit === 'imperial'
                          ? `${activeSpec.weightEmptyOz} oz`
                          : `${activeSpec.weightEmptyGrams} g`}
                      </dd>
                    </div>
                  </dl>

                  {/* Highlights Grid */}
                  <div className="space-y-2">
                    <div className="flex items-start gap-2.5 text-xs text-muted">
                      <Car className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                      <div>
                        <strong className="text-text font-semibold">Cup-Holder Compatibility:</strong>{' '}
                        {activeSpec.cupHolderFit.description}
                      </div>
                    </div>

                    <div className="flex items-start gap-2.5 text-xs text-muted">
                      <Droplets className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                      <div>
                        <strong className="text-text font-semibold">Thermal Performance:</strong>{' '}
                        {activeSpec.insulation.description}
                      </div>
                    </div>

                    <div className="flex items-start gap-2.5 text-xs text-muted">
                      <ShieldCheck className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                      <div>
                        <strong className="text-text font-semibold">Material & Quality:</strong>{' '}
                        {activeSpec.material.grade} — {activeSpec.material.description}
                      </div>
                    </div>

                    <div className="flex items-start gap-2.5 text-xs text-muted">
                      <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                      <div>
                        <strong className="text-text font-semibold">Lid & Accessories:</strong>{' '}
                        {activeSpec.lidAndStraw.description}
                      </div>
                    </div>
                  </div>

                  {/* Size selection CTA */}
                  {onSelectSize && (
                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={handleSelectCurrent}
                        className="w-full btn-primary shadow-glow flex items-center justify-center gap-2 py-2.5"
                      >
                        <Check className="w-4 h-4" />
                        <span>Select {activeSpec.shortLabel} for this order</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'table' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-bold text-text">Standard Tumbler Comparison Matrix</h3>
                <p className="text-xs text-muted mt-0.5">
                  Compare all Imagine This Printed drinkware models to find your preferred capacity and fit.
                </p>
              </div>

              <div className="overflow-x-auto rounded-xl border card-border">
                <table className="w-full text-left border-collapse text-xs sm:text-sm">
                  <thead>
                    <tr className="bg-bg border-b border-border/80 text-muted font-bold">
                      <th className="p-3">Model</th>
                      <th className="p-3">Capacity</th>
                      <th className="p-3">Height</th>
                      <th className="p-3">Top Dia.</th>
                      <th className="p-3">Base Dia.</th>
                      <th className="p-3">Cup-Holder</th>
                      <th className="p-3">Weight</th>
                      <th className="p-3">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y border-border/60">
                    {resolved.allSizes.map((spec) => {
                      const isSelected = spec.id === activeSpec.id
                      return (
                        <tr
                          key={spec.id}
                          className={`hover:bg-primary/5 transition-colors ${
                            isSelected ? 'bg-primary/10 font-medium' : ''
                          }`}
                        >
                          <td className="p-3 font-semibold text-text">
                            {spec.name}
                            {spec.isDefault && (
                              <span className="ml-1.5 text-[10px] uppercase font-bold text-primary">
                                (Popular)
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-text">
                            {unit === 'imperial'
                              ? `${spec.volumeOz} fl oz`
                              : `${spec.volumeMl} ml`}
                          </td>
                          <td className="p-3 text-text">
                            {unit === 'imperial'
                              ? `${spec.dimensions.heightInches}"`
                              : `${spec.dimensions.heightCm} cm`}
                          </td>
                          <td className="p-3 text-text">
                            {unit === 'imperial'
                              ? `${spec.dimensions.topDiameterInches}"`
                              : `${spec.dimensions.topDiameterCm} cm`}
                          </td>
                          <td className="p-3 text-text">
                            {unit === 'imperial'
                              ? `${spec.dimensions.baseDiameterInches}"`
                              : `${spec.dimensions.baseDiameterCm} cm`}
                          </td>
                          <td className="p-3 text-text">
                            <span className="inline-flex items-center gap-1 text-emerald-600 font-medium text-xs">
                              <Check className="w-3.5 h-3.5" />
                              {spec.cupHolderFit.rating}
                            </span>
                          </td>
                          <td className="p-3 text-muted">
                            {unit === 'imperial'
                              ? `${spec.weightEmptyOz} oz`
                              : `${spec.weightEmptyGrams} g`}
                          </td>
                          <td className="p-3">
                            <button
                              type="button"
                              onClick={() => {
                                setActiveSizeId(spec.id)
                                setActiveTab('diagram')
                              }}
                              className="text-xs text-primary font-bold hover:underline"
                            >
                              Inspect →
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className="p-3 rounded-lg bg-bg border border-border/80 flex items-start gap-2.5 text-xs text-muted">
                <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <p>
                  Measurements represent standard manufacturing targets with a ±0.05" (1.2mm) fabrication tolerance. All drinkware features double-wall 18/8 food-safe stainless steel vacuum insulation.
                </p>
              </div>
            </div>
          )}

          {activeTab === 'care' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-bold text-text">Fit Verification & Drinkware Care</h3>
                <p className="text-xs text-muted mt-0.5">
                  Guidance to ensure maximum thermal retention and print longevity.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl border card-border bg-card">
                  <div className="flex items-center gap-2 mb-2 text-primary font-bold text-sm">
                    <Car className="w-4 h-4" />
                    <h4>Vehicle Cup-Holder Compatibility</h4>
                  </div>
                  <p className="text-xs text-muted leading-relaxed">
                    Standard US and international automotive cup holders measure between <strong>3.0" and 3.25"</strong> (76–82 mm) in diameter. Our 20 oz Skinny (2.9"), 30 oz Travel (2.75" base), and 40 oz Adventure (2.9" base) are custom-engineered with slender bases specifically to seat securely in center console cup holders without tipping.
                  </p>
                </div>

                <div className="p-4 rounded-xl border card-border bg-card">
                  <div className="flex items-center gap-2 mb-2 text-primary font-bold text-sm">
                    <Droplets className="w-4 h-4" />
                    <h4>Washing & Graphic Care</h4>
                  </div>
                  <p className="text-xs text-muted leading-relaxed">
                    <strong>Hand washing is strongly recommended</strong> for the stainless steel body to preserve the vibrant gloss and fine linework of your printed graphic wrap. Lids and reusable straws are top-rack dishwasher safe. Avoid harsh bleach, chlorine, or scouring pads.
                  </p>
                </div>

                <div className="p-4 rounded-xl border card-border bg-card">
                  <div className="flex items-center gap-2 mb-2 text-primary font-bold text-sm">
                    <ShieldCheck className="w-4 h-4" />
                    <h4>Vacuum Thermal Seal</h4>
                  </div>
                  <p className="text-xs text-muted leading-relaxed">
                    The double-wall vacuum chamber prevents thermal conduction and stops external condensation ("sweating") completely. Your tumbler stays completely dry in your bag or hand without leaving water rings on wooden desks.
                  </p>
                </div>

                <div className="p-4 rounded-xl border card-border bg-card">
                  <div className="flex items-center gap-2 mb-2 text-primary font-bold text-sm">
                    <Check className="w-4 h-4" />
                    <h4>BPA-Free & Flavor-Neutral</h4>
                  </div>
                  <p className="text-xs text-muted leading-relaxed">
                    18/8 (304) kitchen-grade stainless steel does not leach chemicals or transfer residual taste. Switch from morning espresso to afternoon citrus iced water with zero flavor retention after a quick rinse.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border/80 bg-bg/50 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            <span>Food-Grade 18/8 Stainless Steel · BPA-Free · 100% Recyclable</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg border card-border bg-card text-text font-semibold hover:bg-bg transition-colors"
          >
            Close Guide
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Reusable Size Guide Trigger Button.
 *
 * Drops neatly next to size selectors, variant options, or spec lists.
 */
export const TumblerSizeGuideTrigger: React.FC<{
  onClick: () => void
  label?: string
  className?: string
}> = ({
  onClick,
  label = 'Size & Fit Guide',
  className = '',
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary-dark transition-colors py-1 px-2.5 rounded-md hover:bg-primary/10 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-1 ${className}`}
      aria-label="Open tumbler size and dimension guide"
    >
      <Ruler className="w-3.5 h-3.5 text-primary shrink-0" />
      <span>{label}</span>
    </button>
  )
}

export default TumblerSizeGuideModal
