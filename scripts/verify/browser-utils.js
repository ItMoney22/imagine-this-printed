#!/usr/bin/env node

/**
 * Browser Verification Utilities
 *
 * Puppeteer-based utilities for verifying critical paths work in the browser.
 * Used by Claude to confirm tasks are actually complete before marking done.
 */

import puppeteer from 'puppeteer';

const BASE_URL = process.env.VITE_SITE_URL || 'http://localhost:5173';
const TIMEOUT = 30000;

/**
 * Launch browser with standard config
 */
export async function launchBrowser() {
  return puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
}

/**
 * Take a screenshot for debugging
 */
export async function screenshot(page, name) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = `scripts/verify/screenshots/${timestamp}-${name}.png`;
  await page.screenshot({ path, fullPage: true });
  console.log(`📸 Screenshot saved: ${path}`);
  return path;
}

/**
 * Wait for element and return text content
 */
export async function getElementText(page, selector, timeout = TIMEOUT) {
  try {
    await page.waitForSelector(selector, { timeout });
    return await page.$eval(selector, el => el.textContent?.trim());
  } catch (e) {
    return null;
  }
}

/**
 * Check if element exists
 */
export async function elementExists(page, selector, timeout = 5000) {
  try {
    await page.waitForSelector(selector, { timeout });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Check for console errors
 */
export function setupConsoleMonitor(page) {
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  page.on('pageerror', err => {
    errors.push(err.message);
  });
  return errors;
}

/**
 * Standard test result format
 */
export function result(name, passed, details = {}) {
  return {
    name,
    passed,
    timestamp: new Date().toISOString(),
    ...details
  };
}

/**
 * Run a verification and return structured result
 */
export async function runVerification(name, testFn) {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  const errors = setupConsoleMonitor(page);

  let testResult;
  try {
    console.log(`\n🔍 Running: ${name}`);
    const details = await testFn(page, BASE_URL);
    testResult = result(name, true, { ...details, consoleErrors: errors });
    console.log(`✅ PASSED: ${name}`);
  } catch (error) {
    await screenshot(page, `error-${name.replace(/\s+/g, '-')}`);
    testResult = result(name, false, {
      error: error.message,
      consoleErrors: errors
    });
    console.log(`❌ FAILED: ${name} - ${error.message}`);
  } finally {
    await browser.close();
  }

  return testResult;
}

/**
 * Run multiple verifications and summarize
 */
export async function runAllVerifications(tests) {
  console.log('═══════════════════════════════════════════════════════');
  console.log('🧪 BROWSER VERIFICATION SUITE');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Tests: ${tests.length}`);

  const results = [];
  for (const test of tests) {
    const testResult = await runVerification(test.name, test.fn);
    results.push(testResult);
  }

  // Summary
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('📊 SUMMARY');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📈 Total:  ${results.length}`);

  if (failed > 0) {
    console.log('\n❌ FAILED TESTS:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}: ${r.error}`);
    });
  }

  console.log('═══════════════════════════════════════════════════════\n');

  return {
    passed,
    failed,
    total: results.length,
    allPassed: failed === 0,
    results
  };
}

export { BASE_URL, TIMEOUT };
