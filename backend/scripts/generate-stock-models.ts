/**
 * Generate Stock Model Photos using Replicate
 * Creates diverse model photos for virtual try-on system
 */

import Replicate from 'replicate'
import { Storage } from '@google-cloud/storage'
import fs from 'fs/promises'
import path from 'path'

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN!
})

const storage = new Storage({
  projectId: process.env.GCS_PROJECT_ID || 'imagine-this-printed-main'
})

const bucketName = 'imagine-this-printed-media' // Force correct bucket
const bucket = storage.bucket(bucketName)

// Stock model configurations
const modelConfigs = [
  // Female models
  { gender: 'female', ethnicity: 'caucasian', bodyType: 'slim', description: 'caucasian woman with blonde hair, blue eyes, slim build, wearing plain white t-shirt, neutral background, professional photo shoot, front facing, natural lighting' },
  { gender: 'female', ethnicity: 'caucasian', bodyType: 'athletic', description: 'caucasian woman with brown hair, green eyes, athletic build, wearing plain white t-shirt, neutral background, professional photo shoot, front facing, natural lighting' },
  { gender: 'female', ethnicity: 'caucasian', bodyType: 'average', description: 'caucasian woman with red hair, blue eyes, average build, wearing plain white t-shirt, neutral background, professional photo shoot, front facing, natural lighting' },
  { gender: 'female', ethnicity: 'caucasian', bodyType: 'plus-size', description: 'caucasian woman with blonde hair, hazel eyes, plus size build, wearing plain white t-shirt, neutral background, professional photo shoot, front facing, natural lighting' },

  { gender: 'female', ethnicity: 'african', bodyType: 'slim', description: 'african american woman with black hair, brown eyes, slim build, wearing plain white t-shirt, neutral background, professional photo shoot, front facing, natural lighting' },
  { gender: 'female', ethnicity: 'african', bodyType: 'athletic', description: 'african american woman with black hair, brown eyes, athletic build, wearing plain white t-shirt, neutral background, professional photo shoot, front facing, natural lighting' },
  { gender: 'female', ethnicity: 'african', bodyType: 'average', description: 'african american woman with black curly hair, brown eyes, average build, wearing plain white t-shirt, neutral background, professional photo shoot, front facing, natural lighting' },
  { gender: 'female', ethnicity: 'african', bodyType: 'plus-size', description: 'african american woman with black hair, brown eyes, plus size build, wearing plain white t-shirt, neutral background, professional photo shoot, front facing, natural lighting' },

  { gender: 'female', ethnicity: 'asian', bodyType: 'slim', description: 'asian woman with black hair, brown eyes, slim build, wearing plain white t-shirt, neutral background, professional photo shoot, front facing, natural lighting' },
  { gender: 'female', ethnicity: 'asian', bodyType: 'athletic', description: 'asian woman with black hair, brown eyes, athletic build, wearing plain white t-shirt, neutral background, professional photo shoot, front facing, natural lighting' },
  { gender: 'female', ethnicity: 'asian', bodyType: 'average', description: 'asian woman with black hair, brown eyes, average build, wearing plain white t-shirt, neutral background, professional photo shoot, front facing, natural lighting' },
  { gender: 'female', ethnicity: 'asian', bodyType: 'plus-size', description: 'asian woman with black hair, brown eyes, plus size build, wearing plain white t-shirt, neutral background, professional photo shoot, front facing, natural lighting' },

  { gender: 'female', ethnicity: 'hispanic', bodyType: 'slim', description: 'hispanic woman with dark brown hair, brown eyes, slim build, wearing plain white t-shirt, neutral background, professional photo shoot, front facing, natural lighting' },
  { gender: 'female', ethnicity: 'hispanic', bodyType: 'athletic', description: 'hispanic woman with dark brown hair, brown eyes, athletic build, wearing plain white t-shirt, neutral background, professional photo shoot, front facing, natural lighting' },
  { gender: 'female', ethnicity: 'hispanic', bodyType: 'average', description: 'hispanic woman with dark brown hair, brown eyes, average build, wearing plain white t-shirt, neutral background, professional photo shoot, front facing, natural lighting' },
  { gender: 'female', ethnicity: 'hispanic', bodyType: 'plus-size', description: 'hispanic woman with dark brown hair, brown eyes, plus size build, wearing plain white t-shirt, neutral background, professional photo shoot, front facing, natural lighting' },

  // Male models
  { gender: 'male', ethnicity: 'caucasian', bodyType: 'slim', description: 'caucasian man with short blonde hair, blue eyes, slim build, wearing plain white t-shirt, neutral background, professional photo shoot, front facing, natural lighting' },
  { gender: 'male', ethnicity: 'caucasian', bodyType: 'athletic', description: 'caucasian man with short brown hair, green eyes, athletic build, wearing plain white t-shirt, neutral background, professional photo shoot, front facing, natural lighting' },
  { gender: 'male', ethnicity: 'caucasian', bodyType: 'average', description: 'caucasian man with short dark hair, blue eyes, average build, wearing plain white t-shirt, neutral background, professional photo shoot, front facing, natural lighting' },
  { gender: 'male', ethnicity: 'caucasian', bodyType: 'plus-size', description: 'caucasian man with short hair, hazel eyes, plus size build, wearing plain white t-shirt, neutral background, professional photo shoot, front facing, natural lighting' },

  { gender: 'male', ethnicity: 'african', bodyType: 'slim', description: 'african american man with short black hair, brown eyes, slim build, wearing plain white t-shirt, neutral background, professional photo shoot, front facing, natural lighting' },
  { gender: 'male', ethnicity: 'african', bodyType: 'athletic', description: 'african american man with short black hair, brown eyes, athletic build, wearing plain white t-shirt, neutral background, professional photo shoot, front facing, natural lighting' },
  { gender: 'male', ethnicity: 'african', bodyType: 'average', description: 'african american man with short black hair, brown eyes, average build, wearing plain white t-shirt, neutral background, professional photo shoot, front facing, natural lighting' },
  { gender: 'male', ethnicity: 'african', bodyType: 'plus-size', description: 'african american man with short black hair, brown eyes, plus size build, wearing plain white t-shirt, neutral background, professional photo shoot, front facing, natural lighting' },

  { gender: 'male', ethnicity: 'asian', bodyType: 'slim', description: 'asian man with short black hair, brown eyes, slim build, wearing plain white t-shirt, neutral background, professional photo shoot, front facing, natural lighting' },
  { gender: 'male', ethnicity: 'asian', bodyType: 'athletic', description: 'asian man with short black hair, brown eyes, athletic build, wearing plain white t-shirt, neutral background, professional photo shoot, front facing, natural lighting' },
  { gender: 'male', ethnicity: 'asian', bodyType: 'average', description: 'asian man with short black hair, brown eyes, average build, wearing plain white t-shirt, neutral background, professional photo shoot, front facing, natural lighting' },
  { gender: 'male', ethnicity: 'asian', bodyType: 'plus-size', description: 'asian man with short black hair, brown eyes, plus size build, wearing plain white t-shirt, neutral background, professional photo shoot, front facing, natural lighting' },

  { gender: 'male', ethnicity: 'hispanic', bodyType: 'slim', description: 'hispanic man with short dark hair, brown eyes, slim build, wearing plain white t-shirt, neutral background, professional photo shoot, front facing, natural lighting' },
  { gender: 'male', ethnicity: 'hispanic', bodyType: 'athletic', description: 'hispanic man with short dark hair, brown eyes, athletic build, wearing plain white t-shirt, neutral background, professional photo shoot, front facing, natural lighting' },
  { gender: 'male', ethnicity: 'hispanic', bodyType: 'average', description: 'hispanic man with short dark hair, brown eyes, average build, wearing plain white t-shirt, neutral background, professional photo shoot, front facing, natural lighting' },
  { gender: 'male', ethnicity: 'hispanic', bodyType: 'plus-size', description: 'hispanic man with short dark hair, brown eyes, plus size build, wearing plain white t-shirt, neutral background, professional photo shoot, front facing, natural lighting' }
]

interface ModelConfig {
  gender: string
  ethnicity: string
  bodyType: string
  description: string
}

async function generateStockModel(config: ModelConfig): Promise<void> {
  const filename = `${config.gender}-${config.ethnicity}-${config.bodyType}.jpg`
  const gcsPath = `stock-models/${filename}`

  console.log(`\n🎨 Generating: ${filename}`)
  console.log(`📝 Prompt: ${config.description}`)

  try {
    // Check if already exists
    const file = bucket.file(gcsPath)
    const [exists] = await file.exists()

    if (exists) {
      console.log(`✅ Already exists, skipping: ${filename}`)
      return
    }

    // Generate image using FLUX Schnell (fast, high-quality)
    console.log(`⏳ Calling Replicate FLUX...`)
    const output: any = await replicate.run(
      "black-forest-labs/flux-schnell",
      {
        input: {
          prompt: config.description,
          num_outputs: 1,
          aspect_ratio: "3:4",
          output_format: "jpg",
          output_quality: 90
        }
      }
    )

    // The output is an async iterator of FileOutput objects
    // We need to collect all items from the iterator
    const outputs: string[] = []
    for await (const item of output) {
      if (typeof item === 'string') {
        outputs.push(item)
      } else if (item && typeof item === 'object' && 'toString' in item) {
        // FileOutput object with toString() method
        outputs.push(item.toString())
      }
    }

    if (outputs.length === 0) {
      throw new Error('No outputs returned from Replicate')
    }

    const imageUrl = outputs[0]

    console.log(`✅ Generated: ${imageUrl}`)

    // Download image
    console.log(`⬇️  Downloading...`)
    const response = await fetch(imageUrl)
    if (!response.ok) {
      throw new Error(`Failed to download: ${response.statusText}`)
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    console.log(`📦 Downloaded ${buffer.length} bytes`)

    // Upload to GCS
    console.log(`⬆️  Uploading to GCS: ${gcsPath}`)
    await file.save(buffer, {
      contentType: 'image/jpeg',
      metadata: {
        cacheControl: 'public, max-age=31536000',
        metadata: {
          generatedWith: 'flux-schnell',
          prompt: config.description,
          gender: config.gender,
          ethnicity: config.ethnicity,
          bodyType: config.bodyType,
          generatedAt: new Date().toISOString()
        }
      }
      // No ACL settings needed - bucket has uniform access enabled
    })

    const publicUrl = `https://storage.googleapis.com/${bucketName}/${gcsPath}`
    console.log(`✅ Uploaded: ${publicUrl}`)

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000))

  } catch (error: any) {
    console.error(`❌ Failed to generate ${filename}:`, error.message)
    throw error
  }
}

async function generateAllStockModels(): Promise<void> {
  console.log(`🚀 Starting stock model generation`)
  console.log(`📊 Total models to generate: ${modelConfigs.length}`)
  console.log(`🎯 Target bucket: ${bucketName}`)
  console.log(`📁 Target folder: stock-models/`)

  let successCount = 0
  let errorCount = 0
  let skippedCount = 0

  for (const config of modelConfigs) {
    try {
      await generateStockModel(config)
      successCount++
    } catch (error: any) {
      if (error.message.includes('Already exists')) {
        skippedCount++
      } else {
        errorCount++
      }
    }
  }

  console.log(`\n✅ Generation complete!`)
  console.log(`   Success: ${successCount}`)
  console.log(`   Skipped: ${skippedCount}`)
  console.log(`   Errors: ${errorCount}`)
  console.log(`   Total: ${modelConfigs.length}`)
}

// Run automatically
generateAllStockModels()
  .then(() => {
    console.log(`\n🎉 All done!`)
    process.exit(0)
  })
  .catch((error) => {
    console.error(`\n💥 Fatal error:`, error)
    console.error(error.stack)
    process.exit(1)
  })

export { generateStockModel, generateAllStockModels, modelConfigs }
