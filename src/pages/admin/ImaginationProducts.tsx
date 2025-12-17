
import React, { useState, useEffect } from 'react';
import {
    Loader2,
    Trash2,
    Plus,
    Save,
    AlertCircle,
    CheckCircle,
    Hash,
    DollarSign,
    Maximize,
    Edit2,
    Settings
} from 'lucide-react';
import { imaginationApi } from '../../lib/api';
import type { ImaginationProductConfig, ImaginationProductSizeConfig } from '../../types';

export default function AdminImaginationProducts() {
    const [products, setProducts] = useState<ImaginationProductConfig[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    // Editing state
    const [selectedProduct, setSelectedProduct] = useState<ImaginationProductConfig | null>(null);
    const [editingSize, setEditingSize] = useState<ImaginationProductSizeConfig | null>(null);

    // New size form
    const [newSize, setNewSize] = useState<Partial<ImaginationProductSizeConfig>>({
        height: 12,
        priceUsd: 0,
        priceItc: 0,
        enabled: true
    });

    useEffect(() => {
        loadProducts();
    }, []);

    const loadProducts = async () => {
        setLoading(true);
        try {
            const { data } = await imaginationApi.admin.getProducts();
            setProducts(data);
            // If we were editing a product, refresh its data reference
            if (selectedProduct) {
                const updated = data.find((p: ImaginationProductConfig) => p.printType === selectedProduct.printType);
                if (updated) setSelectedProduct(updated);
            }
        } catch (e) {
            console.error('Failed to load products:', e);
            setError('Failed to load products. Connection to database may be down.');
        } finally {
            setLoading(false);
        }
    };

    const handleUpdateProduct = async (product: ImaginationProductConfig) => {
        setSaving(true);
        setError(null);
        try {
            await imaginationApi.admin.updateProduct(product.id, {
                displayName: product.displayName,
                description: product.description,
                minDpi: product.minDpi,
                rules: product.rules,
                // We generally don't change width for presets, but let's allow it for admins
                width: product.width
            });
            setSuccess('Product updated successfully');
            loadProducts();
        } catch (e) {
            console.error('Update failed:', e);
            setError('Failed to update product');
        } finally {
            setSaving(false);
            setTimeout(() => setSuccess(null), 3000);
        }
    };

    const handleSaveSize = async () => {
        if (!selectedProduct || !newSize.height) return;
        setSaving(true);
        setError(null);

        const sizeData = {
            productId: selectedProduct.id,
            height: newSize.height!,
            priceUsd: Number(newSize.priceUsd) || 0,
            priceItc: Number(newSize.priceItc) || 0,
            enabled: newSize.enabled ?? true
        };

        try {
            await imaginationApi.admin.upsertSize(sizeData);
            setSuccess('Size saved successfully');

            // Reset form
            setNewSize({ height: 12, priceUsd: 0, priceItc: 0, enabled: true });
            setEditingSize(null);

            loadProducts();
        } catch (e) {
            console.error('Save size failed:', e);
            setError('Failed to save size');
        } finally {
            setSaving(false);
            setTimeout(() => setSuccess(null), 3000);
        }
    };

    const handleDeleteSize = async (height: number) => {
        if (!selectedProduct || !confirm('Are you sure you want to delete this size configuration?')) return;
        setSaving(true);
        try {
            await imaginationApi.admin.deleteSize(selectedProduct.id, height);
            setSuccess('Size deleted');
            loadProducts();
        } catch (e) {
            console.error('Delete failed:', e);
            setError('Failed to delete size');
        } finally {
            setSaving(false);
        }
    };

    // Helper to calculate suggested price
    const calculateSuggestedPrice = (width: number, height: number, rate = 0.02) => {
        return Math.round(width * height * rate * 100) / 100;
    };

    if (loading && !products.length) {
        return (
            <div className="flex h-96 items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
            </div>
        );
    }

    return (
        <div className="p-6 max-w-7xl mx-auto">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-stone-900">Imagination Products</h1>
                    <p className="text-stone-500 mt-1">Configure print types, sizes, and pricing</p>
                </div>
                {success && (
                    <div className="px-4 py-2 bg-green-50 text-green-700 rounded-lg flex items-center gap-2 border border-green-200">
                        <CheckCircle className="w-4 h-4" />
                        {success}
                    </div>
                )}
                {error && (
                    <div className="px-4 py-2 bg-red-50 text-red-700 rounded-lg flex items-center gap-2 border border-red-200">
                        <AlertCircle className="w-4 h-4" />
                        {error}
                    </div>
                )}
            </div>

            <div className="grid lg:grid-cols-3 gap-6">
                {/* Product List */}
                <div className="space-y-4">
                    <h2 className="font-semibold text-lg text-stone-800 flex items-center gap-2">
                        <Hash className="w-5 h-5 text-purple-600" />
                        Print Types
                    </h2>
                    {products.map(product => (
                        <button
                            key={product.id}
                            onClick={() => {
                                setSelectedProduct(product);
                                setEditingSize(null);
                                setNewSize({ height: 12, priceUsd: 0, priceItc: 0, enabled: true });
                            }}
                            className={`w-full text-left p-4 rounded-xl border transition-all ${selectedProduct?.id === product.id
                                ? 'bg-purple-50 border-purple-500 ring-1 ring-purple-500 shadow-sm'
                                : 'bg-white border-stone-200 hover:border-purple-300 hover:shadow-md'
                                }`}
                        >
                            <div className="flex items-center justify-between mb-2">
                                <span className="font-bold text-stone-900">{product.displayName}</span>
                                <span className="text-xs px-2 py-1 bg-stone-100 rounded-full text-stone-600 font-mono">
                                    {product.printType}
                                </span>
                            </div>
                            <div className="flex items-center gap-4 text-sm text-stone-500">
                                <span className="flex items-center gap-1">
                                    <Maximize className="w-4 h-4" />
                                    {product.width}" Width
                                </span>
                                <span className="flex items-center gap-1">
                                    <Hash className="w-4 h-4" />
                                    {product.sizes?.length || 0} Sizes
                                </span>
                            </div>
                        </button>
                    ))}
                </div>

                {/* Editor Area */}
                <div className="lg:col-span-2 space-y-6">
                    {selectedProduct ? (
                        <>
                            {/* Product Details Config */}
                            <div className="bg-white p-6 rounded-2xl border border-stone-200 shadow-sm space-y-4">
                                <h3 className="font-semibold text-lg border-b border-stone-100 pb-2 mb-4">
                                    Configuration: {selectedProduct.displayName}
                                </h3>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-stone-700 mb-1">Display Name</label>
                                        <input
                                            type="text"
                                            className="w-full px-3 py-2 border rounded-lg"
                                            value={selectedProduct.displayName}
                                            onChange={(e) => setSelectedProduct({ ...selectedProduct, displayName: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-stone-700 mb-1">Fixed Width (inches)</label>
                                        <input
                                            type="number"
                                            className="w-full px-3 py-2 border rounded-lg bg-stone-50"
                                            value={selectedProduct.width}
                                            onChange={(e) => setSelectedProduct({ ...selectedProduct, width: parseFloat(e.target.value) })}
                                        />
                                    </div>
                                    <div className="col-span-2">
                                        <label className="block text-sm font-medium text-stone-700 mb-1">Description</label>
                                        <input
                                            type="text"
                                            className="w-full px-3 py-2 border rounded-lg"
                                            value={selectedProduct.description || ''}
                                            onChange={(e) => setSelectedProduct({ ...selectedProduct, description: e.target.value })}
                                        />
                                    </div>
                                </div>

                                <div className="flex justify-end pt-2">
                                    <button
                                        onClick={() => handleUpdateProduct(selectedProduct)}
                                        disabled={saving}
                                        className="flex items-center gap-2 px-4 py-2 bg-stone-800 text-white rounded-lg hover:bg-stone-900 transition-colors"
                                    >
                                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                        Save Details
                                    </button>
                                </div>
                            </div>

                            {/* Sizes Management */}
                            <div className="bg-white p-6 rounded-2xl border border-stone-200 shadow-sm">
                                <div className="flex items-center justify-between mb-6">
                                    <h3 className="font-semibold text-lg">Size Configuration</h3>

                                </div>

                                {/* Add/Edit Size Form */}
                                <div className="bg-stone-50 p-4 rounded-xl border border-stone-200 mb-6">
                                    <h4 className="text-sm font-semibold text-stone-800 mb-3 flex items-center gap-2">
                                        {editingSize ? <Edit2 className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                                        {editingSize ? 'Edit Size' : 'Add New Size'}
                                    </h4>
                                    <div className="grid grid-cols-4 gap-4 items-end">
                                        <div>
                                            <label className="block text-xs font-medium text-stone-500 mb-1">Height (in)</label>
                                            <input
                                                type="number"
                                                className="w-full px-3 py-2 border rounded-lg bg-white"
                                                value={newSize.height}
                                                onChange={(e) => {
                                                    const h = parseFloat(e.target.value);
                                                    setNewSize({
                                                        ...newSize,
                                                        height: h,
                                                        // Auto-suggest price when height changes
                                                        priceUsd: calculateSuggestedPrice(selectedProduct.width, h),
                                                        priceItc: calculateSuggestedPrice(selectedProduct.width, h)
                                                    });
                                                }}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-stone-500 mb-1">USD Price ($)</label>
                                            <input
                                                type="number"
                                                step="0.01"
                                                className="w-full px-3 py-2 border rounded-lg bg-white"
                                                value={newSize.priceUsd}
                                                onChange={(e) => setNewSize({ ...newSize, priceUsd: parseFloat(e.target.value) })}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-stone-500 mb-1">ITC Price</label>
                                            <input
                                                type="number"
                                                step="0.01"
                                                className="w-full px-3 py-2 border rounded-lg bg-white"
                                                value={newSize.priceItc}
                                                onChange={(e) => setNewSize({ ...newSize, priceItc: parseFloat(e.target.value) })}
                                            />
                                        </div>
                                        <div>
                                            <button
                                                onClick={handleSaveSize}
                                                disabled={!newSize.height || saving}
                                                className="w-full px-3 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center justify-center gap-2"
                                            >
                                                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                                {editingSize ? 'Update' : 'Add Size'}
                                            </button>
                                        </div>
                                    </div>
                                    <div className="mt-2 text-xs text-stone-500">
                                        Suggested price (2¢/sq in):
                                        <span className="font-mono ml-1 text-stone-700">
                                            ${calculateSuggestedPrice(selectedProduct.width, newSize.height || 0).toFixed(2)}
                                        </span>
                                    </div>
                                </div>

                                {/* Sizes Table */}
                                <div className="overflow-hidden rounded-xl border border-stone-200">
                                    <table className="w-full text-sm">
                                        <thead className="bg-stone-50 border-b border-stone-200">
                                            <tr>
                                                <th className="px-4 py-3 text-left font-medium text-stone-600">Height</th>
                                                <th className="px-4 py-3 text-left font-medium text-stone-600">USD</th>
                                                <th className="px-4 py-3 text-left font-medium text-stone-600">ITC</th>
                                                <th className="px-4 py-3 text-left font-medium text-stone-600">Status</th>
                                                <th className="px-4 py-3 text-right font-medium text-stone-600">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-stone-100">
                                            {selectedProduct.sizes?.length === 0 && (
                                                <tr>
                                                    <td colSpan={5} className="px-4 py-8 text-center text-stone-400 italic">
                                                        No sizes configured. Add one above.
                                                    </td>
                                                </tr>
                                            )}
                                            {selectedProduct.sizes?.map(size => (
                                                <tr key={size.id} className="hover:bg-stone-50/50 transition-colors">
                                                    <td className="px-4 py-3 font-medium text-stone-900">{size.height}"</td>
                                                    <td className="px-4 py-3 text-stone-600">${Number(size.priceUsd).toFixed(2)}</td>
                                                    <td className="px-4 py-3 text-stone-600">{Number(size.priceItc).toFixed(2)}</td>
                                                    <td className="px-4 py-3">
                                                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${size.enabled
                                                            ? 'bg-green-100 text-green-700'
                                                            : 'bg-stone-100 text-stone-500'
                                                            }`}>
                                                            {size.enabled ? 'Active' : 'Disabled'}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-right flex items-center justify-end gap-2">
                                                        <button
                                                            onClick={() => {
                                                                setEditingSize(size);
                                                                setNewSize({
                                                                    height: size.height,
                                                                    priceUsd: Number(size.priceUsd),
                                                                    priceItc: Number(size.priceItc),
                                                                    enabled: size.enabled
                                                                });
                                                            }}
                                                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                                        >
                                                            <Edit2 className="w-4 h-4" />
                                                        </button>
                                                        <button
                                                            onClick={() => handleDeleteSize(size.height)}
                                                            className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="bg-stone-50 rounded-2xl border border-stone-200 border-dashed h-full flex flex-col items-center justify-center text-stone-400 p-8 min-h-[400px]">
                            <Settings className="w-12 h-12 mb-4 opacity-50" />
                            <p className="font-medium">Select a product to configure</p>
                            <p className="text-sm">Choose a print type from the list to manage its settings</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
