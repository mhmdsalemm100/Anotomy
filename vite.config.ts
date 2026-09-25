import { defineConfig } from 'vite';

// Relative base so the build works from any sub-path (GitHub Pages serves the
// site from /<repo>/). Navigation uses the URL hash, never real paths.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    assetsInlineLimit: 0,
  },
  server: { host: true },
});
