import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const hmrClientPort = process.env.VITE_HMR_CLIENT_PORT;

export default defineConfig({
  build: {
    // Vite inlines assets under 4 KiB as `data:` URIs inside the CSS; the
    // production CSP (`font-src 'self'`, RFC-02 R5, RFC-13 R5) forbids them,
    // so every asset stays a file.
    assetsInlineLimit: 0,
  },
  plugins: [
    // Tests live next to the routes they cover (e.g. routes/app.test.tsx).
    tanstackRouter({
      target: 'react',
      // Under Vitest the split would make the first render of every test file
      // import and transform its route chunk inside `findByRole`'s 1 s budget,
      // which is what timed out under load (issue #99); the e2e suite runs the
      // production build, split included.
      autoCodeSplitting: !process.env.VITEST,
      routeFileIgnorePattern: '\\.test\\.tsx?$',
    }),
    react(),
    tailwindcss(),
  ],
  server: {
    // Only the Docker dev stack (which sets VITE_HMR_CLIENT_PORT) needs every
    // interface, so Caddy can reach Vite; on a laptop stay on loopback (issue #13).
    host: hmrClientPort ? '0.0.0.0' : 'localhost',
    port: 5173,
    strictPort: true,
    // Behind Caddy in Docker the browser reaches Vite through port 80 (docs/gotchas/docker.md).
    hmr: hmrClientPort ? { clientPort: Number(hmrClientPort) } : undefined,
  },
  test: {
    name: 'web',
    environment: 'jsdom',
    // Loads jsdom once per worker instead of once per file (it was a third of
    // the suite's CPU time) while keeping a fresh window per file; under
    // parallel load the per-file build starved a test in some other file past
    // Testing Library's timeout (issue #99).
    pool: 'vmThreads',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
