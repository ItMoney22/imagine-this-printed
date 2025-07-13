import { supabase } from './supabase'
import { uploadFile } from './storage'
import { chatbotService } from './chatbot-service'

export interface ValidationResult {
  service: string
  status: 'success' | 'error' | 'warning'
  message: string
  details?: any
}

export class SystemValidator {
  async validateSupabase(): Promise<ValidationResult> {
    try {
      if (!supabase) {
        return {
          service: 'Supabase',
          status: 'error',
          message: 'Supabase client not initialized'
        }
      }

      const { error } = await supabase.from('users').select('count').limit(1)
      
      if (error) {
        return {
          service: 'Supabase',
          status: 'error',
          message: 'Database connection failed',
          details: error.message
        }
      }

      return {
        service: 'Supabase',
        status: 'success',
        message: 'Database connected successfully'
      }
    } catch (error) {
      return {
        service: 'Supabase',
        status: 'error',
        message: 'Connection error',
        details: String(error)
      }
    }
  }

  async validateAuth(): Promise<ValidationResult> {
    try {
      if (!supabase) {
        return {
          service: 'Auth',
          status: 'error',
          message: 'Supabase client not available'
        }
      }

      const { data: { session } } = await supabase.auth.getSession()
      
      return {
        service: 'Auth',
        status: 'success',
        message: session ? 'User authenticated' : 'No active session (normal)',
        details: { hasSession: !!session }
      }
    } catch (error) {
      return {
        service: 'Auth',
        status: 'error',
        message: 'Auth check failed',
        details: String(error)
      }
    }
  }

  async validateStripe(): Promise<ValidationResult> {
    const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
    
    if (!publishableKey || publishableKey.includes('your_stripe')) {
      return {
        service: 'Stripe',
        status: 'error',
        message: 'Stripe publishable key not configured'
      }
    }

    if (publishableKey.startsWith('sk_live_')) {
      return {
        service: 'Stripe',
        status: 'success',
        message: 'Stripe configured in LIVE mode',
        details: { mode: 'live' }
      }
    }

    if (publishableKey.startsWith('pk_test_')) {
      return {
        service: 'Stripe',
        status: 'warning',
        message: 'Stripe configured in TEST mode',
        details: { mode: 'test' }
      }
    }

    return {
      service: 'Stripe',
      status: 'success',
      message: 'Stripe key configured',
      details: { keyType: 'unknown' }
    }
  }

  async validateOpenAI(): Promise<ValidationResult> {
    const apiKey = import.meta.env.VITE_OPENAI_API_KEY
    
    if (!apiKey || apiKey.includes('your_openai')) {
      return {
        service: 'OpenAI',
        status: 'error',
        message: 'OpenAI API key not configured'
      }
    }

    try {
      const testMessage = await chatbotService.sendMessage('Hello, this is a test')
      
      return {
        service: 'OpenAI',
        status: 'success',
        message: 'OpenAI chatbot responding',
        details: { testResponse: testMessage.content.substring(0, 50) + '...' }
      }
    } catch (error) {
      return {
        service: 'OpenAI',
        status: 'error',
        message: 'OpenAI API call failed',
        details: String(error)
      }
    }
  }

  async validateAWS(): Promise<ValidationResult> {
    const accessKey = import.meta.env.AWS_ACCESS_KEY_ID
    const secretKey = import.meta.env.AWS_SECRET_ACCESS_KEY
    const region = import.meta.env.AWS_REGION
    const bucket = import.meta.env.S3_BUCKET_NAME
    
    if (!accessKey || !secretKey || accessKey.includes('your_aws')) {
      return {
        service: 'AWS S3',
        status: 'error',
        message: 'AWS credentials not configured'
      }
    }

    return {
      service: 'AWS S3',
      status: 'success',
      message: 'AWS credentials configured',
      details: { 
        region: region || 'us-east-1',
        bucket: bucket || 'imagine-this-printed',
        hasCloudFront: !!import.meta.env.CLOUDFRONT_URL
      }
    }
  }

  async validateStorage(): Promise<ValidationResult> {
    try {
      const testBlob = new Blob(['test'], { type: 'text/plain' })
      const testFile = new File([testBlob], 'test.txt', { type: 'text/plain' })
      
      const result = await uploadFile(testFile, 'previews', { 
        fileName: 'validation-test.txt',
        forceProvider: 'supabase'
      })
      
      if (result.error) {
        return {
          service: 'Storage',
          status: 'error',
          message: 'File upload failed',
          details: result.error
        }
      }

      return {
        service: 'Storage',
        status: 'success',
        message: 'Storage upload working',
        details: { 
          provider: result.provider,
          url: result.url.substring(0, 50) + '...'
        }
      }
    } catch (error) {
      return {
        service: 'Storage',
        status: 'error',
        message: 'Storage test failed',
        details: String(error)
      }
    }
  }

  async validateAll(): Promise<ValidationResult[]> {
    const results = await Promise.all([
      this.validateSupabase(),
      this.validateAuth(),
      this.validateStripe(),
      this.validateOpenAI(),
      this.validateAWS(),
      this.validateStorage()
    ])

    return results
  }

  getSystemStatus(results: ValidationResult[]): 'healthy' | 'degraded' | 'critical' {
    const errorCount = results.filter(r => r.status === 'error').length
    const warningCount = results.filter(r => r.status === 'warning').length

    if (errorCount === 0 && warningCount === 0) return 'healthy'
    if (errorCount <= 1) return 'degraded'
    return 'critical'
  }
}

export const systemValidator = new SystemValidator()