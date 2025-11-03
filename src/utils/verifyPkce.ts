/**
 * PKCE Verification Utility
 *
 * Verifies that PKCE OAuth flow state and code verifier are properly
 * stored in localStorage before the OAuth redirect.
 *
 * Used for QA and debugging OAuth authentication issues.
 */

export interface PkceVerificationResult {
  hasState: boolean;
  hasVerifier: boolean;
  stateKey?: string;
  verifierKey?: string;
  allSupabaseKeys: string[];
}

/**
 * Verifies PKCE storage by checking localStorage for required OAuth keys
 *
 * @returns {PkceVerificationResult} Object with verification results
 */
export function verifyPkceStorage(): PkceVerificationResult {
  const keys = Object.keys(localStorage).filter(k => k.startsWith('sb-'));
  const stateKey = keys.find(k => k.includes('oauth-state'));
  const verifierKey = keys.find(k => k.includes('code-verifier'));

  const hasState = !!(stateKey && localStorage.getItem(stateKey));
  const hasVerifier = !!(verifierKey && localStorage.getItem(verifierKey));

  console.groupCollapsed('[PKCE Verification]');
  console.log('All sb-* keys:', keys);
  console.log('oauth-state present:', hasState);
  console.log('code-verifier present:', hasVerifier);
  if (stateKey) console.log('state key:', stateKey);
  if (verifierKey) console.log('verifier key:', verifierKey);
  console.groupEnd();

  return {
    hasState,
    hasVerifier,
    stateKey,
    verifierKey,
    allSupabaseKeys: keys,
  };
}

/**
 * Returns detailed PKCE storage information for debugging
 */
export function getPkceDebugInfo(): string {
  const result = verifyPkceStorage();

  const status = result.hasState && result.hasVerifier ? '✅ PASS' : '❌ FAIL';

  return `
[PKCE Debug Info] ${status}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
State Present:    ${result.hasState ? '✅' : '❌'}
Verifier Present: ${result.hasVerifier ? '✅' : '❌'}
State Key:        ${result.stateKey || 'N/A'}
Verifier Key:     ${result.verifierKey || 'N/A'}
All Supabase Keys: ${result.allSupabaseKeys.length} found
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  `.trim();
}
