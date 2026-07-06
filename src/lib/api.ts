// src/lib/api.ts
import { supabase } from "../lib/supabase";
import type {
  AIProductCreationRequest,
  AIProductCreationResponse,
  ProductTrendFamily,
  ProductTrendResponse,
  ProductTrendSource,
  SimpleWordPhraseResponse,
} from '../types'

export const API_BASE = import.meta.env.VITE_API_BASE || import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:4000' : '')

export async function apiFetch(path: string, init: RequestInit = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const headers = new Headers(init.headers || {});
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}

// Axios-compatible API client for components expecting axios interface
const api = {
  get: async (url: string, config?: { params?: Record<string, any> }) => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token

    let fullUrl = `${API_BASE}${url}`
    if (config?.params) {
      const params = new URLSearchParams()
      Object.entries(config.params).forEach(([key, value]) => {
        params.append(key, String(value))
      })
      fullUrl += `?${params.toString()}`
    }

    const response = await fetch(fullUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      }
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Request failed' }))
      throw new Error(error.error || error.message || `HTTP ${response.status}`)
    }

    return { data: await response.json() }
  },

  post: async (url: string, body?: any, config?: any) => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token

    // Handle FormData (for file uploads)
    const isFormData = body instanceof FormData
    const headers: Record<string, string> = {
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...(config?.headers || {})
    }

    // Only set Content-Type for non-FormData
    if (!isFormData && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json'
    }

    const response = await fetch(`${API_BASE}${url}`, {
      method: 'POST',
      headers,
      body: isFormData ? body : (body ? JSON.stringify(body) : undefined)
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Request failed' }))
      throw new Error(error.error || error.message || `HTTP ${response.status}`)
    }

    return { data: await response.json() }
  },

  put: async (url: string, body?: any, config?: any) => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token

    const response = await fetch(`${API_BASE}${url}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Request failed' }))
      throw new Error(error.error || error.message || `HTTP ${response.status}`)
    }

    return { data: await response.json() }
  },

  delete: async (url: string, config?: any) => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token

    const response = await fetch(`${API_BASE}${url}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      }
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Request failed' }))
      throw new Error(error.error || error.message || `HTTP ${response.status}`)
    }

    return { data: await response.json() }
  }
}

export default api

// AI Product Builder endpoints
export const aiProducts = {
  phrases: async (request: {
    source?: ProductTrendSource
    seed?: string
    limit?: number
  }): Promise<SimpleWordPhraseResponse> => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token

    const response = await fetch(`${API_BASE}/api/admin/products/ai/trends/phrases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(request),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    return response.json()
  },

  trends: async (request: {
    source?: ProductTrendSource
    family?: ProductTrendFamily
    seed?: string
    limit?: number
  }): Promise<ProductTrendResponse> => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token

    const response = await fetch(`${API_BASE}/api/admin/products/ai/trends`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(request),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    return response.json()
  },

  create: async (request: AIProductCreationRequest): Promise<AIProductCreationResponse> => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token

    const response = await fetch(`${API_BASE}/api/admin/products/ai/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(request),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    return response.json()
  },

  getStatus: async (productId: string) => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token

    const response = await fetch(`${API_BASE}/api/admin/products/ai/${productId}/status`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    return response.json()
  },

  duplicate: async (productId: string) => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token

    const response = await fetch(`${API_BASE}/api/admin/products/ai/${productId}/duplicate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    return response.json()
  },

  retryJob: async (jobId: string) => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token

    const response = await fetch(`${API_BASE}/api/admin/products/ai/jobs/${jobId}/retry`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    return response.json()
  },

  removeBackground: async (productId: string, selectedAssetId?: string) => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token

    const response = await fetch(`${API_BASE}/api/admin/products/ai/${productId}/remove-background`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ selectedAssetId }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    return response.json()
  },

  createMockups: async (productId: string, selectedAssetId?: string) => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token

    const response = await fetch(`${API_BASE}/api/admin/products/ai/${productId}/create-mockups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ selectedAssetId }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    return response.json()
  },

  regenerateImages: async (productId: string) => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token

    const response = await fetch(`${API_BASE}/api/admin/products/ai/${productId}/regenerate-images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    return response.json()
  },

  selectImage: async (productId: string, selectedAssetId: string) => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token

    const response = await fetch(`${API_BASE}/api/admin/products/ai/${productId}/select-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ selectedAssetId }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    return response.json()
  },
}

// Image Flow API — generic gen/edit/bg-remove via gpt-image-2 etc.
export const imageFlow = {
  edit: async (params: {
    parentAssetId: string
    prompt: string
    refImageUrls?: string[]
    forceModel?: string
    enhance?: boolean
    confirmedCost?: boolean
    /** Strict design-fidelity mode — apply only the requested change. */
    preserveDesign?: boolean
  }): Promise<{
    status: 'ok'
    assetId: string | null
    url: string
    path: string
    costUsd: number
    modelId: string
    provider: 'replicate' | 'fal'
    parentAssetId: string | null
    enhancedPrompt?: string
  }> => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    const response = await fetch(`${API_BASE}/api/image-flow/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(params),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }
    return response.json()
  },

  generate: async (params: {
    purpose: string
    prompt: string
    productId?: string
    assetRole?: string
    forceModel?: string
    enhance?: boolean
  }) => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    const response = await fetch(`${API_BASE}/api/image-flow/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(params),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }
    return response.json()
  },

  upscale: async (params: { parentAssetId: string; forceModel?: string }): Promise<{
    status: 'ok'
    assetId: string | null
    url: string
    path: string
    costUsd: number
    modelId: string
    parentAssetId: string | null
  }> => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    const response = await fetch(`${API_BASE}/api/image-flow/upscale`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(params),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }
    return response.json()
  },

  bgRemove: async (params: { parentAssetId: string; forceModel?: string }): Promise<{
    status: 'ok'
    assetId: string | null
    url: string
    path: string
    costUsd: number
    modelId: string
    parentAssetId: string | null
  }> => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    const response = await fetch(`${API_BASE}/api/image-flow/bg-remove`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(params),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }
    return response.json()
  },

  halftone: async (params: {
    parentAssetId: string
    method?: 'halftone' | 'diffusion'
    frequency?: number
    angle?: number
    shape?: 'round' | 'line'
    invertDark?: boolean
    cropBg?: boolean
  }): Promise<{
    status: 'ok'
    assetId: string | null
    url: string
    path: string
    width: number
    height: number
    costUsd: number
    modelId: string
    parentAssetId: string | null
  }> => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    const response = await fetch(`${API_BASE}/api/image-flow/halftone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(params),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }
    return response.json()
  },
}

// Imagination Station API
export const imaginationApi = {
  // Presets & Pricing (pricing endpoint returns both pricing and freeTrials)
  getPresets: () => api.get('/api/imagination-station/presets'),
  getPricing: () => api.get('/api/imagination-station/pricing'),

  // Sheet CRUD
  createSheet: (data: { name?: string; print_type: string; sheet_height: number }) =>
    api.post('/api/imagination-station/sheets', data),

  getSheets: (status?: string) =>
    api.get('/api/imagination-station/sheets', { params: { status } }),

  getSheet: (id: string) =>
    api.get(`/api/imagination-station/sheets/${id}`),

  updateSheet: (id: string, data: { name?: string; canvas_state?: any; thumbnail_url?: string }) =>
    api.put(`/api/imagination-station/sheets/${id}`, data),

  deleteSheet: (id: string) =>
    api.delete(`/api/imagination-station/sheets/${id}`),

  // Layer operations
  uploadImage: (sheetId: string, file: File) => {
    const formData = new FormData();
    formData.append('image', file);
    return api.post(`/api/imagination-station/sheets/${sheetId}/upload`, formData, {
      headers: {}
    });
  },

  // AI operations - Component-friendly signatures
  generateImage: (params: { prompt: string; style: string; useTrial?: boolean; count?: number; background?: 'black' | 'white' | 'grey' | 'gray' | 'color' | 'transparent'; tier?: 'standard' | 'premium' }) =>
    api.post('/api/imagination-station/ai/generate', params),

  removeBackground: (params: { imageUrl: string; useTrial?: boolean }) =>
    api.post('/api/imagination-station/ai/remove-bg', params),

  upscaleImage: (params: { imageUrl: string; factor: 2 | 4; useTrial?: boolean }) =>
    api.post('/api/imagination-station/ai/upscale', params),

  enhanceImage: (params: { imageUrl: string; useTrial?: boolean }) =>
    api.post('/api/imagination-station/ai/enhance', params),

  // DTF halftone — dot-screen effect (free, local transform)
  halftoneImage: (params: { imageUrl: string; frequency?: number; angle?: number; shape?: 'round' | 'line'; invertDark?: boolean }) =>
    api.post('/api/imagination-station/ai/halftone', params),

  // Reimagine It - add elements to existing images with AI
  reimagineImage: (params: { imageUrl: string; prompt: string; useTrial?: boolean; tier?: 'standard' | 'premium' }) =>
    api.post('/api/imagination-station/ai/reimagine', params),

  // Layout operations - Component-friendly signatures
  autoNest: (params: { sheetWidth: number; sheetHeight: number; layers: Array<{ id: string; width: number; height: number; rotation?: number }>; padding?: number }) =>
    api.post('/api/imagination-station/layout/auto-nest', params),

  smartFill: (params: { sheetWidth: number; sheetHeight: number; layers: Array<{ id: string; width: number; height: number }>; padding?: number }) =>
    api.post('/api/imagination-station/layout/smart-fill', params),

  autoLayout: (sheetId: string) =>
    api.post(`/api/imagination-station/sheets/${sheetId}/auto-layout`),

  // Export operations - Component-friendly signatures
  previewExport: (params: { sheet: any; layers: any[]; format: 'png' | 'pdf'; options?: { includeCutlines?: boolean; mirrorForSublimation?: boolean } }) =>
    api.post('/api/imagination-station/export/preview', params),

  exportDesign: (params: { sheet: any; layers: any[]; format: 'png' | 'pdf'; options?: { includeCutlines?: boolean; mirrorForSublimation?: boolean } }) =>
    api.post('/api/imagination-station/export/download', params),

  submitToProduction: (params: { sheet: any; layers: any[]; format: 'png' | 'pdf'; options?: { includeCutlines?: boolean; mirrorForSublimation?: boolean } }) =>
    api.post('/api/imagination-station/export/submit', params),

  // Legacy sheet-based operations (for backward compatibility)
  removeBackgroundSheet: (sheetId: string, layerId: string) =>
    api.post(`/api/imagination-station/sheets/${sheetId}/remove-bg`, { layer_id: layerId }),

  upscaleImageSheet: (sheetId: string, layerId: string, scaleFactor: number) =>
    api.post(`/api/imagination-station/sheets/${sheetId}/upscale`, { layer_id: layerId, scale_factor: scaleFactor }),

  enhanceImageSheet: (sheetId: string, layerId: string) =>
    api.post(`/api/imagination-station/sheets/${sheetId}/enhance`, { layer_id: layerId }),

  // Export & Submit (legacy)
  exportSheet: (sheetId: string, format: 'png' | 'pdf', options?: { include_cutlines?: boolean; mirror?: boolean }) =>
    api.post(`/api/imagination-station/sheets/${sheetId}/export`, { format, ...options }),

  submitSheet: (sheetId: string) =>
    api.post(`/api/imagination-station/sheets/${sheetId}/submit`),

  // Project Management - Save/Load functionality
  saveProject: (params: {
    sheetId: string;
    name?: string;
    canvasState: any;
    thumbnailBase64?: string;
    layers?: any[];
    metadata?: any;
  }) =>
    api.post('/api/imagination-station/projects/save', params),

  loadProject: (projectId: string) =>
    api.get(`/api/imagination-station/projects/${projectId}`),

  listProjects: (params?: { status?: string; limit?: number }) =>
    api.get('/api/imagination-station/projects', { params }),

  // Make a Product — realistic garment mockup of a finished design
  generateMockup: (params: {
    designImageUrl: string;
    productTemplate: 'shirts' | 'hoodies' | 'tumblers';
    modelDescription: Record<string, any>;
    designElements?: any[];
  }) => api.post('/api/realistic-mockups/generate', { designElements: [], ...params }),

  getMockupStatus: (generationId: string) =>
    api.get(`/api/realistic-mockups/${generationId}/status`),

  selectMockup: (generationId: string) =>
    api.post(`/api/realistic-mockups/${generationId}/select`),

  discardMockup: (generationId: string) =>
    api.post(`/api/realistic-mockups/${generationId}/discard`),

  // Submit a finished design for admin approval -> shows in My Designs (pending)
  // -> approved -> sellable. Same pipeline as CreateDesignModal.
  submitDesign: (params: {
    preview_url: string;
    name?: string;
    design_concept?: string;
    style?: string;
    category?: string;
    mockup_url?: string;
    product_template?: string;
    model_description?: Record<string, any>;
    source?: string;
  }) => api.post('/api/imagination-station/designs/submit', params),

  // Mr. Imagine studio brain — conversational brainstorm + fresh idea generator.
  // mode 'wall-art' tunes it for gallery metal-art (full-bleed), 'dtf' for apparel.
  brainstorm: (messages: Array<{ role: 'user' | 'assistant'; content: string }>, mode: 'dtf' | 'wall-art' = 'dtf') =>
    api.post('/api/imagination-station/ai/brainstorm', { messages, mode }),

  getRandomIdea: (seed?: string) =>
    api.get('/api/imagination-station/ai/random-idea', { params: seed ? { seed } : {} }),

  // "See it in your space" — gpt-image-2 places the metal art in a real room
  // at true-to-life size (4x6 / 8x11).
  roomMockup: (params: { imageUrl: string; location?: string; size?: string }) =>
    api.post('/api/imagination-station/ai/room-mockup', params),

  // Voice: speech-to-text (mic) and text-to-speech (Mr. Imagine's cloned voice)
  transcribeAudio: (audio: Blob) => {
    const formData = new FormData();
    formData.append('audio', audio, 'recording.webm');
    return api.post('/api/ai/transcribe', formData, { headers: {} });
  },

  synthesizeVoice: (text: string) =>
    api.post('/api/ai/voice/synthesize', { text }),

  admin: {
    getProducts: () => api.get('/api/admin/imagination-products'),
    updateProduct: (id: string, data: any) => api.put(`/api/admin/imagination-products/${id}`, data),
    upsertSize: (data: any) => api.post('/api/admin/imagination-products/size', data),
    deleteSize: (productId: string, height: number) => api.delete('/api/admin/imagination-products/size', { body: { productId, height } })
  }
};

// Admin API methods
export const adminApi = {
  // Imagination Station Pricing
  getImaginationPricing: () =>
    api.get('/api/admin/imagination-pricing'),

  updateImaginationPricing: (featureKey: string, updates: {
    current_cost?: number;
    is_free_trial?: boolean;
    free_trial_uses?: number;
  }) =>
    api.put(`/api/admin/imagination-pricing/${featureKey}`, updates),

  setImaginationPromo: (durationHours: number) =>
    api.post('/api/admin/imagination-pricing/promo', { durationHours }),

  resetImaginationPricing: () =>
    api.post('/api/admin/imagination-pricing/reset'),
};


