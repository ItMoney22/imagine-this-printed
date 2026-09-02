/**
 * Google Cloud Storage Service
 * Handles file uploads, downloads, and signed URL generation
 */

import { Storage, Bucket, File } from '@google-cloud/storage'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { sniffImageContentType, extForImageContentType } from './google-cloud-storage.js'

const projectId = process.env.GCS_PROJECT_ID || 'imagine-this-printed-main'
const bucketName = process.env.GCS_BUCKET_NAME || 'imagine-this-printed-main'

// Initialize GCS client - supports both file path and JSON string credentials
function createStorageClient(): Storage {
  const credentialsPath = process.env.GCS_CREDENTIALS_PATH
  const credentialsJson = process.env.GCS_CREDENTIALS

  // If we have a JSON string (for Railway/cloud deployment)
  if (credentialsJson && credentialsJson !== '{}') {
    try {
      const credentials = JSON.parse(credentialsJson)
      return new Storage({
        projectId,
        credentials
      })
    } catch (e) {
      console.error('[gcs-storage] Failed to parse GCS_CREDENTIALS JSON:', e)
    }
  }

  // Fall back to file path (for local development)
  if (credentialsPath) {
    return new Storage({
      projectId,
      keyFilename: credentialsPath
    })
  }

  // Default - uses application default credentials
  return new Storage({ projectId })
}

const storage = createStorageClient()

const bucket: Bucket = storage.bucket(bucketName)

export interface UploadOptions {
  userId: string
  // 'inspiration' added 2026-09-02 (Track B, Step Flow inspiration upload —
  // services/step-flow/inspiration.ts uploads the original reference photo
  // here before analyzing a downscaled copy).
  folder: 'mockups' | 'designs' | 'uploads' | 'temp' | 'thumbnails' | 'avatars' | 'covers' | 'ai-generated' | 'upscaled' | 'enhanced' | 'reimagined' | 'bg-removed' | 'email-attachments' | 'message-attachments' | 'inspiration'
  filename?: string
  contentType?: string
  metadata?: Record<string, any>
}

export interface UploadResult {
  gcsPath: string
  publicUrl: string
  filename: string
}

/**
 * Upload a file to GCS
 */
export async function uploadFile(
  fileBuffer: Buffer,
  options: UploadOptions
): Promise<UploadResult> {
  const { userId, folder, filename, contentType = 'image/png', metadata = {} } = options

  // Generate unique filename if not provided
  const uniqueFilename = filename || `${uuidv4()}.${extForImageContentType(contentType)}`

  // Construct GCS path
  const gcsPath = folder === 'temp'
    ? `temp/designs/${uniqueFilename}`
    : `users/${userId}/${folder}/${uniqueFilename}`

  // Create file reference
  const file: File = bucket.file(gcsPath)

  // Upload buffer
  await file.save(fileBuffer, {
    contentType,
    metadata: {
      ...metadata,
      uploadedAt: new Date().toISOString()
    },
    validation: 'crc32c'
  })

  // Public access is blocked at the org level, so a plain
  // storage.googleapis.com/<bucket>/<path> URL returns 403 — which is why
  // Remove BG / Enhance / Upscale / Reimagine outputs and design thumbnails
  // previously rendered blank even though the upstream model succeeded. Mint a
  // long-lived signed URL instead (same workaround as google-cloud-storage.ts).
  const [publicUrl] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 365 * 24 * 60 * 60 * 1000 // 1 year (max allowed)
  })

  return {
    gcsPath,
    publicUrl,
    filename: uniqueFilename
  }
}

/**
 * Upload from base64 data URL
 */
export async function uploadFromDataUrl(
  dataUrl: string,
  options: UploadOptions
): Promise<UploadResult> {
  // Extract base64 data
  const matches = dataUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/)

  if (!matches || matches.length !== 3) {
    throw new Error('Invalid data URL format')
  }

  const contentType = matches[1]
  const base64Data = matches[2]
  const buffer = Buffer.from(base64Data, 'base64')

  return uploadFile(buffer, {
    ...options,
    contentType
  })
}

/**
 * Generate signed URL for private file download
 */
export async function generateSignedUrl(
  gcsPath: string,
  expiresInHours: number = 24
): Promise<string> {
  const file: File = bucket.file(gcsPath)

  const [signedUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + expiresInHours * 60 * 60 * 1000
  })

  return signedUrl
}

/**
 * Delete a file from GCS
 */
export async function deleteFile(gcsPath: string): Promise<void> {
  const file: File = bucket.file(gcsPath)
  await file.delete()
}

/**
 * Check if file exists
 */
export async function fileExists(gcsPath: string): Promise<boolean> {
  const file: File = bucket.file(gcsPath)
  const [exists] = await file.exists()
  return exists
}

/**
 * Get file metadata
 */
export async function getFileMetadata(gcsPath: string): Promise<any> {
  const file: File = bucket.file(gcsPath)
  const [metadata] = await file.getMetadata()
  return metadata
}

/**
 * List files in a folder
 */
export async function listFiles(
  prefix: string,
  maxResults: number = 100
): Promise<string[]> {
  const [files] = await bucket.getFiles({
    prefix,
    maxResults
  })

  return files.map(file => file.name)
}

/**
 * Download file as buffer
 */
export async function downloadFile(gcsPath: string): Promise<Buffer> {
  const file: File = bucket.file(gcsPath)
  const [buffer] = await file.download()
  return buffer
}

/**
 * Copy file to new location
 */
export async function copyFile(
  sourcePath: string,
  destPath: string
): Promise<void> {
  const sourceFile: File = bucket.file(sourcePath)
  await sourceFile.copy(bucket.file(destPath))
}

/**
 * Move file (copy + delete)
 */
export async function moveFile(
  sourcePath: string,
  destPath: string
): Promise<void> {
  await copyFile(sourcePath, destPath)
  await deleteFile(sourcePath)
}

/**
 * Get public URL for a file
 */
export function getPublicUrl(gcsPath: string): string {
  return `https://storage.googleapis.com/${bucketName}/${gcsPath}`
}

/**
 * Create thumbnail from image buffer
 */
export async function uploadThumbnail(
  imageBuffer: Buffer,
  originalGcsPath: string,
  userId: string
): Promise<UploadResult> {
  // Extract folder and filename
  const pathParts = originalGcsPath.split('/')
  const filename = pathParts[pathParts.length - 1]
  const thumbnailFilename = `thumb_${filename}`

  // Upload thumbnail (in real impl, would resize the image first)
  return uploadFile(imageBuffer, {
    userId,
    folder: 'mockups',
    filename: thumbnailFilename,
    metadata: {
      type: 'thumbnail',
      original: originalGcsPath
    }
  })
}

/**
 * Upload from a remote URL (downloads and re-uploads to GCS)
 * This is critical for persisting temporary URLs (like Replicate delivery URLs)
 */
export async function uploadFromUrl(
  imageUrl: string,
  options: UploadOptions
): Promise<UploadResult> {
  console.log('[gcs-storage] 📥 Downloading image from URL:', imageUrl.substring(0, 80) + '...')

  // Fetch the image from the remote URL
  const response = await fetch(imageUrl)

  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`)
  }

  // Convert to buffer
  const arrayBuffer = await response.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  // Servers (Replicate included) can't be trusted to report the real format —
  // e.g. google/nano-banana-2-lite ignores output_format and always returns
  // JPEG bytes behind a .png delivery URL with an image/png header. Magic
  // bytes win over both the served header and any assumed default.
  const contentType =
    sniffImageContentType(buffer) || response.headers.get('content-type') || 'image/png'

  console.log('[gcs-storage] 📤 Re-uploading to GCS, size:', buffer.length, 'bytes', `(${contentType})`)

  // Keep the caller's filename prefix but make the extension match the real bytes.
  const filename = options.filename
    ? options.filename.replace(/\.[a-zA-Z0-9]+$/, `.${extForImageContentType(contentType)}`)
    : options.filename

  return uploadFile(buffer, {
    ...options,
    filename,
    contentType
  })
}

export default {
  uploadFile,
  uploadFromDataUrl,
  uploadFromUrl,
  generateSignedUrl,
  deleteFile,
  fileExists,
  getFileMetadata,
  listFiles,
  downloadFile,
  copyFile,
  moveFile,
  getPublicUrl,
  uploadThumbnail
}
