import { Storage } from '@google-cloud/storage'
import fetch from 'node-fetch'

// Initialize GCS client
const storage = new Storage({
  projectId: process.env.GCS_PROJECT_ID!,
  credentials: process.env.GCS_CREDENTIALS
    ? JSON.parse(process.env.GCS_CREDENTIALS)
    : undefined,
})

const bucketName = process.env.GCS_BUCKET_NAME || 'imagine-this-printed-products'
const bucket = storage.bucket(bucketName)

export interface UploadImageResult {
  publicUrl: string
  path: string
}

/**
 * Downloads an image from a URL and uploads it to Google Cloud Storage
 * @param imageUrl - The URL of the image to download
 * @param destinationPath - The path in GCS bucket (e.g., 'products/123/source/image.png')
 * @returns Public URL and path of the uploaded image
 */
export async function uploadImageFromUrl(
  imageUrl: string,
  destinationPath: string
): Promise<UploadImageResult> {
  console.log('[gcs] 📥 Downloading image from:', imageUrl)

  // Download the image
  const response = await fetch(imageUrl)
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.statusText}`)
  }

  const buffer = await response.buffer()
  const contentType = response.headers.get('content-type') || 'image/png'

  console.log('[gcs] 📤 Uploading to GCS:', destinationPath)

  // Upload to GCS (without metadata to avoid ACL operations with uniform bucket-level access)
  const file = bucket.file(destinationPath)
  await file.save(buffer, {
    contentType,
    resumable: false, // Faster for small files, avoids some ACL operations
  })

  // Note: Bucket has public access prevention enforced at organization level
  // Using signed URLs as a workaround (valid for 1 year - maximum allowed)
  const [signedUrl] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 365 * 24 * 60 * 60 * 1000, // 1 year
  })

  console.log('[gcs] ✅ Image uploaded successfully:', signedUrl)

  return {
    publicUrl: signedUrl,
    path: destinationPath,
  }
}

/**
 * Uploads a base64-encoded image to Google Cloud Storage
 * @param base64Data - The base64 data URL (e.g., 'data:image/png;base64,...')
 * @param destinationPath - The path in GCS bucket (e.g., 'products/123/nobg/image.png')
 * @returns Public URL and path of the uploaded image
 */
export async function uploadImageFromBase64(
  base64Data: string,
  destinationPath: string
): Promise<UploadImageResult> {
  console.log('[gcs] 📥 Processing base64 image data')

  // Extract the base64 string and content type from data URL
  const matches = base64Data.match(/^data:([^;]+);base64,(.+)$/)
  if (!matches) {
    throw new Error('Invalid base64 data URL format')
  }

  const contentType = matches[1]
  const base64String = matches[2]
  const buffer = Buffer.from(base64String, 'base64')

  console.log('[gcs] 📤 Uploading to GCS:', destinationPath)

  // Upload to GCS
  const file = bucket.file(destinationPath)
  await file.save(buffer, {
    contentType,
    resumable: false,
  })

  // Generate signed URL (valid for 1 year)
  const [signedUrl] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 365 * 24 * 60 * 60 * 1000, // 1 year
  })

  console.log('[gcs] ✅ Image uploaded successfully:', signedUrl)

  return {
    publicUrl: signedUrl,
    path: destinationPath,
  }
}

/**
 * Uploads a Buffer directly to Google Cloud Storage
 * @param buffer - The image buffer
 * @param destinationPath - The path in GCS bucket (e.g., 'products/123/dtf/image.png')
 * @param contentType - The MIME type of the image (default: 'image/png')
 * @returns Public URL and path of the uploaded image
 */
export async function uploadImageFromBuffer(
  buffer: Buffer,
  destinationPath: string,
  contentType: string = 'image/png'
): Promise<UploadImageResult> {
  console.log('[gcs] 📥 Processing buffer data,', buffer.length, 'bytes')

  console.log('[gcs] 📤 Uploading to GCS:', destinationPath)

  // Upload to GCS
  const file = bucket.file(destinationPath)
  await file.save(buffer, {
    contentType,
    resumable: false,
  })

  // Generate signed URL (valid for 1 year)
  const [signedUrl] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 365 * 24 * 60 * 60 * 1000, // 1 year
  })

  console.log('[gcs] ✅ Image uploaded successfully:', signedUrl)

  return {
    publicUrl: signedUrl,
    path: destinationPath,
  }
}

/**
 * Deletes an image from Google Cloud Storage
 * @param path - The path of the file in GCS bucket
 */
export async function deleteImage(path: string): Promise<void> {
  console.log('[gcs] 🗑️ Deleting image:', path)

  const file = bucket.file(path)
  await file.delete()

  console.log('[gcs] ✅ Image deleted successfully')
}

/**
 * Generates a signed URL for temporary access to a file
 * @param path - The path of the file in GCS bucket
 * @param expiresInMinutes - How long the URL should be valid (default: 60 minutes)
 * @returns Signed URL
 */
export async function getSignedUrl(
  path: string,
  expiresInMinutes: number = 60
): Promise<string> {
  const file = bucket.file(path)
  const [url] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + expiresInMinutes * 60 * 1000,
  })

  return url
}

/**
 * Checks if the GCS bucket exists and is accessible
 */
export async function checkBucketAccess(): Promise<boolean> {
  try {
    await bucket.exists()
    console.log('[gcs] ✅ GCS bucket accessible:', bucketName)
    return true
  } catch (error) {
    console.error('[gcs] ❌ GCS bucket not accessible:', error)
    return false
  }
}

/**
 * Extracts the GCS path from a signed URL
 * @param signedUrl - The full signed URL
 * @returns The path in the bucket, or null if not a valid GCS URL
 */
export function extractPathFromSignedUrl(signedUrl: string): string | null {
  try {
    const url = new URL(signedUrl)
    // GCS URLs look like: https://storage.googleapis.com/bucket-name/path/to/file.png?...
    // The pathname will be /bucket-name/path/to/file.png
    // We need to remove the bucket name prefix (imagine-this-printed-media)
    const pathname = url.pathname

    // Match the bucket name and extract the path after it
    // The bucket name is the first path segment
    const bucketMatch = pathname.match(/^\/([^\/]+)\/(.+)$/)
    if (bucketMatch) {
      const path = bucketMatch[2]
      return decodeURIComponent(path)
    }
    return null
  } catch {
    return null
  }
}

/**
 * Refreshes a signed URL by generating a new one from the GCS path
 * @param signedUrl - The existing signed URL (may be expired)
 * @param expiresInDays - How long the new URL should be valid (default: 365 days)
 * @returns New signed URL, or null if the file doesn't exist
 */
export async function refreshSignedUrl(
  signedUrl: string,
  expiresInDays: number = 365
): Promise<string | null> {
  const path = extractPathFromSignedUrl(signedUrl)
  if (!path) {
    console.error('[gcs] ❌ Could not extract path from URL:', signedUrl)
    return null
  }

  try {
    const file = bucket.file(path)
    const [exists] = await file.exists()

    if (!exists) {
      console.error('[gcs] ❌ File does not exist:', path)
      return null
    }

    const [newSignedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + expiresInDays * 24 * 60 * 60 * 1000,
    })

    console.log('[gcs] ✅ Refreshed signed URL for:', path)
    return newSignedUrl
  } catch (error) {
    console.error('[gcs] ❌ Error refreshing signed URL:', error)
    return null
  }
}

/**
 * Refreshes multiple signed URLs in batch
 * @param signedUrls - Array of signed URLs to refresh
 * @param expiresInDays - How long the new URLs should be valid (default: 365 days)
 * @returns Map of old URL to new URL (null if refresh failed)
 */
export async function refreshSignedUrls(
  signedUrls: string[],
  expiresInDays: number = 365
): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>()

  // Process in parallel with concurrency limit
  const batchSize = 10
  for (let i = 0; i < signedUrls.length; i += batchSize) {
    const batch = signedUrls.slice(i, i + batchSize)
    const refreshPromises = batch.map(async (url) => {
      const newUrl = await refreshSignedUrl(url, expiresInDays)
      results.set(url, newUrl)
    })
    await Promise.all(refreshPromises)
  }

  return results
}
