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
  globalIgnores([
    'dist',
    'backend/dist',
    // Root-level snippet/scratch files — not imported anywhere; two don't even parse.
    'AI_HANDLERS_TO_WIRE.ts',
    'IMAGINATION_STATION_DPI_PATCHES.tsx',
    'IMAGINATION_STATION_CODE_ADDITIONS.tsx',
    'handlersToAdd.ts',
  ]),
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
    rules: {
      // Legacy-debt ratchet (2026-07-26): ~1.9k pre-existing violations of these rules.
      // Kept visible as warnings so the new CI lint gate can pass while still failing
      // on every other error class. Fix the backlog, then re-promote rule by rule.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-unsafe-function-type': 'warn',
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'warn',
      '@typescript-eslint/no-namespace': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
      'prefer-const': 'warn',
      'no-case-declarations': 'warn',
      'no-useless-escape': 'warn',
      'react-refresh/only-export-components': 'warn',
      // 5 pre-existing conditional-hook sites (KioskRoute, UserProfile) — real bugs to
      // fix in a dedicated pass, tracked on the Watchtower board.
      'react-hooks/rules-of-hooks': 'warn',
    },
  },
  {
    // backend/ runs on Node, not in the browser — without this, Node globals like
    // process/Buffer/__dirname lint as undefined under rules that consult globals.
    files: ['backend/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', ...noRelativeApiUrls],
    },
  },
])
