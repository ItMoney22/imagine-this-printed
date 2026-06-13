import React, { useState, useEffect, useCallback, useRef } from 'react'
import { CheckCircle, Clipboard, ExternalLink, Info, Tag } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/SupabaseAuthContext'
import { useToast } from '../hooks/useToast'
import { apiFetch } from '../lib/api'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ModelStatus =
  | 'queued'
  | 'generating_concept'
  | 'awaiting_approval'
  | 'awaiting_3d_generation'
  | 'generating_3d'
  | 'ready'
  | 'failed'

interface ToyModel {
  id: string
  user_id: string
  prompt: string
  style: string | null
  status: ModelStatus
  concept_image_url: string | null
  glb_url: string | null
  stl_url: string | null
  itc_charged: number | null
  size_tier: string | null
  print_height_mm: number | null
  print_price_usd: number | null
  error_message: string | null
  metadata: Record<string, unknown> | null
  created_at: string
  owner: { email: string; username: string } | null
}

interface ListResponse {
  ok: boolean
  models: ToyModel[]
  count: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALL_STATUSES: ModelStatus[] = [
  'queued',
  'generating_concept',
  'awaiting_approval',
  'awaiting_3d_generation',
  'generating_3d',
  'ready',
  'failed',
]

const STATUS_LABELS: Record<ModelStatus, string> = {
  queued: 'Queued',
  generating_concept: 'Concept',
  awaiting_approval: 'Needs Approval',
  awaiting_3d_generation: 'Awaiting 3D',
  generating_3d: '3D Gen',
  ready: 'Ready',
  failed: 'Failed',
}

function statusChipClass(status: ModelStatus): string {
  switch (status) {
    case 'queued':
    case 'generating_concept':
    case 'awaiting_3d_generation':
    case 'generating_3d':
      return 'bg-blue-500/15 text-blue-400 border border-blue-500/30 animate-pulse'
    case 'awaiting_approval':
      return 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
    case 'ready':
      return 'bg-green-500/15 text-green-400 border border-green-500/30'
    case 'failed':
      return 'bg-red-500/15 text-red-400 border border-red-500/30'
    default:
      return 'bg-primary/10 text-primary border border-primary/20'
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

const LIMIT = 50

// ---------------------------------------------------------------------------
// Promote Modal
// ---------------------------------------------------------------------------

interface PromoteModalProps {
  model: ToyModel
  onClose: () => void
  onConfirm: (price: number) => Promise<void>
}

function PromoteModal({ model, onClose, onConfirm }: PromoteModalProps) {
  const [price, setPrice] = useState<string>(
    model.print_price_usd != null ? String(model.print_price_usd) : '25'
  )
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const parsed = parseFloat(price)
    if (isNaN(parsed) || parsed <= 0) return
    setLoading(true)
    await onConfirm(parsed)
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 bg-card border border-text/10 rounded-xl shadow-2xl w-full max-w-sm p-6">
        <h3 className="text-lg font-semibold text-text mb-1">Promote to Catalog</h3>
        <p className="text-sm text-muted mb-4 line-clamp-2">
          {model.prompt}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text mb-1">
              Sale Price (USD)
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">$</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={price}
                onChange={e => setPrice(e.target.value)}
                className="w-full pl-7 pr-3 py-2 bg-bg border border-text/10 rounded-lg text-text text-sm focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30"
                required
              />
            </div>
          </div>

          <p className="text-xs text-muted">
            This creates an <span className="font-medium text-amber-400">inactive</span> catalog
            product — activate it in Product Management when ready.
          </p>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded-lg border border-text/10 text-muted text-sm hover:bg-text/5 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {loading ? 'Promoting…' : 'Promote'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// NFC Panel
// ---------------------------------------------------------------------------

interface NfcState {
  enabled: boolean
  experience_url: string
  video_url: string
  written: boolean
}

interface NfcPanelProps {
  model: ToyModel
}

function NfcPanel({ model }: NfcPanelProps) {
  const toast = useToast()
  const defaultArUrl = `https://imaginethisprinted.com/ar/${model.id}`

  // Initialise from metadata if already present
  const existingNfc = (model.metadata as Record<string, unknown> | null)?.nfc as Record<string, unknown> | undefined

  const [nfc, setNfc] = useState<NfcState>({
    enabled: Boolean(existingNfc?.enabled ?? false),
    experience_url: String(existingNfc?.experience_url ?? ''),
    video_url: String(existingNfc?.video_url ?? ''),
    written: Boolean(existingNfc?.written ?? false),
  })
  const [saving, setSaving] = useState<string | null>(null) // which field is being saved
  const [checklistOpen, setChecklistOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const postNfc = async (patch: Partial<NfcState>, fieldKey: string) => {
    setSaving(fieldKey)
    try {
      const res = await apiFetch(`/api/3d-models/admin/${model.id}/nfc`, {
        method: 'POST',
        body: JSON.stringify(patch),
      })
      if (!res?.ok) throw new Error(res?.error ?? 'NFC update failed')
      // Merge returned nfc data if present
      const returned = res.nfc as Partial<NfcState> | undefined
      if (returned) {
        setNfc(prev => ({ ...prev, ...returned }))
      } else {
        setNfc(prev => ({ ...prev, ...patch }))
      }
      toast.success('NFC updated', 'Tag configuration saved.')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Save failed'
      toast.error('NFC save failed', msg)
    } finally {
      setSaving(null)
    }
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(nfc.experience_url || defaultArUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      toast.error('Copy failed', 'Could not copy to clipboard.')
    }
  }

  const displayUrl = nfc.experience_url || defaultArUrl

  return (
    <div className="border border-text/10 rounded-lg p-4 space-y-4 bg-bg">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Tag className="w-4 h-4 text-primary shrink-0" />
          <span className="text-sm font-semibold text-text">NFC Tag</span>
          {nfc.written && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600 bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded-full">
              <CheckCircle className="w-3 h-3" />
              Written
            </span>
          )}
        </div>
        {/* Enable AR toggle */}
        <button
          onClick={() => void postNfc({ enabled: !nfc.enabled }, 'enabled')}
          disabled={saving === 'enabled'}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${nfc.enabled ? 'bg-primary' : 'bg-text/20'} disabled:opacity-50`}
          role="switch"
          aria-checked={nfc.enabled}
          aria-label="Enable AR page"
        >
          <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${nfc.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
        </button>
        <span className="text-xs text-muted">{nfc.enabled ? 'AR page enabled' : 'Enable AR page'}</span>
      </div>

      {/* Default AR URL + copy */}
      <div className="space-y-1">
        <p className="text-xs text-muted font-medium uppercase tracking-wide">AR link</p>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-text/80 bg-text/5 border border-text/10 rounded px-2 py-1 flex-1 truncate">
            {displayUrl}
          </span>
          <button
            onClick={handleCopy}
            className="p-1.5 rounded-lg border border-text/10 bg-card hover:bg-text/5 transition-colors text-muted hover:text-text"
            aria-label="Copy AR link"
            title="Copy to clipboard"
          >
            {copied ? <CheckCircle className="w-3.5 h-3.5 text-green-500" /> : <Clipboard className="w-3.5 h-3.5" />}
          </button>
          <a
            href={displayUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded-lg border border-text/10 bg-card hover:bg-text/5 transition-colors text-muted hover:text-text"
            aria-label="Open AR page"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* WorldCAST experience URL override */}
      <div className="space-y-1">
        <label className="text-xs text-muted font-medium uppercase tracking-wide" htmlFor={`exp-url-${model.id}`}>
          WorldCAST cast URL (optional override)
        </label>
        <div className="flex gap-2">
          <input
            id={`exp-url-${model.id}`}
            type="url"
            value={nfc.experience_url}
            onChange={e => setNfc(prev => ({ ...prev, experience_url: e.target.value }))}
            placeholder={defaultArUrl}
            className="flex-1 text-xs bg-bg border border-text/10 rounded-lg px-3 py-2 text-text placeholder:text-muted focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30"
          />
          <button
            onClick={() => void postNfc({ experience_url: nfc.experience_url }, 'experience_url')}
            disabled={saving === 'experience_url'}
            className="px-3 py-2 rounded-lg bg-primary text-white text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 shrink-0"
          >
            {saving === 'experience_url' ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Come-alive video URL */}
      <div className="space-y-1">
        <label className="text-xs text-muted font-medium uppercase tracking-wide" htmlFor={`vid-url-${model.id}`}>
          Come-alive video URL (optional)
        </label>
        <div className="flex gap-2">
          <input
            id={`vid-url-${model.id}`}
            type="url"
            value={nfc.video_url}
            onChange={e => setNfc(prev => ({ ...prev, video_url: e.target.value }))}
            placeholder="https://…"
            className="flex-1 text-xs bg-bg border border-text/10 rounded-lg px-3 py-2 text-text placeholder:text-muted focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30"
          />
          <button
            onClick={() => void postNfc({ video_url: nfc.video_url }, 'video_url')}
            disabled={saving === 'video_url'}
            className="px-3 py-2 rounded-lg bg-primary text-white text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 shrink-0"
          >
            {saving === 'video_url' ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Tag written checkbox */}
      <label className="flex items-center gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={nfc.written}
          onChange={e => void postNfc({ written: e.target.checked }, 'written')}
          disabled={saving === 'written'}
          className="w-4 h-4 rounded border-text/20 accent-[var(--color-primary)] disabled:opacity-50"
        />
        <span className="text-xs text-text font-medium">Tag written</span>
        {saving === 'written' && <span className="text-xs text-muted animate-pulse">Saving…</span>}
      </label>

      {/* Collapsible worker checklist */}
      <div className="border border-text/10 rounded-lg overflow-hidden">
        <button
          onClick={() => setChecklistOpen(v => !v)}
          className="w-full flex items-center justify-between px-3 py-2 text-xs text-muted hover:text-text hover:bg-text/5 transition-colors"
        >
          <span className="flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5" />
            Worker checklist — how to write this tag
          </span>
          <svg
            className={`w-3.5 h-3.5 transition-transform ${checklistOpen ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {checklistOpen && (
          <ol className="px-4 py-3 space-y-2 text-xs text-muted border-t border-text/10 list-decimal list-inside">
            <li>Open the <strong className="text-text">NFC Tools</strong> app on your phone</li>
            <li>Tap <strong className="text-text">Write</strong> &rarr; <strong className="text-text">URL</strong> &rarr; paste the link above</li>
            <li>Tap the tag in the figurine base, then mark <strong className="text-text">Tag written</strong> above</li>
          </ol>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Model Card
// ---------------------------------------------------------------------------

interface ModelCardProps {
  model: ToyModel
  onRetry: (id: string) => Promise<void>
  onPromote: (model: ToyModel) => void
}

function ModelCard({ model, onRetry, onPromote }: ModelCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [retrying, setRetrying] = useState(false)

  async function handleRetry() {
    setRetrying(true)
    await onRetry(model.id)
    setRetrying(false)
  }

  // ToyCreator stores toy_parts as an object ({head, body, strength, extras[], …}),
  // but this card historically expected a string[] (so .length was undefined and the
  // panel never rendered). Normalize both shapes into a deduped trait chip list.
  const rawToyParts = (model.metadata as Record<string, unknown> | null)?.toy_parts
  const toyParts: string[] = Array.isArray(rawToyParts)
    ? (rawToyParts as unknown[]).filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    : rawToyParts && typeof rawToyParts === 'object'
      ? (() => {
          const p = rawToyParts as Record<string, unknown>
          const vals = [p.head, p.body, p.strength, ...(Array.isArray(p.extras) ? p.extras : [])]
          return Array.from(
            new Set(vals.filter((v): v is string => typeof v === 'string' && v.trim().length > 0))
          )
        })()
      : []

  return (
    <div className="bg-card border border-text/10 rounded-xl overflow-hidden flex flex-col">
      {/* Concept image */}
      <div className="aspect-square bg-bg relative overflow-hidden">
        {model.concept_image_url ? (
          <img
            src={model.concept_image_url}
            alt={model.prompt}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg
              className="w-12 h-12 text-muted/30"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15M14.25 3.104c.251.023.501.05.75.082M19.8 15l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.607L5 14.5m14.8.5l.38 1.427c.12.448-.106.916-.547 1.066A20.99 20.99 0 0112 18a20.99 20.99 0 01-8.233-1.508.75.75 0 01-.547-1.066l.38-1.427M5 14.5l-.38-1.427"
              />
            </svg>
          </div>
        )}

        {/* Status chip overlay */}
        <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusChipClass(model.status)}`}>
            {STATUS_LABELS[model.status]}
          </span>
          {model.status === 'ready' &&
            Boolean((model.metadata as Record<string, unknown> | null)?.nfc &&
              ((model.metadata as Record<string, unknown>).nfc as Record<string, unknown>)?.written) && (
            <span className="flex items-center gap-1 text-[10px] font-medium text-green-600 bg-green-500/10 border border-green-500/20 px-1.5 py-0.5 rounded-full">
              <Tag className="w-2.5 h-2.5" />
              NFC
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="p-4 flex flex-col flex-1 gap-3">
        {/* Prompt */}
        <p className="text-sm text-text line-clamp-2 leading-relaxed">{model.prompt}</p>

        {/* Owner + meta row */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
          {model.owner && (
            <span title={model.owner.email}>{model.owner.email}</span>
          )}
          {model.size_tier && (
            <span className="bg-primary/10 text-primary px-1.5 py-0.5 rounded">
              {model.size_tier}
            </span>
          )}
          {model.print_price_usd != null && (
            <span className="text-green-400 font-medium">${model.print_price_usd.toFixed(2)}</span>
          )}
          <span>{formatDate(model.created_at)}</span>
        </div>

        {/* Error box */}
        {model.status === 'failed' && model.error_message && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            <p className="text-xs text-red-400 leading-relaxed">{model.error_message}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2 mt-auto pt-1">
          {model.status === 'failed' && (
            <button
              onClick={handleRetry}
              disabled={retrying}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-medium hover:bg-amber-500/20 transition-colors disabled:opacity-50"
            >
              {retrying ? (
                <>
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Retrying…
                </>
              ) : (
                <>
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Retry
                </>
              )}
            </button>
          )}

          {model.status === 'ready' && (
            <button
              onClick={() => onPromote(model)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-xs font-medium hover:bg-green-500/20 transition-colors"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 11l5-5m0 0l5 5m-5-5v12" />
              </svg>
              Promote to Catalog
            </button>
          )}

          {model.status === 'ready' && model.glb_url && (
            <a
              href={model.glb_url}
              download
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              GLB
            </a>
          )}

          {model.status === 'ready' && model.stl_url && (
            <a
              href={model.stl_url}
              download
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              STL
            </a>
          )}
        </div>

        {/* Expandable details */}
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-1 text-xs text-muted hover:text-text transition-colors self-start"
        >
          <svg
            className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
          {expanded ? 'Hide details' : 'Details'}
        </button>

        {expanded && (
          <div className="space-y-3 text-xs text-muted border-t border-text/10 pt-3">
            {/* Model ID copyable */}
            <div className="flex items-center gap-2">
              <span className="text-text/50 select-none">ID:</span>
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(model.id)
                }}
                className="font-mono text-primary hover:underline truncate max-w-[180px]"
                title="Click to copy"
              >
                {model.id}
              </button>
            </div>

            {model.itc_charged != null && (
              <div className="flex gap-2">
                <span className="text-text/50 select-none">ITC charged:</span>
                <span className="text-amber-400">{model.itc_charged}</span>
              </div>
            )}

            {model.print_height_mm != null && (
              <div className="flex gap-2">
                <span className="text-text/50 select-none">Height:</span>
                <span>{model.print_height_mm} mm</span>
              </div>
            )}

            {model.style && (
              <div className="flex gap-2">
                <span className="text-text/50 select-none">Style:</span>
                <span>{model.style}</span>
              </div>
            )}

            {toyParts && toyParts.length > 0 && (
              <div>
                <span className="text-text/50 select-none block mb-1">Toy parts:</span>
                <div className="flex flex-wrap gap-1">
                  {toyParts.map((part, i) => (
                    <span
                      key={i}
                      className="bg-primary/10 text-primary px-1.5 py-0.5 rounded text-[10px]"
                    >
                      {part}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* NFC panel — only for ready models */}
            {model.status === 'ready' && (
              <NfcPanel model={model} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AdminToyLab() {
  const { user } = useAuth()
  const toast = useToast()

  // Filter state
  const [statusFilter, setStatusFilter] = useState<ModelStatus | ''>('')
  const [sourceFilter, setSourceFilter] = useState<'toy_creator' | ''>('')
  const [search, setSearch] = useState('')

  // Data state
  const [models, setModels] = useState<ToyModel[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  // Promote modal
  const [promoteTarget, setPromoteTarget] = useState<ToyModel | null>(null)

  // Auto-refresh
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ------------------------------------------------------------------
  // Fetch
  // ------------------------------------------------------------------

  const fetchModels = useCallback(
    async (newOffset: number, append: boolean) => {
      if (append) setLoadingMore(true)
      else setLoading(true)

      try {
        const params = new URLSearchParams({
          limit: String(LIMIT),
          offset: String(newOffset),
        })
        if (statusFilter) params.set('status', statusFilter)
        if (sourceFilter) params.set('source', sourceFilter)

        const res: ListResponse = await apiFetch(
          `/api/3d-models/admin/list?${params.toString()}`
        )

        if (!res.ok) throw new Error('Unexpected response from server')

        setTotalCount(res.count)

        if (append) {
          setModels(prev => [...prev, ...res.models])
        } else {
          setModels(res.models)
          setOffset(0)
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to load models'
        toast.error('Load failed', msg)
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [statusFilter, sourceFilter, toast]
  )

  // Initial load + when filters change
  useEffect(() => {
    void fetchModels(0, false)
  }, [fetchModels])

  // Auto-refresh every 30s, skip when tab is hidden
  useEffect(() => {
    autoRefreshRef.current = setInterval(() => {
      if (!document.hidden) {
        void fetchModels(0, false)
      }
    }, 30_000)

    return () => {
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current)
    }
  }, [fetchModels])

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------

  async function handleRetry(id: string) {
    // Optimistic update
    setModels(prev =>
      prev.map(m => (m.id === id ? { ...m, status: 'queued' as ModelStatus } : m))
    )
    try {
      await apiFetch(`/api/3d-models/admin/${id}/retry`, { method: 'POST' })
      toast.success('Requeued', 'Model sent back to the queue.')
    } catch (err: unknown) {
      // Roll back optimistic update
      setModels(prev =>
        prev.map(m => (m.id === id ? { ...m, status: 'failed' as ModelStatus } : m))
      )
      const msg = err instanceof Error ? err.message : 'Retry failed'
      toast.error('Retry failed', msg)
    }
  }

  async function handlePromote(model: ToyModel, price: number) {
    try {
      const res = await apiFetch(
        `/api/3d-models/admin/${model.id}/promote`,
        {
          method: 'POST',
          body: JSON.stringify({ price_usd: price }),
        }
      )
      toast.success(
        'Promoted!',
        `Created as inactive product (ID: ${res.product_id}) — activate it in Product Management.`
      )
      setPromoteTarget(null)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Promote failed'
      toast.error('Promote failed', msg)
    }
  }

  // ------------------------------------------------------------------
  // Load more
  // ------------------------------------------------------------------

  function handleLoadMore() {
    const nextOffset = offset + LIMIT
    setOffset(nextOffset)
    void fetchModels(nextOffset, true)
  }

  // ------------------------------------------------------------------
  // Client-side search filter
  // ------------------------------------------------------------------

  const filtered = search.trim()
    ? models.filter(m => {
        const q = search.trim().toLowerCase()
        return (
          m.prompt.toLowerCase().includes(q) ||
          (m.owner?.email ?? '').toLowerCase().includes(q) ||
          (m.owner?.username ?? '').toLowerCase().includes(q)
        )
      })
    : models

  // ------------------------------------------------------------------
  // Admin guard
  // ------------------------------------------------------------------

  if (!user || user.role !== 'admin') {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center mx-auto">
            <svg className="w-7 h-7 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
          <p className="text-text font-semibold text-lg">Admins only</p>
          <p className="text-muted text-sm">You don't have permission to view this page.</p>
        </div>
      </div>
    )
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  const hasMore = models.length < totalCount

  return (
    <div className="min-h-screen bg-bg">
      {/* Promote modal */}
      {promoteTarget && (
        <PromoteModal
          model={promoteTarget}
          onClose={() => setPromoteTarget(null)}
          onConfirm={price => handlePromote(promoteTarget, price)}
        />
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              {/* Flask icon */}
              <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15M14.25 3.104c.251.023.501.05.75.082M19.8 15l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.607L5 14.5m14.8.5l.38 1.427c.12.448-.106.916-.547 1.066A20.99 20.99 0 0112 18a20.99 20.99 0 01-8.233-1.508.75.75 0 01-.547-1.066l.38-1.427M5 14.5l-.38-1.427" />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-text">Toy Lab</h1>
              <p className="text-sm text-muted">Toy Creator pipeline — every creature kids are making</p>
            </div>
          </div>

          <button
            onClick={() => void fetchModels(0, false)}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-text/10 bg-card text-sm text-text hover:bg-text/5 transition-colors disabled:opacity-50"
          >
            <svg
              className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>

        {/* Filter bar */}
        <div className="bg-card border border-text/10 rounded-xl p-4 space-y-4">
          {/* Status pills */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setStatusFilter('')}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                statusFilter === ''
                  ? 'bg-primary text-white'
                  : 'bg-bg border border-text/10 text-muted hover:text-text hover:border-text/20'
              }`}
            >
              All
            </button>
            {ALL_STATUSES.map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(prev => (prev === s ? '' : s))}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  statusFilter === s
                    ? 'bg-primary text-white'
                    : 'bg-bg border border-text/10 text-muted hover:text-text hover:border-text/20'
                }`}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>

          {/* Source + search row */}
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Source toggle */}
            <div className="flex rounded-lg overflow-hidden border border-text/10 shrink-0">
              <button
                onClick={() => setSourceFilter('')}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  sourceFilter === ''
                    ? 'bg-primary text-white'
                    : 'bg-card text-muted hover:text-text'
                }`}
              >
                All sources
              </button>
              <button
                onClick={() => setSourceFilter(prev => (prev === 'toy_creator' ? '' : 'toy_creator'))}
                className={`px-3 py-1.5 text-xs font-medium transition-colors border-l border-text/10 ${
                  sourceFilter === 'toy_creator'
                    ? 'bg-primary text-white'
                    : 'bg-card text-muted hover:text-text'
                }`}
              >
                Toy Creator only
              </button>
            </div>

            {/* Search */}
            <div className="relative flex-1">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search prompt or owner email…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-1.5 bg-bg border border-text/10 rounded-lg text-sm text-text placeholder:text-muted focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30"
              />
            </div>
          </div>

          {/* Count summary */}
          <p className="text-xs text-muted">
            Showing <span className="text-text font-medium">{filtered.length}</span>
            {search ? ' matching' : ''} of{' '}
            <span className="text-text font-medium">{totalCount}</span> total
          </p>
        </div>

        {/* Content */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="bg-card border border-text/10 rounded-xl overflow-hidden animate-pulse"
              >
                <div className="aspect-square bg-text/5" />
                <div className="p-4 space-y-3">
                  <div className="h-3 bg-text/10 rounded w-full" />
                  <div className="h-3 bg-text/10 rounded w-3/4" />
                  <div className="h-8 bg-text/5 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <svg className="w-7 h-7 text-primary/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15M14.25 3.104c.251.023.501.05.75.082M19.8 15l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.607L5 14.5m14.8.5l.38 1.427c.12.448-.106.916-.547 1.066A20.99 20.99 0 0112 18a20.99 20.99 0 01-8.233-1.508.75.75 0 01-.547-1.066l.38-1.427M5 14.5l-.38-1.427" />
              </svg>
            </div>
            <p className="text-text font-medium">No models found</p>
            <p className="text-muted text-sm mt-1">
              {search ? 'Try a different search term.' : 'No models match the current filters.'}
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filtered.map(model => (
                <ModelCard
                  key={model.id}
                  model={model}
                  onRetry={handleRetry}
                  onPromote={m => setPromoteTarget(m)}
                />
              ))}
            </div>

            {/* Load more */}
            {hasMore && !search && (
              <div className="flex justify-center pt-4">
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-xl border border-text/10 bg-card text-sm text-text hover:bg-text/5 transition-colors disabled:opacity-50"
                >
                  {loadingMore ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Loading…
                    </>
                  ) : (
                    `Load more (${totalCount - models.length} remaining)`
                  )}
                </button>
              </div>
            )}

            {/* Link to products management */}
            {statusFilter === 'ready' || promoteTarget === null ? null : null}
          </>
        )}

        {/* Footer hint for promote workflow */}
        <p className="text-xs text-muted text-center pb-4">
          Promoted models become inactive products —{' '}
          <Link to="/admin" className="text-primary hover:underline">
            activate them in Product Management
          </Link>
        </p>
      </div>
    </div>
  )
}
