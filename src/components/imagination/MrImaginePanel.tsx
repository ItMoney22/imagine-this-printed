import React, { useState, useEffect } from 'react';
import type { AutoLayoutPricing, FreeTrials } from '../../types';
import { imaginationApi } from '../../lib/api';
import { Loader2, Sparkles, Image as ImageIcon } from 'lucide-react';

interface MrImaginePanelProps {
  pricing: AutoLayoutPricing;
  freeTrials: FreeTrials;
  itcBalance: number;
  isProcessing: boolean;
  setIsProcessing: (processing: boolean) => void;
  onImageGenerated: (imageUrl: string) => void;
}

const styles = [
  { value: 'realistic', label: 'Realistic' },
  { value: 'cartoon', label: 'Cartoon' },
  { value: 'vintage', label: 'Vintage' },
  { value: 'minimalist', label: 'Minimalist' },
  { value: 'vaporwave', label: 'Vaporwave' },
];

const MrImaginePanel: React.FC<MrImaginePanelProps> = ({
  pricing,
  freeTrials,
  itcBalance,
  isProcessing,
  setIsProcessing,
  onImageGenerated,
}) => {
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState('realistic');
  const [error, setError] = useState<string | null>(null);
  const [recentGenerations, setRecentGenerations] = useState<string[]>([]);
  const [trialsRemaining, setTrialsRemaining] = useState(freeTrials.aiGeneration);

  useEffect(() => {
    // Load recent generations from localStorage
    const saved = localStorage.getItem('itp-recent-generations');
    if (saved) {
      setRecentGenerations(JSON.parse(saved));
    }

    // Load trials remaining
    const savedTrials = localStorage.getItem('itp-ai-generation-trials');
    if (savedTrials) {
      setTrialsRemaining(parseInt(savedTrials));
    }
  }, []);

  const saveRecentGeneration = (url: string) => {
    const updated = [url, ...recentGenerations.slice(0, 5)];
    setRecentGenerations(updated);
    localStorage.setItem('itp-recent-generations', JSON.stringify(updated));
  };

  const useTrial = () => {
    const newTrials = trialsRemaining - 1;
    setTrialsRemaining(newTrials);
    localStorage.setItem('itp-ai-generation-trials', newTrials.toString());
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError('Please enter a prompt');
      return;
    }

    const isFree = trialsRemaining > 0;
    if (!isFree && itcBalance < pricing.aiGeneration) {
      setError('Insufficient ITC balance');
      return;
    }

    setError(null);
    setIsProcessing(true);

    try {
      const { data } = await imaginationApi.generateImage({
        prompt: prompt.trim(),
        style,
        useTrial: isFree,
      });

      if (isFree) {
        useTrial();
      }

      const imageUrl = data.imageUrl || data.url || data.output;
      if (imageUrl) {
        saveRecentGeneration(imageUrl);
        onImageGenerated(imageUrl);
      }
      setPrompt('');
    } catch (err: any) {
      setError(err.message || 'Failed to generate image');
    } finally {
      setIsProcessing(false);
    }
  };

  const canGenerate = prompt.trim().length > 0 && (trialsRemaining > 0 || itcBalance >= pricing.aiGeneration);
  const isFree = trialsRemaining > 0;

  return (
    <div className="space-y-4">
      {/* Error Message */}
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Prompt Input */}
      <div>
        <label className="block text-xs font-medium text-muted mb-2">
          Describe what you want to create
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value.slice(0, 500))}
          placeholder="A vibrant sunset over mountains, digital art style..."
          rows={4}
          maxLength={500}
          disabled={isProcessing}
          className="w-full px-3 py-2 bg-bg border border-primary/30 rounded text-sm text-text placeholder-muted focus:outline-none focus:border-primary resize-none disabled:opacity-50"
        />
        <div className="flex justify-between mt-1">
          <span className="text-xs text-muted">{prompt.length}/500 characters</span>
        </div>
      </div>

      {/* Style Selector */}
      <div>
        <label className="block text-xs font-medium text-muted mb-2">Style</label>
        <select
          value={style}
          onChange={(e) => setStyle(e.target.value)}
          disabled={isProcessing}
          className="w-full px-3 py-2 bg-bg border border-primary/30 rounded text-sm text-text focus:outline-none focus:border-primary disabled:opacity-50"
        >
          {styles.map(s => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      {/* Generate Button */}
      <button
        onClick={handleGenerate}
        disabled={isProcessing || !canGenerate}
        className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded font-medium transition-all ${
          isProcessing || !canGenerate
            ? 'bg-primary/10 text-muted cursor-not-allowed'
            : 'bg-gradient-to-r from-primary to-secondary hover:shadow-glowLg text-white'
        }`}
      >
        {isProcessing ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            Generating...
          </>
        ) : (
          <>
            <Sparkles className="w-5 h-5" />
            {isFree ? (
              <span>Generate Free ({trialsRemaining} left)</span>
            ) : (
              <span>Generate ({pricing.aiGeneration} ITC)</span>
            )}
          </>
        )}
      </button>

      {/* Cost Info */}
      <div className="p-3 bg-bg rounded border border-primary/20">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">Free trials remaining:</span>
          <span className={`font-medium ${trialsRemaining > 0 ? 'text-green-400' : 'text-red-400'}`}>
            {trialsRemaining}
          </span>
        </div>
        {!isFree && (
          <div className="flex items-center justify-between text-sm mt-2 pt-2 border-t border-primary/20">
            <span className="text-muted">Cost per generation:</span>
            <span className="text-accent font-medium">{pricing.aiGeneration} ITC</span>
          </div>
        )}
      </div>

      {/* Recent Generations */}
      {recentGenerations.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-muted mb-2">Recent Generations</h4>
          <div className="grid grid-cols-3 gap-2">
            {recentGenerations.map((url, index) => (
              <button
                key={index}
                onClick={() => onImageGenerated(url)}
                className="aspect-square rounded border border-primary/30 overflow-hidden hover:border-primary transition-colors group"
                title="Add to canvas"
              >
                <img
                  src={url}
                  alt={`Generation ${index + 1}`}
                  className="w-full h-full object-cover group-hover:scale-110 transition-transform"
                />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Info */}
      <div className="p-3 bg-primary/5 rounded border border-primary/20">
        <div className="flex items-start gap-2">
          <ImageIcon className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
          <p className="text-xs text-muted leading-relaxed">
            Mr Imagine uses AI to create custom graphics from your descriptions.
            All generated images are 1024x1024px at 300 DPI, perfect for printing.
          </p>
        </div>
      </div>
    </div>
  );
};

export default MrImaginePanel;
