import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt' never activates a new service worker behind the user's back —
      // important here because a silent reload mid-quiz would lose answers.
      // The update UI itself is a component and is NOT defined in this package;
      // `src/pwa.ts` exports the hook a component should call.
      registerType: 'prompt',
      // 'auto' injects a plain registration script when nothing in src imports
      // `virtual:pwa-register*`. That means offline works from day one, before
      // any update-prompt component exists. Once a component imports the hook,
      // the plugin stops injecting and the component owns registration.
      injectRegister: 'auto',
      // Keep the service worker out of `vite dev`. Other agents are working in
      // this repo concurrently and a stale SW in dev is a nasty false bug.
      devOptions: { enabled: false },
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        id: '/',
        name: 'NECPrep',
        short_name: 'NECPrep',
        description:
          'Practice platform for the Nepal Engineering Council licence exam. Chapter practice, timed mock tests, flashcards and progress tracking — fully offline.',
        lang: 'en',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait-primary',
        theme_color: '#0b0b0f',
        background_color: '#0b0b0f',
        categories: ['education'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/icons/maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // App shell: every hashed build output plus the self-hosted woff2.
        // `.json` is deliberately absent — the question bank under public/data is
        // ~968 KB and is handled by the runtime cache below instead, so a first
        // paint is never blocked waiting for the whole bank to precache.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,woff2}'],
        // The latin-ext Inter subset (85 KB) covers accented Latin that this
        // English UI never renders; the browser only requests it if such a glyph
        // appears. Precaching it would put 85 KB of dead weight on every first
        // install over 3G. It is still runtime-cached below if ever fetched.
        globIgnores: ['**/inter-latin-ext-*.woff2'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        clientsClaim: false, // 'prompt' flow: the user decides when to take over.
        skipWaiting: false,
        runtimeCaching: [
          {
            // The question bank. StaleWhileRevalidate: serve the cached copy
            // instantly (works with no connection at all) and refresh in the
            // background when there is one. This is the whole offline story —
            // ~968 KB of JSON is all the app needs to be fully usable on a
            // dropped connection.
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin && url.pathname.startsWith('/data/'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'necprep-question-bank',
              expiration: {
                maxEntries: 64,
                maxAgeSeconds: 60 * 60 * 24 * 90, // 90 days
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Any font not in the precache (currently only the latin-ext Inter
            // subset). Immutable hashed filenames, so CacheFirst is safe.
            urlPattern: ({ request, sameOrigin }) => sameOrigin && request.destination === 'font',
            handler: 'CacheFirst',
            options: {
              cacheName: 'necprep-fonts',
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
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
