// Tests for Watchtower task cc629cad-f5a1-4fd9-9561-97c1ab0a0984: "Persist
// Imagination Sheet layers: fix data loss on save/reload".
//
// POST /projects/save used to destructure `layers` from the request body and
// never write it anywhere — canvas_state only carried a Konva-attrs-only
// summary (x/y/width/height/rotation/scaleX/scaleY), so every save silently
// dropped z_index and the entire metadata blob (dpiInfo, originalWidth/
// Height, opacity, locked, text, fontSize, color, shape props). Reloaded
// sheets always came back from the ORIGINAL upload-time imagination_layers
// row: position 0,0 / 100x100in / metadata = {originalName, mimeType} only.
//
// partitionLayersForSave / toLayerDbRow are the exact row-shaping the route
// hands to supabase-js's .upsert()/.insert() — since those calls pass the
// row objects straight through, asserting every field survives this mapping
// is equivalent to asserting it survives the DB round trip, without needing
// a live database (this repo explicitly keeps live-DB checks out of `npm test`
// — see supabase/validate-*.js).

import { describe, it, expect } from 'vitest'
import { isUuid, toLayerDbRow, partitionLayersForSave, rotatedBoundingBox, type IncomingLayer } from './imagination-layer-save.js'

const SHEET_ID = '11111111-1111-1111-1111-111111111111'
const EXISTING_IMAGE_LAYER_ID = '22222222-2222-2222-2222-222222222222'

describe('isUuid', () => {
  it('accepts a real DB-issued UUID', () => {
    expect(isUuid(EXISTING_IMAGE_LAYER_ID)).toBe(true)
  })

  it('rejects client-generated placeholder ids for text/shape layers created purely in the browser', () => {
    expect(isUuid('text-1785160502767')).toBe(false)
    expect(isUuid('shape-1785160502767')).toBe(false)
    expect(isUuid('line-1785160502767')).toBe(false)
    expect(isUuid(undefined)).toBe(false)
    expect(isUuid(null)).toBe(false)
  })
})

describe('toLayerDbRow / partitionLayersForSave — save -> reload round trip preserves every layer property', () => {
  it('an image layer with FULL metadata survives the mapping to a DB row untouched', () => {
    const layer: IncomingLayer = {
      id: EXISTING_IMAGE_LAYER_ID,
      layer_type: 'image',
      source_url: 'https://storage.googleapis.com/bucket/original.png',
      processed_url: 'https://storage.googleapis.com/bucket/nobg.png',
      position_x: 3.25,
      position_y: 7.5,
      width: 4.5,
      height: 6.1,
      rotation: 33,
      scale_x: 1,
      scale_y: 1,
      z_index: 4,
      metadata: {
        name: 'my-logo',
        visible: true,
        locked: true,
        opacity: 0.8,
        originalWidth: 2400,
        originalHeight: 3200,
        dpiInfo: { dpi: 320, quality: 'good', originalWidth: 2400, originalHeight: 3200, canvasSizeInches: { width: 4.5, height: 6.1 }, minDPI: 300 },
      },
    }

    const { withIdRows, withoutIdRows, withoutIdClientIds } = partitionLayersForSave([layer], SHEET_ID)

    expect(withoutIdRows).toEqual([])
    expect(withoutIdClientIds).toEqual([])
    expect(withIdRows).toHaveLength(1)

    const row = withIdRows[0]
    expect(row.id).toBe(EXISTING_IMAGE_LAYER_ID)
    expect(row.sheet_id).toBe(SHEET_ID)
    expect(row.layer_type).toBe('image')
    expect(row.source_url).toBe(layer.source_url)
    expect(row.processed_url).toBe(layer.processed_url)
    expect(row.position_x).toBe(3.25)
    expect(row.position_y).toBe(7.5)
    expect(row.width).toBe(4.5)
    expect(row.height).toBe(6.1)
    expect(row.rotation).toBe(33)
    expect(row.z_index).toBe(4)
    // The FULL metadata object round-trips verbatim — not just the Konva
    // attrs canvas_state used to carry.
    expect(row.metadata).toEqual(layer.metadata)
  })

  it('a text layer (never persisted at all before this fix) gets its text/font/color metadata preserved', () => {
    const textLayer: IncomingLayer = {
      id: 'text-1785160502767', // client-generated, not a UUID — never touched the DB before
      layer_type: 'text',
      position_x: 1,
      position_y: 1,
      width: 4,
      height: 0.75,
      rotation: 0,
      z_index: 2,
      metadata: { name: 'Hello', text: 'Hello World', fontSize: 48, fontFamily: 'Arial', color: '#FF0000', opacity: 1, locked: false },
    }

    const { withIdRows, withoutIdRows, withoutIdClientIds } = partitionLayersForSave([textLayer], SHEET_ID)
    expect(withIdRows).toEqual([])
    expect(withoutIdRows).toHaveLength(1)
    expect(withoutIdClientIds).toEqual(['text-1785160502767'])

    const row = withoutIdRows[0]
    expect(row.layer_type).toBe('text')
    expect(row.metadata).toEqual(textLayer.metadata)
    expect(row.metadata!.text).toBe('Hello World')
    expect(row.metadata!.fontSize).toBe(48)
    expect(row.metadata!.color).toBe('#FF0000')
  })

  it('a shape layer preserves shapeType/fill/stroke/strokeWidth metadata', () => {
    const shapeLayer: IncomingLayer = {
      id: 'shape-1785160502999',
      layer_type: 'shape',
      position_x: 2,
      position_y: 2,
      width: 2,
      height: 2,
      rotation: 15,
      z_index: 1,
      metadata: { shapeType: 'star', fill: '#8B5CF6', stroke: '#7C3AED', strokeWidth: 2 },
    }

    const { withoutIdRows } = partitionLayersForSave([shapeLayer], SHEET_ID)
    expect(withoutIdRows[0].metadata).toEqual(shapeLayer.metadata)
    expect(withoutIdRows[0].rotation).toBe(15)
  })

  it('a mixed save (existing image + new text) partitions correctly and keeps ids index-aligned', () => {
    const imageLayer: IncomingLayer = { id: EXISTING_IMAGE_LAYER_ID, layer_type: 'image', position_x: 0, position_y: 0, width: 4, height: 4, rotation: 0, z_index: 0 }
    const textLayer: IncomingLayer = { id: 'text-abc', layer_type: 'text', position_x: 1, position_y: 1, width: 2, height: 1, rotation: 0, z_index: 1 }

    const { withIdRows, withoutIdRows, withoutIdClientIds } = partitionLayersForSave([imageLayer, textLayer], SHEET_ID)
    expect(withIdRows.map(r => r.id)).toEqual([EXISTING_IMAGE_LAYER_ID])
    expect(withoutIdRows).toHaveLength(1)
    expect(withoutIdClientIds).toEqual(['text-abc']) // index-aligned with withoutIdRows[0]
  })

  it('an empty save (user cleared the sheet) partitions to nothing on both sides — caller deletes all layers for the sheet', () => {
    const { withIdRows, withoutIdRows } = partitionLayersForSave([], SHEET_ID)
    expect(withIdRows).toEqual([])
    expect(withoutIdRows).toEqual([])
  })

  it('defaults missing numeric fields sanely rather than persisting undefined', () => {
    const sparse: IncomingLayer = { id: EXISTING_IMAGE_LAYER_ID, layer_type: 'image' }
    const row = toLayerDbRow(sparse, SHEET_ID)
    expect(row.position_x).toBe(0)
    expect(row.position_y).toBe(0)
    expect(row.rotation).toBe(0)
    expect(row.scale_x).toBe(1)
    expect(row.scale_y).toBe(1)
    expect(row.z_index).toBe(0)
    expect(row.width).toBeNull()
    expect(row.height).toBeNull()
    expect(row.metadata).toBeNull()
  })
})

describe('rotatedBoundingBox — server-side render rotation math (pivot = top-left corner, matching Konva)', () => {
  it('a 0deg rotation is a no-op bounding box (same size, zero offset)', () => {
    const box = rotatedBoundingBox(100, 50, 0)
    expect(box.offsetX).toBeCloseTo(0)
    expect(box.offsetY).toBeCloseTo(0)
    expect(box.width).toBeCloseTo(100)
    expect(box.height).toBeCloseTo(50)
  })

  it('a 90deg rotation around the top-left corner swaps width/height and sweeps entirely into negative X', () => {
    const box = rotatedBoundingBox(100, 50, 90)
    expect(box.width).toBeCloseTo(50)
    expect(box.height).toBeCloseTo(100)
    // The pivot corner (0,0) stays fixed; rotating 100 units of width by 90deg
    // around it sweeps that edge to x=-100..0, and the 50-unit height edge to
    // y=0..50 — the resulting AABB starts at (-50, 0) once both edges are
    // accounted for.
    expect(box.offsetX).toBeCloseTo(-50)
    expect(box.offsetY).toBeCloseTo(0)
  })

  it('a 45deg rotation of a square expands the bounding box by sqrt(2), pivoting at the top-left corner (not centered)', () => {
    const size = 100
    const box = rotatedBoundingBox(size, size, 45)
    const expectedDiagonal = size * Math.SQRT2
    expect(box.width).toBeCloseTo(expectedDiagonal, 5)
    expect(box.height).toBeCloseTo(expectedDiagonal, 5)
    // Pivoting at the top-left corner (0,0) — which stays fixed — the swept
    // bounding box extends symmetrically to the LEFT of that pivot but not
    // upward past it: offsetX is negative (half the diagonal), offsetY is 0.
    expect(box.offsetX).toBeCloseTo(-expectedDiagonal / 2, 5)
    expect(box.offsetY).toBeCloseTo(0, 5)
  })

  it('the (0,0) pivot corner itself is always included in the swept bounding box', () => {
    for (const angle of [0, 30, 90, 137, 270]) {
      const box = rotatedBoundingBox(80, 40, angle)
      // (0,0) must fall within [offsetX, offsetX+width] x [offsetY, offsetY+height]
      expect(box.offsetX).toBeLessThanOrEqual(0)
      expect(box.offsetX + box.width).toBeGreaterThanOrEqual(0)
      expect(box.offsetY).toBeLessThanOrEqual(0)
      expect(box.offsetY + box.height).toBeGreaterThanOrEqual(0)
    }
  })
})
