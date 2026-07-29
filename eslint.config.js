import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { globalIgnores } from 'eslint/config'

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
])
