import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Split vendor code by package so an app deploy doesn't invalidate the
        // framework in users' caches. The string-array form of manualChunks
        // missed react-dom/client, which left the whole reconciler in the entry
        // chunk; matching on the resolved path is reliable.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (/node_modules\/(framer-motion|motion-dom|motion-utils)\//.test(id)) return 'motion'
          if (/node_modules\/(react-router|react-router-dom)\//.test(id)) return 'router'
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react'
          return 'vendor'
        },
      },
    },
  },
})
