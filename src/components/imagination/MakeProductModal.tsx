// src/components/imagination/MakeProductModal.tsx
//
// "Make a Product" — turn a finished design into a real product. Three paths:
//   1. Wear it     -> AI garment mockup (shirt / hoodie / tumbler) via the
//                     existing /api/realistic-mockups pipeline, saved to My Designs.
//   2. Metal print -> hands the design off to the Metal Art studio (prefilled).
//   3. 3D toy      -> hands the design off to the Toy Creator as a starting point.
//
// The garment mockup runs inline (generate -> poll -> preview -> save). Metal &
// 3D navigate to their dedicated studios, passing the design via sessionStorage.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Shirt, Image as ImageIcon, Box, Loader2, Check, RefreshCw, ArrowLeft, Coins } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { imaginationApi } from '../../lib/api';
import { CHECKERBOARD_BG } from './checkerboard';

interface MakeProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  designUrl: string | null;
  itcBalance: number;
  onBalanceUpdate?: (newBalance: number) => void;
}

type Choice = 'menu' | 'garment';
type GarmentTemplate = 'shirts' | 'hoodies' | 'tumblers';
type MockupStatus = 'idle' | 'generating' | 'completed' | 'failed';

const MOCKUP_COST = 25;

const GARMENTS: { key: GarmentTemplate; label: string }[] = [
  { key: 'shirts', label: 'T-Shirt' },
  { key: 'hoodies', label: 'Hoodie' },
  { key: 'tumblers', label: 'Tumbler' },
];

const GARMENT_COLORS = [
  { hex: '#FFFFFF', label: 'White' },
  { hex: '#000000', label: 'Black' },
  { hex: '#808080', label: 'Grey' },
  { hex: '#1e3a8a', label: 'Navy' },
  { hex: '#7f1d1d', label: 'Maroon' },
  { hex: '#14532d', label: 'Forest' },
];

const MakeProductModal: React.FC<MakeProductModalProps> = ({ isOpen, onClose, designUrl, itcBalance, onBalanceUpdate }) => {
  const navigate = useNavigate();
  const [choice, setChoice] = useState<Choice>('menu');
  const [template, setTemplate] = useState<GarmentTemplate>('shirts');
  const [garmentColor, setGarmentColor] = useState('#FFFFFF');
  const [gender, setGender] = useState('female');
  const [status, setStatus] = useState<MockupStatus>('idle');
  const [mockupUrl, setMockupUrl] = useState<string | null>(null);
  const [generationId, setGenerationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const pollRef = useRef<number | null>(null);

  const clearPoll = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  // Reset state whenever the modal closes.
  useEffect(() => {
    if (!isOpen) {
      setChoice('menu'); setStatus('idle'); setMockupUrl(null);
      setGenerationId(null); setError(null); setSaved(false);
      clearPoll();
    }
  }, [isOpen]);

  useEffect(() => () => clearPoll(), []);

  const handoff = (route: string, key: string) => {
    if (designUrl) sessionStorage.setItem(key, designUrl);
    onClose();
    navigate(route);
  };

  const startMockup = useCallback(async () => {
    if (!designUrl) { setError('No design selected.'); return; }
    if (itcBalance < MOCKUP_COST) { setError(`You need ${MOCKUP_COST} ITC to generate a mockup.`); return; }
    setError(null); setStatus('generating'); setMockupUrl(null); setSaved(false);
    try {
      const { data } = await imaginationApi.generateMockup({
        designImageUrl: designUrl,
        productTemplate: template,
        modelDescription: {
          garmentColor,
          gender,
          ethnicity: 'caucasian',
          hairColor: 'brown',
          eyeColor: 'brown',
          bodyType: 'average',
          additionalDetails: '',
        },
      });
      if (!data?.ok) throw new Error(data?.error || 'Could not start the mockup.');
      if (typeof data.newBalance === 'number') onBalanceUpdate?.(data.newBalance);
      const genId = data.generationId as string;
      setGenerationId(genId);

      pollRef.current = window.setInterval(async () => {
        try {
          const { data: st } = await imaginationApi.getMockupStatus(genId);
          if (st.status === 'completed') {
            clearPoll();
            setMockupUrl(st.mockupUrl);
            setStatus('completed');
          } else if (st.status === 'failed') {
            clearPoll();
            setError(st.errorMessage || 'Mockup generation failed — you were refunded.');
            setStatus('failed');
          }
        } catch {
          /* transient — keep polling */
        }
      }, 3000);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Mockup failed. Please try again.');
      setStatus('idle');
    }
  }, [designUrl, template, garmentColor, gender, itcBalance, onBalanceUpdate]);

  // Submit the design for approval — same pipeline as CreateDesignModal. It
  // lands in My Designs as "pending review", an admin approves it, and then it
  // becomes a sellable product. The garment mockup + product choice ride along
  // in metadata. (We also accept the mockup into the user's media gallery so
  // the temp file is kept, best-effort.)
  const submitForApproval = useCallback(async () => {
    if (!designUrl) return;
    setSubmitting(true);
    setError(null);
    try {
      if (generationId) {
        // Promote the mockup out of temp storage (best-effort; non-blocking).
        try { await imaginationApi.selectMockup(generationId); } catch { /* ignore */ }
      }
      await imaginationApi.submitDesign({
        preview_url: designUrl,
        design_concept: `Custom ${template} design`,
        product_template: template,
        category: template,
        mockup_url: mockupUrl || undefined,
        model_description: { garmentColor, gender },
        source: 'make_a_product',
      });
      setSaved(true);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not submit for approval. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [designUrl, generationId, template, mockupUrl, garmentColor, gender]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-card rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="relative bg-gradient-to-br from-purple-600 via-purple-700 to-indigo-800 px-6 py-4 flex items-center gap-3">
          {choice !== 'menu' && (
            <button
              onClick={() => { setChoice('menu'); setStatus('idle'); setMockupUrl(null); setError(null); clearPoll(); }}
              className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-full transition-colors"
              title="Back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <div className="flex-1">
            <h2 className="text-xl font-bold text-white">Make a Product</h2>
            <p className="text-purple-200 text-xs mt-0.5">Turn your design into something real</p>
          </div>
          <button onClick={onClose} className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-full transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {/* Design preview strip */}
          {designUrl && (
            <div className="flex items-center gap-3 mb-5 p-3 rounded-xl border border-text/10 bg-bg">
              <div className="w-14 h-14 rounded-lg overflow-hidden shrink-0" style={{ background: CHECKERBOARD_BG }}>
                <img src={designUrl} alt="Your design" className="w-full h-full object-contain" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-text">Your design</p>
                <p className="text-xs text-muted">Pick what to make with it below.</p>
              </div>
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-500">{error}</div>
          )}

          {/* ---- MENU ---- */}
          {choice === 'menu' && (
            <div className="grid sm:grid-cols-3 gap-3">
              <button
                onClick={() => setChoice('garment')}
                className="group flex flex-col items-center text-center gap-2 p-5 rounded-xl border border-text/10 bg-bg hover:border-primary/40 hover:bg-primary/5 transition-all"
              >
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-fuchsia-500 to-pink-600 flex items-center justify-center text-white">
                  <Shirt className="w-6 h-6" />
                </div>
                <span className="font-semibold text-sm text-text">Put it on apparel</span>
                <span className="text-xs text-muted">AI mockup on a shirt, hoodie, or tumbler</span>
                <span className="text-[11px] text-primary font-medium mt-1">{MOCKUP_COST} ITC</span>
              </button>

              <button
                onClick={() => handoff('/metal-art', 'itp-incoming-design-metal')}
                className="group flex flex-col items-center text-center gap-2 p-5 rounded-xl border border-text/10 bg-bg hover:border-primary/40 hover:bg-primary/5 transition-all"
              >
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white">
                  <ImageIcon className="w-6 h-6" />
                </div>
                <span className="font-semibold text-sm text-text">Metal print</span>
                <span className="text-xs text-muted">Open it in the Metal Art studio to order</span>
                <span className="text-[11px] text-primary font-medium mt-1">Opens studio</span>
              </button>

              <button
                onClick={() => handoff('/toy-creator', 'itp-incoming-design-toy')}
                className="group flex flex-col items-center text-center gap-2 p-5 rounded-xl border border-text/10 bg-bg hover:border-primary/40 hover:bg-primary/5 transition-all"
              >
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center text-white">
                  <Box className="w-6 h-6" />
                </div>
                <span className="font-semibold text-sm text-text">3D toy</span>
                <span className="text-xs text-muted">Take your idea into the Toy Creator</span>
                <span className="text-[11px] text-primary font-medium mt-1">Opens studio</span>
              </button>
            </div>
          )}

          {/* ---- GARMENT MOCKUP ---- */}
          {choice === 'garment' && (
            <div className="space-y-5">
              {status !== 'completed' && (
                <>
                  <div>
                    <label className="text-sm font-medium text-text mb-2 block">Product</label>
                    <div className="grid grid-cols-3 gap-2">
                      {GARMENTS.map((g) => (
                        <button
                          key={g.key}
                          onClick={() => setTemplate(g.key)}
                          disabled={status === 'generating'}
                          className={`px-3 py-2.5 rounded-lg text-sm font-medium border transition-all disabled:opacity-50 ${
                            template === g.key ? 'border-primary bg-primary/10 text-primary' : 'border-text/10 bg-bg text-text hover:border-primary/30'
                          }`}
                        >
                          {g.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-text mb-2 block">Garment color</label>
                    <div className="flex flex-wrap gap-2">
                      {GARMENT_COLORS.map((c) => (
                        <button
                          key={c.hex}
                          onClick={() => setGarmentColor(c.hex)}
                          disabled={status === 'generating'}
                          title={c.label}
                          className={`w-9 h-9 rounded-full border-2 transition-all disabled:opacity-50 ${
                            garmentColor === c.hex ? 'border-primary ring-2 ring-primary/30 scale-110' : 'border-text/20'
                          }`}
                          style={{ backgroundColor: c.hex }}
                        />
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-text mb-2 block">Model</label>
                    <div className="flex gap-2">
                      {['female', 'male'].map((g) => (
                        <button
                          key={g}
                          onClick={() => setGender(g)}
                          disabled={status === 'generating'}
                          className={`px-4 py-2 rounded-lg text-sm font-medium border capitalize transition-all disabled:opacity-50 ${
                            gender === g ? 'border-primary bg-primary/10 text-primary' : 'border-text/10 bg-bg text-text hover:border-primary/30'
                          }`}
                        >
                          {g}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={startMockup}
                    disabled={status === 'generating' || itcBalance < MOCKUP_COST}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-purple-600 to-indigo-700 text-white rounded-xl font-semibold hover:from-purple-700 hover:to-indigo-800 transition-all disabled:opacity-50"
                  >
                    {status === 'generating' ? (
                      <><Loader2 className="w-5 h-5 animate-spin" /> Generating mockup… (~45s)</>
                    ) : (
                      <><Shirt className="w-5 h-5" /> Generate mockup <span className="inline-flex items-center gap-1 text-white/80 text-sm"><Coins className="w-3.5 h-3.5" />{MOCKUP_COST}</span></>
                    )}
                  </button>
                  {itcBalance < MOCKUP_COST && (
                    <p className="text-xs text-red-500 text-center">You need {MOCKUP_COST} ITC for a mockup.</p>
                  )}
                </>
              )}

              {status === 'completed' && mockupUrl && (
                <div className="space-y-4">
                  <div className="rounded-xl overflow-hidden border border-text/10 bg-bg">
                    <img src={mockupUrl} alt="Mockup" className="w-full max-h-[50vh] object-contain" />
                  </div>
                  {saved ? (
                    <div className="text-center space-y-3">
                      <div className="flex items-center justify-center gap-2 text-green-600 font-medium text-sm">
                        <Check className="w-5 h-5" /> Submitted for review!
                      </div>
                      <p className="text-xs text-muted">
                        Your design is now in <span className="font-medium text-text">My Designs</span> as “pending review.” Once our team approves it, it becomes a sellable product and you earn 15% on every sale.
                      </p>
                      <button
                        onClick={() => { onClose(); navigate('/my-designs'); }}
                        className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-700 text-white rounded-xl font-semibold hover:from-purple-700 hover:to-indigo-800 transition-all"
                      >
                        View My Designs
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col sm:flex-row gap-2">
                      <button
                        onClick={submitForApproval}
                        disabled={submitting}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-purple-600 to-indigo-700 text-white rounded-xl font-semibold hover:from-purple-700 hover:to-indigo-800 transition-all disabled:opacity-50"
                      >
                        {submitting ? <><Loader2 className="w-5 h-5 animate-spin" /> Submitting…</> : <><Check className="w-5 h-5" /> Submit for approval</>}
                      </button>
                      <button
                        onClick={() => { setStatus('idle'); setMockupUrl(null); setGenerationId(null); }}
                        disabled={submitting}
                        className="flex items-center justify-center gap-2 px-4 py-3 bg-card border border-text/10 rounded-xl font-medium text-text hover:border-primary/40 transition-all disabled:opacity-50"
                      >
                        <RefreshCw className="w-4 h-4" /> Try again
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MakeProductModal;
