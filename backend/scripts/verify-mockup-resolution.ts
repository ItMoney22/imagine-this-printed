import sharp from 'sharp'
import { resizeIfNeeded } from '../services/etsy-model-shots.js'

async function runVerification() {
  console.log('--- STARTING RESOLUTION VERIFICATION ---')

  // Test Case 1: Portrait Image (1024x1536)
  console.log('\n[Case 1] Portrait Image (1024x1536)')
  const portraitInput = await sharp({
    create: {
      width: 1024,
      height: 1536,
      channels: 3,
      background: { r: 255, g: 0, b: 0 }
    }
  }).png().toBuffer()

  const portraitOutput = await resizeIfNeeded(portraitInput)
  const portraitMeta = await sharp(portraitOutput).metadata()
  console.log(`Input: 1024x1536`)
  console.log(`Output: ${portraitMeta.width}x${portraitMeta.height}`)
  if (portraitMeta.width === 2000 && portraitMeta.height === 3000) {
    console.log('✅ Case 1 Passed!')
  } else {
    console.error('❌ Case 1 Failed!')
    process.exit(1)
  }

  // Test Case 2: Square Image (1024x1024)
  console.log('\n[Case 2] Square Image (1024x1024)')
  const squareInput = await sharp({
    create: {
      width: 1024,
      height: 1024,
      channels: 3,
      background: { r: 0, g: 255, b: 0 }
    }
  }).png().toBuffer()

  const squareOutput = await resizeIfNeeded(squareInput)
  const squareMeta = await sharp(squareOutput).metadata()
  console.log(`Input: 1024x1024`)
  console.log(`Output: ${squareMeta.width}x${squareMeta.height}`)
  if (squareMeta.width === 2000 && squareMeta.height === 2000) {
    console.log('✅ Case 2 Passed!')
  } else {
    console.error('❌ Case 2 Failed!')
    process.exit(1)
  }

  // Test Case 3: Landscape Image (1536x1024)
  console.log('\n[Case 3] Landscape Image (1536x1024)')
  const landscapeInput = await sharp({
    create: {
      width: 1536,
      height: 1024,
      channels: 3,
      background: { r: 0, g: 0, b: 255 }
    }
  }).png().toBuffer()

  const landscapeOutput = await resizeIfNeeded(landscapeInput)
  const landscapeMeta = await sharp(landscapeOutput).metadata()
  console.log(`Input: 1536x1024`)
  console.log(`Output: ${landscapeMeta.width}x${landscapeMeta.height}`)
  if (landscapeMeta.width === 3000 && landscapeMeta.height === 2000) {
    console.log('✅ Case 3 Passed!')
  } else {
    console.error('❌ Case 3 Failed!')
    process.exit(1)
  }

  // Test Case 4: High Res Image (3000x4500) - Should not be resized
  console.log('\n[Case 4] High Res Image (3000x4500) - Already meets minimum')
  const highResInput = await sharp({
    create: {
      width: 3000,
      height: 4500,
      channels: 3,
      background: { r: 255, g: 255, b: 0 }
    }
  }).png().toBuffer()

  const highResOutput = await resizeIfNeeded(highResInput)
  const highResMeta = await sharp(highResOutput).metadata()
  console.log(`Input: 3000x4500`)
  console.log(`Output: ${highResMeta.width}x${highResMeta.height}`)
  if (highResMeta.width === 3000 && highResMeta.height === 4500) {
    console.log('✅ Case 4 Passed!')
  } else {
    console.error('❌ Case 4 Failed!')
    process.exit(1)
  }

  console.log('\n🎉 ALL VERIFICATION CASES PASSED SUCCESSFULLY!')
}

runVerification().catch(err => {
  console.error(err)
  process.exit(1)
})
