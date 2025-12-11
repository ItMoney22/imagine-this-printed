// src/lib/api.ts
import { supabase } from "../lib/supabase";
import type { AIProductCreationRequest, AIProductCreationResponse } from '../types'

const API_BASE = import.meta.env.VITE_API_BASE || import.meta.env.VITE_API_URL || 'http://localhost:4000'

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
      throw new Error(error.message || `HTTP ${response.status}`)
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
      throw new Error(error.message || `HTTP ${response.status}`)
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
      throw new Error(error.message || `HTTP ${response.status}`)
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
      throw new Error(error.message || `HTTP ${response.status}`)
    }

    return { data: await response.json() }
  }
}

export default api

// AI Product Builder endpoints
export const aiProducts = {
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

// Imagination Station API
export const imaginationApi = {
  // Presets & Pricing
  getPresets: () => api.get('/imagination-station/presets'),
  getPricing: () => api.get('/imagination-station/pricing'),
  getTrials: () => api.get('/imagination-station/trials'),

  // Sheet CRUD
  createSheet: (data: { name?: string; print_type: string; sheet_height: number }) =>
    api.post('/imagination-station/sheets', data),

  getSheets: (status?: string) =>
    api.get('/imagination-station/sheets', { params: { status } }),

  getSheet: (id: string) =>
    api.get(`/imagination-station/sheets/${id}`),

  updateSheet: (id: string, data: { name?: string; canvas_state?: any; thumbnail_url?: string }) =>
    api.put(`/imagination-station/sheets/${id}`, data),

  deleteSheet: (id: string) =>
    api.delete(`/imagination-station/sheets/${id}`),

  // Layer operations
  uploadImage: (sheetId: string, file: File) => {
    const formData = new FormData();
    formData.append('image', file);
    return api.post(`/imagination-station/sheets/${sheetId}/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },

  // AI operations - Component-friendly signatures
  generateImage: (params: { prompt: string; style: string; useTrial?: boolean }) =>
    api.post('/imagination-station/ai/generate', params),

  removeBackground: (params: { imageUrl: string; useTrial?: boolean }) =>
    api.post('/imagination-station/ai/remove-bg', params),

  upscaleImage: (params: { imageUrl: string; factor: 2 | 4; useTrial?: boolean }) =>
    api.post('/imagination-station/ai/upscale', params),

  enhanceImage: (params: { imageUrl: string; useTrial?: boolean }) =>
    api.post('/imagination-station/ai/enhance', params),

  // Layout operations - Component-friendly signatures
  autoNest: (params: { sheetWidth: number; sheetHeight: number; layers: Array<{ id: string; width: number; height: number; rotation?: number }>; padding?: number }) =>
    api.post('/imagination-station/layout/auto-nest', params),

  smartFill: (params: { sheetWidth: number; sheetHeight: number; layers: Array<{ id: string; width: number; height: number }>; padding?: number }) =>
    api.post('/imagination-station/layout/smart-fill', params),

  autoLayout: (sheetId: string) =>
    api.post(`/imagination-station/sheets/${sheetId}/auto-layout`),

  // Export operations - Component-friendly signatures
  previewExport: (params: { sheet: any; layers: any[]; format: 'png' | 'pdf'; options?: { includeCutlines?: boolean; mirrorForSublimation?: boolean } }) =>
    api.post('/imagination-station/export/preview', params),

  exportDesign: (params: { sheet: any; layers: any[]; format: 'png' | 'pdf'; options?: { includeCutlines?: boolean; mirrorForSublimation?: boolean } }) =>
    api.post('/imagination-station/export/download', params),

  submitToProduction: (params: { sheet: any; layers: any[]; format: 'png' | 'pdf'; options?: { includeCutlines?: boolean; mirrorForSublimation?: boolean } }) =>
    api.post('/imagination-station/export/submit', params),

  // Legacy sheet-based operations (for backward compatibility)
  removeBackgroundSheet: (sheetId: string, layerId: string) =>
    api.post(`/imagination-station/sheets/${sheetId}/remove-bg`, { layer_id: layerId }),

  upscaleImageSheet: (sheetId: string, layerId: string, scaleFactor: number) =>
    api.post(`/imagination-station/sheets/${sheetId}/upscale`, { layer_id: layerId, scale_factor: scaleFactor }),

  enhanceImageSheet: (sheetId: string, layerId: string) =>
    api.post(`/imagination-station/sheets/${sheetId}/enhance`, { layer_id: layerId }),

  // Export & Submit (legacy)
  exportSheet: (sheetId: string, format: 'png' | 'pdf', options?: { include_cutlines?: boolean; mirror?: boolean }) =>
    api.post(`/imagination-station/sheets/${sheetId}/export`, { format, ...options }),

  submitSheet: (sheetId: string) =>
    api.post(`/imagination-station/sheets/${sheetId}/submit`),
};

