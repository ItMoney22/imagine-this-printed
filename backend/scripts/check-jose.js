/**
 * Prestart check: Verify jose@6 can be dynamically imported
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

(async () => {
  try {
    const m = await import('jose');
    if (!m || !m.jwtVerify) {
      throw new Error('jose missing jwtVerify');
    }

    // Get package version from package.json
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(__dirname, '../node_modules/jose/package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    console.log('[prestart] ✅ jose OK:', pkg.version);
  } catch (e) {
    console.error('[prestart] ❌ jose import failed:', e?.message);
    process.exit(1);
  }
})();
