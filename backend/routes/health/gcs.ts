import { Router, Request, Response } from 'express'
import { checkBucketAccess } from '../../services/google-cloud-storage.js'

const router = Router()

// GET /api/health/gcs
router.get('/', async (req: Request, res: Response): Promise<any> => {
  try {
    const bucketName = process.env.GCS_BUCKET_NAME
    const projectId = process.env.GCS_PROJECT_ID
    const hasCredentials = !!process.env.GCS_CREDENTIALS

    if (!bucketName || !projectId || !hasCredentials) {
      return res.status(500).json({
        status: 'error',
        message: 'GCS configuration incomplete',
        details: {
          bucketName: !!bucketName,
          projectId: !!projectId,
          credentials: hasCredentials
        }
      })
    }

    // Check bucket access
    const accessible = await checkBucketAccess()

    if (accessible) {
      return res.json({
        status: 'ok',
        message: 'Google Cloud Storage is configured and accessible',
        bucket: bucketName,
        projectId
      })
    } else {
      return res.status(500).json({
        status: 'error',
        message: 'GCS bucket not accessible',
        bucket: bucketName
      })
    }
  } catch (error: any) {
    console.error('[health/gcs] Error:', error)
    return res.status(500).json({
      status: 'error',
      message: 'GCS health check failed',
      error: error.message
    })
  }
})

export default router
