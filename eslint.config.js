import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { globalIgnores } from 'eslint/config'

// A bare relative '/api/...' URL works in dev (the Vite proxy in vite.config.ts
// forwards it to localhost:4000) but 404s in production: vercel.json has no
// /api rewrite, so the SPA catch-all serves index.html and the caller tries to
// JSON.parse a page of HTML. Everything must go through src/lib/api.ts, which
// prefixes API_BASE (the real backend host) and attaches the Supabase JWT.
const RELATIVE_API_URL_MESSAGE =
  "Relative '/api/...' URLs 404 in production (vercel.json has no /api rewrite). Use apiFetch/api from src/lib/api.ts, or prefix the path with `${API_BASE}`."

const noRelativeApiUrls = [
  "CallExpression[callee.name='fetch']",
  "CallExpression[callee.name='axios']",
  "CallExpression[callee.object.name='axios']",
]
  // \x2f is a literal '/'. esquery's selector parser terminates a regex at the
  // first '/' and does NOT honour a '\/' escape, so the slash must be written
  // as a hex escape or the whole config throws at lint time.
  .flatMap((call) => [
    `${call}[arguments.0.value=/^\\x2fapi(\\x2f|$)/]`,
    `${call}[arguments.0.quasis.0.value.raw=/^\\x2fapi(\\x2f|$)/]`,
  ])
  .map((selector) => ({ selector, message: RELATIVE_API_URL_MESSAGE }))

export default tseslint.config([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', ...noRelativeApiUrls],
    },
  },
])
