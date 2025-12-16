import React, { useState, useMemo } from 'react';
import type { Layer, Sheet, PrintType, PaymentMethod } from '../../types';
import { imaginationApi } from '../../lib/api';
import { Loader2, ShoppingCart, Eye, CheckCircle2, AlertTriangle, XCircle, DollarSign, Coins } from 'lucide-react';
import { useCart } from '../../context/CartContext';
import { useAuth } from '../../context/SupabaseAuthContext';

interface ExportPanelProps {
  sheet: Sheet;
  layers: Layer[];
  isProcessing: boolean;
  setIsProcessing: (processing: boolean) => void;
}

interface PreflightCheck {
  id: string;
  label: string;
  status: 'pass' | 'warning' | 'fail';
  message: string;
}

const ExportPanel: React.FC<ExportPanelProps> = ({
  sheet,
  layers,
  isProcessing,
  setIsProcessing,
}) => {
  const { addToCart } = useCart();
  const { user } = useAuth();
  const [includeCutlines, setIncludeCutlines] = useState(false);
  const [mirrorForSublimation, setMirrorForSublimation] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('usd');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [calculatedPrice, setCalculatedPrice] = useState<number | null>(null);

  // Pre-flight checks
  const preflightChecks: PreflightCheck[] = useMemo(() => {
    const checks: PreflightCheck[] = [];

    // Check if there are any layers
    if (layers.length === 0) {
      checks.push({
        id: 'no-layers',
        label: 'Content Check',
        status: 'fail',
        message: 'No layers on canvas',
      });
    } else {
      checks.push({
        id: 'has-content',
        label: 'Content Check',
        status: 'pass',
        message: `${layers.length} layer${layers.length > 1 ? 's' : ''} ready`,
      });
    }

    // Check DPI for image layers
    const imageLayers = layers.filter(l => l.type === 'image');
    const lowDpiLayers = imageLayers.filter(l => (l.dpi || 0) < 150);
    const mediumDpiLayers = imageLayers.filter(l => (l.dpi || 0) >= 150 && (l.dpi || 0) < 300);

    if (lowDpiLayers.length > 0) {
      checks.push({
        id: 'dpi-check',
        label: 'Image Quality',
        status: 'fail',
        message: `${lowDpiLayers.length} image${lowDpiLayers.length > 1 ? 's' : ''} below 150 DPI`,
      });
    } else if (mediumDpiLayers.length > 0) {
      checks.push({
        id: 'dpi-check',
        label: 'Image Quality',
        status: 'warning',
        message: `${mediumDpiLayers.length} image${mediumDpiLayers.length > 1 ? 's' : ''} below 300 DPI`,
      });
    } else if (imageLayers.length > 0) {
      checks.push({
        id: 'dpi-check',
        label: 'Image Quality',
        status: 'pass',
        message: 'All images are 300+ DPI',
      });
    }

    // Check if elements are within bounds
    const outOfBounds = layers.filter(l => {
      const right = l.x + l.width;
      const bottom = l.y + l.height;
      return l.x < 0 || l.y < 0 || right > sheet.width || bottom > sheet.height;
    });

    if (outOfBounds.length > 0) {
      checks.push({
        id: 'bounds-check',
        label: 'Bounds Check',
        status: 'warning',
        message: `${outOfBounds.length} element${outOfBounds.length > 1 ? 's' : ''} outside sheet area`,
      });
    } else if (layers.length > 0) {
      checks.push({
        id: 'bounds-check',
        label: 'Bounds Check',
        status: 'pass',
        message: 'All elements within bounds',
      });
    }

    return checks;
  }, [layers, sheet]);

  const canAddToCart = layers.length > 0 && !preflightChecks.some(c => c.status === 'fail');

  const getStatusIcon = (status: 'pass' | 'warning' | 'fail') => {
    switch (status) {
      case 'pass':
        return <CheckCircle2 className="w-4 h-4 text-green-400" />;
      case 'warning':
        return <AlertTriangle className="w-4 h-4 text-yellow-400" />;
      case 'fail':
        return <XCircle className="w-4 h-4 text-red-400" />;
    }
  };

  // Calculate pricing based on print type and payment method
  const pricing = useMemo(() => {
    // Pricing table based on print type
    const PRICING_TABLE: Record<PrintType, { base: number; usd: number; itc: number }> = {
      dtf: { base: 14, usd: 15.00, itc: 14.00 },
      sublimation: { base: 8, usd: 9.00, itc: 8.00 },
      uv_dtf: { base: 12, usd: 13.00, itc: 12.00 },
    };

    const printTypePricing = PRICING_TABLE[sheet.printType];

    return {
      usd: printTypePricing.usd,
      itc: printTypePricing.itc,
      savings: printTypePricing.usd - printTypePricing.itc,
    };
  }, [sheet.printType]);

  const selectedPrice = useMemo(() => {
    return paymentMethod === 'itc' ? pricing.itc : pricing.usd;
  }, [paymentMethod, pricing]);

  const handlePreview = async () => {
    setError(null);
    setIsProcessing(true);
    setPreviewUrl(null);

    try {
      const { data } = await imaginationApi.previewExport({
        sheet,
        layers,
        format: 'png', // Always use PNG for preview
        options: {
          includeCutlines,
          mirrorForSublimation,
        },
      });

      setPreviewUrl(data.previewUrl || data.url);
      setCalculatedPrice(selectedPrice);
    } catch (err: any) {
      setError(err.message || 'Failed to generate preview');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAddToCart = async () => {
    if (!user) {
      setError('Please sign in to add items to cart');
      return;
    }

    setError(null);
    setSuccess(null);
    setIsProcessing(true);

    try {
      // Generate preview image for cart
      const { data } = await imaginationApi.previewExport({
        sheet,
        layers,
        format: 'png',
        options: {
          includeCutlines,
          mirrorForSublimation,
        },
      });

      const previewImageUrl = data.previewUrl || data.url;

      // Create an Imagination Sheet™ product
      const imaginationSheetProduct = {
        id: `imagination-sheet-${Date.now()}`,
        name: `Imagination Sheet™ - ${sheet.name || 'Untitled'}`,
        description: `Custom Imagination Sheet™ (${sheet.width}" x ${sheet.height}") with ${layers.length} element${layers.length > 1 ? 's' : ''}`,
        price: selectedPrice,
        images: [previewImageUrl],
        category: 'dtf-transfers' as const,
        inStock: true,
        productType: 'physical' as const,
        metadata: {
          isImaginationSheet: true,
          sheetId: sheet.id,
          sheetSize: `${sheet.width}" x ${sheet.height}"`,
          layerCount: layers.length,
          printType: sheet.printType,
          paymentMethod: paymentMethod,
          pricingInfo: {
            usd: pricing.usd,
            itc: pricing.itc,
            selected: selectedPrice,
          },
        },
      };

      // Prepare design data with full configuration
      const designData = {
        elements: layers.map((layer, index) => ({
          id: layer.id,
          name: layer.name,
          type: layer.type,
          x: layer.x,
          y: layer.y,
          width: layer.width,
          height: layer.height,
          rotation: layer.rotation,
          imageUrl: layer.imageUrl,
          dpi: layer.dpi,
          zIndex: index,
        })),
        template: 'imagination-sheet',
        mockupUrl: previewImageUrl,
        canvasSnapshot: JSON.stringify({
          sheet: {
            id: sheet.id,
            name: sheet.name,
            width: sheet.width,
            height: sheet.height,
            printType: sheet.printType,
          },
          layers: layers,
          options: {
            includeCutlines,
            mirrorForSublimation,
          },
        }),
      };

      // Add to cart with design data
      addToCart(
        imaginationSheetProduct,
        1, // quantity
        undefined, // selectedSize
        undefined, // selectedColor
        previewImageUrl, // customDesign (preview URL)
        designData,
        paymentMethod // payment method (usd or itc)
      );

      setSuccess('Imagination Sheet™ added to cart successfully!');
      setTimeout(() => {
        setSuccess(null);
      }, 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to add to cart');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Error/Success Messages */}
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded text-sm text-red-400">
          {error}
        </div>
      )}
      {success && (
        <div className="p-3 bg-green-500/10 border border-green-500/30 rounded text-sm text-green-400">
          {success}
        </div>
      )}

      {/* Pre-flight Checklist */}
      <div>
        <h4 className="text-xs font-medium text-muted mb-2">Pre-flight Checklist</h4>
        <div className="space-y-2">
          {preflightChecks.map(check => (
            <div
              key={check.id}
              className={`p-3 rounded border ${
                check.status === 'pass'
                  ? 'bg-green-500/5 border-green-500/30'
                  : check.status === 'warning'
                  ? 'bg-yellow-500/5 border-yellow-500/30'
                  : 'bg-red-500/5 border-red-500/30'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                {getStatusIcon(check.status)}
                <span className="text-sm font-medium text-text">{check.label}</span>
              </div>
              <p className={`text-xs ${
                check.status === 'pass'
                  ? 'text-green-400'
                  : check.status === 'warning'
                  ? 'text-yellow-400'
                  : 'text-red-400'
              }`}>
                {check.message}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Payment Method Selector */}
      <div className="p-4 bg-card border border-primary/20 rounded">
        <h4 className="text-sm font-medium text-text mb-3">Payment Method</h4>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setPaymentMethod('usd')}
            className={`p-3 rounded-lg border-2 transition-all ${
              paymentMethod === 'usd'
                ? 'border-primary bg-primary/10 shadow-glow'
                : 'border-primary/20 bg-bg hover:border-primary/40'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <DollarSign className={`w-5 h-5 ${paymentMethod === 'usd' ? 'text-primary' : 'text-muted'}`} />
              <span className={`text-xs font-medium ${paymentMethod === 'usd' ? 'text-primary' : 'text-muted'}`}>
                USD
              </span>
            </div>
            <div className="text-left">
              <div className={`text-lg font-bold ${paymentMethod === 'usd' ? 'text-primary' : 'text-text'}`}>
                ${pricing.usd.toFixed(2)}
              </div>
              <div className="text-xs text-muted">Credit/Debit Card</div>
            </div>
          </button>

          <button
            onClick={() => setPaymentMethod('itc')}
            disabled={!user || (user.wallet?.itcBalance || 0) < pricing.itc}
            className={`p-3 rounded-lg border-2 transition-all ${
              paymentMethod === 'itc'
                ? 'border-secondary bg-secondary/10 shadow-glow'
                : 'border-primary/20 bg-bg hover:border-primary/40'
            } ${(!user || (user.wallet?.itcBalance || 0) < pricing.itc) ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <div className="flex items-center justify-between mb-1">
              <Coins className={`w-5 h-5 ${paymentMethod === 'itc' ? 'text-secondary' : 'text-muted'}`} />
              <span className={`text-xs font-medium ${paymentMethod === 'itc' ? 'text-secondary' : 'text-muted'}`}>
                ITC
              </span>
            </div>
            <div className="text-left">
              <div className={`text-lg font-bold ${paymentMethod === 'itc' ? 'text-secondary' : 'text-text'}`}>
                {pricing.itc.toFixed(2)} ITC
              </div>
              <div className="text-xs text-muted">
                {user ? `Balance: ${(user.wallet?.itcBalance || 0).toFixed(2)}` : 'Sign in to use'}
              </div>
            </div>
          </button>
        </div>

        {paymentMethod === 'itc' && pricing.savings > 0 && (
          <div className="mt-3 p-2 bg-green-500/10 border border-green-500/30 rounded text-center">
            <p className="text-xs text-green-400 font-medium">
              Save ${pricing.savings.toFixed(2)} with ITC!
            </p>
          </div>
        )}
      </div>

      {/* Pricing Summary */}
      <div className="p-4 bg-primary/10 border border-primary/30 rounded">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-text">Total Price</span>
          <div className="flex items-center gap-1">
            {paymentMethod === 'usd' ? (
              <>
                <DollarSign className="w-4 h-4 text-primary" />
                <span className="text-xl font-bold text-primary">
                  {selectedPrice.toFixed(2)}
                </span>
              </>
            ) : (
              <>
                <Coins className="w-4 h-4 text-secondary" />
                <span className="text-xl font-bold text-secondary">
                  {selectedPrice.toFixed(2)} ITC
                </span>
              </>
            )}
          </div>
        </div>
        <p className="text-xs text-muted">
          {sheet.printType.toUpperCase().replace('_', ' ')} • {sheet.width}" x {sheet.height}"
        </p>
      </div>

      {/* Print Options - Conditionally shown based on print type */}
      <div>
        <h4 className="text-xs font-medium text-muted mb-2">Options</h4>
        <div className="space-y-2">
          {/* Show cutlines toggle ONLY for UV DTF */}
          {sheet.printType === 'uv_dtf' && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={includeCutlines}
                onChange={(e) => setIncludeCutlines(e.target.checked)}
                className="w-4 h-4 rounded border-primary/30 bg-bg text-primary focus:ring-primary focus:ring-offset-0"
              />
              <span className="text-sm text-text">Include cutlines (for UV DTF)</span>
            </label>
          )}

          {/* Show mirror toggle ONLY for Sublimation */}
          {sheet.printType === 'sublimation' && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={mirrorForSublimation}
                onChange={(e) => setMirrorForSublimation(e.target.checked)}
                className="w-4 h-4 rounded border-primary/30 bg-bg text-primary focus:ring-primary focus:ring-offset-0"
              />
              <span className="text-sm text-text">Mirror for sublimation</span>
            </label>
          )}

          {/* Show info if no options available (DTF) */}
          {sheet.printType === 'dtf' && (
            <p className="text-xs text-muted italic">No additional print options for DTF</p>
          )}
        </div>
      </div>

      {/* Preview */}
      {previewUrl && (
        <div>
          <h4 className="text-xs font-medium text-muted mb-2">Preview</h4>
          <div className="border border-primary/30 rounded overflow-hidden">
            <img
              src={previewUrl}
              alt="Export preview"
              className="w-full h-auto"
            />
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="space-y-2">
        <button
          onClick={handlePreview}
          disabled={isProcessing || !canAddToCart}
          className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded font-medium transition-all ${
            isProcessing || !canAddToCart
              ? 'bg-primary/10 text-muted cursor-not-allowed'
              : 'bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30 hover:border-primary'
          }`}
        >
          {isProcessing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Eye className="w-4 h-4" />
          )}
          Preview Design
        </button>

        <button
          onClick={handleAddToCart}
          disabled={isProcessing || !canAddToCart || !user}
          className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded font-medium transition-all ${
            isProcessing || !canAddToCart || !user
              ? 'bg-secondary/10 text-muted cursor-not-allowed'
              : 'bg-gradient-to-r from-secondary to-accent hover:shadow-glowLg text-white'
          }`}
        >
          {isProcessing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <ShoppingCart className="w-4 h-4" />
          )}
          {!user ? 'Sign in to Add to Cart' : 'Add to Cart'}
        </button>
      </div>

      {/* Info */}
      <div className="p-3 bg-bg rounded border border-primary/20">
        <p className="text-xs text-muted leading-relaxed">
          <strong>Add to Cart:</strong> Save your design and proceed to checkout<br />
          <strong>Cutlines:</strong> Add registration marks for UV DTF transfers<br />
          <strong>Mirror:</strong> Flip design horizontally for sublimation printing<br />
          <strong>Preview:</strong> See how your final design will look
        </p>
      </div>
    </div>
  );
};

export default ExportPanel;
