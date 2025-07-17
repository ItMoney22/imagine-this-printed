import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export interface StorageConfig {
  provider: 's3'
  bucket?: string
  folder?: string
}

const s3Client = new S3Client({
  region: import.meta.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: import.meta.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: import.meta.env.AWS_SECRET_ACCESS_KEY || '',
  },
})

const S3_BUCKET = import.meta.env.S3_BUCKET_NAME || 'imagine-this-printed'
const CLOUDFRONT_URL = import.meta.env.CLOUDFRONT_URL || ''

export type FileType = '3d-files' | 'dashboards' | 'previews' | 'product-photos' | 'ai-art' | 'videos' | 'social-content'

export const getStorageConfig = (fileType: FileType): StorageConfig => {
  return {
    provider: 's3',
    bucket: S3_BUCKET,
    folder: fileType
  }
}

// Legacy function kept for backward compatibility - now redirects to S3
export const uploadToSupabase = async (
  file: File,
  options: {
    bucket?: string
    folder?: string
    fileName?: string
    isPublic?: boolean
  } = {}
): Promise<{ url: string; path: string; error?: string }> => {
  console.warn('uploadToSupabase is deprecated, using S3 instead')
  return uploadToS3(file, options.folder || 'user-uploads', { fileName: options.fileName })
}

export const uploadToS3 = async (
  file: File,
  folderName: string,
  options: {
    fileName?: string
    contentType?: string
  } = {}
): Promise<{ url: string; path: string; error?: string }> => {
  const { fileName, contentType } = options
  const fileExtension = file.name.split('.').pop()
  const uniqueFileName = fileName || `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExtension}`
  const key = `${folderName}/${uniqueFileName}`

  try {
    const uploadParams = {
      Bucket: S3_BUCKET,
      Key: key,
      Body: file,
      ContentType: contentType || file.type,
      CacheControl: 'max-age=31536000'
    }

    const command = new PutObjectCommand(uploadParams)
    await s3Client.send(command)

    const cdnUrl = getCDNUrl(key)
    return { url: cdnUrl, path: key }
  } catch (error) {
    return { url: '', path: '', error: String(error) }
  }
}

export const getCDNUrl = (path: string): string => {
  if (path.startsWith('http')) {
    return path
  }

  // Legacy check for old URLs
  if (path.includes('supabase')) {
    console.warn('Legacy Supabase URL detected, consider migrating to S3')
    return path
  }

  if (CLOUDFRONT_URL) {
    return `${CLOUDFRONT_URL}/${path}`
  }

  return `https://${S3_BUCKET}.s3.${import.meta.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${path}`
}

export const getSignedS3Url = async (key: string, expiresIn = 3600): Promise<string> => {
  try {
    const command = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
    })

    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn })
    return signedUrl
  } catch (error) {
    console.error('Error generating signed URL:', error)
    return ''
  }
}

export const uploadFile = async (
  file: File,
  fileType: FileType,
  options: {
    fileName?: string
    forceProvider?: 's3'
    isPublic?: boolean
  } = {}
): Promise<{ url: string; path: string; provider: string; error?: string }> => {
  const { fileName } = options
  
  const config = getStorageConfig(fileType)
  const result = await uploadToS3(file, config.folder || fileType, { fileName })
  return { ...result, provider: 's3' }
}

export const resizeImage = async (
  file: File,
  maxWidth: number,
  maxHeight: number,
  quality: number = 0.8
): Promise<File> => {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    const img = new Image()

    img.onload = () => {
      const ratio = Math.min(maxWidth / img.width, maxHeight / img.height)
      const width = img.width * ratio
      const height = img.height * ratio

      canvas.width = width
      canvas.height = height

      ctx.drawImage(img, 0, 0, width, height)

      canvas.toBlob((blob) => {
        if (blob) {
          const resizedFile = new File([blob], file.name, {
            type: file.type,
            lastModified: Date.now(),
          })
          resolve(resizedFile)
        } else {
          resolve(file)
        }
      }, file.type, quality)
    }

    img.src = URL.createObjectURL(file)
  })
}

export const getOptimizedImageUrl = (url: string, width?: number, height?: number): string => {
  if (!url) return ''
  
  // Legacy support for old Supabase URLs
  if (url.includes('supabase')) {
    console.warn('Legacy Supabase URL detected for image optimization')
    const transformParams = []
    if (width) transformParams.push(`width=${width}`)
    if (height) transformParams.push(`height=${height}`)
    
    if (transformParams.length > 0) {
      const separator = url.includes('?') ? '&' : '?'
      return `${url}${separator}${transformParams.join('&')}`
    }
  }
  
  // For S3/CloudFront URLs, return as-is (image optimization handled by CloudFront)
  return url
}