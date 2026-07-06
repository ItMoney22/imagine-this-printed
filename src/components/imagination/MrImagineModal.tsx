// src/components/imagination/MrImagineModal.tsx
// Mr. Imagine Lightbox with DTF-style prompting, multi-image generation, and enhanced UX

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  X,
  Sparkles,
  Wand2,
  Loader2,
  Download,
  RefreshCw,
  Check,
  Lightbulb,
  Palette,
  Layers,
  Maximize2,
  ChevronDown,
  AlertCircle,
  Mic,
  Square,
  Volume2,
  VolumeX
} from 'lucide-react';
import type { AutoLayoutPricing, FreeTrials } from '../../types';
import { imaginationApi } from '../../lib/api';
import { itcToUsdLabel } from '../../lib/itc-pricing';
import { CHECKERBOARD_BG } from './checkerboard';

interface MrImagineModalProps {
  isOpen: boolean;
  onClose: () => void;
  pricing: AutoLayoutPricing;
  freeTrials: FreeTrials;
  itcBalance: number;
  onImageGenerated: (imageUrl: string, metadata?: MrImagineGeneratedImageMetadata) => void;
  /** Called with the user's new ITC balance right after a generation charges. */
  onBalanceUpdate?: (newBalance: number) => void;
}

type GenerationState = 'idle' | 'generating' | 'complete' | 'error';

interface MrImagineGeneratedImageMetadata {
  printWidthInches: number;
  printSizeLabel: string;
  source: 'mr-imagine';
}

interface GeneratedImageResult {
  url: string;
  modelLabel: string;
  added: boolean;
}

// DTF-compatible style presets matching AI Product Builder
const DTF_STYLES = [
  {
    key: 'dtf-print-ready',
    label: 'DTF Print Ready (Default)',
    description: 'Optimized for DTF transfers - clean edges, solid colors',
    prompt_suffix: 'clean crisp edges, solid vibrant colors, vector-style clarity, professional print-ready, centered composition, bold clean shapes'
  },
  {
    key: 'realistic',
    label: 'Realistic',
    description: 'Photorealistic details and textures',
    prompt_suffix: 'HYPER-REALISTIC photographic style, real photography quality, dramatic studio lighting, sharp ultra-detailed textures, professional 3D render quality, lifelike realistic depth and shadows, NOT cartoon NOT illustrated NOT flat'
  },
  {
    key: 'cartoon',
    label: 'Cartoon',
    description: 'Bold outlines, vibrant colors',
    prompt_suffix: 'cartoon style, vibrant colors, bold outlines, fun playful'
  },
  {
    key: 'vintage',
    label: 'Vintage/Retro',
    description: 'Nostalgic retro aesthetic',
    prompt_suffix: 'vintage style, retro aesthetic, distressed texture, nostalgic'
  },
  {
    key: 'minimalist',
    label: 'Minimalist',
    description: 'Simple, clean designs',
    prompt_suffix: 'minimalist design, clean lines, simple shapes, modern'
  },
  {
    key: 'grunge',
    label: 'Grunge',
    description: 'Distressed, worn look',
    prompt_suffix: 'grunge aesthetic, distressed texture, rough edges, worn vintage look'
  },
];

// Background options
const BACKGROUND_OPTIONS = [
  { key: 'transparent', label: 'Transparent', description: 'Best for DTF - no background' },
  { key: 'solid-white', label: 'Solid White', description: 'Clean white backdrop' },
  { key: 'solid-black', label: 'Solid Black', description: 'Dark background' },
];

// Shirt color affects design colors (from DTF optimizer)
const SHIRT_COLORS = [
  { key: 'black', label: 'Black Shirt', colorHint: 'Use bright, vibrant colors - no black in design' },
  { key: 'white', label: 'White Shirt', colorHint: 'Use colors with good contrast, avoid pure white' },
  { key: 'grey', label: 'Grey Shirt', colorHint: 'Use bold saturated colors' },
  { key: 'color', label: 'Colored Shirt', colorHint: 'Use high contrast colors' },
];

// DTF print-width presets
const SIZE_OPTIONS = [
  { key: 'pocket', label: 'Pocket 4"', printWidthInches: 4 },
  { key: 'youth', label: 'Youth 7"', printWidthInches: 7 },
  { key: 'small', label: 'Small 8"', printWidthInches: 8 },
  { key: 'medium', label: 'Medium 9"', printWidthInches: 9 },
  { key: 'large', label: 'Large 10"', printWidthInches: 10 },
  { key: 'xl', label: 'XL 11"', printWidthInches: 11 },
  { key: 'xxl', label: 'XXL 12"', printWidthInches: 12 },
  { key: 'xxxl', label: 'XXXL 13"', printWidthInches: 13 },
];

// Example prompts for inspiration
const EXAMPLE_PROMPTS = [
  "A fierce tiger with glowing eyes emerging from flames",
  "Retro sunset with palm trees and 'GOOD VIBES' text",
  "Sugar skull with colorful flowers Day of the Dead style",
  "Astronaut floating in space with colorful galaxy background",
  "Vintage motorcycle with American flag wings",
  "Cute kawaii cat holding a taco",
  "Geometric wolf head in low-poly style",
  "Classic hot rod car with flames",
];

/**
 * Build the design prompt. POSITIVE-ONLY and subject-first.
 *
 * Why no "shirt / garment / fabric / mockup / do-not-include-a-shirt" language:
 * diffusion models weight negations weakly, so naming a garment AT ALL (even to
 * forbid it) makes one appear (this is why Flux rendered a shirt). We describe
 * ONLY the standalone artwork + a solid background; the backend appends the
 * hard background rule and runs each model's own prompt-tailoring on top.
 */
function buildDTFPrompt(
  userPrompt: string,
  style: typeof DTF_STYLES[number],
  shirtColor: string,
  background: string // eslint-disable-line @typescript-eslint/no-unused-vars
): string {
  const BG_NAME: Record<string, string> = {
    black: 'a solid black',
    white: 'a solid white',
    grey: 'a solid heather-grey',
    color: 'a single solid complementary-color',
  };
  const bg = BG_NAME[shirtColor] || 'a solid black';

  // Positive color steering only — no "fabric"/"shirt" words.
  let colorGuidance = 'bold, high-contrast, saturated colors';
  if (shirtColor === 'black') colorGuidance = 'bright, vivid, glowing saturated colors that pop against the dark background (keep near-black tones out of the art)';
  else if (shirtColor === 'white') colorGuidance = 'rich saturated colors with clean defining outlines (avoid large pure-white areas)';
  else if (shirtColor === 'grey') colorGuidance = 'bold, saturated, high-contrast colors';

  // Subject FIRST (models weight early tokens). Purely a description of the
  // standalone graphic — no garment/mockup/transparency words anywhere.
  return `${userPrompt}. ${style.prompt_suffix}. A single isolated graphic illustration with one clear central subject, bold clean shapes and crisp defined edges, ${colorGuidance}, professional print-ready artwork centered on ${bg} background that fills the entire frame.`;
}

const MrImagineModal: React.FC<MrImagineModalProps> = ({
  isOpen,
  onClose,
  pricing,
  freeTrials,
  itcBalance,
  onImageGenerated,
  onBalanceUpdate,
}) => {
  // Form state
  const [prompt, setPrompt] = useState('');
  const [selectedStyle, setSelectedStyle] = useState(DTF_STYLES[0]);
  const [shirtColor, setShirtColor] = useState<string>('black');
  const [background, setBackground] = useState<string>('transparent');
  const [printSizeKey, setPrintSizeKey] = useState<string>('pocket');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [imageCount, setImageCount] = useState(1);
  const [genTier, setGenTier] = useState<'standard' | 'premium'>('standard');

  // Premium = GPT Image 2 (top quality, reliable, best with text). 50 ITC / $0.50 per image.
  const PREMIUM_ITC = 50;

  // Generation state
  const [generationState, setGenerationState] = useState<GenerationState>('idle');
  const [generatedImages, setGeneratedImages] = useState<GeneratedImageResult[]>([]);
  const [failureCount, setFailureCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // "Random idea" generator state (smart, server-backed with offline fallback)
  const [randomLoading, setRandomLoading] = useState(false);
  const lastIdeaRef = useRef<string>('');

  // Voice conversation state — talk to Mr. Imagine with the mic, hear him reply
  const [isRecording, setIsRecording] = useState(false);
  const [isVoiceThinking, setIsVoiceThinking] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceConversation, setVoiceConversation] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [readyToGenerateHint, setReadyToGenerateHint] = useState(false);
  const [voiceMuted, setVoiceMuted] = useState<boolean>(() => localStorage.getItem('itp-mr-imagine-muted') === '1');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Trial tracking (synced with localStorage)
  const [trialsRemaining, setTrialsRemaining] = useState(freeTrials.aiGeneration);

  useEffect(() => {
    const savedTrials = localStorage.getItem('itp-ai-generation-trials');
    if (savedTrials) {
      setTrialsRemaining(parseInt(savedTrials));
    }
  }, [isOpen]);

  const consumeTrial = () => {
    const newTrials = Math.max(0, trialsRemaining - 1);
    setTrialsRemaining(newTrials);
    localStorage.setItem('itp-ai-generation-trials', newTrials.toString());
  };

  // Cost calculation. Standard: table price, free trial covers the first image.
  // Premium: flat PREMIUM_ITC per image, no free trial.
  const perImageCost = genTier === 'premium' ? PREMIUM_ITC : pricing.aiGeneration;
  const isFreeFirst = genTier === 'standard' && trialsRemaining > 0;
  const chargeable = genTier === 'premium'
    ? imageCount
    : Math.max(0, imageCount - (isFreeFirst ? 1 : 0));
  const totalCost = chargeable * perImageCost;
  const canAfford = itcBalance >= totalCost;

  // "Surprise me" idea — asks Mr. Imagine's brain for a fresh, on-trend idea
  // (rotating trend lenses server-side so it stops repeating). Falls back to the
  // static list, never repeating the previous pick, if the brain is unavailable.
  const getRandomExample = useCallback(async () => {
    setRandomLoading(true);
    setError(null);
    try {
      const { data } = await imaginationApi.getRandomIdea();
      const idea = (data?.idea || '').trim();
      if (idea) {
        lastIdeaRef.current = idea;
        setPrompt(idea.slice(0, 500));
        return;
      }
      throw new Error('empty');
    } catch {
      let pick = EXAMPLE_PROMPTS[Math.floor(Math.random() * EXAMPLE_PROMPTS.length)];
      let guard = 0;
      while (pick === lastIdeaRef.current && guard++ < 6) {
        pick = EXAMPLE_PROMPTS[Math.floor(Math.random() * EXAMPLE_PROMPTS.length)];
      }
      lastIdeaRef.current = pick;
      setPrompt(pick);
    } finally {
      setRandomLoading(false);
    }
  }, []);

  // ---- Voice: talk to Mr. Imagine ----
  const toggleMute = useCallback(() => {
    setVoiceMuted((m) => {
      const next = !m;
      localStorage.setItem('itp-mr-imagine-muted', next ? '1' : '0');
      if (next && audioRef.current) {
        audioRef.current.pause();
        setIsSpeaking(false);
      }
      return next;
    });
  }, []);

  const speak = useCallback(async (text: string) => {
    if (!text) return;
    try {
      setIsSpeaking(true);
      const { data } = await imaginationApi.synthesizeVoice(text);
      const url = data?.audioUrl;
      if (url && audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.onended = () => setIsSpeaking(false);
        await audioRef.current.play();
      } else {
        setIsSpeaking(false);
      }
    } catch {
      // Voice output is best-effort; silence on failure (text reply still shows).
      setIsSpeaking(false);
    }
  }, []);

  const handleRecordingStop = useCallback(async () => {
    const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
    audioChunksRef.current = [];
    if (blob.size < 1200) {
      setVoiceError("I didn't catch that — hold the mic a touch longer.");
      return;
    }
    setIsVoiceThinking(true);
    setVoiceError(null);
    try {
      const { data: tr } = await imaginationApi.transcribeAudio(blob);
      const userText = (tr?.text || '').trim();
      if (!userText) {
        setVoiceError("I didn't catch that — try again.");
        return;
      }
      const nextConvo = [...voiceConversation, { role: 'user' as const, content: userText }];
      setVoiceConversation(nextConvo);
      const { data: br } = await imaginationApi.brainstorm(nextConvo);
      const reply = (br?.reply || '').trim();
      const suggestion = (br?.promptSuggestion || '').trim();
      if (reply) setVoiceConversation((prev) => [...prev, { role: 'assistant', content: reply }]);
      if (suggestion) setPrompt(suggestion.slice(0, 500));
      setReadyToGenerateHint(!!br?.readyToGenerate);
      if (!voiceMuted && reply) void speak(reply);
    } catch (err: any) {
      setVoiceError(err?.response?.data?.error || 'Voice chat failed. Please try again.');
    } finally {
      setIsVoiceThinking(false);
    }
  }, [voiceConversation, voiceMuted, speak]);

  const startRecording = useCallback(async () => {
    setVoiceError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = () => { void handleRecordingStop(); };
      mr.start();
      setIsRecording(true);
    } catch {
      setVoiceError('Microphone access was blocked. Allow mic access in your browser to talk.');
    }
  }, [handleRecordingStop]);

  const stopRecording = useCallback(() => {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== 'inactive') mr.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setIsRecording(false);
  }, []);

  const toggleRecording = useCallback(() => {
    if (isRecording) stopRecording();
    else void startRecording();
  }, [isRecording, startRecording, stopRecording]);

  // Stop mic + audio whenever the modal closes.
  useEffect(() => {
    if (!isOpen) {
      const mr = mediaRecorderRef.current;
      if (mr && mr.state !== 'inactive') mr.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (audioRef.current) audioRef.current.pause();
      setIsRecording(false);
      setIsSpeaking(false);
    }
  }, [isOpen]);

  // Build a human-readable label for the generate button. We show the USD
  // alongside the ITC so customers see how cheap it is — at 1 ITC = $0.01,
  // a 15 ITC design is just $0.15.
  const getGenerateLabel = () => {
    if (generationState === 'generating') return 'Generating...';
    const tag = genTier === 'premium' ? 'Premium ' : '';
    if (imageCount === 1) {
      return isFreeFirst ? 'Generate Free' : `Generate ${tag}(${perImageCost} ITC · ${itcToUsdLabel(perImageCost)})`;
    }
    if (isFreeFirst && chargeable === 0) {
      return `Generate ${imageCount} designs (Free)`;
    }
    if (isFreeFirst) {
      return `Generate ${imageCount} designs (Free + ${chargeable * perImageCost} ITC · ${itcToUsdLabel(chargeable * perImageCost)})`;
    }
    return `Generate ${imageCount} ${tag}designs (${totalCost} ITC · ${itcToUsdLabel(totalCost)})`;
  };

  // Handle generation
  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError('Please describe what you want to create');
      return;
    }

    if (!canAfford) {
      setError('Insufficient ITC balance. Purchase more ITC to continue.');
      return;
    }

    setError(null);
    setGenerationState('generating');
    setGeneratedImages([]);
    setFailureCount(0);

    try {
      // Build DTF-aware prompt
      const dtfPrompt = buildDTFPrompt(prompt, selectedStyle, shirtColor, background);

      const { data } = await imaginationApi.generateImage({
        prompt: dtfPrompt,
        style: selectedStyle.key,
        useTrial: isFreeFirst,
        count: imageCount,
        background: shirtColor as 'black' | 'white' | 'grey' | 'color',
        tier: genTier,
      });

      if (isFreeFirst) {
        consumeTrial();
      }

      // Reflect the post-charge ITC balance immediately so the user sees the
      // deduction the moment images generate (the server charged inside /generate).
      if (typeof data.newBalance === 'number') {
        onBalanceUpdate?.(data.newBalance);
      }

      // Normalise response: new multi-image format or legacy single-image
      let images: GeneratedImageResult[] = [];
      if (data.images && Array.isArray(data.images) && data.images.length > 0) {
        images = data.images.map((img: { url: string; modelId?: string; modelLabel?: string }) => ({
          url: img.url,
          modelLabel: img.modelLabel || img.modelId || 'AI Model',
          added: false,
        }));
      } else {
        // Legacy fallback: single imageUrl
        const legacyUrl = data.imageUrl || data.url || data.output || data.processedUrl;
        if (legacyUrl) {
          images = [{ url: legacyUrl, modelLabel: 'AI Model', added: false }];
        }
      }

      if (images.length === 0) {
        throw new Error('No image URL in response');
      }

      // Count failures reported by backend
      const failures = data.failures?.length || 0;
      setFailureCount(failures);

      // Save first to recent generations
      const saved = localStorage.getItem('itp-recent-generations');
      const recent = saved ? JSON.parse(saved) : [];
      const updated = [images[0].url, ...recent.slice(0, 5)];
      localStorage.setItem('itp-recent-generations', JSON.stringify(updated));

      setGeneratedImages(images);
      setGenerationState('complete');
    } catch (err: any) {
      setError(err.message || 'Failed to generate image. Please try again.');
      setGenerationState('error');
    }
  };

  // Add a specific generated image to the sheet
  const handleAddToSheet = (index: number) => {
    const img = generatedImages[index];
    if (!img || img.added) return;
    const selectedPrintSize = SIZE_OPTIONS.find(size => size.key === printSizeKey) || SIZE_OPTIONS[0];
    onImageGenerated(img.url, {
      printWidthInches: selectedPrintSize.printWidthInches,
      printSizeLabel: selectedPrintSize.label,
      source: 'mr-imagine',
    });
    setGeneratedImages(prev =>
      prev.map((item, i) => (i === index ? { ...item, added: true } : item))
    );
  };

  // Download a specific image
  const handleDownloadImage = async (url: string) => {
    let objectUrl: string | null = null;
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `mr-imagine-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error('Download failed:', err);
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  };

  // Regenerate with same settings
  const handleRegenerate = () => {
    setGeneratedImages([]);
    setGenerationState('idle');
    handleGenerate();
  };

  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Enter' && e.ctrlKey && generationState === 'idle') {
        e.preventDefault();
        handleGenerate();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, generationState]);

  if (!isOpen) return null;

  const canGenerate = prompt.trim().length > 0 && canAfford;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-card rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header with Mr. Imagine character */}
        <div className="relative bg-gradient-to-br from-purple-600 via-purple-700 to-indigo-800 px-6 py-5">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-4">
            {/* Mr. Imagine character */}
            <div className="relative">
              <img
                src="/mr-imagine/mr-imagine-waving.png"
                alt="Mr. Imagine"
                className="w-20 h-20 object-contain drop-shadow-lg"
              />
              <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-yellow-400 rounded-full flex items-center justify-center">
                <Sparkles className="w-3 h-3 text-yellow-900" />
              </div>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                Mr. Imagine
                <Wand2 className="w-6 h-6 text-yellow-300" />
              </h2>
              <p className="text-purple-200 text-sm mt-1">
                Imagine anything... let's build it together!
              </p>
            </div>
          </div>

          {/* Cost indicator */}
          <div className="absolute bottom-4 right-4 flex items-center gap-2">
            {isFreeFirst ? (
              <span className="px-3 py-1 bg-green-500/20 text-green-300 text-xs font-medium rounded-full border border-green-500/30">
                {trialsRemaining} Free Generation{trialsRemaining !== 1 ? 's' : ''} Left
              </span>
            ) : (
              <span className="px-3 py-1 bg-purple-500/20 text-purple-200 text-xs font-medium rounded-full border border-purple-500/30">
                {pricing.aiGeneration} ITC · just {itcToUsdLabel(pricing.aiGeneration)} per design
              </span>
            )}
          </div>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto">
          <div className="grid md:grid-cols-2 gap-6 p-6">
            {/* Left column: Prompt & Tools */}
            <div className="space-y-5">
              {/* Error message */}
              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-2">
                  <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-400">{error}</p>
                </div>
              )}

              {/* Prompt input */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-text">
                    Describe your design
                  </label>
                  <button
                    onClick={getRandomExample}
                    disabled={randomLoading || generationState === 'generating'}
                    className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
                    title="Mr. Imagine suggests a fresh, on-trend idea"
                  >
                    {randomLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Lightbulb className="w-3 h-3" />}
                    {randomLoading ? 'Thinking…' : 'Surprise me'}
                  </button>
                </div>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value.slice(0, 500))}
                  placeholder="A fierce tiger with glowing eyes emerging from flames..."
                  rows={4}
                  maxLength={500}
                  disabled={generationState === 'generating'}
                  className="w-full px-4 py-3 bg-bg border border-primary/30 rounded-lg text-sm text-text placeholder-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 resize-none disabled:opacity-50 transition-all"
                />
                <div className="flex justify-between mt-1.5 text-xs text-muted">
                  <span>Be specific about colors, style, and composition</span>
                  <span>{prompt.length}/500</span>
                </div>
              </div>

              {/* Talk to Mr. Imagine — voice conversation */}
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      onClick={toggleRecording}
                      disabled={isVoiceThinking || generationState === 'generating'}
                      className={`relative flex items-center justify-center w-10 h-10 rounded-full shrink-0 transition-all disabled:opacity-50 ${
                        isRecording
                          ? 'bg-red-500 text-white shadow-lg ring-4 ring-red-500/30 animate-pulse'
                          : 'bg-gradient-to-br from-fuchsia-600 to-pink-600 text-white hover:from-fuchsia-700 hover:to-pink-700'
                      }`}
                      title={isRecording ? 'Stop and send' : 'Hold a chat — tap to talk to Mr. Imagine'}
                    >
                      {isRecording ? <Square className="w-4 h-4 fill-current" /> : <Mic className="w-5 h-5" />}
                    </button>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-text leading-tight">Talk to Mr. Imagine</p>
                      <p className="text-xs text-muted leading-tight truncate">
                        {isRecording
                          ? 'Listening… tap to send'
                          : isVoiceThinking
                          ? 'Mr. Imagine is thinking…'
                          : isSpeaking
                          ? 'Mr. Imagine is speaking…'
                          : 'Tap the mic and describe your idea out loud'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={toggleMute}
                    className="p-2 rounded-lg text-muted hover:text-primary hover:bg-primary/10 transition-colors shrink-0"
                    title={voiceMuted ? 'Unmute Mr. Imagine' : 'Mute Mr. Imagine'}
                  >
                    {voiceMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  </button>
                </div>

                {voiceError && (
                  <p className="mt-2 text-xs text-red-500">{voiceError}</p>
                )}

                {voiceConversation.length > 0 && (
                  <div className="mt-3 max-h-40 overflow-y-auto space-y-2 pr-1">
                    {voiceConversation.slice(-6).map((turn, i) => (
                      <div
                        key={i}
                        className={`text-xs leading-snug rounded-lg px-2.5 py-1.5 ${
                          turn.role === 'user'
                            ? 'bg-bg border border-text/10 text-text ml-6'
                            : 'bg-primary/10 text-text mr-6'
                        }`}
                      >
                        <span className="font-semibold">{turn.role === 'user' ? 'You' : 'Mr. Imagine'}:</span>{' '}
                        {turn.content}
                      </div>
                    ))}
                  </div>
                )}

                {readyToGenerateHint && (
                  <p className="mt-2 text-xs text-primary font-medium flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> Your idea's ready — hit Generate below!
                  </p>
                )}
              </div>
              <audio ref={audioRef} className="hidden" />

              {/* How many designs? */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-text">How many designs?</label>
                </div>
                <div className="flex gap-2">
                  {[1, 2, 3, 4].map(n => (
                    <button
                      key={n}
                      onClick={() => setImageCount(n)}
                      disabled={generationState === 'generating'}
                      className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all disabled:opacity-50 ${
                        imageCount === n
                          ? 'bg-primary text-white shadow-md'
                          : 'bg-bg border border-primary/30 text-text hover:border-primary/50'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-muted">
                  {genTier === 'premium' ? 'Each design rendered by GPT Image 2 (premium)' : 'Each design comes from a different top AI model'}
                </p>
                {imageCount > 1 && (
                  <p className="mt-1 text-xs text-primary font-medium">
                    {imageCount} designs × {itcToUsdLabel(perImageCost)} = just {itcToUsdLabel(imageCount * perImageCost)}
                    {isFreeFirst && ' — first one free!'}
                  </p>
                )}
              </div>

              {/* Quality tier */}
              <div>
                <label className="text-sm font-medium text-text mb-2 block">Quality</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setGenTier('standard')}
                    disabled={generationState === 'generating'}
                    className={`px-3 py-2.5 rounded-lg text-left transition-all border disabled:opacity-50 ${
                      genTier === 'standard' ? 'border-primary bg-primary/10' : 'border-primary/30 bg-bg hover:border-primary/50'
                    }`}
                  >
                    <span className="block text-sm font-semibold text-text">Standard</span>
                    <span className="block text-xs text-muted">Top models · {itcToUsdLabel(pricing.aiGeneration)} each</span>
                  </button>
                  <button
                    onClick={() => setGenTier('premium')}
                    disabled={generationState === 'generating'}
                    className={`px-3 py-2.5 rounded-lg text-left transition-all border disabled:opacity-50 ${
                      genTier === 'premium' ? 'border-primary bg-primary/10' : 'border-primary/30 bg-bg hover:border-primary/50'
                    }`}
                  >
                    <span className="block text-sm font-semibold text-text flex items-center gap-1">Premium <Sparkles className="w-3 h-3 text-amber-500" /></span>
                    <span className="block text-xs text-muted">GPT Image 2 · best quality · {itcToUsdLabel(PREMIUM_ITC)} each</span>
                  </button>
                </div>
              </div>

              {/* Style Preset (always visible) */}
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-text mb-2">
                  <Palette className="w-4 h-4 text-primary" />
                  Style Preset
                </label>
                <div className="relative">
                  <select
                    value={selectedStyle.key}
                    onChange={(e) => {
                      const style = DTF_STYLES.find(s => s.key === e.target.value);
                      if (style) setSelectedStyle(style);
                    }}
                    disabled={generationState === 'generating'}
                    className="w-full px-4 py-2.5 bg-bg border border-primary/30 rounded-lg text-sm text-text focus:outline-none focus:border-primary appearance-none pr-10 disabled:opacity-50"
                  >
                    {DTF_STYLES.map(style => (
                      <option key={style.key} value={style.key}>
                        {style.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
                </div>
                <p className="mt-1.5 text-xs text-muted">{selectedStyle.description}</p>
              </div>

              {/* Shirt Color (DTF critical) */}
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-text mb-2">
                  <Layers className="w-4 h-4 text-primary" />
                  Target Shirt Color
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {SHIRT_COLORS.map(color => (
                    <button
                      key={color.key}
                      onClick={() => setShirtColor(color.key)}
                      disabled={generationState === 'generating'}
                      className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                        shirtColor === color.key
                          ? 'bg-primary text-white shadow-md'
                          : 'bg-bg border border-primary/30 text-text hover:border-primary/50'
                      } disabled:opacity-50`}
                    >
                      {color.label}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-muted">
                  {SHIRT_COLORS.find(c => c.key === shirtColor)?.colorHint}
                </p>
              </div>

              {/* Advanced Options Toggle */}
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-2 text-sm text-muted hover:text-text transition-colors"
              >
                <ChevronDown className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
                {showAdvanced ? 'Hide' : 'Show'} Advanced Options
              </button>

              {/* Advanced Options */}
              {showAdvanced && (
                <div className="space-y-4 pt-2 border-t border-primary/10">
                  {/* Background */}
                  <div>
                    <label className="text-sm font-medium text-text mb-2 block">
                      Background
                    </label>
                    <div className="flex gap-2">
                      {BACKGROUND_OPTIONS.map(opt => (
                        <button
                          key={opt.key}
                          onClick={() => setBackground(opt.key)}
                          disabled={generationState === 'generating'}
                          className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                            background === opt.key
                              ? 'bg-primary text-white'
                              : 'bg-bg border border-primary/30 text-text hover:border-primary/50'
                          } disabled:opacity-50`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* DTF Print Size */}
                  <div>
                    <label className="flex items-center gap-2 text-sm font-medium text-text mb-2">
                      <Maximize2 className="w-4 h-4 text-primary" />
                      DTF Print Size
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {SIZE_OPTIONS.map(size => (
                        <button
                          key={size.key}
                          onClick={() => setPrintSizeKey(size.key)}
                          disabled={generationState === 'generating'}
                          className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                            printSizeKey === size.key
                              ? 'bg-primary text-white'
                              : 'bg-bg border border-primary/30 text-text hover:border-primary/50'
                          } disabled:opacity-50`}
                        >
                          {size.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Right column: Preview & Results */}
            <div className="flex flex-col">
              {/* Preview / Results area */}
              <div className="flex-1 bg-bg rounded-xl border border-primary/20 overflow-hidden flex items-center justify-center min-h-[300px]">
                {generationState === 'idle' && generatedImages.length === 0 && (
                  <div className="text-center p-6">
                    <div className="w-20 h-20 mx-auto mb-4 bg-primary/10 rounded-full flex items-center justify-center">
                      <Wand2 className="w-10 h-10 text-primary/50" />
                    </div>
                    <p className="text-muted text-sm">
                      Your generated {imageCount === 1 ? 'image' : 'images'} will appear here
                    </p>
                    <p className="text-muted/60 text-xs mt-2">
                      Press Ctrl+Enter to generate
                    </p>
                  </div>
                )}

                {generationState === 'generating' && (
                  <div className="text-center p-6">
                    <div className="relative w-24 h-24 mx-auto mb-4">
                      <img
                        src="/mr-imagine/mr-imagine-head-thinking.png"
                        alt="Thinking..."
                        className="w-full h-full object-contain animate-pulse"
                      />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Loader2 className="w-8 h-8 text-primary animate-spin" />
                      </div>
                    </div>
                    <p className="text-text font-medium">Creating your masterpiece{imageCount > 1 ? 's' : ''}...</p>
                    <p className="text-muted text-xs mt-2">
                      {imageCount > 1
                        ? `Generating ${imageCount} designs across top AI models`
                        : 'This usually takes 10-30 seconds'}
                    </p>
                  </div>
                )}

                {generationState === 'complete' && generatedImages.length > 0 && (
                  <div className="w-full h-full p-3 overflow-y-auto">
                    {/* Failure notice */}
                    {failureCount > 0 && (
                      <div className="mb-3 px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
                        <p className="text-xs text-amber-500">
                          {failureCount} model{failureCount !== 1 ? 's' : ''} declined this prompt (usually an over-cautious safety filter — not you). You were only charged for the images that came back. Tweaking the wording or trying Premium usually clears it.
                        </p>
                      </div>
                    )}
                    {/* Grid: 1 image = large single; 2-4 = 2-column grid */}
                    <div className={`${generatedImages.length === 1 ? '' : 'grid grid-cols-2 gap-3'}`}>
                      {generatedImages.map((img, index) => (
                        <div
                          key={index}
                          className="flex flex-col rounded-xl overflow-hidden border border-primary/20 bg-card shadow-sm"
                        >
                          {/* Image with checkerboard bg + model badge */}
                          <div className={`relative ${CHECKERBOARD_BG} flex items-center justify-center ${generatedImages.length === 1 ? 'min-h-[220px]' : 'min-h-[130px]'}`}>
                            <img
                              src={img.url}
                              alt={`Design ${index + 1}`}
                              className="w-full h-full object-contain rounded-t-xl"
                              style={{ maxHeight: generatedImages.length === 1 ? 260 : 150 }}
                            />
                            {/* Model badge */}
                            <span className="absolute top-2 left-2 px-2 py-0.5 bg-black/60 text-white text-[10px] font-medium rounded-full backdrop-blur-sm">
                              {img.modelLabel}
                            </span>
                          </div>
                          {/* Action buttons */}
                          <div className="flex gap-2 p-2">
                            <button
                              onClick={() => handleAddToSheet(index)}
                              disabled={img.added}
                              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                                img.added
                                  ? 'bg-green-500/15 text-green-500 cursor-default'
                                  : 'bg-primary hover:bg-primary/90 text-white'
                              }`}
                            >
                              {img.added ? (
                                <>
                                  <Check className="w-3.5 h-3.5" />
                                  Added
                                </>
                              ) : (
                                <>
                                  <Sparkles className="w-3.5 h-3.5" />
                                  Add to Sheet
                                </>
                              )}
                            </button>
                            <button
                              onClick={() => handleDownloadImage(img.url)}
                              className="w-8 h-8 flex items-center justify-center bg-bg border border-primary/30 text-text hover:border-primary rounded-lg transition-colors shrink-0"
                              title="Download image"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {generationState === 'error' && (
                  <div className="text-center p-6">
                    <div className="w-20 h-20 mx-auto mb-4">
                      <img
                        src="/mr-imagine/mr-imagine-waist-up-confused.png"
                        alt="Error"
                        className="w-full h-full object-contain"
                      />
                    </div>
                    <p className="text-red-400 font-medium">Oops! Something went wrong</p>
                    <p className="text-muted text-xs mt-2">Please try again</p>
                  </div>
                )}
              </div>

              {/* Regenerate button shown after complete */}
              {generationState === 'complete' && generatedImages.length > 0 && (
                <div className="mt-3">
                  <button
                    onClick={handleRegenerate}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-bg border border-primary/30 text-text hover:border-primary rounded-lg font-medium transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Regenerate
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer with Generate button */}
        <div className="px-6 py-4 bg-bg/50 border-t border-primary/10 flex items-center justify-between">
          <div className="text-xs text-muted">
            <span className="hidden sm:inline">Tip: Be specific about style, colors, and composition for best results</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2.5 text-muted hover:text-text transition-colors font-medium"
            >
              Close
            </button>

            {generationState !== 'complete' && (
              <button
                onClick={handleGenerate}
                disabled={!canGenerate || generationState === 'generating'}
                className={`flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium transition-all ${
                  !canGenerate || generationState === 'generating'
                    ? 'bg-primary/30 text-white/50 cursor-not-allowed'
                    : 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-lg hover:shadow-xl'
                }`}
              >
                {generationState === 'generating' ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" />
                    {getGenerateLabel()}
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MrImagineModal;
