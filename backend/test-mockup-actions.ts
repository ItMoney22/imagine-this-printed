/**
 * Test script for mockup download and delete functionality
 *
 * Tests:
 * 1. Accept mockup (download functionality)
 * 2. Reject mockup (delete functionality with refund)
 */

import fetch from 'node-fetch'

const API_BASE = 'http://localhost:4000'
const TEST_USER_ID = '11111111-1111-1111-1111-111111111111' // You'll need to use a real user ID

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
}

function log(message: string, color: string = colors.reset) {
  console.log(`${color}${message}${colors.reset}`)
}

async function testAcceptMockup(generationId: string, userId: string) {
  log('\n🧪 TEST 1: Accept Mockup (Download Functionality)', colors.cyan)
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', colors.cyan)

  try {
    log(`\n📤 Sending POST request to /api/realistic-mockups/${generationId}/accept`, colors.blue)
    log(`User ID: ${userId}`)

    const response = await fetch(`${API_BASE}/api/realistic-mockups/${generationId}/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId }),
    })

    const data = await response.json()

    log(`\n📊 Response Status: ${response.status}`, colors.blue)
    log(`Response Body:`, colors.blue)
    console.log(JSON.stringify(data, null, 2))

    if (data.ok) {
      log('\n✅ ACCEPT TEST PASSED', colors.green)
      log(`✅ Media ID: ${data.mediaId}`, colors.green)
      log(`✅ Download URL: ${data.downloadUrl}`, colors.green)
      log(`✅ Message: ${data.message}`, colors.green)

      // Test if download URL is accessible
      log('\n🔗 Testing if download URL is accessible...', colors.blue)
      try {
        const downloadResponse = await fetch(data.downloadUrl, { method: 'HEAD' })
        if (downloadResponse.ok) {
          log(`✅ Download URL is accessible (Status: ${downloadResponse.status})`, colors.green)
          log(`✅ Content-Type: ${downloadResponse.headers.get('content-type')}`, colors.green)
          log(`✅ Content-Length: ${downloadResponse.headers.get('content-length')} bytes`, colors.green)
        } else {
          log(`❌ Download URL returned error: ${downloadResponse.status}`, colors.red)
        }
      } catch (error) {
        log(`❌ Failed to access download URL: ${error}`, colors.red)
      }

      return true
    } else {
      log('\n❌ ACCEPT TEST FAILED', colors.red)
      log(`❌ Error: ${data.error}`, colors.red)
      return false
    }
  } catch (error) {
    log('\n❌ ACCEPT TEST FAILED WITH EXCEPTION', colors.red)
    log(`❌ Error: ${error}`, colors.red)
    return false
  }
}

async function testRejectMockup(generationId: string, userId: string) {
  log('\n🧪 TEST 2: Reject Mockup (Delete Functionality)', colors.cyan)
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', colors.cyan)

  try {
    log(`\n📤 Sending POST request to /api/realistic-mockups/${generationId}/reject`, colors.blue)
    log(`User ID: ${userId}`)

    const response = await fetch(`${API_BASE}/api/realistic-mockups/${generationId}/reject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId }),
    })

    const data = await response.json()

    log(`\n📊 Response Status: ${response.status}`, colors.blue)
    log(`Response Body:`, colors.blue)
    console.log(JSON.stringify(data, null, 2))

    if (data.ok) {
      log('\n✅ REJECT TEST PASSED', colors.green)
      log(`✅ Refund Amount: ${data.refundAmount} ITC`, colors.green)
      log(`✅ New Balance: ${data.newBalance} ITC`, colors.green)
      log(`✅ Message: ${data.message}`, colors.green)
      return true
    } else {
      log('\n❌ REJECT TEST FAILED', colors.red)
      log(`❌ Error: ${data.error}`, colors.red)
      return false
    }
  } catch (error) {
    log('\n❌ REJECT TEST FAILED WITH EXCEPTION', colors.red)
    log(`❌ Error: ${error}`, colors.red)
    return false
  }
}

async function checkMockupStatus(generationId: string, userId: string) {
  log('\n📋 Checking mockup generation status...', colors.yellow)

  try {
    const response = await fetch(`${API_BASE}/api/realistic-mockups/${generationId}/status?userId=${userId}`)
    const data = await response.json()

    log(`Status: ${data.status}`, colors.blue)
    log(`Mockup URL: ${data.mockup_url || 'N/A'}`, colors.blue)

    return data
  } catch (error) {
    log(`❌ Failed to check status: ${error}`, colors.red)
    return null
  }
}

async function main() {
  log('\n═══════════════════════════════════════════════════', colors.cyan)
  log('   MOCKUP DOWNLOAD & DELETE FUNCTIONALITY TEST', colors.cyan)
  log('═══════════════════════════════════════════════════', colors.cyan)

  const args = process.argv.slice(2)

  if (args.length < 2) {
    log('\n❌ Usage: tsx test-mockup-actions.ts <generationId> <userId>', colors.red)
    log('\nExample:', colors.yellow)
    log('tsx test-mockup-actions.ts cf18945d-2317-46a9-b630-fcdf507e5597 11111111-1111-1111-1111-111111111111', colors.yellow)
    log('\nTo get a generation ID:', colors.yellow)
    log('1. Open http://localhost:5173 in your browser', colors.yellow)
    log('2. Go to Design Studio', colors.yellow)
    log('3. Generate a mockup', colors.yellow)
    log('4. Check backend logs for the generation ID', colors.yellow)
    process.exit(1)
  }

  const [generationId, userId] = args

  log(`\n📋 Test Configuration:`, colors.blue)
  log(`   Generation ID: ${generationId}`)
  log(`   User ID: ${userId}`)
  log(`   API Base: ${API_BASE}`)

  // Check mockup status first
  const status = await checkMockupStatus(generationId, userId)

  if (!status) {
    log('\n❌ Cannot proceed with tests - mockup status check failed', colors.red)
    process.exit(1)
  }

  if (status.status !== 'completed') {
    log(`\n⚠️  Warning: Mockup status is "${status.status}", not "completed"`, colors.yellow)
    log('Tests may fail if mockup is not completed yet', colors.yellow)
  }

  // Run tests
  log('\n\n🚀 Starting tests...', colors.cyan)

  const results = []

  // Test 1: Accept (Download)
  const acceptPassed = await testAcceptMockup(generationId, userId)
  results.push({ name: 'Accept/Download', passed: acceptPassed })

  // Wait a bit between tests
  await new Promise(resolve => setTimeout(resolve, 1000))

  // Test 2: Reject (Delete) - Only run if accept wasn't tested or you have another generation ID
  log('\n⚠️  Note: Reject test will delete the mockup. Only run this if you want to test rejection.', colors.yellow)
  log('If you already tested accept, skip this or use a different generation ID.', colors.yellow)

  // Uncomment to test rejection:
  // const rejectPassed = await testRejectMockup(generationId, userId)
  // results.push({ name: 'Reject/Delete', passed: rejectPassed })

  // Summary
  log('\n\n═══════════════════════════════════════════════════', colors.cyan)
  log('                  TEST SUMMARY', colors.cyan)
  log('═══════════════════════════════════════════════════', colors.cyan)

  results.forEach(result => {
    const status = result.passed ? '✅ PASSED' : '❌ FAILED'
    const color = result.passed ? colors.green : colors.red
    log(`${status} - ${result.name}`, color)
  })

  const allPassed = results.every(r => r.passed)

  if (allPassed) {
    log('\n✅ ALL TESTS PASSED!', colors.green)
  } else {
    log('\n❌ SOME TESTS FAILED', colors.red)
  }

  log('\n═══════════════════════════════════════════════════\n', colors.cyan)
}

main().catch(error => {
  log(`\n❌ Test script failed: ${error}`, colors.red)
  console.error(error)
  process.exit(1)
})
