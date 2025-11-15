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
  // Using signed URLs as a workaround (valid for 7 days)
  const [signedUrl] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
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

  // Generate signed URL (valid for 7 days)
  const [signedUrl] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
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
