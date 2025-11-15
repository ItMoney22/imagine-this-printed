import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export interface UploadOptions {
  bucket: string
  path: string
  buffer: Buffer
  contentType: string
  isPublic?: boolean
}

export async function uploadFromBuffer(options: UploadOptions): Promise<string> {
  const { bucket, path, buffer, contentType, isPublic = true } = options

  console.log('[storage] 📤 Uploading to:', { bucket, path, size: buffer.length })

  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(path, buffer, {
      contentType,
      upsert: true,
    })

  if (error) {
    console.error('[storage] ❌ Upload failed:', error)
    throw error
  }

  console.log('[storage] ✅ Upload successful:', data.path)

  // Get public URL
  const { data: urlData } = supabase.storage
    .from(bucket)
    .getPublicUrl(data.path)

  return urlData.publicUrl
}

export async function downloadImage(url: string): Promise<Buffer> {
  console.log('[storage] 📥 Downloading image:', url)

  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.statusText}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}
