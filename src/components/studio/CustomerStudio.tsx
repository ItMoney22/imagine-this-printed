/**
 * CustomerStudio — the Creator Studio step flow, handed to every signed-in
 * customer from the My Designs tab.
 *
 * David 2026-09-03: "copy our step flow for AI Product builder its really good
 * and i want to pass that on to our customers in the My Design tab ... minus
 * the etsy flow at the end".
 *
 * This file is ONLY the ImagineThisPrinted adapter: brand, lanes, and the
 * translation between our API and the kit's contract. The flow itself lives in
 * src/studio-kit, which has no idea this site exists — see its README.
 *
 * Backend: /api/studio/* (backend/routes/customer-studio.ts). Same rail the
 * Creator Studio runs on, minus the creator gate and minus the real-person
 * model shoot, which is the Etsy listing pipeline.
 */
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE } from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { StepFlowStudio } from '../../studio-kit'
import type {
  StudioAdapter,
  StudioBrand,
  StudioCandidate,
  StudioCreateInput,
  StudioLane,
  StudioShot,
  StudioStatus,
} from '../../studio-kit'

/** The brief Mr. Imagine locks in, in the shape our /create endpoint wants. */
interface ItpBrief {
  prompt: string
  style?: string
  tone?: string
  shirtColor?: 'black' | 'white' | 'gray'
  printPlacement?: string
  printSizeInches?: number
}

const MOCKUP_LABELS: Record<string, string> = {
  mockup_ghost_mannequin: 'Product shot',
  mockup_flat_lay: 'Flat lay',
  mockup_back: 'Back view',
  mockup_pocket: 'Pocket scale',
  mockup_mr_imagine: 'Mr. Imagine',
}

/**
 * apiFetch reports failures as "HTTP 402: {json}", which is no use to a person
 * being told they are short on credits. Surface what the server actually said.
 */
async function studioFetch(path: string, init: RequestInit = {}) {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  const headers = new Headers(init.headers || {})
  if (!(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `That did not go through (${res.status})`)
  return body
}

function briefSummary(brief: ItpBrief): string | undefined {
  const bits: string[] = []
  if (brief.printPlacement === 'front-back') bits.push('Printed front + back')
  else if (brief.printPlacement) bits.push(`Placement: ${brief.printPlacement.replace(/-/g, ' ')}`)
  if (brief.printSizeInches) bits.push(`${brief.printSizeInches}" print`)
  return bits.length > 0 ? bits.join(' · ') : undefined
}

const BRAND: StudioBrand = {
  title: 'MAKE SOMETHING',
  tagline: 'Talk it out with Mr. Imagine — shirts, metal art, 3D prints. Made for you, printed by us.',
  mascotName: 'Mr. Imagine',
  mascotImages: {
    idle: '/mr-imagine/mr-imagine-waist-up.png',
    recording: '/mr-imagine/mr-imagine-waist-up.png',
    thinking: '/mr-imagine/mr-imagine-waist-up-thinking.png',
    speaking: '/mr-imagine/mr-imagine-waist-up-happy.png',
  },
  mascotFallbackImage: '/mr-imagine/mr-imagine-waving.png',
  currency: 'ITC',
  mutePreferenceKey: 'itp-mr-imagine-muted',
  copy: {
    idlePrompt: 'Tap the mic and tell me what you want to make.',
    micIdle: 'Talk to Mr. Imagine',
    typePlaceholder: '…or type to him',
    emptyTitle: 'Say what you want to make.',
    emptyExamples: [
      'A shirt for my fishing club',
      'Metal art of a desert sunset',
      'A little dragon 3D print',
    ],
    pickPrompt: 'Say the numbers you love — or tap them. Every pick becomes its own product.',
    buildButton: 'Build {n} product{s}',
    shotsLabel: 'Your product shots',
    submitButton: 'Send it to the print shop',
    doneTitle: 'Sent to the print shop!',
    doneBody: 'A human checks every design before it goes live — usually within a day. You will find it under My Designs either way.',
    againButton: 'Make another',
  },
}

interface Props {
  /** Called when a build starts or finishes, so the dashboard can refresh. */
  onChanged?: () => void
}

export default function CustomerStudio({ onChanged }: Props) {
  const navigate = useNavigate()

  const lanes: StudioLane[] = useMemo(() => [
    {
      key: 'shirt',
      label: 'Shirt',
      generatingCopy: 'Four AI models are painting your designs…',
    },
    {
      key: 'metal-art',
      label: 'Metal art',
      generatingCopy: 'Four AI models are painting your designs…',
    },
    {
      // 3D runs on the owner-scoped /api/3d-models rail and finishes in the
      // Toy Creator, which already owns concept approval and print sizing.
      // Half-rebuilding that here would be a second, worse copy of it.
      key: '3d-print',
      label: '3D print',
      kind: 'preview-handoff',
      generatingCopy: 'Sketching your 3D concept…',
      handoff: {
        label: 'Finish it in the Toy Creator →',
        note: "That's where you approve the concept and pick a print size.",
        onClick: () => navigate('/toy-creator'),
      },
      doneCopy: {
        title: 'Saved to your 3D library!',
        body: 'Find it under My Designs, in the 3D Models tab.',
      },
    },
  ], [navigate])

  const adapter: StudioAdapter = useMemo(() => ({
    getPricing: async () => {
      try { return await studioFetch('/api/studio/pricing') } catch { return null }
    },

    create: async ({ lane, brief, options }: StudioCreateInput) => {
      const b = brief as ItpBrief
      const res = await studioFetch('/api/studio/create', {
        method: 'POST',
        body: JSON.stringify({
          prompt: b.prompt,
          style: b.style,
          tone: b.tone,
          category: lane === 'metal-art' ? 'metal-art' : 'shirts',
          productType: 'tshirt',
          shirtColor: b.shirtColor,
          printPlacement: b.printPlacement,
          printSizeInches: b.printSizeInches,
          metalSize: lane === 'metal-art' ? (options.metalSize || '4x6') : undefined,
        }),
      })
      onChanged?.()
      return { id: res.productId, name: res.product?.name }
    },

    status: async (id: string): Promise<StudioStatus> => {
      const data = await studioFetch(`/api/studio/${id}/status`)
      const assets: any[] = data.assets || []
      const jobs: any[] = data.jobs || []
      const terminal = (j: any) => ['succeeded', 'failed', 'skipped'].includes(j.status)

      const candidates: StudioCandidate[] = assets
        .filter((a) => a.kind === 'source')
        .map((a) => ({
          id: a.id,
          url: a.url,
          label: String(a.metadata?.model_id ?? '').split('/').pop() || undefined,
        }))

      const shots: StudioShot[] = assets
        .filter((a) => a.kind === 'mockup' || String(a.asset_role || '').startsWith('mockup_'))
        .map((a) => ({
          id: a.id,
          url: a.url,
          label: MOCKUP_LABELS[a.asset_role] || 'Mockup',
        }))

      return {
        candidates,
        shots,
        generating: jobs.some((j) => !terminal(j)),
        productName: data.product?.name,
      }
    },

    select: async (id: string, assetIds: string[]) => {
      const res = await studioFetch(`/api/studio/${id}/select-image`, {
        method: 'POST',
        body: JSON.stringify({ selectedAssetId: assetIds[0], selectedAssetIds: assetIds }),
      })
      onChanged?.()
      return {
        siblings: (res.siblings || []).map((s: any) => ({ id: s.productId, name: s.name })),
      }
    },

    submit: async (id: string) => {
      await studioFetch(`/api/studio/${id}/submit`, { method: 'POST', body: '{}' })
      onChanged?.()
    },

    createPreview: async ({ brief }: StudioCreateInput) => {
      const b = brief as ItpBrief
      const style3d = /cartoon|toy|cute|chibi/i.test(`${b.style || ''} ${b.prompt}`) ? 'cartoon' : 'realistic'
      const res = await studioFetch('/api/3d-models/create', {
        method: 'POST',
        body: JSON.stringify({ prompt: b.prompt, style: style3d }),
      })
      if (!res?.model?.id) throw new Error('3D concept could not start')
      onChanged?.()
      return { id: res.model.id }
    },

    pollPreview: async (id: string) => {
      const data = await studioFetch(`/api/3d-models/${id}`)
      return { imageUrl: data.model?.concept_image_url, done: !!data.model?.glb_url }
    },

    turn: async ({ audio, text, state, history }) => {
      const form = new FormData()
      if (audio) form.append('audio', audio, 'turn.webm')
      if (text) form.append('text', text)
      form.append('state', JSON.stringify(state))
      form.append('history', JSON.stringify(history))

      const turn = await studioFetch('/api/studio/turn', { method: 'POST', body: form })

      // The brief card gets its one-line summary here, where the ITP field
      // names are known — the kit only ever reads `brief.summary`.
      if (turn?.statePatch?.brief) {
        turn.statePatch.brief.summary = briefSummary(turn.statePatch.brief)
      }
      return turn
    },
  }), [onChanged])

  return (
    <StepFlowStudio
      brand={BRAND}
      lanes={lanes}
      adapter={adapter}
      onBuildStarted={() => onChanged?.()}
      onSubmitted={() => onChanged?.()}
    />
  )
}
