module.exports = {
  globDirectory: 'dist',
  globPatterns: ['**/*.{html,js,mjs,css,json,webmanifest,png,svg,ico,ttf,wasm,bcmap}'],
  swDest: 'dist/sw.js',
  navigateFallback: '/index.html',
  cleanupOutdatedCaches: true,
  clientsClaim: true,
  skipWaiting: false,
  maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
  runtimeCaching: [
    {
      urlPattern: ({ request }) => request.mode === 'navigate',
      handler: 'NetworkFirst',
      options: {
        cacheName: 'growai-pages',
        networkTimeoutSeconds: 3,
        expiration: { maxEntries: 20, maxAgeSeconds: 7 * 24 * 60 * 60 },
      },
    },
    {
      urlPattern: ({ request }) => request.destination === 'image',
      handler: 'CacheFirst',
      options: {
        cacheName: 'growai-images',
        expiration: { maxEntries: 40, maxAgeSeconds: 30 * 24 * 60 * 60 },
      },
    },
  ],
};
