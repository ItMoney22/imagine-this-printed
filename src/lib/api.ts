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

    const response = await fetch(`${API_BASE}${url}`, {
      method: 'POST',
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

  removeBackground: async (productId: string) => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token

    const response = await fetch(`${API_BASE}/api/admin/products/ai/${productId}/remove-background`, {
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

  createMockups: async (productId: string) => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token

    const response = await fetch(`${API_BASE}/api/admin/products/ai/${productId}/create-mockups`, {
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
}

