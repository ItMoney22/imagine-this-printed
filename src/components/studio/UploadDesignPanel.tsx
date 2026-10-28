// "I already have the design" — the Idea step's other way in.
//
// David 2026-10-16: "i need to be able to just upload a design in create a
// product also or go into step flow i have a design i need to make a product
// but no easy way to do it". The flow could already build from finished
// artwork (that is how a design-library row gets in), but only artwork that
// was already on a product. This drops a file onto a fresh draft
// (POST /step/upload) and runs the same adopt the library uses, so the
// builder lands on Garment & Color with the print file being made. Nothing
// is generated.
//
// Staff lane only: the server refuses it on the customer lane too.
import React, { useRef, useState } from 'react'
import { ImageUp } from 'lucide-react'
import { useStudioLane } from './lane'
import { InlineError } from './shared'
import ProgressBar from './ProgressBar'

const ACCEPT = 'image/png,image/jpeg,image/webp'
const MAX_BYTES = 30 * 1024 * 1024
// Upload plus adopt. Adopt is quick for print-ready art and about half a
// minute when a small file has to be enlarged first.
const EXPECTED_MS = 25000

export type UploadKind = 'tshirt' | 'hoodie' | 'youth-tshirt' | 'metal'

const KIND_LABEL: Record<UploadKind, string> = {
  tshirt: 'T-Shirt',
  hoodie: 'Hoodie',
  'youth-tshirt': 'Kids T-Shirt',
  metal: 'Metal print',
}

const readAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Could not read that file'))
    reader.readAsDataURL(file)
  })

interface UploadDesignPanelProps {
  kind: UploadKind
  refresh: (opts?: { productId?: string; advance?: boolean }) => Promise<void>
}

const UploadDesignPanel: React.FC<UploadDesignPanelProps> = ({ kind, refresh }) => {
  const lane = useStudioLane()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [stage, setStage] = useState<string | null>(null)
  const [startedAt, setStartedAt] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const start = async (file: File | undefined) => {
    if (!file || stage) return
    setError(null)
    if (!ACCEPT.split(',').includes(file.type)) {
      setError('Use a PNG, JPG or WEBP file.')
      return
    }
    if (file.size > MAX_BYTES) {
      setError('That file is over 30MB.')
      return
    }
    setStartedAt(Date.now())
    setStage('Uploading your design…')
    let productId: string | null = null
    try {
      const image = await readAsDataUrl(file)
      ;({ productId } = await lane.api.upload({ image, kind, filename: file.name }))
      // Adopt BEFORE the flow learns the product id. Once it knows, the
      // builder's resume effect would see a product with no design take and
      // start a second adopt of its own.
      setStage('Bringing it into the flow…')
      await lane.api.adopt(productId)
      await refresh({ productId, advance: true })
    } catch (err: any) {
      // A draft whose artwork could not be brought in would only sit in the
      // product list with no way forward, so it goes.
      if (productId) await lane.discardDraft(productId).catch(() => undefined)
      setError(err?.message || 'Upload failed')
      setStage(null)
    }
  }

  return (
    <div className="mb-5">
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload a finished design"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            inputRef.current?.click()
          }
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          void start(e.dataTransfer.files?.[0])
        }}
        className={`flex items-center gap-4 rounded-2xl border-2 border-dashed p-4 transition-colors ${
          stage ? 'pointer-events-none opacity-70' : 'cursor-pointer'
        } ${dragging ? 'border-primary bg-primary/10' : 'border-primary/40 bg-primary/5 hover:border-primary hover:bg-primary/10'}`}
      >
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-secondary text-white">
          <ImageUp className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text">Already have the design? Upload it</p>
          <p className="text-xs text-muted mt-0.5">
            Drop a PNG, JPG or WEBP here, or click to choose. It becomes a {KIND_LABEL[kind]} with the background
            cut for print. Approve it, then on to colors and mockups. Nothing is redrawn.
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            void start(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </div>

      {stage && (
        <div className="mt-3">
          <ProgressBar label={stage} startedAt={startedAt} expectedMs={EXPECTED_MS} />
        </div>
      )}
      <InlineError message={error} />

      <div className="mt-5 flex items-center gap-3 text-xs uppercase tracking-wide text-muted">
        <span className="h-px flex-1 bg-border-subtle" />
        or start from an idea
        <span className="h-px flex-1 bg-border-subtle" />
      </div>
    </div>
  )
}

export default UploadDesignPanel
