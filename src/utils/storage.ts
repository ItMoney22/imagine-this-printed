import { supabase } from './supabase'
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export interface StorageConfig {
  provider: 'supabase' | 's3'
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

export const getStorageConfig = (fileType: FileType, isProduction = false): StorageConfig => {
  const productionTypes: FileType[] = ['product-photos', 'ai-art', 'videos', 'social-content']
  
  if (isProduction || productionTypes.includes(fileType)) {
    return {
      provider: 's3',
      bucket: S3_BUCKET,
      folder: fileType
    }
  }
  
  return {
    provider: 'supabase',
    bucket: fileType.includes('secure') ? 'secure-files' : 'user-uploads',
    folder: fileType
  }
}

export const uploadToSupabase = async (
  file: File,
  options: {
    bucket?: string
    folder?: string
    fileName?: string
    isPublic?: boolean
  } = {}
): Promise<{ url: string; path: string; error?: string }> => {
  if (!supabase) {
    return { url: '', path: '', error: 'Supabase client not initialized' }
  }

  const { bucket = 'user-uploads', folder = '', fileName, isPublic = true } = options
  const fileExtension = file.name.split('.').pop()
  const uniqueFileName = fileName || `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExtension}`
  const filePath = folder ? `${folder}/${uniqueFileName}` : uniqueFileName

  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false
      })

    if (error) {
      return { url: '', path: '', error: error.message }
    }

    if (isPublic) {
      const { data: urlData } = supabase.storage
        .from(bucket)
        .getPublicUrl(data.path)
      
      return { url: urlData.publicUrl, path: data.path }
    } else {
      const { data: urlData, error: urlError } = await supabase.storage
        .from(bucket)
        .createSignedUrl(data.path, 3600)
      
      if (urlError) {
        return { url: '', path: data.path, error: urlError.message }
      }
      
      return { url: urlData.signedUrl, path: data.path }
    }
  } catch (error) {
    return { url: '', path: '', error: String(error) }
  }
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

  if (path.includes('supabase')) {
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
    forceProvider?: 'supabase' | 's3'
    isPublic?: boolean
  } = {}
): Promise<{ url: string; path: string; provider: string; error?: string }> => {
  const { fileName, forceProvider, isPublic = true } = options
  
  const config = forceProvider 
    ? { provider: forceProvider, bucket: forceProvider === 's3' ? S3_BUCKET : 'user-uploads', folder: fileType }
    : getStorageConfig(fileType)

  if (config.provider === 's3') {
    const result = await uploadToS3(file, config.folder || fileType, { fileName })
    return { ...result, provider: 's3' }
  } else {
    const result = await uploadToSupabase(file, {
      bucket: config.bucket,
      folder: config.folder,
      fileName,
      isPublic
    })
    return { ...result, provider: 'supabase' }
  }
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
  
  if (url.includes('supabase')) {
    const transformParams = []
    if (width) transformParams.push(`width=${width}`)
    if (height) transformParams.push(`height=${height}`)
    
    if (transformParams.length > 0) {
      const separator = url.includes('?') ? '&' : '?'
      return `${url}${separator}${transformParams.join('&')}`
    }
  }
  
  return url
}