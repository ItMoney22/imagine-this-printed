import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const ImageDebug: React.FC = () => {
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProducts();
  }, []);

  const loadProducts = async () => {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('category', 'dtf-transfers')
        .order('name');

      if (error) throw error;
      setProducts(data || []);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="p-8">Loading...</div>;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8 text-text">Image Debug - DTF Transfers</h1>

      {products.map((product) => (
        <div key={product.id} className="mb-8 p-6 bg-card rounded-lg border card-border">
          <h2 className="text-xl font-bold mb-4 text-text">{product.name}</h2>

          <div className="mb-4">
            <p className="text-sm text-muted">Images in database: <strong>{product.images?.length || 0}</strong></p>
            <p className="text-sm text-muted mb-2">Product ID: {product.id}</p>
          </div>

          {product.images && product.images.length > 0 ? (
            <div>
              <h3 className="text-sm font-semibold mb-2 text-text">Image URLs:</h3>
              <div className="space-y-4">
                {product.images.map((img: string, idx: number) => (
                  <div key={idx} className="border card-border p-3 rounded">
                    <p className="text-xs text-muted mb-2">Image {idx + 1}:</p>
                    <p className="text-xs font-mono break-all mb-2 text-muted">{img}</p>

                    <div className="mt-2">
                      <img
                        src={img}
                        alt={`${product.name} - ${idx + 1}`}
                        className="w-32 h-32 object-cover rounded border card-border"
                        onLoad={() => console.log(`✅ Image ${idx + 1} loaded for ${product.name}`)}
                        onError={(e) => {
                          console.error(`❌ Image ${idx + 1} failed to load for ${product.name}`);
                          (e.target as HTMLImageElement).style.border = '2px solid red';
                        }}
                      />
                      <p className="text-xs text-green-600 mt-1">Image element rendered</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-red-600">⚠️ NO IMAGES IN DATABASE</p>
          )}
        </div>
      ))}
    </div>
  );
};

export default ImageDebug;

