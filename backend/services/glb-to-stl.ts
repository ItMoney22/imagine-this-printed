/**
 * GLB to STL Converter Service
 *
 * Converts GLB (glTF Binary) files to STL format for 3D printing.
 * Uses three.js for parsing and exporting.
 *
 * Note: This service runs in Node.js environment using three.js
 * which requires proper setup for server-side rendering.
 * We use dynamic imports to ensure polyfills are set up before three.js loads.
 */

export interface ConversionResult {
  stlBuffer: Buffer
  vertexCount: number
  triangleCount: number
  processingTime: number
  /** Final mesh bounding box in millimeters (after scale + axis transform). */
  bboxMm?: { x: number; y: number; z: number }
  /** True if the converter applied Y-up → Z-up rotation. */
  zUpApplied?: boolean
}

export interface ConversionOptions {
  /**
   * Scale the mesh so its post-rotation Z (height) axis equals this many
   * millimeters. STL has no unit metadata; Bambu / OrcaSlicer / Cura all read
   * raw STL coordinates as mm. Without this, a Tripo3D GLB (typically ~1m in
   * GLB units) imports as a 1mm speck.
   */
  targetHeightMm?: number
  /**
   * Convert glTF's Y-up convention to FDM's Z-up. Default true.
   * Without this, figurines import lying on their side in Bambu Studio.
   */
  yUpToZUp?: boolean
  /**
   * Center the mesh on XY at origin and rest its lowest point at Z=0 so it
   * sits flat on the build plate. Default true.
   */
  centerAndGround?: boolean
}

// Flag to track if polyfills have been set up
let polyfillsInitialized = false

/**
 * Setup polyfills for three.js in Node.js environment
 * Must be called before importing three.js modules
 */
function setupThreeJsPolyfills() {
  if (polyfillsInitialized) return

  // Only polyfill if not already set
  if (typeof (globalThis as any).self === 'undefined') {
    (globalThis as any).self = globalThis
  }
  if (typeof (globalThis as any).window === 'undefined') {
    (globalThis as any).window = {
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
      innerWidth: 1024,
      innerHeight: 768,
      devicePixelRatio: 1,
    }
  }
  if (typeof (globalThis as any).document === 'undefined') {
    (globalThis as any).document = {
      createElement: () => ({ style: {}, addEventListener: () => {} }),
      createElementNS: () => ({ style: {}, setAttribute: () => {} }),
      documentElement: { style: {} },
    }
  }

  polyfillsInitialized = true
}

/**
 * Convert a GLB file to binary STL format
 *
 * @param glbUrl - URL to the GLB file
 * @returns Buffer containing binary STL data
 */
export async function convertGlbToStl(glbUrl: string, options: ConversionOptions = {}): Promise<ConversionResult> {
  // Setup browser polyfills BEFORE importing three.js
  setupThreeJsPolyfills()

  // Dynamic imports to ensure polyfills are in place first
  const THREE = await import('three')
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
  const { STLExporter } = await import('three/examples/jsm/exporters/STLExporter.js')

  console.log('[glb-to-stl] Starting conversion from:', glbUrl.substring(0, 100) + '...')
  const startTime = Date.now()

  try {
    // Download GLB file
    const response = await fetch(glbUrl)
    if (!response.ok) {
      throw new Error(`Failed to download GLB: ${response.status} ${response.statusText}`)
    }

    const glbArrayBuffer = await response.arrayBuffer()
    console.log('[glb-to-stl] Downloaded GLB file:', (glbArrayBuffer.byteLength / 1024).toFixed(2), 'KB')

    // Parse GLB using GLTFLoader
    const loader = new GLTFLoader()

    const gltf = await new Promise<any>((resolve, reject) => {
      loader.parse(
        glbArrayBuffer,
        '',
        (result) => resolve(result),
        (error) => reject(error)
      )
    })

    console.log('[glb-to-stl] GLB parsed successfully')

    // Merge all meshes into a single geometry for STL export
    const scene = gltf.scene
    const geometries: any[] = []
    let totalVertices = 0

    scene.traverse((child: any) => {
      if (child instanceof THREE.Mesh) {
        // Clone and apply world transform
        const geometry = child.geometry.clone()
        geometry.applyMatrix4(child.matrixWorld)
        geometries.push(geometry)
        totalVertices += geometry.attributes.position?.count || 0
      }
    })

    if (geometries.length === 0) {
      throw new Error('No meshes found in GLB file')
    }

    console.log('[glb-to-stl] Found', geometries.length, 'meshes with', totalVertices, 'total vertices')

    // Create a merged mesh for export
    let finalMesh: any

    if (geometries.length === 1) {
      finalMesh = new THREE.Mesh(geometries[0])
    } else {
      // Merge geometries
      const mergedGeometry = mergeBufferGeometries(geometries, THREE)
      finalMesh = new THREE.Mesh(mergedGeometry)
    }

    // === Print-prep transform pipeline ===
    // 1) Y-up → Z-up (FDM convention; figurines stand vertically in Bambu Studio)
    // 2) Scale to target height in mm (without this, STL imports as 1mm speck)
    // 3) Center on XY, ground at Z=0 (sits flat on build plate)
    // All transforms are baked into the geometry so STLExporter sees the final
    // coords directly — STL has no concept of nodes/transforms.
    const yUpToZUp = options.yUpToZUp !== false
    const centerAndGround = options.centerAndGround !== false
    const targetHeightMm = options.targetHeightMm

    if (yUpToZUp) {
      const yToZ = new THREE.Matrix4().makeRotationX(-Math.PI / 2)
      finalMesh.geometry.applyMatrix4(yToZ)
    }

    // After (optional) rotation, height is along Z. Compute bbox to drive scale.
    finalMesh.geometry.computeBoundingBox()
    let bbox = finalMesh.geometry.boundingBox!
    let bboxSize = new THREE.Vector3()
    bbox.getSize(bboxSize)

    if (targetHeightMm && targetHeightMm > 0 && bboxSize.z > 0) {
      // Scale uniformly so the Z extent matches targetHeightMm exactly.
      const factor = targetHeightMm / bboxSize.z
      finalMesh.geometry.scale(factor, factor, factor)
      console.log('[glb-to-stl] scaled by', factor.toFixed(4), 'so Z-height =', targetHeightMm, 'mm')
      finalMesh.geometry.computeBoundingBox()
      bbox = finalMesh.geometry.boundingBox!
      bbox.getSize(bboxSize)
    }

    if (centerAndGround) {
      const center = new THREE.Vector3()
      bbox.getCenter(center)
      // Translate so XY center is at origin and Z minimum (lowest point) is at 0
      finalMesh.geometry.translate(-center.x, -center.y, -bbox.min.z)
      finalMesh.geometry.computeBoundingBox()
      bbox = finalMesh.geometry.boundingBox!
      bbox.getSize(bboxSize)
    }

    console.log(
      '[glb-to-stl] final bbox (mm):',
      bboxSize.x.toFixed(1) + ' ×',
      bboxSize.y.toFixed(1) + ' ×',
      bboxSize.z.toFixed(1)
    )

    // Export to STL
    const exporter = new STLExporter()
    const stlResult = exporter.parse(finalMesh, { binary: true })

    // Convert to Buffer
    let stlBuffer: Buffer
    if (stlResult instanceof ArrayBuffer) {
      stlBuffer = Buffer.from(stlResult)
    } else if (typeof stlResult === 'string') {
      stlBuffer = Buffer.from(stlResult)
    } else if (stlResult instanceof DataView) {
      stlBuffer = Buffer.from(stlResult.buffer, stlResult.byteOffset, stlResult.byteLength)
    } else {
      stlBuffer = Buffer.from(stlResult as ArrayBuffer)
    }

    const processingTime = (Date.now() - startTime) / 1000
    const triangleCount = Math.floor(totalVertices / 3)

    console.log('[glb-to-stl] Conversion complete:', {
      stlSize: (stlBuffer.length / 1024).toFixed(2) + ' KB',
      triangles: triangleCount,
      processingTime: processingTime.toFixed(2) + 's'
    })

    return {
      stlBuffer,
      vertexCount: totalVertices,
      triangleCount,
      processingTime,
      bboxMm: { x: bboxSize.x, y: bboxSize.y, z: bboxSize.z },
      zUpApplied: yUpToZUp,
    }
  } catch (error: any) {
    console.error('[glb-to-stl] Conversion failed:', error.message)
    throw new Error(`GLB to STL conversion failed: ${error.message}`)
  }
}

/**
 * Simple buffer geometry merge utility
 */
function mergeBufferGeometries(geometries: any[], THREE: any): any {
  // Calculate total attribute lengths
  let totalPositions = 0
  let totalNormals = 0
  let hasNormals = true

  for (const geometry of geometries) {
    const positions = geometry.attributes.position
    if (positions) {
      totalPositions += positions.count * 3
    }
    const normals = geometry.attributes.normal
    if (normals) {
      totalNormals += normals.count * 3
    } else {
      hasNormals = false
    }
  }

  // Create merged arrays
  const mergedPositions = new Float32Array(totalPositions)
  const mergedNormals = hasNormals ? new Float32Array(totalNormals) : null

  let positionOffset = 0
  let normalOffset = 0

  for (const geometry of geometries) {
    const positions = geometry.attributes.position
    if (positions) {
      const posArray = positions.array as Float32Array
      mergedPositions.set(posArray, positionOffset)
      positionOffset += posArray.length
    }

    if (hasNormals && mergedNormals) {
      const normals = geometry.attributes.normal
      if (normals) {
        const normArray = normals.array as Float32Array
        mergedNormals.set(normArray, normalOffset)
        normalOffset += normArray.length
      }
    }
  }

  // Create merged geometry
  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.BufferAttribute(mergedPositions, 3))

  if (mergedNormals) {
    merged.setAttribute('normal', new THREE.BufferAttribute(mergedNormals, 3))
  } else {
    merged.computeVertexNormals()
  }

  return merged
}

/**
 * Validate STL buffer is properly formatted
 */
export function validateStlBuffer(buffer: Buffer): boolean {
  // Binary STL files start with 80-byte header followed by 4-byte triangle count
  if (buffer.length < 84) {
    return false
  }

  const triangleCount = buffer.readUInt32LE(80)
  const expectedSize = 84 + triangleCount * 50 // Header + count + (50 bytes per triangle)

  return buffer.length === expectedSize
}

/**
 * Get STL file statistics
 */
export function getStlStats(buffer: Buffer): { triangles: number; sizeKb: number } {
  const triangles = buffer.length >= 84 ? buffer.readUInt32LE(80) : 0
  return {
    triangles,
    sizeKb: buffer.length / 1024
  }
}
