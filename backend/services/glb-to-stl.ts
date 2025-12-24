/**
 * GLB to STL Converter Service
 *
 * Converts GLB (glTF Binary) files to STL format for 3D printing.
 * Uses three.js for parsing and exporting.
 *
 * Note: This service runs in Node.js environment using three.js
 * which requires proper setup for server-side rendering.
 */

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'

export interface ConversionResult {
  stlBuffer: Buffer
  vertexCount: number
  triangleCount: number
  processingTime: number
}

/**
 * Convert a GLB file to binary STL format
 *
 * @param glbUrl - URL to the GLB file
 * @returns Buffer containing binary STL data
 */
export async function convertGlbToStl(glbUrl: string): Promise<ConversionResult> {
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
    const geometries: THREE.BufferGeometry[] = []
    let totalVertices = 0

    scene.traverse((child: THREE.Object3D) => {
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
    // If multiple geometries, merge them
    let finalMesh: THREE.Mesh

    if (geometries.length === 1) {
      finalMesh = new THREE.Mesh(geometries[0])
    } else {
      // Merge geometries using BufferGeometryUtils pattern
      const mergedGeometry = mergeBufferGeometries(geometries)
      finalMesh = new THREE.Mesh(mergedGeometry)
    }

    // Export to STL
    const exporter = new STLExporter()
    const stlString = exporter.parse(finalMesh, { binary: true })

    // Convert to Buffer
    let stlBuffer: Buffer
    if (stlString instanceof ArrayBuffer) {
      stlBuffer = Buffer.from(stlString)
    } else if (typeof stlString === 'string') {
      stlBuffer = Buffer.from(stlString)
    } else if (stlString instanceof DataView) {
      stlBuffer = Buffer.from(stlString.buffer, stlString.byteOffset, stlString.byteLength)
    } else {
      stlBuffer = Buffer.from(stlString as ArrayBuffer)
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
      processingTime
    }
  } catch (error: any) {
    console.error('[glb-to-stl] Conversion failed:', error.message)
    throw new Error(`GLB to STL conversion failed: ${error.message}`)
  }
}

/**
 * Simple buffer geometry merge utility
 */
function mergeBufferGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
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
