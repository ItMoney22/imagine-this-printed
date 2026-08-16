import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@lib': fileURLToPath(new URL('./src/lib', import.meta.url))
    }
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production')
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true
      }
    }
  },
  build: {
    // 700KB (down from 1000KB): tight enough to flag real regressions, loose
    // enough not to warn on the lazy model-viewer chunk (see note below).
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          router: ['react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          motion: ['framer-motion'],
          // Heavy, lazy-only libraries: kept OUT of the eager vendor/router
          // chunks so they stay behind their React.lazy()/dynamic import()
          // boundaries instead of loading on every route.
          konva: ['konva', 'react-konva'],
          // Bundles Three.js internally (~980KB) — inherent to the library,
          // only ever pulled in via dynamic import() behind a 3D-viewer
          // route, never on the critical path. Not further splittable.
          'model-viewer': ['@google/model-viewer'],
          stripe: ['@stripe/react-stripe-js', '@stripe/stripe-js']
          // NOTE: @aws-sdk/* is intentionally NOT chunked here. src/utils/storage.ts
          // is the only importer and it is dead code (its sole consumer,
          // StorageSettings.tsx, is never imported by any route) — chunking it
          // produced an empty 0KB chunk and a build warning for nothing.
        }
      }
    }
  }
})
