import 'dotenv/config'
import { extractPathFromSignedUrl, refreshSignedUrl } from '../services/google-cloud-storage'

const testUrl = 'https://storage.googleapis.com/imagine-this-printed-media/graphics/arc-raiders-battle-glory-tee/original/arc-raiders-battle-glory-tee-original-1764353579891.png?GoogleAccessId=product-images-uploader%40imagine-this-printed-main.iam.gserviceaccount.com&Expires=1764958379&Signature=somebase64'

async function test() {
  console.log('Testing path extraction...')
  const path = extractPathFromSignedUrl(testUrl)
  console.log('Extracted path:', path)

  if (!path) {
    console.error('❌ Failed to extract path')
    process.exit(1)
  }

  console.log('\nTesting URL refresh...')
  const newUrl = await refreshSignedUrl(testUrl, 365)

  if (newUrl) {
    console.log('✅ SUCCESS!')
    console.log('New URL:', newUrl.substring(0, 120) + '...')
  } else {
    console.error('❌ Failed to refresh URL')
  }
}

test().catch(e => {
  console.error('Error:', e)
  process.exit(1)
})
