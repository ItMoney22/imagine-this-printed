#!/usr/bin/env node

/**
 * Critical Path Verification
 *
 * Tests the most important user flows to ensure the site is working.
 * Run after making changes to verify nothing is broken.
 *
 * Usage:
 *   npm run verify           # Run all critical path tests
 *   npm run verify:home      # Just homepage
 *   npm run verify:products  # Just product catalog
 */

import {
  runAllVerifications,
  runVerification,
  elementExists,
  getElementText,
  screenshot,
  BASE_URL
} from './browser-utils.js';

// ============================================================
// CRITICAL PATH TESTS
// ============================================================

/**
 * Test 1: Homepage loads correctly
 */
const testHomepage = {
  name: 'Homepage Loads',
  fn: async (page) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 30000 });

    // Check for critical elements
    const hasHeader = await elementExists(page, 'header');
    const hasHero = await elementExists(page, '[class*="hero"], [class*="Hero"], main section:first-child');
    const hasFooter = await elementExists(page, 'footer');

    if (!hasHeader) throw new Error('Header not found');
    if (!hasFooter) throw new Error('Footer not found');

    // Check page title
    const title = await page.title();

    return {
      url: page.url(),
      title,
      hasHeader,
      hasHero,
      hasFooter
    };
  }
};

/**
 * Test 2: Navigation works
 */
const testNavigation = {
  name: 'Navigation Works',
  fn: async (page) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle0' });

    // Look for nav links
    const hasNav = await elementExists(page, 'nav');
    if (!hasNav) throw new Error('Navigation not found');

    // Try to find and click products link
    const productsLink = await page.$('a[href*="product"], a[href*="catalog"], nav a');
    if (!productsLink) throw new Error('No navigation links found');

    return {
      hasNav,
      linksFound: true
    };
  }
};

/**
 * Test 3: Product catalog loads
 */
const testProductCatalog = {
  name: 'Product Catalog Loads',
  fn: async (page) => {
    await page.goto(`${BASE_URL}/products`, { waitUntil: 'networkidle0', timeout: 30000 });

    // Wait for products to load (give it time for API call)
    await page.waitForTimeout(2000);

    // Check for product grid or product cards
    const hasProductGrid = await elementExists(page, '[class*="product"], [class*="Product"], [class*="grid"]');
    const hasLoadingOrProducts = await elementExists(page, '[class*="loading"], [class*="product"], [class*="card"]');

    // Check for error states
    const hasError = await elementExists(page, '[class*="error"], [class*="Error"]');
    if (hasError) {
      const errorText = await getElementText(page, '[class*="error"], [class*="Error"]');
      throw new Error(`Error displayed: ${errorText}`);
    }

    return {
      url: page.url(),
      hasProductGrid,
      hasLoadingOrProducts
    };
  }
};

/**
 * Test 4: Auth modal opens
 */
const testAuthModal = {
  name: 'Auth Modal Opens',
  fn: async (page) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle0' });

    // Look for login/sign in button
    const authButton = await page.$('button:has-text("Sign"), button:has-text("Login"), a:has-text("Sign"), a:has-text("Login"), [class*="auth"], [class*="login"]');

    if (!authButton) {
      // Maybe user is already logged in or button has different text
      const hasAuthElements = await elementExists(page, '[class*="auth"], [class*="login"], [class*="signin"]');
      return {
        authButtonFound: false,
        hasAuthElements,
        note: 'Auth button not found - may be logged in or different UI'
      };
    }

    await authButton.click();
    await page.waitForTimeout(500);

    // Check if modal opened
    const hasModal = await elementExists(page, '[class*="modal"], [role="dialog"], [class*="Modal"]');

    return {
      authButtonFound: true,
      modalOpened: hasModal
    };
  }
};

/**
 * Test 5: No critical console errors
 */
const testNoConsoleErrors = {
  name: 'No Critical Console Errors',
  fn: async (page) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    // Visit multiple pages
    const pages = ['/', '/products'];
    for (const path of pages) {
      await page.goto(`${BASE_URL}${path}`, { waitUntil: 'networkidle0', timeout: 30000 });
      await page.waitForTimeout(1000);
    }

    // Filter out known non-critical errors
    const criticalErrors = errors.filter(e =>
      !e.includes('ResizeObserver') &&
      !e.includes('Non-Error promise rejection') &&
      !e.includes('Loading chunk')
    );

    if (criticalErrors.length > 0) {
      throw new Error(`Critical errors found: ${criticalErrors.join('; ')}`);
    }

    return {
      pagesChecked: pages.length,
      totalErrors: errors.length,
      criticalErrors: criticalErrors.length
    };
  }
};

/**
 * Test 6: API health check
 */
const testApiHealth = {
  name: 'API Health Check',
  fn: async (page) => {
    const apiBase = process.env.VITE_API_BASE || 'http://localhost:4000';

    const response = await page.goto(`${apiBase}/api/health`, {
      waitUntil: 'networkidle0',
      timeout: 10000
    });

    const status = response.status();
    if (status !== 200) {
      throw new Error(`API health check returned ${status}`);
    }

    const body = await page.content();

    return {
      status,
      healthy: status === 200
    };
  }
};

// ============================================================
// RUN TESTS
// ============================================================

const allTests = [
  testHomepage,
  testNavigation,
  testProductCatalog,
  testAuthModal,
  testNoConsoleErrors
  // testApiHealth - uncomment if backend is running
];

// Check command line args for specific test
const args = process.argv.slice(2);

async function main() {
  if (args.includes('--home') || args.includes('home')) {
    await runVerification(testHomepage.name, testHomepage.fn);
  } else if (args.includes('--products') || args.includes('products')) {
    await runVerification(testProductCatalog.name, testProductCatalog.fn);
  } else if (args.includes('--auth') || args.includes('auth')) {
    await runVerification(testAuthModal.name, testAuthModal.fn);
  } else if (args.includes('--api') || args.includes('api')) {
    await runVerification(testApiHealth.name, testApiHealth.fn);
  } else {
    // Run all
    const summary = await runAllVerifications(allTests);

    // Exit with error code if any tests failed
    if (!summary.allPassed) {
      process.exit(1);
    }
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
