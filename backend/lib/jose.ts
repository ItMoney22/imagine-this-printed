/**
 * Dynamic jose loader for CommonJS compatibility
 *
 * jose@6 is ESM-only, but Node.js supports dynamic import() in CommonJS.
 * This loader allows us to use jose@6 without converting the entire backend to ESM.
 */

export async function jose() {
  const mod = await import('jose');
  return mod;
}
