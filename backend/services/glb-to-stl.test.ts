import { describe, it, expect } from 'vitest'
import { convertGlbToStl } from './glb-to-stl'

/**
 * A minimal glTF "statue": a wide triangular base at y=0 and a narrow apex at
 * y=2 (glTF is +Y up, +Z toward the viewer). Packed as a GLB data: URL so
 * convertGlbToStl's fetch reads it without a network.
 */
function statueGlbUrl(): string {
  const positions = new Float32Array([
    -1, 0, -1, // 0 base, back left
    1, 0, -1, // 1 base, back right
    0, 0, 1, // 2 base, FRONT (+Z)
    0, 2, 0 // 3 apex (top of the head)
  ])
  const indices = new Uint16Array([0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3])
  const bin = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(indices.buffer)])
  const binPadded = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)])
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    buffers: [{ byteLength: binPadded.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: indices.byteLength }
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [-1, 0, -1], max: [1, 2, 1] },
      { bufferView: 1, componentType: 5123, count: 12, type: 'SCALAR' }
    ]
  }
  let jsonBuf = Buffer.from(JSON.stringify(json))
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)])
  const header = Buffer.alloc(12)
  header.writeUInt32LE(0x46546c67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binPadded.length, 8)
  const chunk = (type: number, data: Buffer) => {
    const h = Buffer.alloc(8)
    h.writeUInt32LE(data.length, 0)
    h.writeUInt32LE(type, 4)
    return Buffer.concat([h, data])
  }
  const glb = Buffer.concat([header, chunk(0x4e4f534a, jsonBuf), chunk(0x004e4942, binPadded)])
  return `data:model/gltf-binary;base64,${glb.toString('base64')}`
}

/** Every vertex of a binary STL, as [x, y, z]. */
function stlVertices(stl: Buffer): number[][] {
  const n = stl.readUInt32LE(80)
  const out: number[][] = []
  for (let t = 0; t < n; t++) {
    const base = 84 + t * 50 + 12
    for (let v = 0; v < 3; v++) {
      const o = base + v * 12
      out.push([stl.readFloatLE(o), stl.readFloatLE(o + 4), stl.readFloatLE(o + 8)])
    }
  }
  return out
}

describe('convertGlbToStl orientation', () => {
  it('keeps a statue standing: base on the plate, head on top, front toward -Y', async () => {
    const { stlBuffer, bboxMm } = await convertGlbToStl(statueGlbUrl(), {
      targetHeightMm: 100,
      yUpToZUp: true,
      centerAndGround: true
    })
    expect(bboxMm?.z).toBeCloseTo(100, 3)

    const verts = stlVertices(stlBuffer)
    const bottom = verts.filter(v => v[2] < 1)
    const top = verts.filter(v => v[2] > 99)

    // The wide base sits on the plate (it spans 100 mm across at this scale)...
    expect(Math.max(...bottom.map(v => v[0])) - Math.min(...bottom.map(v => v[0]))).toBeGreaterThan(90)
    // ...and the only thing at the top is the apex, centred over it.
    expect(top.length).toBeGreaterThan(0)
    for (const v of top) {
      expect(Math.abs(v[0])).toBeLessThan(1)
    }

    // glTF's front (+Z) faces the front of the plate (-Y): the base's front corner
    // is the lowest Y on the plate.
    const minY = Math.min(...bottom.map(v => v[1]))
    const frontCorner = bottom.find(v => Math.abs(v[0]) < 1)!
    expect(frontCorner[1]).toBeCloseTo(minY, 3)
  })
})
